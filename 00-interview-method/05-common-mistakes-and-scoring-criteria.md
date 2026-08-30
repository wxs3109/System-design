# Common Mistakes and Scoring Criteria

There is usually no one right answer to a System Design interview. What the interviewer really judges is whether you can continue to make well-founded engineering decisions and explain your ideas clearly when the information is incomplete and time is limited.

Therefore, when reviewing, don’t just ask “Is my architecture diagram correct?”, but also ask:

- Have you grasped the core contradiction of the topic?
- Is each key decision derived from requirements and orders of magnitude?
- Do you know where the solution will fail and how to continue evolving?
- Have you maintained effective collaboration with the interviewer?

## 1. What do interviewers usually evaluate?

The rating scales are not exactly the same for different companies and job levels, but they can usually be summarized into six dimensions.

| Dimensions | What interviewers want to see | Common negative signs |
| --- | --- | --- |
| Requirements and scope | Proactively clarify users, core use cases, scale, and non-functional requirements | Start drawing without clarification; keep expanding irrelevant functionality |
| Structured advancement | Clear stages, ability to control time, and timely summary | Jumping ideas; spending too much time on local details |
| Technical correctness | Data flow is closed loop, component responsibilities are clear, and the critical path is executable | Only technical terms are listed; the reading and writing paths do not make sense |
| Capacity and scalability | Use estimates to identify bottlenecks, and expand strategies to match access patterns | Default is "just add machines"; no order of magnitude awareness |
| Reliability and consistency | Can explain failure behavior, data semantics, and recovery methods | Only talk about normal paths; blindly promise strong consistency and high availability |
| Weighing and communicating | Comparing alternatives, clarifying reasons for selection, accepting prompts and making adjustments | Treating preferences as conclusions; avoiding costs; not listening to prompts |

Interviewers generally will not directly reject a candidate just because a certain component is missing. A more serious problem is: there is no causal relationship between components and requirements, or the solution cannot be corrected after contradictions are discovered.

## 2. Common mistakes and why points will be deducted

### 1. Start designing without clarifying the requirements

"Designing YouTube" might focus on uploading and transcoding, video distribution, recommendation systems, or it might focus on metadata storage. If you do everything by default, it will be easy to lose focus later.

Improvement method: First spend a few minutes to clarify the core use cases, user scale, read-write ratio, latency goals, consistency requirements and parts that are not done, and then reiterate the scope:

> This time I gave priority to designing the video upload, processing and playback links; the recommendation algorithm only defines the interface and does not expand the model details.

### 2. Stack components as soon as they come up

"Load Balancer + Redis + Kafka + Cassandra + CDN" is not the design. The interviewer will continue to ask: what is cached, why is it asynchronous, what is the Partition Key, what is the Source of Truth, and what to do after Cache Invalidation.

Ways to improve: Let’s talk about the minimum viable architecture and main data flow first; introduce new components only when capacity, latency, or reliability goals expose problems. Every time a component is added, three questions can be answered:

1. What specific problem does it solve?
2. What complexity or new failure modes does it introduce?
3. Under what conditions will the system fail when it is not used?

### 3. API, data model and architecture are disconnected from each other

For example, the API supports page turning by time cursor, but the storage model cannot efficiently query by user and time; or the interface promises idempotence, but the system does not have idempotent keys and deduplication status.

Improvement method: Choose a core write path and a core read path, from the client to the persistence layer, and then back to the response. Checks for identity, validation, data changes, asynchronous events, error returns, and retry semantics along the way.

### 4. Estimation is only for formality and does not affect decision-making.

Once DAUs, QPS, and storage are listed, and the architecture doesn't quote those numbers at all, the estimates lose their usefulness.

How to improve: Only count numbers that can change the design. For example:

- Peak QPS determines whether a single instance solution is sufficient;
- Object size and daily increment determine storage level and life cycle strategy;
- Outbound bandwidth determines whether a CDN must be used;
- The hotspot ratio determines whether normal caching or hotspot isolation is required.

Numbers do not have to be exact, but the assumptions, units, and magnitudes must be consistent.

### 5. Only talk about normal paths, not failure paths.

