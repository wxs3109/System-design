# General design patterns

This chapter only covers reusable collaboration methods between two or more components, services, or state boundaries. Each pattern must have clear data flow or control flow, Source of Truth, Success Semantics, Failure Window, Recovery and Verification.

Individual concepts, algorithms, or products do not belong in this chapter; nor do complete business systems.

## Position in the entire set of notes

| Chapter | Responsible Questions | How to use this chapter |
|---|---|---|
| 02-Core concepts | CAP, idempotence, Retry, Backpressure, Saga, RPO/RTO and other principles | Provide semantics and Trade-off |
| 03-Data and Storage | Data model, index, authority and derivation relationships | Determine the role of each state in the link |
| 04-Infrastructure components | Database, Cache, Broker, Workflow, Mesh, etc. Black-box Contract | Provides composable component capabilities |
| 05-General Design Patterns | How multiple states and components form a stable link | Responsibilities of this chapter |
| 06-Case Design | News Feed, YouTube, Booking and other complete systems | Reuse the pattern in this chapter and evolve step by step |

For example, exponential backoff is 02; Kafka Consumer Group is 04; the collaboration of Database, Outbox, Relay, Broker, and Consumer is 05; and how News Feed uses this link is 06.

## Mode admission criteria

Before a topic can enter this chapter, both of the following must be met:

1. Involves at least two components or two clear state boundaries;
2. Can be reused in multiple business systems;
3. Able to draw stable normal data flow or control flow;
4. Be able to point out the Source of Truth and API Success Semantics;
5. Able to enumerate important Failure Window and the results seen by the caller;
6. There are Recovery, Rebuild, Compensation or Reconciliation methods;
7. There are simple solutions, applicable conditions, counterexamples and upgrade signals.

Just listing the components, just drawing the normal flow, or just saying "eventually consistent" does not complete a pattern.

## Table of Contents and Learning Sequence

| Sequence | Topics | Problems solved |
|---|---|---|
| 00 | [How to select and express patterns](00-how-to-select-and-express-patterns/) | How to select and express patterns from Invariant and Failure Window |
| 01 | [Cache Read Link](01-cache-read-path/) | How Cache and Source of Truth form a low-latency read path |
| 02 | [Read Scaling and Derived Read Model](02-read-scaling-and-derived-read-model/) | Replica, Materialized View and Search How to scale reading |
| 03 | [Reliable event publishing link](03-reliable-event-publishing-path/) | How to publish and consume events recoverably after business submission |
| 04 | [Long task submission and execution](./04-long-running-task-submission-and-execution/) | How API, Operation, Queue and Worker complete background tasks |
| 05 | [Fan-out and Aggregation](05-fan-out-and-aggregation/) | How to distribute and merge results through Fan-out on Write or Fan-out on Read |
| 06 | [Saga and business workflow](06-saga-and-business-workflow/) | How multiple local submissions form a recoverable business process |
| 07 | [Batch and Streaming Data Pipeline](07-batch-and-streaming-data-pipeline/) | How Source, Processing and Sink continuously produce analysis results |
| 08 | [Flexible Synchronization Call Chain](08-resilient-synchronous-call-path/) | How to cooperate with deadline, retry, isolation and degradation |
| 09 | [Cell and Multi-region Topology](09-cell-and-multi-region-topology/) | How to control Routing, Data Ownership and Isolation Blast Radius |
| 10 | [Evolution and Data Migration](./10-evolution-and-data-migration/) | How Backfill, Change Capture, Validation and Cutover collaborate |

It is recommended to read 00 first, and then choose a topic based on the problems encountered in the case. 01–04 are common data links; 05–08 are work splitting and reliable execution; 09–10 are only introduced when isolation, geographical or online migration requirements arise.

## Three fixed expression paths

Each pattern must express:

### Happy Path

What each component reads and writes, where the API returns, and how the asynchronous steps continue.

### Failure Path

When a break occurs between two status commits, will it be missing, duplicated, stale, partially completed, or will the result be unknown.

### Recovery Path

Who scans, retries, compensates, rebuilds or reconciles, how progress is recorded, and how recovery completion is proven.

## Key differences between themes

| Similar looking questions | Actual boundaries |
|---|---|
| Cache and Derived Read Model | Authoritative Read can be executed after Cache miss; Derived Read Model reorganizes data for specific queries and requires reconstruction verification |
| Reliable event publishing with Saga | Outbox propagates committed facts; Saga manages business intermediate state and Compensation of multiple services |
| Long tasks and workflow | Ordinary long tasks revolve around an Operation and Worker; business workflow coordinates multiple steps with independent states |
| Follow Bidirectional Index and Fan-out | Bidirectional index provides two Query Directions; Fan-out distributes a job or result to a large number of targets |
| Batch pipelines vs. online migration | Pipelines continuously generate analysis or derived results; migration involves transferring authority and eventually exiting the old system |
| Multi-region Replication and Cell | Multi-region focuses on geographical availability; Cell first focuses on Blast Radius and Tenant data ownership |

## Fixed output for each pattern

1. Problems to be solved and business invariants;
2. Why the simplest solution is not enough, and the signals for upgrading;
3. Participating components, status roles and owners;
4. Happy Path and API Success Semantics;
5. Failure Window and the caller can see the result;
6. Fallback, Recovery, Rebuild, Compensation and Verification;
7. Latency, throughput, correctness, availability and cost Trade-off;
8. Applicable conditions, counterexamples and alternatives;
9. In which cases it is reused.

The product name only needs to help positioning, and the specific contract should be linked to 04. There is no need to repeat the product encyclopedia in this chapter.

## You should be able to answer after studying

- Why do you need this composition instead of a component or a local transaction?
- Which is the authoritative fact and which is just cached, transmitted state or derived results?
- When the API returns success, where has the entire link been reliably completed?
- How is each Failure Window discovered (Detection), recovered (Recovery) and verified (Validation)?
- What latency, write amplification, state, and operational costs does the pattern add?
- What upgrade signals are worth introducing and when should they be kept simple?

## Terminology convention

Mode names and mechanism names are preferably kept in common English, such as `Fan-out`, `Backfill`, `Replay`, `Watermark`, `Lease`, `Circuit Breaker`, `Jitter` and `Write Amplification`. Use a Chinese explanation when it first appears; use English directly in the following paragraphs to avoid readers having to back-translate the blunt translation before looking up the information.

If the content can be finished with only one product, you should go back to 04; if you start to answer all the needs of a specific business, you should go to 06.
