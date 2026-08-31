# QPS and peak traffic estimation

## 1. Get average QPS from user behavior

Basic formula:

$$\text{Average QPS}=\frac{\text{DAU}\times\text{Operations per user per day}\times\text{Requests per operation}}{86,400}$$

In interviews, $10^5$ seconds are used to approximate a day. Assume 100 million DAU, each person reads 20 times per day, each time generating one backend request:

$$\frac{10^8\times20}{10^5}=20,000\text{ QPS}$$

The real divisor works out to about $23,148$ QPS. Both have the same conclusion: the average read is about tens of thousands of times per second.

## 2. Calculate different paths separately

Don’t just give “total system QPS”. Estimate separately:

- Create, update, delete, etc. write;
- Check, list, search and other reading;
- Client requests and internal fan-out requests;
- Synchronize online traffic and asynchronous background tasks;
- API QPS, database QPS, cache QPS.

An API request may check 20 shards or call 5 services, so 10,000 QPS externally does not mean that each internal component is also 10,000 QPS.

$$\text{Downstream QPS}=\text{Incoming QPS}\times\text{Average Fan-out}\times(1-\text{Upstream Hit Rate})$$

## 3. Peak estimation: interview value

When no more information is available, use and explicitly state:

- Ordinary global consumer services: 2–3 times the peak average;
- Geographical concentration, obvious commuting or evening peak hours: 3–5 times;
- Sports, ticketing, promotions or breaking news: 10x or more, and model breaking separately.

These are not industry laws. During the interview, choose an integer and explain the basis:

$$\text{Peak QPS}=\text{Average QPS}\times\text{Peak Factor}$$

If you average 20,000 QPS, peak factor 3, you peak at about 60,000 QPS.

## 4. Peak in reality

Realistic systems should be derived from time series:

- Arrival rate per minute or per second, not daily average;
- Within days, weeks, holidays and geographical distribution;
- P95/P99 window flow;
- The duration of the instantaneous burst;
- Amplification brought by Retry, Crawler, Batch Job and Failover;
- Product growth and marketing campaign planning.

“Peak 3x” can miss 50x the rush traffic in a minute. Capacity also needs to distinguish between sustainable peaks and short bursts: short bursts can be absorbed by queues, token buckets, or caches, while sustained peaks must have sufficient processing capabilities.

## 5. Concurrency estimation

Use Little's Law:

$$\text{Concurrency}\approx\text{QPS}\times\text{Average Latency in Seconds}$$

If the peak is 60,000 QPS and the average delay is 200 ms:

$$60,000\times0.2=12,000$$

About 12,000 requests are in transit at the same time. If it is a WebSocket equal-length connection, it should be estimated from the online users and simultaneous online rate, rather than using short request latency.

## 6. Architectural implications of read-write ratio

Assume that 100 million pieces of content are added every day, and each piece of content is read an average of 100 times:

- Write about $10^3$ QPS;
- Read about $10^5$ QPS;
- The peak value is multiplied by the corresponding coefficient.

More reads may promote Cache, CDN, Read Replica and Materialized View; more writes may promote Batch Processing, Log-structured Write, Sharding and asynchronous Index. But the read-write ratio is just the entry point, and it also depends on the request complexity, object size, Hotspot and Consistency.

## 7. Capacity is not as simple as dividing the peak value by the QPS of a single machine

A rough calculation for the interview can be written:

$$
\text{Instances}
=\left\lceil
\frac{\text{Peak QPS}}{\text{Assumed QPS per Instance}}
\right\rceil
$$

Add safety margin and fault redundancy. For example, for a peak of 60,000 QPS, assuming that each instance can withstand 1,000 QPS under the target delay, 60 units are theoretically needed; if only 60% of the target utilization is used:

$$\frac{60}{0.6}=100\text{ instances}$$

In reality, the capacity of a single machine must be obtained through stress testing, and it must also be ensured that critical traffic can still be met after the failure of an availability zone or a batch of nodes.

## 8. Retry Storm and Load Amplification

The actual load goes up when the failure rate is $p$ and each failure is retried at most $r$ times. Roughly speaking, 10% of requests failing and retrying once will increase traffic by about 10%; multiple service tiers each retrying may be multiplicative.

Realistic designs use Timeout Budget, Exponential Backoff, Jitter, Retry Limit, Circuit Breaker and Load Shedding. The simultaneous occurrence of Cache Invalidation, Failover, and Retry should be considered when estimating Graceful Degradation capacity.

## 9. Interview answer template

> 100 million DAU 20 reads per person per day, so ~2 billion daily reads. At $10^5$ seconds a day, that’s about 20,000 QPS on average. Considering the evening peak, I first take 3 times and get 60,000 peak QPS. This multiple is an interview assumption; it is calibrated in production using minute-level traffic, burst duration, and failure retry data.

## 10. Checklist

- [ ] Is DAU mistaken for concurrent users?
- [ ] How many internal requests will a user operation generate?
- [ ] Are reading, writing, searching and background tasks separated?
- [ ] Are average, daily peak and burst peaks distinguished?
- [ ] Do Hotspot and Fan-out cause local peaks?
- [ ] Are failures, retries, and Regional Traffic Cutover factored into capacity?