Timeouts, duplications, reordering, partial failures, and network partitions are all normal in real distributed systems. Completely ignoring these situations will make the design appear to be at the drawing level.

How to improve: Choose at least one key link to answer:

- After a dependency times out, should I retry, downgrade or return on failure?
- Will retrying cause repeated writing?
- What should I do if the consumer crashes after half of processing?
- How to recover after the main database or an availability zone fails?
- What are the data recovery point objective (RPO) and recovery time objective (RTO)?

### 6. Use technical terms as answers

"Use Eventual Consistency", "Do Sharding" and "Use Consistent Hashing" are just directions, not complete decisions. It is also necessary to explain the consistency object and time window, Shard Key, Resharding method, Hotspot, and behavior in case of failure.

Improvement method: Add semantics and boundaries after technical nouns. For example:

> The like count allows for eventual consistency at the second level, but whether the user has liked it must read his or her latest write; therefore, the two types of data adopt different consistency strategies.

### 7. Pursuing unnecessary strong consistency or "never downtime"

All operations require strong consistency, high availability, and low latency, which usually means that the requirements have not been truly analyzed. CAP is not a memorization question, the key is how to choose different business operations.

How to improve: Discuss semantics by operation. The tolerance levels for payment deductions, ticket booking, feed sorting, and pageview statistics are not the same. Make it clear which data cannot be wrong, which data can be converged later, and which functions can be temporarily degraded.

### 8. The direction of in-depth exploration has nothing to do with the core of the question.

Spending ten minutes designing the login system in the News Feed question, or discussing the front-end upload progress bar in detail in the Object Storage question, will take away time from demonstrating core capabilities.

Ways to improve: Choose one or two Deep Dives based on the unique difficulty of the question and confirm with the interviewer. For example, News Feed can drill down to Fan-out and Celebrity Hotspot; S3 can drill down to Metadata Sharding, Durability, and large object uploads.

### 9. No explanation of trade-offs

Giving only one option makes it difficult for people to judge whether it is a choice or just knowing this method.

Improvement method: Use a short "goal-option-choice-cost" structure for key decisions:

> The goal is to reduce feed read latency for the average user. You can use Fan-out on Read or Fan-out on Write. There is more reading and less writing here, so ordinary users use Fan-out on Write; the cost is increased Write Amplification and storage, and celebrity accounts use Fan-out on Read instead.

### 10. Lack of closing and verification

If the time is up and still stays in a certain part, the overall design will appear incomplete.

How to improve: Set aside the last three to five minutes to complete the following actions:

- Restate core data flows and key decisions;
- Conduct item-by-item acceptance against initial requirements;
- Identify the biggest risks and next steps;
- If time permits, add monitoring, security or cost.

## 3. Actionable mock interview scorecard

Each dimension is rated on a scale of $0$ to $4$, for a total score of $24$. Don’t substitute “feels good” for evidence; record what the candidate said at each minute.

| Score | Meaning |
| --- | --- |
| 0 | Completely missing, or there is a fatal error that cannot be corrected |
| 1 | Only fragmentary content can be given after the prompt |
| 2 | Meets the basic requirements, but has shallow coverage, weak reasons, or relies on many tips |
| 3 | Complete independently, make reasonable derivation, and be able to discuss main boundaries and trade-offs |
| 4 | Outstanding performance, able to proactively discover hidden problems and promote high-quality and in-depth discussions |

### A. Requirements and Scope:__/4

- Have core users and key use cases been identified?
- Are functional requirements and non-functional requirements distinguished?
- Are scale, literacy ratios, and key SLAs clearly defined?
- Do you actively declare out of scope?

### B. Structured promotion and time management: __/4

- Should we give a roadmap first and then proceed in stages?
- Is time allocated appropriately between requirements, estimation, API, architecture, drill-down, and closing?
- Will it be summarized in stages and solicit the interviewer’s opinions on the in-depth direction?
- Can I return to the main line after being interrupted?

### C. Core design and technical correctness: __/4

- Are APIs, data models, components and data flows consistent?
- Can the critical read and write paths be communicated end-to-end?
- Are component boundaries and responsibilities clear?
-Are single points of failure and obvious data correctness issues avoided?

