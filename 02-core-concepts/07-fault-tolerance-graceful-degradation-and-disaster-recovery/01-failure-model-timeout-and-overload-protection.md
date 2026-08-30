# Failure Model, Timeout and Overload Protection

## 1. First clarify the fault model

Before designing for fault tolerance, first identify what faults you want to tolerate. Otherwise "high availability" has no boundaries.

| Fault hierarchy | Examples | Common protection methods |
|---|---|---|
| Process/container | Crash, memory leak, deadlock | Multiple instances, health check, automatic restart |
| Node | Hardware failure, operating system failure | Cross-node copy, rescheduling |
| Rack/fault domain | Power supply or network switch failure | Cross-rack placement, anti-affinity |
| Availability Zone | Data center network or power outage | Cross-zone replication, cross-zone load balancing |
| Region | Large-scale network, control plane or natural disaster | Cross-region backup/replication, region switching |
| Dependencies | Slow database, DNS failure, quota exhaustion | Timeout, Circuit Breaker, Bulkhead, Cache/Graceful Degradation |
| Data | Accidental deletion, bad writing, silent damage | PITR, immutable backup, verification, reconciliation |
| People and software | Misconfiguration, defect release, key rotation failure | Grayscale, fast rollback, approval, audit |

### Crash-stop and partial failure

It is easy to find that the process is completely stopped; partial failures are more common in distributed systems: dependencies can still respond, but change from 50 ms to 5 seconds; an availability zone can be left but not entered; the master replica considers itself the master; some users receive incorrect data.

So it must be handled explicitly:

- Timeout and result unknown;
- Slow nodes and tail delays;
- Network Partition and Split Brain;
- Duplicate, lost and out-of-order messages;
- Data corruption rather than just service outage.

## 2. Basic sequence of troubleshooting

A dependency failure is usually handled in the following order:

1. **Set deadline**: Do not let the call wait indefinitely.
2. **Limit concurrency and queuing**: Do not let slow dependencies occupy all resources.
3. **Limited retries for safe operations only**: Absorb transient failures.
4. **Enable Circuit Breaker** for dependencies that continue to fail: fail quickly to give downstream recovery space.
5. **Graceful Degradation** according to business semantics: retain the critical path and close minor functions.
6. **Gradual recovery after repair**: A small amount of detection and gradual increase in traffic to avoid instant recurrence.
7. **Replay and Reconciliation**: Complete the data results within the fault window.

Immediately retrying infinitely when the downstream is overloaded will amplify a local slow failure into resource exhaustion of the entire site.

## 3. Timeout sets boundaries for resource usage

All remote calls, database queries, and queue waits should be capped. A timeout that is too long will cause threads, connections, and memory to be filled up with slow requests; a timeout that is too short will create false failures and retry storms.

The outer budget should be larger than the inner one, and the remaining deadlines should be propagated downstream:

| Tier | Sample Cap |
|---|---:|
| Client | 3,000 ms |
| API Gateway | 2,500 ms |
| Business Services | 2,000 ms |
| Database | 1,500 ms |

After timeout, downstream work that has no value should be canceled. If the client has given up and the request continues to be executed by each service, a large amount of "ghost traffic" will be generated.

Different routes cannot share an arbitrary global value: reasonable budgets for user queries, lock sockets, batch exports, and long polling are different. Long tasks should be submitted asynchronously and return the task ID, rather than letting the HTTP connection wait for several minutes. For retry semantics, see [Impotent, Retry and Deduplication](../06-idempotency-retry-and-deduplication/).

## 4. Overload Protection: Bounded Queue and Load Shedding

When the arrival rate continues to be greater than the processing rate, unbounded queues will only change "immediate failure" into "delayed failure after occupying a lot of memory". The system should be set to:

- Maximum number of concurrency and connections per instance;
- short, bounded waiting queue;
- Quotas per tenant, route and priority;
- Return `429` or `503` when the upper limit is exceeded;
- Reserve capacity for critical traffic such as health checks, logins, payment callbacks, etc.

### The difference between Load Shedding and current limiting

- **Rate Limiting**: Manage traffic according to predefined quotas, such as 100 times per second per tenant.
- **Load Shedding**: When the system is close to saturation, low-priority work is actively discarded to protect the overall system.

Both should happen as early as possible. A request is rejected after entering ten levels of dependencies, which has consumed a lot of resources.

### Example: News Feed backlog recovery

After a FeedItem shard fails, the system must simultaneously handle new posts, historical backlogs, and retries. If the entire backlog is released in one fell swoop after repair, the shard will be overwhelmed again. The correct way is to limit the consumer rate of failed shards, reserve capacity for online reading and writing, and gradually increase the speed after observing the error rate and the age of the oldest task.

## 5. Checklist

- What failure domains across processes, nodes, availability zones, regions, data, and human errors does the target include?
- What are the deadlines, timeouts and cancellation propagation for each remote call?
- Are queues, connection pools and concurrency bounded? Who will you reject when you are full?
- How do online traffic, new traffic, retries, and disaster replays share capacity?
- Is critical capacity reserved by tenant or priority?

[Return to detailed directory](README.md)
