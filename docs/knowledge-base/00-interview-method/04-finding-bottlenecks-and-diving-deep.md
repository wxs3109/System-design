# Finding Bottlenecks and Diving Deep

A high-level architecture demonstrates that a system can work. A deep dive must show that it remains sound at the target scale and under failure conditions. The interview is not about giving every box equal airtime; it is about identifying the one or two highest-risk areas and demonstrating analysis and tradeoff judgment.

## 1. What Deserves a Deep Dive

Prioritize areas that satisfy several of the following conditions:

- They directly determine whether a core requirement can be met.
- Capacity estimates put them near a single-machine or single-partition limit.
- They involve a significant consistency, reliability, or latency tradeoff.
- They present a challenge specific to the prompt rather than a generic component found in any system.
- The interviewer has shown explicit interest.

For example, upload transcoding and distribution in a media system, fan-out in a feed, spatial indexing in a mapping system, and data durability in object storage usually deserve deeper treatment than the login service.

A useful transition is:

> The high-level data flow is complete. Based on peak writes and hotspot distribution, X is the greatest risk, while Y determines the core consistency semantics. I suggest diving into X first, then discussing the failure behavior of Y.

## 2. Find Bottlenecks from Four Perspectives

### 2.1 Capacity

Map estimates onto every component:

- QPS, concurrent connections, and CPU or memory per request.
- Per-partition write throughput and storage limits.
- Network ingress, egress, and cross-region bandwidth.
- The gap between queue production and consumption rates.
- Cache working set and hot keys.

Pay attention to skew. Average QPS may look safe while a celebrity account, popular video, or monotonically increasing shard key still overwhelms a single point.

### 2.2 Latency

List the synchronous dependencies along the critical path:

```text
Total latency ≈ Queueing + Network + Service processing + Storage + Downstream dependencies
```

Fan-out calls amplify tail latency, sequential calls add latency, and cache misses create a slow path. Identify which segment dominates P95/P99.

### 2.3 Correctness and Consistency

Look for state changes that cross system boundaries:

- The dual write between a database update and message publication.
- A balance update and an external payment.
- Cache invalidation and primary-data updates.
- Primary-replica failover and replication lag.
- Cross-shard constraints and transactions.

Ask: what does the user see if only half the operation completes? Can a retry make the result worse?

### 2.4 Failures and Dependencies

For each critical component, consider what happens when it:

- Becomes completely unavailable.
- Merely becomes slow.
- Returns an error or stale result.
- Times out over the network even though the operation actually succeeded.
- Loses an availability zone or an entire region.

"It has replicas" is not a complete high-availability strategy. Detection, leader election, traffic failover, the data-loss window, and the recovery process must also be explained.

## 3. A Repeatable Framework for Diving into a Subsystem

Use these six steps to avoid getting lost in arbitrary details.

### Step 1: Restate the Goal

Define the subsystem's inputs, outputs, scale, and quality targets.

### Step 2: List Candidate Approaches

Give at least two realistic options, such as fan-out on write versus fan-out on read, synchronous versus asynchronous replication, or range versus hash sharding.

### Step 3: Establish Selection Criteria

Choose the genuinely relevant dimensions from latency, throughput, consistency, availability, complexity, and cost.

### Step 4: Choose and Explain

Say explicitly, "Given the current assumptions, I choose A," and explain why it fits the access pattern. Do not claim that it is always superior to B.

### Step 5: Explain Failures and Boundaries

Discuss hotspots, retries, staleness, recovery, and operational complexity.

### Step 6: Provide an Evolution Path

Identify the metric or scale threshold that would trigger a switch to another approach.

## 4. Questions to Answer in a Sharding Deep Dive

- Why is one machine or partition insufficient?
- How does the shard key balance even distribution with query locality?
- How are requests routed to shards?
- How are hot keys handled?
- How are cross-shard queries, sorting, and transactions handled?
- How is data rebalanced during scaling, and how do reads and writes work during migration?
- How is each shard replicated and failed over?

Saying only "shard by `user_id`" is insufficient; validate the key against the core queries.

