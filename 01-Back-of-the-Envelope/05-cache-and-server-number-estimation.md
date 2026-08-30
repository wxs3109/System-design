# Cache and server number estimation

## 1. First estimate the Cache Working Set

The cache is not the total amount of historical data, but the hot data that you want to retain within a certain time window.

$$\text{Working Set}=\text{Unique Hot Objects}\times\text{Average Cached Object Size}$$

Or a rough estimate from daily data:

$$\text{Cache Size}=\text{Daily Read Data}\times\text{Hot Fraction}\times\text{Retention Window}
$$

Assuming that daily reading involves 10 TB of unique data, 20% of which are hot objects that are accessed repeatedly, and it is hoped to cover the working set of a day, then the payload is about 2 TB. It will be larger after adding Key, object overhead, Replica, Shard Skew and margin.

## 2. Impact of hit rate on backend traffic

$$\text{Backend QPS}=\text{Read QPS}\times(1-\text{Hit Ratio})$$

If reading peak 100,000 QPS:

| Hit rate | Backend QPS |
|---:|---:|
| 90% | 10,000 |
| 95% | 5,000 |
| 99% | 1,000 |

The hit rate increased from 90% to 99%, and the backend load was reduced by 10 times. However, in reality, it is necessary to observe by endpoint, tenant, object size and time window, and a single global hit rate may cover up hot spots and critical paths.

## 3. Realistic overhead of cache memory

Caching a 1 KB payload does not only consume 1 KB of memory. May also include:

- Key, object header, pointer and allocator fragments;
- TTL, version and obsolescence metadata;
- Data structure encoding;
- Replica and migration margins.

During the interview, you can add 20%–50% overhead to the payload, multiplied by the number of copies and margin. Memory metrics and representative data measurements using real-world caching engines.

## 4. Rough estimate of service instances

The simplest interview formula:

$$
N=\max\left(
\frac{\text{Peak QPS}}{\text{QPS per Instance}},
\frac{\text{Peak CPU Work}}{\text{CPU Capacity}},
\frac{\text{Peak Bandwidth}}{\text{NIC Capacity}}
\right)
$$

Divide by target utilization and round up.

If the peak is 80,000 QPS, the interview assumes that each instance processes 1,000 QPS at the target latency and the target utilization is 50%:

$$N=\frac{80,000}{1,000\times0.5}=160$$

This is just the starting capacity. Also verify memory, number of connections, bandwidth, and downstream limits.

## 5. Single-machine assumptions available for interviews

When there is no benchmark, the following convenience values ​​can be chosen as **explicit assumptions**, which are not realistic guarantees:

- Lightweight stateless API: $10^3$ QPS per instance;
- Memory Key-Value cache: $10^5$ per node, simple operations/s;
- Database: Avoid giving universal values; you can first assume that each shard is $10^3$ for simple writes/s or $10^4$ for simple reads/s, and then emphasize the need for stress testing;
- Available cache memory for a single machine: 64 GB or 128 GB for easy calculation;
- Stand-alone network: Take 10 Gbit/s, but only use a certain proportion as a sustainable payload.

These values ​​are used to calculate whether there are 10 units, 100 units, or 10,000 units. Different requests and hardware can deviate by one or even multiple orders of magnitude.

## 6. How to obtain stand-alone capabilities in reality

Determine sustainable capacity at SLO using representative stress testing:

1. Use payload, data size and read-write ratio close to production;
2. The amount of data must exceed the unrealistic full cache state, unless the production is indeed fully cached;
3. Gradually increase pressure and observe throughput, P95/P99, errors and resource saturation;
4. Find the inflection point where latency starts to rise sharply;
5. Select a safe operating area below the inflection point;
6. Test node failure, rebalancing, deployment and cache cold start;
7. Retest regularly as code, examples, and data change.

The maximum throughput of a single machine is not a capacity target. Production typically runs at lower utilization to absorb bursts and failures.

## 7. Redundancy and Failure Capacity

If the system is deployed evenly across three availability zones, each zone will bear one-third of the traffic under normal circumstances. After losing one zone, the remaining two zones each bear half of the original total traffic, which is a 50% increase relative to their respective normal loads.

If you want to be able to withstand the peak value without expanding the capacity after a single zone failure, the capacity of each zone should cover at least 50% of the total peak value, and the entire cluster should be configured to 150% of the peak value. Reality also needs to consider Regional Traffic Cutover Time, automatic expansion speed and region-related failures.

## 8. Cache failure capacity

When the cache is completely invalidated:

$$\text{Database Load}\rightarrow\text{Full Read QPS}$$

Databases usually cannot withstand this jump. Design needs:

- Request merge and single-flight;
- TTL jitter；
- Hotspot preheating;
- Rate Limiting, Load Shedding and Graceful Degradation;
- Restore in batches to avoid simultaneous Backfill;
- Reserve backend emergency capacity.

Capacity estimation should calculate at least two scenarios: normal hit rate and full cache failure.

## 9. Boundary of automatic expansion

Automatic expansion is not instantaneous:

- There is a delay in indicator collection and judgment;
- It takes time for new instances to start, load configuration and warm up;
- Databases and stateful sharding cannot expand as quickly as stateless services;
- Bursts may overwhelm dependencies before scaling is complete.

Therefore, it is necessary to combine baseline capacity, predicted expansion, queuing, throttling and degradation.

## 10. Checklist

- [ ] Cache estimates Hot Working Set instead of all historical data?
- [ ] Are memory overhead, copies and margins outside of the payload included?
- [ ] Is the sensitivity of hit rate changes to the backend calculated?
- [ ] Is the single-machine capability a stated assumption or a stress test result?
- [ ] Who is saturated first among CPU, memory, network, connection and downstream?
- [ ] Is the capacity sufficient after an Availability Zone or node failure?
- [ ] Are cache cold start and automatic expansion delays considered?
