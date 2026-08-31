# How to select and express patterns

A design pattern is not a fixed list of components, but a collaborative approach formed by multiple state boundaries to solve a type of repetitive problem. The same pattern can be implemented using different products; the same product can also appear in different patterns.

This article establishes a unified method: **Select the mode from Business Invariant and Failure Window, express it with Happy Path, Failure Path, Recovery Path, and explain when it is not worth introducing. **

## 1. What is the pattern of this chapter?

A topic must simultaneously satisfy:

1. Involves at least two components or two clear state boundaries;
2. Can be reused in multiple business systems;
3. Able to draw stable data flow or control flow;
4. Be able to explain Source of Truth, Success Semantics and Failure Window;
5. There are Recovery, Rebuild or Reconciliation methods;
6. Have applicable conditions, counterexamples, and simpler alternatives.

For example, Kafka Consumer Group is a single-component contract and belongs to [Infrastructure Component](../../04-Infrastructure-Components/); the collaboration of Database, Outbox, Relay, Broker and Consumer is the reliable event publishing model of this chapter.

## 2. Start with business invariants

Patterns protect business facts, not boxes and arrows. For example:

- The API has returned a successfully published Post, and the events that need to be published must be able to be recovered later;
- After the Operation is accepted, even if the Worker crashes, it cannot disappear permanently;
- Data for which permissions have been revoked cannot continue to be accessed simply because the cache or index is stale;
- After migration and switching, the old and new systems cannot be allowed to become unconstrained write authorities at the same time;
- When one Cell fails, it should not bring down other Cells.

Write the invariants first before you can determine whether you need local transactions, derived status, messages, routing, or reconciliation. Without explicit invariants, "using an Outbox" or "using a Saga" are just technical terms.

## 3. Find all States and their Owners

Before drawing the diagram for the pattern, make a state table:

| Status | Owner | Authoritative or derived | Who can modify | Can it be rebuilt |
|---|---|---|---|---|
| Business records | Business services | Authority | Business write path | Usually cannot be reconstructed solely by derived data |
| Outbox record | Publishing service | Recoverable intent | Same commit boundary as business record | Partially checkable by business action rules |
| Broker message | Message platform | Transmission status | Producer/Broker | Depends on Retention and Replay Contract |
| Search Documents | Search Projectors | Derive | Consumer | Rebuild from Authoritative Records |

"State owner" is not the name of the operations team, but who has the authority to interpret and change the business state. Caches, search indexes, and feed timelines, even if persisted, do not become authoritative facts.

## 4. Clarify two categories of Success Semantics

Patterns usually have at least two completion points:

### API Success Semantics

What state has been reliably committed when the API returns? For example, if the long task interface returns Accepted, it may only mean that the operation has been persisted, but it does not mean that the task has been completed.

### End-to-end Completion Criteria

What outcome does the business ultimately need? For example, the search index can be queried, the mail has been delivered, all branches have been aggregated, or the old system has stopped writing.

The gap between the two must have an observable state, a recovery mechanism, and a timeliness target. You cannot cover the entire link with a vague "success".

## 5. Draw three execution paths in a unified manner

### Happy Path

Describe in sequence what each component reads, writes, returns at what point, and how the asynchronous work continues. Next to the arrow, it should say Stable ID, Version, or Cursor, not just "Send Data."

### Failure Path

Enumerate the Failure Window that occurs between two state commits (intervals that may interrupt and leave partial state):

- The previous step was successful, but the next step was not started;
- The request timed out, but the result is unknown;
- Repeated execution of the same message or step;
- Branches are partially successful and partially failed;
- The old version results are late after the new version;
- Backlog concentrated Replay after component recovery.

### Recovery Path

Describes who Scan, Retry, Compensate, Rebuild, or Reconcile, and how Recovery is known to be complete. Recovery cannot just write "Retry", but also describes the input, idempotent conditions, Checkpoint and exception exit.

## 6. Use Failure Window table instead of general reliability

| Failure Window | Observable Result | Detection | Recovery Action | Validation |
|---|---|---|---|---|
| Relay is not released after business submission | Business exists, derived status is missing | Outbox Age, differential scan | Relay retries release | Reconciliation between event version and derived view |
| Ack is lost after Worker execution | Task re-delivery | Number of re-throws, idempotent conflicts | Idempotent return of existing results | Operation check with external side effects |
| Cache cleanup failed | User read old value | Version, staleness rate, business alarm | Expiration, active invalidation or Authoritative Read verification | Authoritative value and cache sampling comparison |
| Old writes are late during migration switch | Old and new systems are inconsistent | Change Lag, double read difference | Catch-up or rollback | Invariant and Watermark inspection |