## 5. Questions to Answer in a Caching Deep Dive

- What is cached, and what are the keys and values?
- Is the cache on the client, at the CDN, in the service layer, or in front of the database?
- Does it use cache-aside, read-through, or write-through?
- How do TTL and active invalidation work together?
- How stale may the data be?
- How are cache misses, cache stampedes, and hot keys handled?
- Can the backend withstand complete cache failure?

A cache improves average performance, but during a failure it can also send all traffic back to the primary database at once.

## 6. Questions to Answer in a Queue Deep Dive

- Why is asynchronous processing needed, and when does the user observe success?
- Which key partitions messages, and is ordering required?
- With at-least-once delivery, how are consumers made idempotent?
- How are retries, the DLQ, and poison messages handled?
- How is backlog monitored, and how do consumers scale?
- If the queue is unavailable, does the system reject work, degrade, or buffer locally?
- Is replay required, and how long are messages retained?

Do not promise "exactly once" casually. First define exactly-once business effects, then explain how idempotency, deduplication, or transaction boundaries provide them.

## 7. The 10× Traffic Test

Multiply the system scale by ten and inspect the data flow in order:

1. Traffic entry and network bandwidth.
2. Stateless service instances and connection counts.
3. Cache working set and hotspots.
4. Database throughput, capacity, and indexes.
5. Queue backlog and consumer processing capacity.
6. Third-party dependencies and cost.

Do not answer with "scale everything horizontally." Identify the first component to fail, the metric that exposes it, and the first redesign:

> At ten times the scale, the application tier can scale out, but write throughput for a single partition reaches its limit first. I will use X as the shard key to distribute writes while addressing hotspots and online migration. The cost is greater complexity for cross-shard queries and operations.

## 8. Failure Scenario Exercise

Choose one critical failure and explain it chronologically:

1. How it is detected.
2. How the blast radius is limited.
3. Whether requests fail, retry, queue, or degrade.
4. How the system fails over or recovers.
5. Whether it loses data, processes work twice, or produces stale results.
6. How recovery is verified and whether compensation is required.

Cover at least three categories:

- Failure of one instance or partition.
- A slow dependency causing a cascading failure.
- A regional outage or control-plane misconfiguration.

Common mechanisms include timeouts, exponential backoff with jitter, circuit breakers, bulkheads, load shedding, idempotency, replication, and graceful degradation. Each mechanism must address a specific failure.

## 9. How to Keep Communicating During a Deep Dive

- Explain why the area was selected.
- Draw an enlarged local diagram instead of repeatedly redrawing the entire architecture.
- For each approach, state the conclusion first, then the reasoning and cost.
- After completing a section, confirm whether the interviewer wants to continue.
- When challenged, first check whether the new condition changes an original assumption.

Useful phrasing includes:

> There are two approaches here, A and B. The current read/write ratio and consistency requirements favor A, at the cost of C. If the condition changes to D, I would switch to B.

> This timeout has an indeterminate outcome, so I cannot simply retry a non-idempotent operation. I will add an idempotency key and use status lookup as the recovery path.

## 10. Common Mistakes

- Giving every component equal attention instead of emphasizing the system's distinctive challenges.
- Discussing only the success path and ignoring timeouts and partial failures.
- Proposing an approach without alternatives or selection criteria.
- Treating replication, caches, and queues as cost-free switches.
- Letting average traffic obscure hotspots and tail latency.
- Claiming horizontal scalability without a plan for sharding, routing, and migration.
- Spending too long on implementation details and failing to return to the requirements.

## 11. Deep-Dive Checklist

- [ ] The deep-dive area follows from a core requirement, an estimate, or an interviewer signal
- [ ] Inputs, outputs, scale, and quality targets are explicit
- [ ] At least two candidate approaches were compared
- [ ] Selection criteria and primary costs are clear
- [ ] Hotspots, tail latency, and traffic skew were discussed
- [ ] Timeouts, duplicates, staleness, and partial failures were explained
- [ ] The 10× traffic test was completed
- [ ] Monitoring metrics and evolution triggers were provided
- [ ] The design was validated against the original requirements at the end
