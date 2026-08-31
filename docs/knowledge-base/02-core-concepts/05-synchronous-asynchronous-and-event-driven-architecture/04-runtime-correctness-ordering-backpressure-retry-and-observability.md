# Runtime correctness: Ordering, Backpressure, Retry and Observability

The normal path can only show that the message can flow smoothly. The quality of an asynchronous design depends on what happens when the Consumer slows down, messages are repeated out of order, dependencies fail, and replays are backlogged.

## Ordering: Only buy the guarantee that the business really needs

Global Ordering squeezes all parallel processing into a serial bottleneck. What most businesses really need is "the related operations of the same entity in order": the same order is created first and then paid, the same post is edited first and then deleted, but different orders and different posts can be completely parallel.

A common implementation is to have the same `aggregate_id` hashed to the same Partition:

$$
partition = hash(aggregate\_id) \bmod N
$$

Within the same Partition, they are usually ordered by Offset, but there are still several pitfalls:

- Producer retries can change the write order when configured incorrectly;
- When the Consumer processes multiple messages of the same Partition concurrently, the later ones may be completed first;
- After messages flow through multiple Topics, Partition mapping may change;
- Adding Partition will not rearrange existing historical messages;
- Delayed retry queue will cause old messages to come back later than new messages.

Therefore, the key entity should also carry a monotonically increasing `aggregate_version`. Consumer only applies the state that is newer than the current version; when it finds that the version jumps, it can pause the entity, wait for missing events, or return to the fact base to calibrate.

Timestamps are not suitable for strict versions: clocks will drift, and it is entirely possible for two updates to fall on the same timestamp.

## Classifying failures is much more important than "retrying three times"

| Failure type | Example | Handling method |
|---|---|---|
| Instantaneous failure | Network jitter, transient 503 | Exponential backoff with Jitter, limited times and total duration |
| Rate Limiting/overload | Downstream 429, connection pool full | Respect `Retry-After`, reduce concurrency, and break the circuit when necessary |
| Permanent business failure | The account does not exist and the status transition is illegal | Do not blindly retry, record the final status or take business compensation |
| Poison Message | Schema cannot be parsed, required fields are missing | Isolate into DLQ, and control replay after repair |
| The result is unknown | The external call times out, but it may have succeeded | Use idempotent keys to query or retry, and never treat it as a failure directly |

Exponential backoff can be written as:

$$
delay_n = \min(cap, base \times 2^n) + jitter
$$

`jitter` is used to break up the panic caused by "all Consumers are restored at the same time". The retry budget must limit three things at the same time: the number of attempts for a single message, the cumulative duration, and the total amount of system-level retry traffic - otherwise the dependent service will be suspended again by the retry peak as soon as it slows down.

## When to ACK

- **Pre-processing ACK**: The throughput seems high, but the work is lost as soon as the process hangs up. It is only suitable for telemetry that allows loss;
- **ACK after processing**: reroll if failed, which is a common default, provided that the side effects are idempotent;
- **Batch ACK**: High efficiency, but when one item in the batch fails, it must be clear whether to re-submit the entire batch or record the status one by one.

If the processing time may exceed the visibility timeout or Lease of the message, the worker must renew the lease, otherwise another worker will run the same task at the same time. But lease renewal cannot replace idempotence - it is entirely possible that the Worker will continue to run briefly after losing the Lease. If you want to strictly prevent old holders from writing, assign a monotonically increasing Fencing Token to the Lease, and the storage layer will reject the old Token.

## DLQ is not a trash can

DLQ (Dead-Letter Queue) isolates messages that exceed the automatic retry budget from the main traffic, preventing a single Poison Message from blocking the entire Partition. Each message entering DLQ must retain at least:

- Original Topic, Partition and Offset;
- `event_id`, Entity ID, Schema Version and Trace ID;
- Error classification, last error, number of attempts and time;
- The original payload, or an auditable security reference.

DLQ must have an owner, alarms, retention period, troubleshooting tools, and replay process. Fix the root cause before replaying; use separate rate-limited channels, start with small batches, and verify idempotence and downstream capacity. Putting the entire DLQ back into the main queue is usually equivalent to repeating the accident all over again.

There is also a trade-off to be aware of: if strict ordering is a business requirement, then "skip one bad message, send it to the DLQ, and continue processing the next one" will destroy the state. At this time, you can pause the entity or the entire Partition, or let subsequent events get stuck waiting for version checking - at the expense of availability and throughput. This must be an explicit decision, not a default behavior.

