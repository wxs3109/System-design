# Queueing, Backpressure and Overload Protection

Queuing can absorb fluctuations from milliseconds to seconds, and can also convert short-term unavailability into recoverable backlogs; but unbounded queues will turn immediate rejection into long-delayed failure, swallowing up memory, connections, and deadlines.

## Why queuing worsens near saturation

Establish intuition using a simplified M/M/1 model: arrival rate $\lambda$, service rate $\mu$, utilization $\rho=\lambda/\mu<1$. The average system dwell time is:

$$
W=\frac{1}{\mu-\lambda}
$$

When $\lambda$ approaches $\mu$, the waiting time increases nonlinearly. For example, the average service capacity is 100 requests/s:

- Reaching 50 requests/s, the model stays for about 20 ms on average;
- Reach 90 requests/s, about 100 ms;
- Arrived at 99 requests/s, about 1 s.

Real systems are not exponentially distributed and often have multiple Workers, but the conclusion is still useful: high Utilization will amplify tiny Jitters into Queues. Safe Operating Level is determined based on request variance, burstiness, and SLO stress testing and cannot be uniformly specified as a certain CPU percentage.

## Bounded Queue and Admission Control

Decide before expensive work begins:

1. Check whether the request deadline is sufficient;
2. Check per-tenant, per-priority and global concurrency quotas;
3. Reject immediately when the queue reaches capacity or the expected wait exceeds the budget;
4. Return explicit `429` or `503`, and `Retry-After` if necessary;
5. Ensure observable state and bounded recovery for accepted tasks.

The queue limit should not be set only by "how much can fit in memory", but should be derived from the latency budget. If the maximum acceptable queuing time is 100 ms and the processing rate is about 2000/s, then even if the queue of 20,000 can be accommodated, most requests have already lost value.

## How to spread Backpressure

**Backpressure** is the downstream feedback of "I can't handle it" to the upstream, causing the upstream to slow down, pause Pull, or reject new work:

| Scenario | Backpressure method | Precautions |
|---|---|---|
| Synchronization API | Concurrency limit, `429/503`, connection pool | Client must have backoff and retry budget |
| Message consumer | Reduce prefetch, pause partition, reduce concurrency | Monitor the age of the oldest message instead of just looking at the number |
| Streaming protocol | credit/window, bounded buffer | Prevent a slow consumer from holding up all partitions |
| Batch tasks | Capacity Queue, quotas and priorities | Preventing background tasks from starving interactive traffic |

If the upstream ignores Backpressure and retry infinitely, the protection will just transfer the pressure to another layer. Ingress Rate Limit, Queue Capacity, Thread Pool, Database Connection and downstream Quota should form a consistent Concurrency Budget.

## What Queue Buffering can and cannot solve

Suppose the queue backlog is $B$, the production rate is $\lambda$, and the consumption rate is $\mu$:

$$
\frac{dB}{dt}=\lambda-\mu
$$

Short $\lambda>\mu$ can be absorbed by the queue; there must be a long enough $\mu>\lambda$ interval after the peak to clear the Backlog. If 1 million new tasks are added at the peak, the net processing capacity after the peak is 5000/s, and the theoretical Catch-up Time is at least:

$$
\frac{1{,}000{,}000}{5{,}000}=200\text{ s}
$$

If the business only allows a 60-second delay, the capacity is still substandard. In the long term $\lambda \ge \mu$, the queue simply defers failure and must be expanded, work reduced, merged/sampled, throttled, or product commitments changed.

## Load Shedding and Graceful Degradation

Core invariants and resilience should be protected during overload, typically in the following order:

1. Reject work that exceeds deadline, is duplicated or is obviously ineffective;
2. Restrict large tenants, hot keys and low-priority traffic;
3. Skip unnecessary calculations such as personalization, recommended explanations, and prefetching;
4. Return short cache, default value or partial results, but explicitly mark downgrade;
5. Retain login, payment callback, status query and control plane recovery traffic;
6. Stop new writes when necessary rather than subject the entire system to Cascading Failure.

The order of demotion is defined by the business. For example, authentication failure cannot exchange old permissions for availability; feed personalization failure can return attention streams or popular content.

## Fairness and Priority

A single FIFO queue can cause Head-of-Line Blocking for a large tenant or large task. Common methods:

- Independent queues or concurrency caps per tenant/traffic class;
- Weighted Fair Queuing or Deficit Round Robin;
- Interactive queries take precedence over background backfilling, but a minimum share is reserved for the background to prevent permanent starvation;
- Split large tasks into small work units that can be preempted;
- Cost-weighted tokens instead of counting both 1 KB and 1 GB requests as one.

Prioritization introduces starvation and reversal risks, and rejection rates, wait times, and completion delays for each type of traffic must be monitored.

## Why is Autoscaling not the first line of protection?

Capacity expansion has indicator windows, scheduling and warm-up delays, which cannot absorb instantaneous spikes; high concurrency caused by slow dependencies may also be misjudged as requiring more upstream instances, further increasing downstream pressure.

A safer combination is:

- Bounded concurrency and Admission Control immediate protection;
- Queues or short buffers absorb limited fluctuations;
- Autoscaling expands capacity based on arrival rate, in-transit volume, queue oldest age and resource saturation;
- Predictive scaling to handle known activity;
- Always subject to global caps on database connections, third-party quotas, etc.

## Overload test

Gradually increase the **arrival rate** instead of just increasing the closed-loop client thread, record:

- When does successful throughput stop increasing;
- When will P95/P99, queuing time and timeout rate reach an inflection point;
- Resources that are saturated first;
- Whether rejections are fast, explainable and prioritized;
- How long does it take to resume pressurization after stopping, and whether the backlog can be cleared;
- Whether Retry/Hedge/Reconnect allows the load to continue to be higher than the external arrival rate.

A qualified system does not necessarily accept all requests, but should maintain core paths when overloaded, reject them early, and be able to recover quickly.

[Previous section: Tail delay](04-tail-latency-and-fan-out.md) · [Next section: Case deduction](06-case-study-and-design-checklist.md) · [Return to the entrance of this chapter](README.md)
