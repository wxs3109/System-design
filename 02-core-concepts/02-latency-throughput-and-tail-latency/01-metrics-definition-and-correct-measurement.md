# Metrics: definition and correct measurement

"Interface took 100 ms" has little information without measuring boundaries and distribution. The first step should be to define the metrics into a repeatable and verifiable contract.

## Basic terminology

| Indicators | Meaning | Common misuses |
|---|---|---|
| Latency | The time for an operation from the specified starting point to the end point | Does not indicate whether to include network, queuing and retries |
| Service Time Service Time | The time it takes the resource to actually process the request | Treat it as the user's end-to-end delay |
| Response Time | Waiting time plus service time | Ignore client connection and download time |
| Throughput Throughput | The effective amount of work completed per unit time | Treat "received" as "successfully completed" |
| Arrival Rate | The amount of work entering the system per unit time | Confused with the completion rate |
| Concurrency | The number of requests, connections or tasks in the system at the same time | Directly equivalent to QPS |
| Utilization Utilization | The busy time or capacity ratio of a resource | Only look at the average CPU, ignoring single core, sharding and quota saturation |

The unit of throughput needs to match the resource: APIs look at requests/s, streaming systems look at records/s and bytes/s, storage looks at IOPS and MB/s, and video systems look at concurrent streams and egress Gbps. A single QPS is misleading when costs vary widely across requests and should be weighted by route or work unit.

## Why we must look at distribution

Assuming 99 requests take 10 ms and 1 request takes 5 s, the average is about 60 ms. This average neither describes the majority of requests nor masks severe waits for 1% of users.

Quantile $P_k$ means that approximately $k%$ of samples do not exceed this value. Common uses:

- P50: Typical requests;
- P95: Common slow requests;
- P99/P99.9: tail and large-scale user experience;
- Max: Useful for anomalies, but extremely sensitive to individual noise and cannot replace quantiles.

Quantiles cannot be added. The sum of the P99s for each of the two stages does not necessarily equal the end-to-end P99; whether they both slow down on the same request depends on the correlation. End-to-end SLO should be measured directly at the end-to-end boundary, with stage quantiles used for positioning.

## Clear measurement boundaries

There can be at least three sets of delays for the same API:

1. Client: DNS, connection establishment, TLS, upload, server processing, download and client retry;
2. Gateway: from receiving the complete request to writing the response;
3. Business services: internal queuing, computing, database and downstream RPC.

Therefore, the indicator name should have range and dimensions, such as `http.server.duration{route,status,region}`, rather than the general `latency`. Do not use unbounded labels such as original URLs and user IDs, otherwise the monitoring system itself will be overwhelmed by High-cardinality Labels.

## Correct bucketing and aggregation

- The buckets of the histogram should cover the vicinity of the SLO. For example, if the target is 200 ms, there must be sufficient accuracy nearby.
- Multi-instance average P99 is not statistically significant. Aggregable histograms should be merged and the quantiles should be recalculated, or a sketch that supports merging should be used.
- Segment by Route, Region, Status and Key Account levels while retaining the global view. Global normality may mask a partition being completely abnormal.
- Errors and timeout requests cannot disappear from latency statistics. Success latency, end-to-end latency, error rate, and timeout rate are reported separately.

## Common measurement traps

### Coordinated Omission

If Load Generator "sends the next request only after the previous request is completed", it will actually reduce the sending rate when the service becomes slow. Requests that were supposed to arrive during the blocking period did not make it into the sample, and Tail Latency was systematically underestimated.

When verifying capacity, you should try to use the Open Workload Model: send requests according to the scheduled arrival rate, and count client waiting and unfinished requests into the results. The load generator itself must have sufficient CPU, connectivity, and bandwidth.

### Preheating and cold start mixed together

JIT, connection pooling, caching, and page caching can all change the results. Cold start, post-warm steady state, and cache invalidation scenarios should be reported separately, rather than haphazardly discarding the "unsightly" first few minutes.

### Test data is too uniform

Real systems often have Zipf hotspots, large objects, deep paging, and large tenants. A stress test with uniform keys and a fixed response size can only obtain the upper limit of the experimental environment. Workloads should be generated from production masked distributions or well-defined worst-case scenarios.

### Only test successful steady state

You should also inject slow dependencies, a shard hotspot, full cache invalidation, an availability zone offline, retries and reconnections. The safe capacity of a system depends on maintaining the SLO in the event of a failure, not just the highest QPS when healthy.

## A set of executable SLOs

```text
Scenario: The logged in user reads the first page of the feed
Border: North American client edge ingress to complete received JSON response
Window: Rolling 28 days
Target: 99.95% non-server errors; successful requests P95 < 200 ms, P99 < 500 ms
Load premise: the regional peak does not exceed the declared safe capacity; 20 responses and the total text does not exceed 128 KiB
Segmentation: region, client type, cache_hit, downgrade status
```

This contract clarifies who is testing, what will be tested, and when it will be established, and it also avoids using abnormally large responses to undermine unachievable unified delay goals.

## Minimum observation combination

Adopt two perspectives: RED and USE:

- Request: Rate, Errors, Duration;
- Resources: Utilization, Saturation, Errors;
- Added queue depth/oldest task age, cache hit rate, dependency latency and Trace critical path.

The quantile tells "how slow the user is" and the saturation tells "why it is immediately slower". Both must be seen together.

[Return to the entrance of this chapter](README.md)
