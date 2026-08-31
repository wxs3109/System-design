# Latency Budget, Deadline and Critical Path

End-to-end targets cannot be directly replicated into each downstream Timeout. You must first draw the critical path, then allocate the budget to the network, queuing, computing, storage and necessary dependencies, and reserve time for returning responses.

## Serial addition, parallel critical path

If the stages are completely serial, the end-to-end delay is approximately:

$$
T_{total}=T_{edge}+T_{queue}+T_{auth}+T_{service}+T_{store}+T_{response}
$$

If B and C are parallel and both must be completed, this part will take about $\max(T_B,T_C)$, not the sum of the two; but its tail delay will be amplified by the slowest branch. If C is not necessary to return correct results, consider moving out of the synchronization path rather than just giving it a shorter Timeout.

The longest dependency chain in Trace is the critical path. Optimizing work that is not on the critical path may reduce costs, but it will not directly reduce user latency.

## An example of a 500 ms budget

Assume the Feed API's P99 target is 500 ms:

| Stage | P99 Budget | Description |
|---|---:|---|
| Edge, Routing and Networking | 60 ms | Region and TLS affect this value |
| Gateway itself | 25 ms | Authentication, flow limiting, routing |
| Feed Service queuing and calculation | 55 ms | Includes assembly and serialization |
| Timeline/Cache query | 90 ms | First batch of candidate IDs |
| Post batch completion | 180 ms | Necessary text, usually the leading item |
| Returns and Safety Margin | 90 ms | Jitter, Cancellation, and Writeback Responses |

These stages are not all independent, nor can the quantiles be simply added together and claim to be P99. The purpose of the table is to give each owner a project upper limit; in the end, end-to-end P99 must still be directly measured and the budget calibrated using Trace.

## Timeout, Deadline and Cancellation

- **Timeout**: The maximum waiting time for a call, usually a relative duration.
- **Deadline**: The absolute time before which the entire request must be completed.
- **Cancel**: After the caller no longer needs the results, notify the downstream to stop working.

Deadline should be propagated from the entry point along the call chain. Each layer decides whether to start work based on the remaining budget:

$$
T_{child} \le T_{deadline}-T_{now}-T_{return\ margin}
$$

When the outer layer's deadline is 500 ms, the inner layers cannot wait 500 ms each. What's more, you can't let the database query continue for several seconds after the upstream 500 ms timeout, occupying the connection pool. Downstream should receive cancellation signals and set resource-level caps on non-cancelable operations.

Timeout cannot be set to "the shorter the better" just by feeling:

- Too long: Failure is exposed slowly, threads, connections and memory are occupied;
- Too short: Healthy slow requests are accidentally killed, retry to increase the load;
- Correct approach: Derive from end-to-end SLO, dependency distribution, business value and safety margin, and configure by routing.

## When to shorten the synchronization path?

Start by asking whether a piece of work affects the correctness of the current response:

| Jobs | Common Choices | Reasons and Costs |
|---|---|---|
| Login authentication, lock condition writing | Maintain synchronization | Users must know the results immediately; dependency failures are usually fail-closed |
| Search indexing, notifications, analysis | Asynchronous | Should not dominate the main request; need to accept Stale Data and process Backlog |
| Multiple independent reads | Bounded parallelism | Reduces serial waits; increases transient concurrency and downstream pressure |
| Repeated reads of Hot Data | Cache | Reduce remote work; introduce Invalidation, Stale Data and Cache Stampede risks |
| Multiple small IOs | Batch/merge | Reduce round trips; need to wait for batching and may generate large requests |
| Large file transfer | Signed URL direct connection to object storage/CDN | Avoid occupying ordinary API resources; increase authorization and life cycle design |

See [Synchronization, Asynchronous and Event-Driven](../05-synchronous-asynchronous-and-event-driven-architecture/) for complete success boundaries, status and backlog handling of asynchronization.

## Whether the cache really shortens the critical path

Cache is suitable for data that is expensive to read, highly repetitive, and allows a certain degree of staleness. Calculate before use:

- Hit rate and hit/miss are delayed respectively;
- When the Cache fails, whether Origin can withstand the peak;
- Whether hot keys will overwhelm a single node;
- Whether invalidation and version checking increase synchronization dependencies instead.

The average expected latency can be roughly written as:

$$
E[T]=hT_{hit}+(1-h)T_{miss}
$$

But SLO can’t just look at this average. If the 1% miss is 2 s, a 99% hit rate might still be very poor around P99. Hit/miss distribution and cache invalidation events should be observed separately.

## Limits of parallelization

Parallel calls can reduce single request waits, but concentrate work into shorter times and increase downstream concurrency. For example, if the ingress is 1000 QPS and each request calls 20 shards in parallel, 20,000 downstream QPS will be generated. Must be set:

- Maximum parallelism and global concurrency upper limit;
- Per-dependency connection pooling and Bulkhead;
- Whether some results are acceptable;
- Cancel remaining requests when the deadline expires;
- Individual throttling for hot shards.

## Optimization steps

1. Use end-to-end Trace to find out the critical path and wait types.
2. Remove or asynchronousize non-essential work.
3. Incorporate remote round-trips, limit data volume and deep paging.
4. Add a cache with a clear consistency contract for reusable results.
5. Bounded parallelism when dependency capacity permits.
6. Final adjustments to implementation details, instance specifications, or capacity expansion.
7. Retest end-to-end SLO under real distribution, peak and failure conditions.

[Previous section: Capacity estimation](02-from-load-contract-to-concurrency-capacity-and-bottleneck.md) · [Next section: Tail delay](04-tail-latency-and-fan-out.md) · [Return to the entrance of this chapter](README.md)