There should be at least one such table per schema. It's more enforceable than "guarantee high availability and eventual consistency".

## 7. Write the simplest solution first

Before introducing the pattern, explain why the simple solution is not enough:

- Whether the single database query plus index has satisfied the reading requirements;
- Whether the synchronous call is still within the delay budget;
- Can a local transaction protect all invariants;
- Is it enough to add one Worker to the database task table?
- Whether downtime migration is acceptable within the business window;
- Whether single-region deployment has met the requirements.

Only upgrade after quantitative signals occur, such as Origin QPS approaching capacity, Derived Query scan too large, task execution exceeding request time limit, single Cell Blast Radius too large, or Offline Migration Window unacceptable.

Patterns are not badges of maturity. When there is no current problem, one more component only adds state, latency, and recovery responsibilities.

## 8. When comparing plans, always look at the six categories of Trade-off

| Dimensions | Questions to compare |
|---|---|
| Correctness | Which states will be temporarily different, for how long, and whether permissions and funds are allowed |
| Delay | How many hops are added to the synchronization path, and how long does it take for the asynchronous results to be visible |
| Throughput | Whether the work is moved to writing or reading, whether amplification or hot spots occur |
| Availability | Reject, downgrade, perform Database Fallback or continue using old values ​​when a component fails |
| Recovery | Can Replay, Rebuild, Compensate, Rollback and Prove Completion |
| Cost | Added storage, network, computing, operations and cognitive burden |

Don't just write about the advantages. Cache-Aside reduces database load and also increases Staleness Window and Database Fallback in case of failure; Fan-out on Write reduces read time calculation and also increases Write Amplification and backlog.

## 9. Leave the principles and products in the responsible chapter

Schema documents can rely on these semantics without reteaching:

- Idempotent, Retry, Sequence, Lease, Backpressure, Saga and RPO/RTO: see [Core Concepts](../../02-core-concepts/);
- Schema, index, authority and derived data: see [Data and Storage](../../03-data-and-storage/);
- Product contracts for Redis, Kafka, Queue, Workflow, DNS and Mesh: see [Infrastructure Components](../../04-Infrastructure-Components/);
- Complete system for News Feed, YouTube, Booking, etc.: See [Case Design](../../06-case-design/).

This chapter only explains how these capabilities work together. If a piece of content can be covered in just one component, it usually does not belong in this chapter.

## 10. Unified document template

Each pattern text uses the following structure:

1. Problems to be solved and business invariants;
2. The simplest solution and its upgrade signal;
3. Participating components, states and owners;
4. Happy Path and API Success Semantics;
5. Failure Window and the result seen by the caller;
6. Recovery, Rebuild, Compensation and verification;
7. Latency, throughput, correctness, availability and cost trade-offs;
8. Applicable conditions, counterexamples and alternatives;
9. In which cases it is reused.

"Replaceable products" only need to be linked to 04, and do not write product encyclopedias in the schema document.

## 11. One-page pattern card

When interview or review time is limited, at least deliver:

| Project | Content |
|---|---|
| Problem | At which quantitative objective does the current simple solution fail |
| Invariant | The business facts that the schema must protect |
| Authority | Which state has the final say |
| Flow | Normal requests and asynchronous steps |
| API Success | Where to reliably complete when returning success |
| Failure Windows | The three most important interruption points |
| Recovery | Retry, Compensation, Rebuild or Reconciliation |
| Trade-off | What you get, you gain |
| Exit | Under what conditions should this pattern be deleted or replaced |

## 12. Common ways of losing control

- First draw all the components, then fill in the reasons for each box;
- Treat the product feature list as a pattern;
- Only draw the normal process, not the failure between two submissions;
- Each copy is called a data source and has no authority in the event of conflict;
- The API returns Accepted, but externally describes the business as completed;
- Only write retry, do not write idempotent conditions, stop conditions and exception exits;
- Only write the final consistency, do not write the allowed delay and permission revocation upper limit;
- Copying a complete case makes the pattern unreusable.

## 13. Complete the checklist

- [ ] Involves at least two component or state boundaries;
- [ ] Business Invariant and Source of Truth are clear;
- [ ] API Success and End-to-end Completion have been separated;
- [ ] Happy, Failure and Recovery Path can all be accessed;
- [ ] Each Failure Window has detection, recovery and verification methods;
- [ ] Write simpler solutions and quantitative upgrade signals;
- [ ] Trade-off includes correctness, latency, throughput, availability and cost;
- [ ] Single product capabilities and underlying principles have been linked to the responsible chapter;
- [ ] Patterns are not written as complete answers for a specific application.

[Return to the table of contents of this chapter](../README.md)
