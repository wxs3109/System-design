# Job Scheduler Refactoring Review

## in conclusion

The refactoring has been changed from "increased navigation" to true content cropping. The current case has only one progressive knowledge mainline and one acceptance exercise; Cron and a small number of implementation fragments have been isolated as optional, and old Version/Phase/Step documents and unfinished product routes have been deleted.

The default path is:

```text
README
→ 01-Progressive design main line
→ 02-Review and practice
→ Stop
```

## What to keep

The core mainline only retains content that changes the architecture, correctness, fault semantics, or dominant capacity:

- Minimal system and Scheduler/Worker responsibility boundaries.
- The difference between Job, Execution, Attempt and Lease.
- Time indexing with "Scan results are Candidate only".
- DB + MQ double write fails with Transactional Outbox.
- At-least-once, duplicate delivery, atomic preemption and MQ ACK order.
- Worker lost connection, Lease, Heartbeat, Reaper and limited retries.
- Old Worker, Fencing and external business idempotent boundaries.
- Unified state machines and core invariants.
- Write amplification level, transaction co-location sharding and partition expiration discovery.
- Hot Tenant, data lifecycle, minimum validation metrics and stopping conditions.

These contents are strung together into a continuous story according to "Pressure → Failure → Minimum Mechanism → Guarantee → Price" and will no longer be split into multiple versions.

## What is isolated?

[`optional/cron semantics.md`](optional/optional-cron-scheduling-semantics.md) Read only if the requirement contains periodic tasks, covering occurrence, timezone/DST, Misfire, Overlap and version modifications.

[`optional/implementation reference.md`](optional/optional-semantic-implementation-reference.md) only retains four fragments that can express semantics:

- State transition is the same as Outbox.
- Worker Compare-and-Set and ACK order.
- Lease/Reaper/Fencing condition writing.
- Keyset Pagination。

Complete production management, workflow and multiple regions are only recorded in [Parking Lot](PARKING-LOT.md), without chapter skeleton.

## What was deleted or omitted

- Old route for `Correctness Edition → Extended Edition → Production Edition → Workflow Edition → Final Edition`.
- Recursive directory of Version → Phase → Step.
- Fixed 4096 Logical Shard.
- Job ID bit layout, Route Table Schema and Physical Database exact number.
- Full Scan Lane, Cursor, Round-robin Quantum and Receivership Agreement.
- Phase 03–09 Placeholder README.
- Full API, Schema, error codes, TypeScript types and lots of SQL.
- Complete RBAC, auditing, runbook, alert matrix and disaster recovery solution.
- DAG, Fan-out/Fan-in, Backfill, Compensation and resource orchestration.
- Repeat old notes about the same architecture.

Removing these is not to suggest that they have no engineering value, but rather that they no longer add to the core learning objectives of this case.

## Current granularity

- `README.md`: Learning contracts, architecture maps, invariants, and completion criteria.
- `01-Progressive Design Main Line.md`: The only main line of knowledge.
- `02-Review and Exercise.md`: State machine, fault, capacity and boundary acceptance.
- `optional/`: Does not block completed special materials.
- `PARKING-LOT.md`: Only trigger conditions, no plan expansion.

## Complete judgment

Completion of a case is no longer determined by the number of documents. This case ends after the learner can deduct Outbox, Attempt, Lease, Fencing and fragmentation from the minimum system in a closed book, explain the main crash window, make magnitude estimates and clarify boundaries.
