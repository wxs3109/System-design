# How to Conduct a System Design Interview

## 1. The Nature of the Interview

A system design interview is not about guessing the "standard architecture" in the interviewer's head. It is an opportunity to demonstrate a reusable engineering decision-making process within limited time:

1. Narrow an ambiguous problem into a clear scope.
2. Use orders of magnitude to identify the system's dominant constraints.
3. Propose a working end-to-end solution.
4. Find bottlenecks and design the critical paths in depth.
5. Explain tradeoffs, failure scenarios, and evolution paths.

By the end, the interviewer should clearly see that you understand the problem being solved, why the system is designed this way, and how the design behaves under load and failure.

## 2. A Reliable Through Line

The same through line applies to different prompts such as YouTube, News Feed, Google Maps, or object storage:

```text
Requirements clarification → Scale estimation → APIs / Data model → High-level architecture → Critical-path deep dive → Reliability and scaling → Summary
```

This is not a waterfall process to follow mechanically. The interviewer may ask to explore a component at any time; answer the question first, then explain where it fits in the overall flow.

## 3. Allocating a 45-Minute Interview

| Phase | Suggested Time | Deliverable | Question That Must Be Answered |
| --- | ---: | --- | --- |
| Opening and requirements clarification | 0–5 minutes | Functional scope, non-functional goals, explicit assumptions | "What exactly are we designing?" |
| Order-of-magnitude estimation | 5–8 minutes | Peak QPS, storage, and bandwidth ranges | "Where is the system under pressure?" |
| APIs and data model | 8–13 minutes | Core interfaces, entities, and access patterns | "How does data enter and leave the system?" |
| High-level architecture | 13–23 minutes | One complete end-to-end architecture diagram | "What is the simplest viable solution?" |
| Critical-path deep dive | 23–37 minutes | Detailed solutions for one or two key problems | "How do we solve the genuinely difficult parts?" |
| Reliability and scaling | 37–42 minutes | Failure handling, hotspots, monitoring, and evolution | "What happens when it fails or grows?" |
| Summary and additions | 42–45 minutes | Design recap, tradeoffs, and uncovered items | "What is the final design and its boundary?" |

The proportions matter more than the exact minute marks. In a 30-minute interview, compress estimation and interface design while retaining a complete architecture, deep dive, and summary. In a 60-minute interview, add another deep-dive topic instead of expanding the requirements indefinitely.

## 4. Phase One: Open and Narrow the Requirements

### 4.1 Restate the Prompt First

Establish shared context in one sentence:

> Let me confirm: we are designing a system that supports video upload, processing, and playback. We will focus on the core backend paths and not discuss the recommendation algorithm itself. Is that correct?

Draw the system boundary proactively when restating the prompt, but do not unilaterally remove its core difficulty.

### 4.2 Ask the Most Discriminating Questions

Prioritize questions whose answers would change the architecture:

- What are the core user actions? Which features are out of scope?
- What are the read/write ratio, user scale, and geographic distribution?
- What are the latency, availability, and consistency requirements?
- May data be briefly stale or ever be lost?
- Are multi-tenancy, authorization, compliance, or disaster recovery required?

Do not turn the opening into a ten-minute requirements interview. Confirming two to four core capabilities and two to three quality goals is usually sufficient. When the interviewer provides no numbers, state reasonable assumptions explicitly and continue.

### 4.3 Write Down the Deliverable for This Phase

Keep this information visible in one corner of the whiteboard:

```text
In scope: Upload, playback, metadata lookup
Out of scope: Recommendations, advertising, comments
Scale: 10M DAU, 100:1 read/write ratio, multi-region
SLO: Highly available playback; eventual consistency is acceptable for metadata
```

### 4.4 Transition

> The scope is now reasonably clear. Next, I will use a few order-of-magnitude estimates to determine whether read traffic, storage, or bandwidth is the primary bottleneck.

