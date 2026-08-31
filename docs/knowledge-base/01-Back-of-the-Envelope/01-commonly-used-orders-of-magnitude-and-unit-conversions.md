# Commonly used orders of magnitude and unit conversions

## 1. Decimal and binary units

Storage vendors and networks often use decimal units, and operating systems and memory contexts often use binary units. Just choose one set and explain it when making an estimate.

| Name | Decimal | Binary Approximation | Interview Usage |
|---|---:|---:|---|
| KB / KiB | $10^3$ B | $2^{10}=1,024$ B | Both are $10^3$ B |
| MB / MiB | $10^6$ B | $2^{20}\approx1.05\times10^6$ B | By $10^6$ B |
| GB / GiB | $10^9$ B | $2^{30}\approx1.07\times10^9$ B | By $10^9$ B |
| TB / TiB | $10^{12}$ B | $2^{40}\approx1.10\times10^{12}$ B | By $10^{12}$ B |
| PB / PiB | $10^{15}$ B | $2^{50}\approx1.13\times10^{15}$ B | By $10^{15}$ B |

Note: Network speed is usually expressed in bit/s, and data size is usually expressed in bytes.

$$1\text{ byte}=8\text{ bits}$$

So $1\text{ GB/s}\approx8\text{ Gbit/s}$, not counting protocol overhead.

## 2. Time quick check

| Time | True value | Approximate interview value |
|---|---:|---:|
| 1 minute | 60 seconds | 60 seconds |
| 1 hour | 3,600 seconds | $3.6\times10^3$ seconds |
| 1 day | 86,400 seconds | $10^5$ seconds |
| 1 month | ~2.59 million seconds (30 days) | $2.5$–$3\times10^6$ seconds |
| 1 year | 31.536 million seconds (365 days) | $3\times10^7$ seconds |

Mental arithmetic rules:

- The number of daily events divided by $10^5$ is approximately equal to the average number of events per second;
- Average QPS multiplied by $10^5$, which is approximately equal to the number of daily requests;
- The traffic per second multiplied by $10^5$ is approximately equal to the daily data volume.

For example, 100 million requests per day:

$$\frac{10^8}{10^5}=10^3\text{ QPS}$$

The true average is about $1,157$ QPS; the interview estimate of $1,000$ QPS is sufficient to determine the order of magnitude.

## 3. Common prefixes and mental arithmetic

| Quantity | Writing | Intuition |
|---:|---:|---|
| Thousand | $10^3$ | thousand |
| Million | $10^6$ | million |
| billion | $10^9$ | billion |
| trillion | $10^{12}$ | trillion |

Commonly used splits:

$$2.5\times10^8\times4\times10^3 = 10^{12}$$

Count the significant figures first, then combine the exponents. Estimates to one or two significant figures are usually sufficient.

## 4. Delay: Realistic Ranges and Interview Constants

Latency is highly dependent on hardware, load, data size, and Tail Latency. The following are just orders of magnitude common in modern data centers, not SLAs:

| Operation | Typical orders of magnitude in reality | Interview convenience value |
|---|---|---:|
| L1/L2 CPU cache | Sub-nanosecond to several nanoseconds | $1$–$10$ ns |
| Memory access | Tens to more than a hundred ns | $100$ ns |
| NVMe SSD Random Read | Dozens to Hundreds $\mu\text{s}$ | $100\ \mu\text{s}$ |
| Same area network RTT | Hundreds $\mu\text{s}$ to several ms | $1$ ms |
| HDD seek | A few ms to a dozen ms | $10$ ms |
| Cross-continental RTT | About 50–200+ ms | $100$–$200$ ms |

In reality, a database query does not equal a media access. It also includes queuing, networking, parsing, locking, caching, logging, copying, and returning data. These numbers are used in interviews to compare orders of magnitude: memory is much faster than disk, and cross-continental calls cannot meet single-digit millisecond latencies.

## 5. There is no universal constant for throughput

It is not recommended to memorize "how many requests the server handles per second". Static health checks, JSON aggregations, image processing, and complex SQL can vary by orders of magnitude on the same machine.

Real engineering practices:

- Define real request distribution and payload;
- Measure CPU, memory, I/O, connections and P99;
- Find sustainable throughput at target SLO;
- Ability to test node failures and emergencies;
- Leave headroom for releases, rebalancing, and traffic growth.

Interview practice: State a conservative assumption, such as $1,000$ QPS per instance, and then explain how the number of instances would change if the actual stress test is $500$ or $5,000$ QPS.

## 6. Little's Law

In a steady-state system:

$$L=\lambda W$$

$L$ is the average number of concurrent requests in the system, $\lambda$ is the arrival rate, and $W$ is the average processing time. If the traffic is $10,000$ QPS, the average response time is $0.2$ seconds:

$$L=10,000\times0.2=2,000$$

There are approximately 2,000 requests in the system at the same time. Realistic capacity planning also depends on Tail Latency, long connections, Burst and Queueing; during interviews, it can quickly estimate the order of magnitude of concurrent connections or workers.

## 7. Order of magnitude self-test

- Are bit and byte confused?
- The daily number is divided by $10^5$, not $10^4$?
- Does the single entry size include index, replica and protocol overhead?
- Is the average or the peak calculated?
- Is latency a single operation, end-to-end or P99?
- Does the result retain too many meaningless decimals?
