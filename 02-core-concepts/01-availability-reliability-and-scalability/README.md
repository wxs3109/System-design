# Availability, Reliability and Scalability

These three words do not answer the same question: availability focuses on "whether the service can be served", reliability focuses on "whether the results continue to be correct", and scalability focuses on "whether the target can be maintained after the load increases." When designing the system, you should first write them into measurable goals, and then talk about copies, caches and shards.

## 1. First distinguish several concepts that are easily confused.

| Concepts | Questions to answer | Common indicators | Counterexamples |
|---|---|---|---|
| Availability Availability | Is the service available to the user at this time? | Successful request ratio, serviceable time ratio | The interface keeps returning error results, but the HTTP status is 200 |
| Reliability | Can the system continue to give correct results over a period of time? | Correct completion rate, lost order rate, repeat execution rate | The payment interface is accessible, but the same amount of money was deducted twice |
| Durability | Will the confirmed written data be lost? | Annual object loss probability, recovery verification results | The database and backup are lost at the same time after the write request is successful |
| Scalability | Can goals be maintained by adding resources as load grows? | Maximum QPS, number of concurrencies, unit resource throughput, expansion time | Single machine performance is very high, but it cannot be expanded after reaching the upper limit |
| Elasticity | Can resources increase or decrease in time with the load? | Expansion and contraction are time-consuming and over-provisioning ratio | Machines can be added manually, but it takes two days |

These properties may conflict with each other. For example, the ticketing system refuses to sell tickets when the main database loses contact, which will reduce write availability, but prevents one ticket from being sold to two people, improving business reliability.

## 2. State your goals clearly with SLI, SLO and SLA

- **SLI (Service Level Indicator)**: actual measured values, such as successful request ratio, P99 latency, message freshness.
- **SLO (Service Level Objective)**: Internal goal, such as "99.95% of homepage requests within a 30-day window are successful within 300 ms."
- **SLA (Service Level Agreement)**: External commitments and consequences for failure to meet standards are usually looser than internal SLOs.
- **Error Budget**: Allowed percentage that does not meet the target. The error budget for a 99.9% SLO is 0.1%.

A rough calculation of availability by time:

$$
A = \frac{\text{Serviceable time}}{\text{Total time}}
$$

| Monthly Goal | Allowed unavailability time in 30 days (approximately) |
|---:|---:|
| 99% | 7 hours 12 minutes |
| 99.9% | 43 minutes 12 seconds |
| 99.95% | 21 minutes 36 seconds |
| 99.99% | 4 minutes 19 seconds |

But "online time" often masks local failures. More practical is to measure by request:

$$
A_{request}=\frac{\text{Valid requests that meet correctness and latency requirements}}{\text{All eligible requests}}
$$

### Example: News Feed should have multiple SLIs

Just counting `GET /feed` and returning 200 is not enough. can be defined separately:

- 99.95% of home pages are read successfully;
- 99% of homepage reads are completed within 300 ms;
- After an ordinary author posts, 99% of fans will see it within 10 seconds;
- After Celebrity Author posts, 99% of users can read it from the Author Timeline within 3 seconds.

This corresponds to two different distribution paths in the case, and the slower one cannot be covered by an average freshness. See [News Feed: Capacity Estimation and SLO](../../06-case-design/02-specific-application-system/03-news-feed/08-resumable-production-version-news-feed/02-capacity-estimation-and-slo.md).

### When is it worth raising a “9”?

First answer what business losses the failure caused. Internal reporting from 99.9% to 99.99% may be of no value; a payment authorization portal down for one minute may directly impact revenue. Each additional 9 usually comes with more redundancy, automatic switchover, data replication, drills, and operational costs.

An executable goal must at least state:

1. **Service object**: Which API, task or user journey;
2. **Success Criteria**: Whether the status code, correctness, and delay meet the standards at the same time;
3. **Statistics window**: rolling 30 days, natural months or every 5 minutes;
4. **Exclusions**: Whether to exclude client cancellations, illegal requests and planned maintenance;
5. **Measurement location**: client, gateway or server;
6. **Grouping method**: Whether regions, tenants, and read and write paths are counted separately.