## 5. Phase Two: Make Purposeful Order-of-Magnitude Estimates

Estimation is not an isolated arithmetic performance. Calculate only figures that affect design choices, such as:

- Average and peak QPS.
- New data per day and storage over multiple years.
- Ingress and egress bandwidth.
- Hot working-set size and the benefit of cache hits.
- Load that a single shard, queue, or machine might have to sustain.

Every estimate should lead to an architectural conclusion:

> Peak playback requests are several hundred times more frequent than uploads, and video egress bandwidth far exceeds metadata traffic. The playback path therefore needs a CDN, while post-upload transcoding is well suited to asynchronous processing.

The numbers need not be exact, but the units, orders of magnitude, and derivation must be internally consistent. If a figure does not change the solution, record the assumption and skip the calculation.

### Transition

> At this scale, the system is clearly read-heavy, and media bandwidth is the primary cost. Next, I will define the user-visible interfaces and data-access patterns before drawing the overall architecture.

## 6. Phase Three: Fix the Boundary with APIs and a Data Model

### 6.1 Define Only the Core APIs

The APIs should cover the core capabilities confirmed earlier and expose their critical semantics:

```text
POST /videos                 Create an upload task
PUT  /uploads/{id}/parts     Upload a part
POST /uploads/{id}/complete  Complete the upload (must be idempotent)
GET  /videos/{id}            Retrieve metadata and the playback URL
```

While discussing the interfaces, annotate the following as needed:

- Identity and authorization.
- Pagination method.
- Idempotency keys.
- Synchronous response versus asynchronous task.
- Whether large objects bypass application servers and upload directly to storage.

### 6.2 Model Around Access Patterns

Write the entities and key fields first, then choose the database:

```text
Video(video_id, owner_id, status, metadata, created_at)
Upload(upload_id, video_id, parts, checksum, status)
Rendition(video_id, codec, resolution, object_key, status)
```

Then describe the primary access patterns, such as point lookups by `video_id`, pagination by `owner_id + created_at`, and scans by task status. Database selection should serve the access patterns, consistency requirements, and scale rather than begin with a familiar product name.

### Transition

> The interfaces and access patterns are now established. I will draw one complete write path and one complete read path so the solution works end to end, then dive into the most critical areas.

## 7. Phase Four: Draw the End-to-End High-Level Architecture

### 7.1 Start with the Shortest Critical Path

First draw the primary path from client to result:

```text
Client → DNS / CDN → Load Balancer → Stateless Service → Cache / Database
                                      ↓
                                Queue → Workers → Object Storage
```

Keep the first version to roughly five to eight major boxes. Complete the data flow first, then add components for scale and fault tolerance. Drawing dozens of microservices too early buries the core decisions under names.

### 7.2 Explain the Write and Read Paths Separately

Number the arrows:

- Write path: how requests are validated, persisted, queued, processed asynchronously, and published.
- Read path: where the system looks first, what happens on a cache miss, and where the returned data originates.
- Background path: how retries, compensation, index construction, and data cleanup work.

For each path, state its success condition. For example, must "write to the database and successfully publish an event" be atomic? Which status does the API return before the task finishes?

### 7.3 Inspect the Architecture Proactively

- Does it cover every in-scope capability?
- Are there obvious single points of failure?
- Is data ownership clear?
- Is the synchronous chain too long?
- Does the client transfer unnecessary large objects?
- Does the appropriate component absorb the greatest pressure identified by the estimates?

### Transition

> The high-level design now covers the core read and write paths. The two areas most worth exploring are reliable asynchronous processing after upload and large-scale playback distribution. I suggest discussing task reliability first, then expanding on the CDN if time permits.

This statement offers a judgment while inviting the interviewer to choose the deep-dive direction.

## 8. Phase Five: Select and Explore the Critical Challenges

A deep dive does not mean drawing another layer inside every box. Prioritize:

