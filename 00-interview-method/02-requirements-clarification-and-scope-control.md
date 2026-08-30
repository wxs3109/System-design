# Requirements Clarification and Scope Control

System design prompts are often a single sentence, such as "Design a video platform." The first step is not to draw services, but to turn that sentence into a set of verifiable goals. The output of requirements clarification should be a concise design contract: **who the system is for, what it supports, its scale, what it prioritizes, and what it will not address for now**.

## 1. Why Clarification Must Come First

The same product can imply entirely different systems:

- Supporting only upload and playback leads to a different design from one that also includes recommendations, comments, and live streaming.
- An architecture for ten thousand daily users differs from one for a billion daily users.
- A financial ledger prioritizes correctness, while a feed can usually tolerate briefly stale reads.
- A global service must account for cross-region latency and data sovereignty; a single-region system may not need to yet.

Without establishing these conditions first, subsequent choices about databases, caches, queues, and sharding lack a sound basis.

## 2. Five Categories of Clarifying Questions

### 2.1 Users and Use Cases

First determine who uses the system and which end-to-end actions matter most.

- Are the users consumers, content creators, enterprise customers, or internal services?
- Do clients include web, mobile, devices, or third-party APIs?
- What are the one to three most important user flows?
- Are users distributed across countries and regions?

One way to ask is:

> First, I would like to confirm the primary users and critical paths. Which user actions must this system support?

### 2.2 Functional Requirements

Functional requirements describe what the system must do. In an interview, prioritize a few core flows instead of collecting a complete product specification.

Group requirements by priority:

- **Must support**: the primary paths that this design must make work end to end.
- **Could discuss**: topics to explore if time permits.
- **Explicitly excluded**: items ruled out to prevent continuous scope expansion.

For example, a content system might treat publishing and reading as must-have capabilities, search as optional, and advertising settlement as out of scope.

### 2.3 Scale and Access Patterns

Ask for the orders of magnitude that would change the architecture; calculate precise figures later during capacity estimation.

- What are the approximate DAU and MAU?
- How often does each user perform the core operations per day?
- What are the read-to-write ratio and peak-to-average factor?
- What is the typical size of an object or record?
- How long is data retained, and does it grow indefinitely?
- Are there hot users, popular objects, or traffic bursts?

If the interviewer does not provide numbers, state assumptions:

> If unspecified, I will assume 100 million DAU, a read-heavy workload, and peak traffic around three times the average. After estimating capacity, I will check whether these assumptions change the architecture.

The point is not to guess real-world numbers exactly, but to keep the figures internally consistent and use them to make decisions.

### 2.4 Non-Functional Requirements

Non-functional requirements describe how well the system must operate. Do not merely say "high availability" or "high performance"; establish priorities and user-visible behavior.

| Dimension | Questions to Clarify |
|---|---|
| Latency | Which path is most latency-sensitive? Do we care about the mean or P95/P99? |
| Availability | Which functions must remain available? Can the system degrade partially? |
| Consistency | Must a write be visible immediately? Can reads briefly return stale data? |
| Durability | May acknowledged data ever be lost? |
| Scalability | To what order of magnitude are users, traffic, or data expected to grow? |
| Security and privacy | Does the system handle payments, identity, or sensitive data? |
| Geography | Is the system single-region or global? Are there data-residency requirements? |

A common way to express a tradeoff is:

> For this read path, I will prioritize low latency and availability and accept eventual consistency on the order of seconds. However, create operations require durable persistence: once success is returned, the data must not be lost.

### 2.5 Scope and Constraints

Clear boundaries are essential for managing time. Confirm the following:

- Which end-to-end flows must be designed in this session?
- Which external capabilities can be treated as existing, such as authentication, payments, or recommendation models?
- Must the discussion cover clients, machine-learning algorithms, or operational deployment?
- Are the cloud platform, database, or protocol constrained?

Out of scope does not mean unimportant; it means treating the capability as an external system with a clear interface for this discussion.

## 3. Condense the Answers into a Design Contract

At the end of clarification, summarize and confirm the contract in under a minute:

> We will design a service for global users whose core capabilities are A and B. We will assume X DAU, far more reads than writes, and the presence of hotspots. Reads prioritize low latency and high availability and may be briefly stale; successful writes must be durable. We will not explore C and D in depth. Next, I will estimate the relevant orders of magnitude, then define the interfaces and high-level architecture.

Keep the following information in one corner of the whiteboard:

```text
Core:       Core capabilities A / B
Scale:      Users, QPS, data volume, geography
Priority:   Latency / availability / consistency / durability
Out:        Explicit exclusions
Assumption: Unconfirmed assumptions needed to continue the design
```

Every important design decision that follows should be traceable to this contract.

## 4. How to Limit Clarification Time

Requirements clarification is not a product interview. Use the first few minutes to establish the facts that can materially change the architecture, then move on to estimation and design.

Signals that it is time to stop asking questions include:

- One to three core user flows are established.
- Approximate scale and read/write patterns are known.
- The two most important quality attributes are clear.
- Key assumptions and out-of-scope items have been stated.
- Remaining unknowns do not prevent a high-level design.

If the interviewer says, "You decide," state and record a reasonable assumption rather than repeatedly asking the same question.

## 5. How to Handle Changing Requirements

When an interviewer introduces a constraint midway through the discussion, they are usually testing the ability to evolve an architecture. Handle it in this order:

1. Restate the new condition and confirm what it changes.
2. Identify the affected estimates, data flows, or quality attributes.
3. Point out the first bottleneck in the current design.
4. Modify the architecture locally and explain the added cost.
5. Do not redraw everything unless a core assumption is no longer valid.

For example, "The service must now be global" does not merely mean adding more servers. It also affects routing, data placement, replication latency, failover, and consistency choices.

## 6. Common Mistakes

### Asking for Too Many Product Details

Many questions are asked, but they do not focus on conditions that change the architecture. Improve by centering questions on core flows, scale, and quality attributes.

### Disguising Solutions as Requirements Questions

"Should we use Kafka?" is not requirements clarification. First ask whether asynchronous processing is acceptable, whether replay is needed, and what the peak write rate is.

### Maximizing Every Quality Attribute

The lowest possible latency, strong consistency, zero data loss, and global high availability usually imply enormous cost or conflicting requirements. Priorities must be set separately for different paths.

### Making Unstated Assumptions

Assumptions are unavoidable, but they must be explicit. Hidden assumptions make the design seem arbitrary and prevent it from adapting when conditions change.

### Allowing the Scope to Expand Continuously

Adding every adjacent feature as it appears leads to a design in which no primary path is explained clearly. Complete the core loop first, then expand if time permits.

## 7. Practice Checklist

Given a new prompt, try to write the following within three minutes:

- [ ] Two primary user types
- [ ] No more than three core capabilities
- [ ] User scale and read/write pattern
- [ ] The two most important non-functional requirements
- [ ] One hotspot or burst-traffic assumption
- [ ] Three out-of-scope items
- [ ] A 30-second summary of the design contract

The purpose of this exercise is not to memorize a fixed list of questions, but to identify quickly which answers would actually change the design.
