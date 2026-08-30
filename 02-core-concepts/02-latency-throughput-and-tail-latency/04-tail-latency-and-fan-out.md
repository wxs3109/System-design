#Tail Latency and Fan-out

Tail Latency is not a rare exception that can be ignored. When a page requires multiple dependencies, a query requires multiple Shards, or a user performs many operations a day, the probability of encountering at least one slow request increases rapidly.

## Why Fan-out amplifies Tail Latency

Assuming that the probability of a branch completing within the target time is $p$, requesting parallel access to $n$ independent branches, and having to wait for all to complete, the probability that all branches will be completed on time is:

$$
P(\text{all fast})=p^n
$$

The probability of at least one slow branch is:

$$
P(\text{at least one slow})=1-p^n
$$

If each shard has a 99% probability of completing within 50 ms, when querying 100 shards, the probability of at least one timeout is approximately:

$$
1-0.99^{100} \approx 63.4\%
$$

Independence assumes that GC, shared networks, and hotspots in production will make slow requests relevant, and actual results may be worse. The significance of this formula is to illustrate that wide Fan-out is inherently dangerous and is not intended to replace stress testing.

## Common sources of Tail Latency

| Source | Typical symptoms | Verification methods |
|---|---|---|
| Queuing | P99 suddenly rises when QPS is close to capacity | queue wait, concurrency, utilization curve |
| GC, scheduling and Page Fault | Periodic pauses, large differences between instances | Runtime pause, CPU steal, memory/page missing |
| Hot spots and skew | Overall resources are normal, but a few keys/shards are very slow | per-shard, key bucket, tenant dimensions |
| Large requests or slow queries | Latency grows with object size/scan volume | payload size, rows scanned, query plan |
| Cache miss | The miss path forms the second slow peak | Hit/miss are counted separately |
| Connection establishment and pool wait | Short service time but long total time | DNS/TLS, pool wait, new connection rate |
| Shared dependency Jitter | Multiple upstreams slow down at the same time | Distributed Trace and Dependency Metrics |
| Background work contention | Deterioration during compaction, backup, backfill | IO/CPU grouping and task time correlation |
| Retry | A single failure becomes a long delay and increases the load | attempt count, retry reason, total deadline |

## Reduce synchronization Fan-out first

A more fundamental approach than "hedging each branch" is usually to reduce the number of synchronized branches:

- Precompute or maintain inverted index to avoid Scatter-Gather every time;
- Use shard keys that match the access pattern so that a query falls on one or a small number of shards;
- Batch reading to reduce network round-trips and connection pool competition;
- Cache stable aggregation results;
- Move unnecessary dependencies out of the synchronization path;
- For search and recommendation, only query candidate shards or hierarchical aggregations instead of broadcasting to all nodes.

The costs are Write Amplification, Derived Data Staleness, Cache Consistency and a more complex data model. The choice is driven by read-write ratio, update frequency, and Freshness SLO.

## Deadline and partial results

Not all Fan-outs have to wait for full results:

- Search can merge returned shards before deadline and mark results as possibly incomplete;
- Recommendations can be filled with alternate content;
- When the feed completes 20 items, more candidates can be selected, and a non-key enrichment will be skipped if it times out;
- Balances, permissions and locks cannot be guessed based on partial results and should fail quickly or remain in an indeterminate state.

Whether to allow partial results is business semantics and cannot be decided by the basic library after timeout. Responses and metrics should be able to differentiate between complete, degraded, and failed, otherwise a "200 OK" will mask quality degradation.

## Hedged Request: Hedging slow copies carefully

For idempotent reads, if the first replica exceeds the latency threshold and still does not return, the same request can be sent to another healthy replica, accepting the first successful result and canceling the other one. It can alleviate occasional slow nodes, but will increase load.

Applicable conditions:

- The operation is read-only or the side effects are strictly idempotent;
- Equivalent copies with independent fault domains;
- Only trigger on a small number of requests that exceed the higher quantile threshold;
- The system is not overloaded and has a global Hedge Budget;
- The loser can cancel or its additional costs are controllable.

Not applicable: write requests, simultaneous replication of all requests, strongly correlated sharing bottlenecks, and overloaded systems. If hedging is issued twice from the beginning of the request, the load will be approximately doubled, but the tail delay will be worsened.

## Speculative Execution and Straggler

In offline MapReduce or sharded batch tasks, an abnormally slow task can block the entire stage. If the task is repeatable and the output is submitted atomically by attempt, you can start a speculative attempt in other workers and only accept one winner.

The common requirements for this and online hedging are that repeated executions cannot produce repeated side effects, and late submissions of old attempts are rejected by the attempt ID or fencing token. When data locality is poor or the input itself is anomalous, blindly copying tasks simply duplicates expensive work.

## Tail-Tolerant Design Checklist

- Directly measure P99/P99.9 end-to-end without adding stage quantiles.
- Segmentation by instance, shard, tenant, hit status and object size.
- Limit synchronization fan-out width, single branch deadline and overall parallelism.
- Differentiate between essential data and degradable enrichment.
- Cancel slow branches after expiration to avoid ghost work continuing to occupy resources.
- Hedging and retries share additional traffic budget and are turned off when overloaded.
- Periodically verified under cache miss, single shard slowness and single zone failure conditions.

[Previous section: Delay budget](03-latency-budget-deadline-and-critical-path.md) · [Next section: Queuing and overload](05-queueing-backpressure-and-overload-protection.md) · [Return to the entrance of this chapter](README.md)