## 3. Reliability is not “never failing”, but failing and recovering in a controlled manner

Distributed systems experience process crashes, network packet loss, disk corruption, configuration errors, and dependency slowdowns. The goals of reliability design are:

- Failure will not spread indefinitely;
- Key semantics are still correct, or explicitly rejected;
- Able to determine the scope of influence;
- Ability to restore data and services;
- Ability to verify recovery results instead of just looking at process restarts.

### Example: Why does a post need to be "recoverable"?

Posts may span the Post database, Outbox, Message Queue, Timeline Worker, and FeedItem Store. The Worker may still fail after the database submission is successful. A reliable solution is not to require that all components never fail, but to:

- Post and Outbox are submitted in the same local transaction;
- The message is delivered at least once;
- Worker is idempotent through business unique keys;
- Enter DLQ after exceeding the retry budget;
- Reconciliation of Derived Index using Fact Table.

In this way, known failures can be Retryed, and Silent Data Loss can be discovered through Reconciliation. See [News Feed: Write Reliability](../../06-case-design/02-specific-application-system/03-news-feed/08-resumable-production-version-news-feed/09-write-reliability.md).

## 4. How redundancy improves availability, and why it’s not free

If the two instances are truly independent and the single-instance availability is $a$, and any instance can be serviced if it is available, then the ideal availability is:

$$
A = 1-(1-a)^2
$$

But in reality "independence" is a strong assumption. Two instances may share:

- The same database, rack, Availability Zone or DNS;
- The same misconfiguration and release version;
- The same Identity Service, Certificate or Quota;
- The same code defect will be triggered at the same time.

Therefore, an increase in the number of replicas does not equal an increase in availability according to the formula. Truly effective redundancy spans the target failure domain and deals with the following costs:

| Redundancy options | Benefits | New costs or risks |
|---|---|---|
| Multi-instance stateless service | Endpoint Removal can be executed in case of single process failure, and horizontal expansion is possible | Load balancing, health check, release consistency |
| Database replica in the same region | Quickly switch to the master and share read requests | Replication delay, mistaken master switch, old data reading |
| Cross-availability zone replicas | Tolerate room-level failures | Increased write latency and cross-zone traffic costs |
| Cross-regional disaster recovery | Tolerating regional failures | RPO/RTO, dual-master conflict, drill complexity |
| Multi-cloud | Reduce the risk of single cloud failure | Lowest common denominator architecture, personnel and network costs are high |

### Health Check must test "can it serve"

- **Liveness**: Whether the process needs to be restarted; do not restart all instances just because one downstream fails briefly.
- **Readiness**: Whether the instance should currently receive traffic; it should be removed from the Load Balancer when the connection pool is exhausted and the configuration is not loaded.
- **Deep Health Check**: Verify key dependencies, suitable for Monitoring, and not suitable for high-frequency driver instance restarts.

Incorrect health checks can cause synchronous restarts or repeated master cuts, which are more serious than the original failure.

## 5. Scalability: Find the growth dimension first, and then choose the expansion method

"Support 100 million users" is not a capacity requirement. At a minimum, an estimate should be made of:

- Peak read and write QPS, instead of just looking at the daily average;
- Active connections and request concurrency;
- Total data volume, daily growth and retention period;
- Object size, inbound and outbound bandwidth;
- Hotspot distribution, e.g. 1% of authors generate 50% of reads;
- Additional capacity required for Batch Processing, Replay and post-disaster catch-up.

The amount of concurrency can be estimated as a first step using Little's Law:

$$
L = \lambda W
$$

If the entrance is 10,000 QPS and the average request takes up 200 ms of connection, then the average online request alone is about $10{,}000 \times 0.2=2{,}000$ concurrency; long connections and retries have not been calculated.

### Vertical expansion and horizontal expansion

