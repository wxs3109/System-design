# From Load Contract to Concurrency, Capacity and Bottleneck

This section will not teach you the complete estimation process of "DAU divided by seconds per day". [Back-of-the-Envelope](../../01-Back-of-the-Envelope/) has produced peak QPS, request bytes, working set, growth and fault margin, etc. **Load Contract**; these inputs are consumed here to determine Concurrency, Resource Saturation, Bottleneck and Safe Operating Zone.

The purpose of capacity analysis is not to guess an exact number of machines, but to identify upgrade signals that dominate resources and solutions. The number of registered users is usually not the direct load, active behavior and data distribution are. A short calculation example is reserved below, which is only used to demonstrate how the inlet traffic is amplified by the internal fan-out. The estimation arithmetic itself is not the focus of this section.

## Write the workload model first

At least make it clear:

| Dimensions | Required inputs | What will be affected |
|---|---|---|
| User behavior | DAU, daily operations per person, read-write ratio | Average request volume |
| Time distribution | Peak coefficients, activity spikes, periodic tasks | Peak capacity and queuing |
| Request cost | Request/response size, per fan-out, CPU time | Bandwidth, CPU, downstream calls |
| Data distribution | Hot keys, large tenants, large objects, shard skew | Single shard bottleneck |
| Data lifecycle | New increments, retention periods, replicas, indexes and compression ratios | Storage capacity and background maintenance |
| Failure conditions | Single instance/single zone offline, cache invalidation, dependency slowdown | Safety capacity and downgrade |

For example, 30 million DAU, each person reads the feed 20 times per day:

$$
QPS_{avg}=\frac{3\times 10^7\times 20}{86{,}400} \approx 6{,}944
$$

If the peak factor is 4, the inlet peak is about 28,000 QPS. This result is still just a starting point: a feed may read 20 objects in a single request, while a post may generate hundreds of derived writes. The internal work amplification must continue to be calculated.

## Calculate the number of requests and the number of bytes at the same time

A slow request rate can also drain the network. For example, the peak value is 28,000 QPS and the average response is 80 KiB:

$$
B_{out}=28{,}000\times80\text{ KiB} \approx 2.14\text{ GiB/s} \approx 17.2\text{ Gbit/s}
$$

In turn, small requests may be dominated by TLS, serialized, or random IOPS. Each key component is estimated separately:

- Logical QPS and physical operation amplification;
- Average and P99 bytes;
- CPU-seconds/s；
- Database IOPS, number of scanned rows and number of connections;
- Network bandwidth and new connection rate;
- Memory Working Set and Cache Hit Ratio.

## Little’s Law: Push concurrency from rate

In a stable system, the average in-transit quantity $L$, the average arrival rate $\lambda$ and the average stay time $W$ satisfy:

$$
L=\lambda W
$$

If the entrance is 20,000 requests/s and the average end-to-end time is 200 ms, then the average time is about:

$$
20{,}000\times0.2=4{,}000
$$

requests in progress. If the dependency slows down to 1 s, even if the QPS remains unchanged, approximately 20,000 request slots will be occupied. Exhausting connections, memory, and threads first exacerbates queuing, which is why slow dependencies can bring down upstream.

Little's law requires approximate stability within the observation window; when the queue continues to grow, the input rate and completion rate are not equal, and it cannot be used to cover up overload. Capacity protection should also not only configure concurrency by average latency, but also combine tails, maximum request sizes, and acceptable memory limits.

## What happens after saturation point

When the system is under low load, increasing Concurrency usually improves Throughput; after a resource approaches Saturation, new requests start queuing. Throughput tends to a plateau and Response Time rises rapidly. Continuing to pressurize may cause the effective throughput to decrease due to Context Switch, GC, Lock Contention, Cache Thrashing and Timeout Retry.

Therefore "5000 QPS per machine at 100% CPU" is not a safe capacity. The inflection point that still meets P99, error rate, and resource margin should be selected from the stress test curve. For example, a single machine meets SLO at 3000 QPS, and it is regarded as the service capacity.

## Calculate the number of instances and fault margin

Calculate each constraint separately and take the maximum value:

$$
N_{steady}=\max\left(
\frac{QPS_{peak}}{QPS_{safe,node}},
\frac{B_{peak}}{B_{safe,node}},
\frac{C_{peak}}{C_{safe,node}}
\right)
$$

If any availability zone is required to continue to carry the peak value after a failure, it must be verified based on the remaining availability zone capacity, rather than simply multiplying by a fuzzy 20% margin. For example, if 3 zones are deployed evenly, only $2/3$ of capacity will be left after losing 1 zone; when healthy, each zone cannot reach 80% for a long time. Also consider scaling startup time, Connection Draining, and dependency quotas.

## Find bottlenecks instead of just adding application instances

The throughput cap is determined by the necessary resources that are saturated first. Common signals:

| Phenomenon | Possible bottleneck | Verify first |
|---|---|---|
| High CPU, throughput grows nearly linearly with instances | Computation or serialization | Profile, CPU time per route |
| Not high CPU but requests are queued | Connection pool, lock, thread pool or downstream quota | Wait time, pool utilization, lock contention |
| Overall OK but single shard P99 high | Hot key or shard skew | QPS/bytes/queue per shard |
| Database crash after cache hit drop | Insufficient Origin Capacity | Miss QPS, Request Coalescing, DB Safe Utilization Threshold |
| The larger the batch, the higher the throughput but the P99 worsens | Waiting for the batch or large request to block | batch wait, processing time, size distribution |
| DB becomes slower after adding application instances | Connection and query amplification | Total number of connections, slow queries, IOPS |

Horizontal scaling is only effective when work can be distributed and there is room for shared dependencies. Strong global locks, single leader, hot sharding, and downstream fixed quotas will not disappear automatically due to the addition of front-end instances.

## The cost also belongs to the capacity contract

When both scenarios meet the SLO, the cost per unit of work should be compared, such as cost per million requests, per GB processed, or per minute of video. Over-replication, low-hit caching, and unbounded precomputation can cost expensive resources for little gain.

## When to evolve

Instead of triggering a transformation with "the user has reached a certain integer", use an observable signal:

- The peak safety capacity continues to exceed 60% to 70%, and the expansion time is too late to absorb the forecast growth;
- P99 has an obvious inflection point when the load increases;
- A single shard or a single tenant is approaching the physical limit;
- Unable to maintain core SLO in case of cache failure or single zone failure;
- Cost per request worsens as traffic grows.

[Previous section: Indicator caliber](01-metrics-definition-and-correct-measurement.md) · [Next section: Delay budget](03-latency-budget-deadline-and-critical-path.md) ·[Return to the entrance of this chapter](README.md)