1. The core difficulty unique to the prompt.
2. The largest bottleneck exposed by estimates.
3. The clearest tradeoff among consistency, availability, and latency.
4. An area in which the interviewer has expressed interest.

For each deep-dive topic, use this sequence:

```text
Goals and constraints → Candidate approaches → Choice and rationale → Data flow / State machine → Failure scenarios → Costs
```

For example, a deep dive into message processing should discuss more than "use a message queue." It should also cover:

- How to choose the partition key and whether ordering is required.
- Whether delivery is at least once or at most once.
- How consumers remain idempotent.
- Retries, exponential backoff, and a DLQ (dead-letter queue).
- How to scale or degrade under backlog.
- How to observe end-to-end processing latency.

Two candidate approaches are usually enough. State clearly why A is preferable under the current constraints and under which conditions B would become the better choice.

## 9. Phase Six: Stress-Test the Entire Design

Once the architecture is mostly complete, review it quickly from four directions.

### 9.1 Scalability

- Which services can scale horizontally?
- How is data sharded, and can the shard key create a hotspot?
- What are the cache capacity and invalidation strategy?
- Which component reaches its limit first at 10× traffic?

### 9.2 Reliability

- What happens if one machine, availability zone, or region fails?
- Can retries cause duplicate writes or a retry storm?
- How is data replicated, backed up, and restored?
- How does the system degrade when queues back up or the database is unavailable?

### 9.3 Consistency

- Which data requires strong consistency?
- Which reads can tolerate eventual consistency?
- What does the user see when the cache and database disagree?
- How are conflicts from concurrent updates detected?

### 9.4 Observability and Security

- Core SLIs: success rate, latency, backlog, and cache hit ratio.
- How logs, metrics, and traces correlate one request.
- Where authentication, authorization, encryption, and rate limiting occur.
- Whether privacy, abuse prevention, or audit requirements apply.

## 10. Phase Seven: Close in Two Minutes

The summary should be more than "That is all." Organize it into four statements:

1. **Goal**: the core capabilities and scale covered by the design.
2. **Architecture**: the primary read/write paths and most important components.
3. **Tradeoffs**: the chosen consistency, sharding, or asynchronous strategies.
4. **Evolution**: what to improve next given more time or greater scale.

Example:

> This design supports large-scale video upload and playback. Media is uploaded directly to object storage, transcoded asynchronously by queues and workers, and distributed for playback through a CDN. The metadata service remains stateless and uses a cache. We trade immediate consistency for availability in the processing pipeline, but upload completion and task-status updates must be idempotent. With more time, I would validate cross-region disaster recovery and the CDN-origin traffic caused by popular content.

Finally, check the requirements list quickly and identify items intentionally left out of scope rather than merely forgotten.

## 11. How to Stay Synchronized with the Interviewer

The interview should be a collaborative design session, not a continuous monologue. After each phase, use "conclusion + next step" to synchronize:

> We have established that read traffic is much higher than write traffic, so we will focus on optimizing the read path. Next, I will define the APIs and draw the high-level architecture.

When the interviewer interrupts:

- Answer the question directly first.
- Connect the answer back to the architecture diagram.
- Confirm whether to continue the deep dive or return to the main thread.
- Record unfinished topics in a whiteboard parking lot.

If the interviewer provides no feedback for a while, do not repeatedly ask, "Is this okay?" State a judgment and continue:

> Without further constraints, I will assume eventual consistency on the order of seconds is acceptable and continue the design on that basis.

## 12. Organizing a Whiteboard or Online Diagram

Use fixed regions to reduce repeated erasing and redrawing:

```text
┌────────────────────────────┬────────────────────────────────────┐
│ Requirements / Assumptions │ High-level architecture and        │
│ / SLOs                     │ numbered data flows                │
├────────────────────────────┼────────────────────────────────────┤
│ Estimates / APIs / Model   │ Deep dives, failure scenarios,     │
│                            │ parking lot                        │
└────────────────────────────┴────────────────────────────────────┘
```