| Choice | When to Suit | Advantages | Upper Limits and Costs |
|---|---|---|---|
| Vertical expansion (Scale Up) | Early system, strongly consistent single database, short-term emergency | Simple, less modification | Hardware has upper limit; upgrade may cause downtime; larger fault radius |
| Scale Out (horizontal expansion) | Stateless computing, high concurrent reading, partitionable data | Capacity can be gradually increased and faults can be dispersed | Routing, Sharding, Consistency and Rebalancing are more complex |

Usually, the computing layer is made stateless and scaled out first, and then the database bottleneck is dealt with based on the evidence. Don't shard prematurely for "potentially large futures"; sharding immediately introduces cross-shard queries, hotspots, migrations, and transaction boundaries.

### Scalability is not just about maximum throughput

A good capacity verification is to observe when the load increases:

- Whether P95/P99 rises sharply;
- Whether the error rate and the age of the oldest task in the queue increase;
- Whether the throughput increases approximately with each additional instance;
- Which resource is saturated first: CPU, memory, connection pool, disk IOPS or downstream quota;
- Whether automatic expansion is faster than traffic increase;
- Whether there is still room left during Failure or Replay.

If Throughput increases but Tail Latency and Error Rate have crossed the SLO, it is not considered a "successful scaling".

## 6. Three specific decision-making cases

### Case A: URL Shortener Redirect

Redirect reads more than writes, and a short stale read is usually more acceptable than a complete unavailability. Multi-region Stateless Instance, Cache and Read Replica can be used to improve read availability. When creating a short link, the short code must be unique; if the Primary Store cannot be confirmed, it would rather fail to write than assign the same short code to two URLs.

**Trade-off**: The read path favors availability and low latency, and the write path favors uniqueness and reliability.

### Case B: Ticket Booking lock seat

A network partition occurs at "1 seat left" and both regions may be oversold if they continue to accept writes. Writers should be determined by a single authoritative partition or a lease with a fencing token; lock seats are rejected when authority cannot be confirmed.

**Trade**: Sacrifice write availability during partitioning to keep inventory correct. It is acceptable to read a slightly older seating map, but the final confirmation cannot be based on old data.

### Case C: News Feed Fan-out

The posting interface should not wait for millions of FeedItems to be generated. Posts in Source of Truth are persisted and returned, and Derived Feeds are generated asynchronously, measured by the Freshness SLO of "99% visible within 10 seconds." When generating Backlog, first ensure that Post can be read, and then delay non-critical work such as recommendations and notifications.

**Trade-off**: Trade short-lived Eventual Consistency for write Availability and Scalability, but must make up for Outbox, Idempotency, Monitoring and Reconciliation.

## 7. Check sequence during design

1. Write down key user journeys and correctness invariants, such as “cannot deduct money repeatedly”.
2. Define a Success Rate, Latency or Freshness SLO for each journey.
3. Estimate peak load, growth dimensions and hotspots instead of just reporting the total number of users.
4. List failure domains such as processes, nodes, availability zones, regions, and human errors.
5. Determine which failures should be rejected, retried, degraded, or recovered asynchronously.
6. Select redundancy that spans the target failure domain and write out the replication and switchover semantics.
7. Reserve capacity for Failure, Retry, Replay, and Scaling.
8. Validate SLOs, RPOs, and RTOs through fault injection and recovery drills.

## 8. Common misunderstandings

- **"Three replicas are deployed, so there are three 9's"**: The replicas may share a fault domain and the switchover may fail.
- **"HTTP 200 even if available"**: Wrong, blank, or severely out-of-date results should not be counted as valid successes.
- **"Average latency is good"**: P99 may have timed out the most important users.
- **"Automatic expansion can handle all peaks"**: Expansion has detection and startup delays, and the downstream may not be able to expand.
- **"If you have a backup, you can restore"**: There is no regular recovery verification, recovery sequence and the owner's backup is just hope.
- **"Same SLO for all features"**: Login, payments, search suggestions and offline reporting have completely different business costs.

## 9. One sentence summary

Define the measurable goal of "correct service" first, then design redundancy and scaling around failure domains and load growth; availability, reliability, and scalability are not components, but the nature of the system that is verified by failures and capacity.