### D. Capacity planning and scalability:__/4

- Have adequate but not excessive order-of-magnitude estimates been made?
- Do estimates actually influence architectural choices?
- Are hotspots, shards, caches and bandwidth bottlenecks identified?
- When faced with ten times the traffic, can you point out the location and evolution sequence of the first failure?

### E. Reliability, consistency and operation and maintenance: __/4

-Explain Timeout, Retry, Idempotency, Deduplication and Backpressure?
- Do you choose consistency based on business operations rather than drawing general conclusions?
- Consider Replication, Failover, Data Recovery and Graceful Degradation?
- Are key indicators, logs, tracking and alerts presented?

### F. Trade-offs, Communication and Technical Leadership: __/4

- Are requirements used to support key decisions?
- Can you compare alternatives and proactively state the costs?
- Are assumptions clearly expressed and can they be broken down reasonably if they are not understood?
- Do you listen to prompts, fix mistakes, and keep the conversation collaborative?

$$
\text{Total score}=A+B+C+D+E+F
$$

It is recommended that the scores be used to track your own progress and not be mechanically mapped to the company's employment conclusion. The following practice grading can be used:

- $0$–$9$: The main process has not been established yet, priority is given to practicing the fixed answering framework;
- $10$–$14$: The design can be completed, but there are obvious gaps, and the closed loop must be completed item by item;
- $15$–$19$: Reach a stable interview level, focusing on improving the quality and trade-offs of in-depth research;
- $20$–$24$: Overall mature, continue to use unfamiliar questions and follow-up stress tests.

A fatal problem should not be obscured by the total score. For example, core data may be missing, duplicate deductions may be paid, critical paths may not be runnable at all, or the candidate may not be able to accept any corrections, all need to be flagged individually.

## 4. Focus on different ranks

The same set of designs has different expectations under different ranks.

### Intermediate Engineer

- Ability to clarify main requirements and complete end-to-end design;
- Master the basic applicable scenarios of commonly used components;
- Discover bottlenecks and improve reliability with prompts;
- The data flow and interface semantics are basically correct.

### Senior Engineer

- Proactively identify implicit constraints, failure modes and evolution paths;
- Use order of magnitude and business semantics to make key trade-offs;
- Ability to choose high-value depth directions instead of average force;
- Have practical judgment on operability, cost and migration risk.

### Staff and above

- Able to redefine ambiguous problems and establish cross-team boundaries and long-term architectural direction;
- Differentiate between short-term delivery, scale-up stage and final form;
- Discuss organizational, compliance, regionalization, cost and platformization implications;
- Not only design components, but also explain the decision-making mechanism, risk control and implementation sequence.

The higher the rank, the less depth should be reflected by stacking more technical terms. Higher-level signals are often about identifying a critical problem within complex constraints and solving it with a simple, scalable solution.

## 5. Review template

Immediately after each exercise, complete the recording below. The goal of review is not to rewrite the "standard answer", but to find the behavior that is most worth changing next time.

### Basic information

- Title:
- Limited time:
- Actual phase time: requirements __ / estimation __ / architecture __ / in-depth __ / closing __
- Total score: __/24
- Are there any fatal problems:

### Evidence Record

- The best decision ever made:
- The most unfounded decision:
- Missed critical requirements or failure scenarios:
- Prompts given by the interviewer, and my response:
- If traffic increases tenfold, where will the current design fail first:

### Only change three things in the next round

1. Stop doing:
2. Start doing:
3. Continue:

The next round of practice should deliberately verify these three points, rather than correcting a dozen problems at the same time. Only by retaining the same scoring dimension three times in a row can we judge whether the improvement is stable.

## 6. 60-second self-examination before the end of the interview

- Can all core functions find corresponding paths in the architecture?
- Does the order of magnitude support the current capacity solution?
- Are the most important consistency and reliability semantics clearly stated?
- Is at least one trade-off discussed that really affects the solution?
- Have the biggest bottlenecks, failure points and evolution directions been pointed out?
- Did you respond to the original question in one sentence?

A good answer does not need to cover all knowledge points. It needs to let the interviewer clearly see: why the system is designed this way, under what conditions it is effective, at what cost, and how to evolve next.