Follow a few simple diagramming conventions:

- Put responsibilities in boxes, not just product names.
- Mark arrow directions and number critical arrows.
- Use solid lines for synchronous calls and dashed lines for asynchronous events.
- Label primary storage, caches, and object storage distinctly.
- Write a one-line rationale next to each decision, such as "Shard by `user_id`: primary access is aggregated by user."

## 13. How to Recover When Time Gets Away from You

### Requirements Take More Than Seven Minutes

Freeze secondary capabilities, state assumptions, and move into the architecture:

> To leave enough time for an end-to-end design, I will exclude comments and recommendations for now and focus on upload and playback.

### There Is Still No Complete Architecture at 20 Minutes

Stop refining the APIs or schema and complete the write and read paths with the fewest components possible. A complete but coarse-grained system is easier to evaluate than a finely detailed fragment.

### The Deep Dive Gets Trapped in Local Details

State the conclusion and tradeoff first, and move implementation details to the parking lot:

> I will use consistent-hash sharding with virtual nodes to reduce skew. A deeper discussion would cover the migration protocol, but I will return to failure handling now.

### Only Three Minutes Remain

Immediately summarize the primary paths, greatest tradeoff, and one unresolved risk. Do not introduce new components.

## 14. How to Adjust Timing for Different Prompt Types

| Prompt Type | Spend More Time On | Areas That Can Be Compressed |
| --- | --- | --- |
| Product systems: Feed, Chat, YouTube | User experience, read/write paths, hotspots, and ranking | Low-level storage implementation |
| Infrastructure systems: S3, Queue, Cache | Data placement, consistency, replication, and failure recovery | Number of product APIs |
| Geospatial systems: Maps, Ride Hailing | Spatial indexes, location updates, and real-time matching | Generic authentication flows |
| Transactional systems: Payments, Ticketing | Concurrency control, idempotency, ledgers, and compensation | Cache optimization |
| Data-processing systems: Crawler, Metrics | Partitioning, scheduling, backpressure, and data pipelines | Front-end interaction |

The process remains the same; only the focus of the deep dive changes.

## 15. Pre- and Post-Interview Checklists

### Before Starting

- [ ] Did I restate the goal and confirm the scope?
- [ ] Did I ask about constraints that would change the design?
- [ ] Did I write down the key assumptions explicitly?

### During the Design

- [ ] Did the estimates lead to architectural conclusions?
- [ ] Are the APIs, data model, and access patterns consistent?
- [ ] Is there a complete read path and write path?
- [ ] Does every important component have a clear responsibility?
- [ ] Did I explore the prompt's real challenges?
- [ ] Did I explain candidate approaches and tradeoffs clearly?

### Before Closing

- [ ] Did I check single points of failure, hotspots, retries, and consistency?
- [ ] Did I mention monitoring, security, and graceful degradation?
- [ ] Did I summarize the solution, boundaries, and future evolution?

## 16. Time-Boxed Practice Methods

### 10-Minute Skeleton Exercise

Choose a random prompt and cover only the requirements, three estimates, core APIs, read/write paths, and one challenge. The goal is to develop a consistent sequence.

### 25-Minute Solo Mock Interview

Record yourself and complete the entire process. Review for long monologues without conclusions, unjustified component choices, and inconsistencies between the architecture diagram and spoken explanation.

### 45-Minute Paired Mock Interview

Ask the other person to add a constraint midway through, such as 10× traffic, a single-region outage, strict ordering, or privacy-deletion requirements. Practice adapting the design while preserving the main thread.

### Record Only Three Review Items

After each practice session, write down:

1. One critical question you missed.
2. One tradeoff you explained poorly.
3. One stage to practice deliberately next time.

Accumulating these notes over time improves performance more effectively than repeatedly memorizing complete answers.
