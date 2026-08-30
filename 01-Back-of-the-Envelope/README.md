# Back-of-the-Envelope

Back-of-the-envelope estimation is not a replacement for capacity planning, but uses a few assumptions to quickly determine orders of magnitude: approximately how many requests the system will handle, how much data will be generated, how much bandwidth will be consumed, and which components are likely to become bottlenecks first.

##Boundary of this chapter

This chapter only solves one problem: **Translating business size into numbers that can be used for architectural decisions. **

| This chapter is responsible | This chapter is not responsible | Follow-up destination |
|---|---|---|
| Estimating average and peak QPS from DAU and behavior frequency | Explain why queuing amplifies P99 | [Core concepts: latency, throughput and tail latency] (../02-Core Concepts/02-Latency, Throughput and Tail Latency/) |
| Estimate storage from object size, growth, and retention | Choose SQL, NoSQL, or object storage | [Data & Storage](../03-data-and-storage/) |
| Estimating bandwidth, Hot Working Set and machine magnitude | Talking about Cache Consistency, Shard Migration and Hotspot processing mechanism | [Core concept] (../02-Core concept/) |
| Distinguish between interview convenience value and engineering measurement value | Commit a fixed QPS or delay to a product | Product documentation, benchmark testing and production stress testing |

We can draw conclusions such as "the peak value is about 100,000 QPS, the original data is about 2 PB per year, and a single machine is not enough", but we do not decide to use Kafka, Redis, Cassandra or some kind of consistency model here. Numbers are **input** to subsequent design, not architectural answers.

## Two sets of number systems

This chapter deliberately distinguishes between two types of numbers.

### Interview approximation

For whiteboard mental arithmetic, choose integers that are easy to multiply and divide. For example:

- One day is calculated as $10^5$ seconds, which is actually $86,400$ seconds;
- A month is calculated as 30 days;
- $1\text{ KB}=10^3$ bytes，$1\text{ MB}=10^6$ bytes；
- When there is no information about the peak value, first assume 3 times the average value;
- First declare a conservative integer for the single-machine capability, and then perform sensitivity analysis.

The goal of the interview approximation is to be fast, self-consistent, and able to influence the design, not to recite the benchmark of a certain machine.

### Realistic engineering value

In reality, there is no universal "database stand-alone QPS" or "SSD fixed latency". Numbers depend on:

- Hardware generations, instance specifications and cloud platforms;
- Request size, read-write ratio, index and query complexity;
- Concurrency, connection pool, cache hit rate and data distribution;
- Persistence, replication, consistency and batching strategies;
-The average is still P95/P99;
- Steady state, burst, degraded state or single node failure state.

The real capacity should be obtained through production indicators, load testing and fault drills, and a safety margin should be retained. The realistic numbers given in this article can only be used as typical orders of magnitude or initial assumptions.

## Recommendation process

1. Write down inputs such as user size, behavior frequency, object size, retention period, etc.;
2. Calculate average and peak QPS;
3. Calculate daily new increments and accumulated storage;
4. Calculate inbound, outbound and cross-regional bandwidth;
5. Rough estimate of Cache Working Set, Partition and service instances;
6. Check units, orders of magnitude and extreme situations;
7. Clearly indicate which outcome will change the architecture.

After completing the estimation, write the results into a short Load Contract (load assumption table):

- Inlet peak and burst duration;
- Read-write ratio, request and response size;
- Daily new increments, retention period and total storage;
- Hot Working Set, Hotspot tilt hypothesis;
- Is the single machine capacity an assumed value or a stress test value?
- The capacity that needs to be reserved in the event of a single node or single availability zone failure.

Subsequent chapters will only consume this contract and will not repeat the arithmetic process from DAU to QPS.

## Chapter

- [Common orders of magnitude and unit conversion](01-commonly-used-orders-of-magnitude-and-unit-conversions.md)
- [QPS vs Peak Traffic](02-qps-and-peak-traffic-estimation.md)
- [Storage Capacity](03-storage-capacity-estimate.md)
- [Bandwidth and Network Cost](04-bandwidth-and-network-cost-estimation.md)
- [Number of caches and servers](05-cache-and-server-number-estimation.md)
- [Complete Estimation Exercise](06-complete-estimation-exercise.md)

## Interview expression template

> I'll make an order of magnitude estimate first. To make mental arithmetic easier, I approximated a day as $10^5$ seconds and assumed the peak was 3 times the average. These are interview assumptions, not production capacity commitments; in engineering I calibrate them with request distribution and stress test results.

> The key conclusion of this estimate is not that 127 machines are required exactly, but that a single machine is obviously not enough, and writes will hit the partition limit first, so the design requires horizontal sharding.