## Backpressure: Make overload propagated explicitly

Just looking at the queue depth is not enough, because the cost of each task may vary significantly. More meaningful metrics are oldest message age, estimated flush time, and end-to-end visible latency.

Assuming that the current backlog is $B$, the production rate is $\lambda$, the consumption capacity is $\mu$, and $\mu > \lambda$, the rough clearing time is:

$$
T_{drain} \approx \frac{B}{\mu-\lambda}
$$

For example: There is a backlog of 600,000 items, but 2,000 new items are coming in every second. After the Consumer recovers, it can process 5,000 items per second. Then it takes $600000 / (5000-2000) = 200$ seconds, instead of $600000/5000 = 120$ seconds - new traffic is being poured in all the time.

Backpressure means are combined by priority:

1. Limit the concurrency, batch size, and number of unacknowledged messages in memory for each Consumer;
2. Expand Worker according to Lag, CPU and downstream capacity, instead of just focusing on the queue length;
3. Create fair queues for tenants or task types to prevent one large customer from eating up all resources;
4. Merge tasks that can cover each other, such as multiple "refresh indexes" of the same entity to keep only the latest version;
5. Sampling or downgrading low-value events, but never discard business facts silently;
6. When the backlog exceeds the safety threshold, the flow will be limited or rejected at the entrance to prevent unlimited storage occupation.

Consumer expansion is not infinitely effective: the number of Partitions limits the parallelism of the Consumer Group, and the write capacity of the downstream database may become a new bottleneck. Before scaling up, first determine where the real bottleneck is.

## Resource allocation during backlog recovery

After the dependency is restored, new traffic in the main queue, automatic retry, DLQ replay and historical backfill will all grab a resource at the same time. To assign them independent quotas, for example:

- 70% capacity to handle new online traffic;
- 20% clearing normal backlog;
- 10% Perform replay or backfill.

The specific ratio is determined by the SLO, but the principle remains the same: **Restoring traffic cannot starve online requests to death**. For large-scale backfilling, it is best to use independent consumer groups, independent speed limits, and checkpoints that can be paused at any time.

## End-to-end observability

The asynchronous phase cannot be judged as unsuccessful by a synchronization Trace. At least these five layers should be observed:

| Level | Indicator | Description |
|---|---|---|
| Production side | Number of publishing errors, oldest record age of Outbox | Whether the facts are entered in time Broker |
| Broker | ingress/egress, storage usage, Partition hot spots | Is the messaging platform itself healthy |
| Consumer side | Consumer Lag, oldest message age, processing P95/P99 | Consumer can’t catch up |
| Failure recovery | Retry rate, number and age of DLQs, replay rate | Whether known failures are controllable |
| Business results | Differences between Commit-to-Visible’s P95/P99, Source of Truth and Derived Data | Did users get the promised results |

`trace_id` and causation/correlation ID should be propagated in the message. However, an asynchronous stream that runs for a long time is not suitable for generating an infinitely extended Trace - a better approach is to make each stage into a new Trace, link it back to the original context, and then string it together with the business ID.

Alerts should be set around the user's budget, such as "Oldest unprocessed high-priority notification is older than 2 minutes" rather than a dry "Queue length exceeds 10,000." The same number of 10,000 messages may be completely normal during peak traffic, but may mean that the Consumer has completely shut down during low traffic in the middle of the night.

## Operation and maintenance acceptance list

- [ ] Consumer's repeated execution will not cause repeated deductions, repeated coupon issuance, or other irreversible side effects.
- [ ] A single Poison Message will not block the entire Partition indefinitely.
- [ ] Retries include classification, backoff, Jitter, and system-level budget.
- [ ] can check which stage a `event_id` is currently in.
- [ ] DLQ has Owner, can be filtered by reason, and can be played back at a limited speed.
- [ ] Monitored the oldest message age and end-to-end business delay.
- [ ] Rehearsed catching the backlog after a Consumer outage, and verified that it would not overwhelm the downstream.
- [ ] Rehearsed historical replay or derived data reconstruction.

[Previous section: Reliable Delivery](03-reliable-delivery-success-boundary-and-consistency.md) · [Return to the entrance of this chapter](README.md) · [Next section: Case deduction](05-case-deduction-how-does-the-asynchronous-boundary-fall-into-the-design.md)
