# Evolution and Data Migration

System evolution often requires migrating traffic and data from the old implementation to the new implementation while continuing to accept online requests. This pattern combines Backfill, Change Capture, Shadow, Verification, Cutover, and Rollback to make migration an observable, pauseable, and provably complete process.

This article discusses how multiple old and new components work together. For field compatibility, TTL and data life cycle, see [Schema Evolution and Data Life Cycle](../../03-data-and-storage/09-schema-evolution-and-data-life-cycle/); deployment tools such as Canary and Blue-Green themselves are not expanded here.

## 1. Invariant to be protected

- There is only one clear writing authority at any time, or there is only one conflicting interpretation of the double writing rules;
- All historical data before the migration starts will eventually enter the target;
- New writes during migration will not fall behind Backfill;
- Deletions, permission revocations and version changes are migrated together with ordinary records;
- Before switching, it can be verified that the target meets key business invariants;
- Pause, Resume or Rollback on failure instead of relying on manual guessing of Watermark.

If you can't tell which side has the final say, you shouldn't start double-writing or switching.

## 2. First determine whether online migration is required

The simplest solution is to stop writing, copy, verify, and switch. This is usually safest if the data volume is small and the maintenance window is acceptable.

Online migration is only required when the following signals occur:

- The full copy time exceeds the acceptable downtime window;
- Business cannot stop writing during migration;
- New implementations need to pass real traffic verification first;
- Migration must be gradual by Tenant, Region or percentage;
- Rollback requires keeping the old system for a period of time.

Online migration reduces downtime but increases dual-version, change lag, late writing, and rollback data compatibility.

## 3. Participate in Component and State

| Component or state | Role | Authority relationship |
|---|---|---|
| Old System | Current production read and write | Usually authoritative before switch |
| New System | Migration target | Take over authority after verification |
| Backfill Worker | Copies historical snapshots | Does not create business facts on its own |
| Change Capture/Log | Deliver deltas during migration | Based on source commit order and version |
| Migration State | Logging Scope, Phase, Watermark, and Errors | Source of Truth for Migrating Control Plane |
| Validator | Compares records, versions, and invariants | Only reports or prevents switches, does not modify facts |
| Router / Feature Flag | Decide whether to read or write old or new | Follow approved migration status |

Migration State should at least record Scope, Phase, Snapshot Watermark, Change Watermark, Validation Status, Cutover Version and Owner.

## 4. Standard Migration Phase

### 4.1 Expand: Create a compatible entrance

Old and new code first understands compatible APIs, schemas, or events. The target system has not yet taken over authoritative traffic.

### 4.2 Snapshot/Backfill: Copy History

Start scanning the Source Data from the clear Watermark, and write to the Target based on the stable Key. Backfill must be Idempotent, Partitionable, Rate Limitable, and Pauseable, and a failure list must be recorded. Watermark indicates the position that a certain stage has been processed to, not a vague "progress".

### 4.3 Change Capture: Catch Up incremental changes

Captures additions, updates, and deletions that occur after the Snapshot and applies them to the target in a source version or sequence. Late, old Backfill results cannot overwrite newer deltas.

### 4.4 Validate: Verify completeness and correctness

Compare quantities, checksums, version distributions, references, and business invariants. Key data such as amounts, permissions, and Tenant isolation cannot be switched based on just a small sample approval.

### 4.5 Shadow: Verify behavior with real requests

The main request is still answered by the old system, and safe read requests or side-effect-free traffic are copied to the new system and the results and performance are compared. Shadow results cannot affect users or produce real side effects.

### 4.6 Cutover: Gradual switching

First perform a read cutover on the controlled Scope, and then perform a write cutover after the conditions are met. Cutover can be advanced by Tenant, Region, Key Range or percentage, and an Observation Window is set for each step.

### 4.7 Contract: Exit the old path

After confirming that there is no old caller, all increments have been caught up to the target Watermark, and the Rollback Window has ended, stop Dual Write, delete the old Route, and take the old Storage offline. Contract is always the last step.

## 5. Happy Path and Success Semantics

The normal link can be summarized as follows: historical data enters the New System through Backfill; the online increment of the Old System is caught up through Change Capture; the Validator compares both sides; after the Lag and invariants meet the standards, the Router switches the controlled Scope from Old to New.

The meaning of API success before the switch is still defined by Old System commits. Change Capture and target updates can be completed later, but must be recoverable and meet migration aging goals.

After switching the write authority, all normal write paths must comply with the new routing version; you cannot rely solely on deployment time and assume that all instances are updated at the same time.

## 6. How to prevent backfill and online writing from overwriting each other

The danger window is when Backfill first reads the old value, the online request then writes the new value, and finally Backfill writes the old value to the target.

Common data contracts include:

- Each record carries the source version or monotonic sequence;
- The target only accepts higher versions;
- Backfill uses conditional writing and cannot overwrite existing new versions;
- Delete the use of Tombstone or delete the version to prevent the old value from being resurrected;
- Repeated writing of the same version yields the same result;
- Unsortable conflicts go into exception list, no silent guessing.

This is just the version requirement for migration; see [Core Concepts](../../02-core-concepts/) for the principles of concurrency, idempotence and sequence.

## 7. Why is Dual Write not the default solution?

When the application writes Old and New at the same time, network failure will cause one side to succeed and the other side to fail. If there is no common business, you must answer:

- Which side is written first, which side determines the success of the API;
- Where to recover the write intent after the second side fails;
- Both sides are successful but the content is different, who covers whom;
- Whether retrying will produce repeated side effects;
- How to roll back writes unique to the new system back to the old system.

Therefore, it is usually preferred to use "single authoritative write + recoverable change capture" instead of letting the request path directly bear unconstrained double writes. When double writing is really necessary, the duration and scope should be limited, and reconciliation repairs should be retained.

## 8. Shadow Read and Double Read

### Shadow Read

The old system results are returned to the user, the new system results are only used for comparison. It is suitable for verifying correctness, latency and capacity without changing user behavior.

Note: Asynchronous Shadow may see different time points; random fields and sorting Tie-breakers require standardized comparisons; sensitive data must maintain authorization and audit boundaries; Shadow traffic should have an upper limit.

### Dual Read and Fallback

The new system reads it first, and falls back to the old system if it is missing or wrong. This reduces cutover risk but may mask migration gaps in the long term. The Fallback Rate must be monitored and the exit date must be set. Fallback cannot be regarded as a permanent correctness mechanism.

## 9. Failure Window and Recovery

| Failure Window | External Behavior | Recovery | Validation |
|---|---|---|---|
| Backfill Worker interrupted | Part of history not copied | Continue from Partition Watermark | Scope coverage and Key collection |
| Change Capture lags behind | Target data is older | Rate-limit Backfill, expand Consumer to catch up | Change Lag and source target version |
| Missing deletion events | Deleted records appear in the target | Replay Tombstone, differential scan | Deletion and permissions Invariant |
| Shadow results are different | Users still read old results | Classification Schema, time point or logical differences | Difference rates and business samples |
| Some Scope cutover failed | Different Scope uses different Source of Truth | Router rollback by Route Version | Routing and writing location of each Scope |
| Old writes are late after Cutover | Disagreement between the two sides | Reject the old Epoch and capture late writes | Source write QPS is reset to zero and version reconciliation |
| Rollback occurs | Older systems may lack new writes | Reverse Sync, or stop writing after executing Rollback | Rollback Checkpoint with Invariant |

The migration control plane must allow Pause instead of automatically expanding the Scope when an error occurs.

## 10. Verification cannot only compare the total number of rows

There are at least four levels:

1. **Coverage**: Whether each Scope is scanned and whether failed items are reset to zero;
2. **Record**: Key, version, checksum and deletion status are consistent;
3. **Relationship**: Whether reference, uniqueness, tenant boundary and quantity aggregation are established;
4. **Behavior**: Whether representative APIs are equivalent in terms of permissions, sorting, paging, and error handling.

The verification results need to be bound to Snapshot and Change Watermark. Just saying "it was consistent yesterday" cannot prove that it is still consistent when switching today.

## 11. Cutover Gate

- Backfill coverage reaches the target and exceptions have been classified;
- Change Lag is lower than the upper limit and can continue to catch up to the latest Change Watermark;
- Key invariants and difference rates pass the threshold;
- The new system capacity, tail latency and error rate are verified by real traffic;
- Routing changes can be rolled back by Scope;
- On-call, Dashboard and repair tools are ready;
- The old system can still accept traffic within the rollback window;
- The direction of rollback data and the last safe point are clear.

Switches are evidence-based state transitions, not release times on the calendar.

## 12. Usage boundaries of Strangler Fig

Strangler Fig allows the Router to gradually shift traffic from the old system to the new system by API, tenant, or business capabilities. It's suitable for long-term replacement where the scope can be clearly demarcated.

The main risk is that the old and new systems call each other for a long time, forming circular dependencies and repeated business rules. Each Scope should have a completion definition: authoritative writes have been switched, old calls have been zeroed out, data has been verified, the rollback period has ended, and old code can be deleted.

If you can't find stable boundaries, refactor the interface or data ownership first, don't hide the coupling with a more complex Router.

## 13. Trade-off

| Revenue | New consideration |
|---|---|
| Reduce or eliminate downtime | Long-term coexistence of old and new versions |
| Real traffic verification available | Shadow, double read and comparative costs |
| Risks can be limited by scope | Routing and Migration State are more complex |
| Rollbackable | Requires preservation of old capacity and reverse data plan |
| Provable Data Correctness | Backfill, Change Capture, Verification and Repair Tool Costs |

The more gradual the migration, the more states and the longer they last. Small systems should not mechanically replicate the entire online migration topology.

## 14. Case reuse

- Database replacement: historical Backfill, Change Capture catch-up, Dual Read Validation, press Tenant cutover;
- Search index upgrade: create new index, Backfill, Dual Query comparison, Alias ​​Cutover;
- Single-unit disassembly service: Router gradually changes data authority according to its business capabilities;
- Object Key migration: copy objects, verify Checksum, cut metadata references, and clean up old objects;
- Multi-tenant platform: Migrate to a new cell by Tenant Placement and verify tenant-level integrity.

The complete business structure is still responsible for [Case Design](../../06-case-design/).

## 15. Common mistakes

- Start double writing without single writing authority;
- Backfill has no version conditions and covers new online values;
- Only new additions and updates are migrated, deletions and permission revocation are omitted;
- Shadow requests produce real side effects;
- Double read fallback exists for a long time, covering up the lack of target data;
- Only compare totals and do not check business invariants;
- Delete the old Schema or old system first, and then find that it needs to be rolled back;
- All Tenants switch at once, no controllable Scope;
- Claims to be rollbackable, but does not handle new writes after the switch.

## 16. Checklist

- [ ] Clarify the writing authority at each stage before and after migration;
- [ ] Snapshot, Change Capture and Cutover Watermark are trackable;
- [ ] Backfill is idempotent and will not overwrite later versions;
- [ ] Deletions, permissions and tombstones are migrated along with normal records;
- [ ] Shadow has no side effects, and there are exit conditions for double-read rollback;
- [ ] Validation covers records, relationships, behaviors and business invariants;
- [ ] Cutover can be paused and rolled back by Scope;
- [ ] Rollback can handle new writes after the switch;
- [ ] Contract will only be executed after the rollback window ends;
- [ ] In small-scale scenarios, consider downtime migration first.

[Return to the table of contents of this chapter](../README.md)
