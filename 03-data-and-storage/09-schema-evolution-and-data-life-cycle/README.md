# Schema evolution and data life cycle

The data model is not finalized all at once. Fields will be added, semantics will change, historical data will need to be supplemented, and expired data will eventually be deleted. This article focuses on: How new and old code work at the same time during a change, how data is safely migrated and verified, and when data leaves the online system. **

Only the compatible contracts, migration steps and verification methods of the data layer are defined here. Release orchestration, cross-service transactions, failover, RPO/RTO and disaster recovery strategies are not covered in this article.

## 1. Schema is not just a collection of columns

Each important field needs to be specified at least:

- Name and business meaning;
- type, unit and time zone;
- Whether it is nullable, and what the null value represents;
- Is the default value "real business value" or "not yet calculated";
- Who is responsible for writing and which consumers read;
- Whether it contains sensitive information;
- Retention and deletion rules;
- The current Schema or event version.

For example, setting the default value of status to active may incorrectly interpret old records that have not yet been migrated as being activated. The database can fill in a default value, but it cannot determine its true meaning for the business.

## 2. First determine whether the change is compatible

| Changes | Common Risks | Safer Practices |
|---|---|---|
| Add optional fields | The old code is not recognized, and the new record has no value for the time being | Tolerate the missing when reading, and gradually complete it |
| Add required fields | Old writers will not provide | Optional first, then tighten after completion of adoption and Backfill |
| Field renaming | Old and new codes use different names | Add new fields first and make them compatible with reading, then remove old fields |
| Change field type or unit | Historical values ​​cannot be directly compared with new values ​​| Add new fields, explicitly convert and validate |
| Delete fields | The old consumer is still reading | First prove that there are no readers, then stop writing and delete |
| Change enumeration meaning | Unknown values ​​may make old code fail | Consumers tolerate unknown values, add rather than reuse old values ​​|
| Changing uniqueness or relationships | Historical data may violate new constraints | Scan for conflicts first, then fix and enable constraints |

"DDL can be executed successfully" does not mean change compatibility. Databases, caches, search indexes, event consumers, and offline tasks may be on different versions, and the design must allow for a period of time for the old and new to coexist.

## 3. A controllable migration path

Application-level Schema changes can be understood in six steps:

### 3.1 Expand: Expand first

Add new fields, tables, or indexes without immediately deleting old structures. The new structure should allow old code to continue to be written.

### 3.2 Adopt: Let the code adopt

The new code begins to understand both the old and new representations. Temporarily write two representations if necessary, but you must specify which one is the current authoritative value and how to expose the problem if the writing fails.

### 3.3 Backfill: Processing historical data

Background tasks convert old records into new representations. Backfill should be pauseable, retryable, have checkpoints, and repeated executions should not produce different results.

### 3.4 Verify: Verify

Validation should not only compare the total number of rows. Also check key fields, uniqueness, references, summary values, and business invariants, and separately log abnormal data that cannot be converted.

### 3.5 Cutover: Switch the read and write paths of Source of Truth

Read cutover is performed only after coverage and correctness meet predetermined standards. Then continue to observe the difference between the old value and the new value to confirm that there are no missing old writers; if write cutover occurs alone, it must also be clearly recorded.

### 3.6 Contract: Final contraction

Stop writing the old structure and confirm that there are no consumers before deleting the old fields, old indexes or compatible code. Contract is the last step and should not be placed in the same irreversible change as Expand.

This sequence is a data migration contract and does not stipulate which publishing platform must be used.

## 4. Why Backfill can easily damage online data

Backfill reads the old value at a certain point in time. Before its calculation is completed, an online request may have updated the same record. If the task overwrites unconditionally, new writes will be erased with expired calculations.

So at least define:

- **Impotent Key**: Repeated processing of the same record will not produce repeated side effects;
- **Version Condition**: Write only if the source version or updated_at has not changed;
- **Checkpoint**: Record where to scan, so you don’t have to guess from scratch after restarting;
- **Speed ​​Limit Range**: Migration scanning cannot occupy resources required for online query;
- **Exception**: Records that cannot be converted enter a list that can be viewed and repaired;
- **Complete Definition**: Not "the task is completed", but "coverage and invariant check passed".

If migration requires Message Replay, Retry and Deduplication, see [Impotent, Retry and Deduplication] (../../02-Core Concepts/06-Impotent, Retry and Deduplication/) for their semantics. This article will not repeat the message reliability mechanism.

## 5. Verify with data invariants instead of switching based on feeling

Invariants are business facts that the system must always satisfy, such as:

- Each Item refers to the Workspace in the same Tenant memory;
- The quantity of active reservation cannot exceed the inventory;
- When the object metadata is marked ready, the corresponding Blob must exist and the checksum must be consistent;
- The difference after conversion between the old and new amount fields is zero;
- Each business unique key corresponds to at most one valid record;
- Deleted objects can no longer appear in search or feed results.

Record the baseline before migration, continuously check during migration, and check again after switching. Sampling is suitable for catching general errors, but key constraints such as amounts, permissions, tenant isolation, etc. often require a complete check or a summary reconciliation with provable equivalence.

## 6. Data Lifecycle

### 6.1 Retention and TTL

Retention is a business or compliance rule: "How long should this data be retained?" TTL is a storage's ability to enforce expiration. The two cannot be confused.

When designing, write clearly:

- The retention period starts from creation, last access or business completion;
- Will it be invisible immediately after expiration, or will it enter a pending deletion state?
- Whether deletion is suspended for legal retention;
- Whether the expiration times of authoritative data, derived data and backups are different;
- Is the TTL a punctual deletion, or does it only guarantee a final cleanup.

The last point is that you must check the specific product guarantee and cannot assume that it will disappear automatically in seconds.

### 6.2 Soft Delete, Hard Delete and Tombstone

**Soft Delete** usually adds `deleted_at` or status to the record so that online queries no longer return it. It's suitable for undo, audit, and asynchronous cleanup, but the data still exists and doesn't automatically equate to privacy deletion.

**Hard Delete** Removes records from Source of Truth. Reference, Object Content, Search Index and Analytical Copy should be processed before execution, and necessary completion evidence should be retained.

**Tombstone** is the minimum markup for "this ID has been deleted". It can prevent late late old events from re-creating the object, and can also notify the derived system to clean up. How long Tombstone retains depends on how long late data may exist, rather than permanently retaining all original records.

### 6.3 Hot, Warm, Cold and Archive

These words describe access frequency, latency targets, and cost options and are not fixed product names.

| Hierarchy | Typical access | Design focus |
|---|---|---|
| Hot | Online requests for frequent reads | Low latency and sufficient capacity |
| Warm | Occasional queries or recent history | Cost vs. query speed balance |
| Cold | Rarely accessed | Recovery time and read charges |
| Archiving | Compliant retention, almost no online reading | Lowest cost, clear retrieval process |

Before moving, confirm whether the business accepts longer read times, whether the index still exists, and who will notify the caller after the object is restored. How to layer the database internally is beyond the scope of this article.

## 7. Online copies, backups and derived data are not the same thing

| Data form | Main uses | Can it replace authoritative data |
|---|---|---|
| Online replicas | Increase read capabilities or continue service during failures | Typically not considered independent backups |
| Backup | Restore data at a certain historical point in time | Cannot directly undertake online query |
| Derived data | Optimize access paths for searches, feeds, reports, etc. | Should be able to be reconstructed from authoritative data |
| Archiving | Long-term, low-frequency preservation of historical data | Whether the authority depends on the business contract |

Replication errors can quickly propagate to online copies, so "having a copy" does not mean that accidental deletions can be recovered. Conversely, having only a backup without a validated recovery process does not prove that the data is recoverable.

There may still be data in the backup that has been deleted from the online system. Compliance design should address when backups naturally expire, how deletions are re-performed after restoring old backups, and what legal requirements allow or prohibit immediate modification of backup media.

For RPO, RTO, failover and recovery drills, see [Fault Tolerance, Downgrade and Disaster Recovery] (../../02-Core Concepts/07-Fault Tolerance, Downgrade and Disaster Recovery/).

## 8. Also understand the new Schema when restoring from an old backup

The recovered data version may lag behind the current application. The recovery plan needs to retain:

- Migration program from old Schema to current Schema;
- Version interpretation rules for events and objects;
- Replay list of completed deletions or permission revocation;
- Data invariant checks that must be performed again after recovery;
- Rebuild methods for Search Index, Cache and Materialized View.

Otherwise, even if the backup file is intact, your current code may not be able to safely read it.

## 9. Common mistakes

- Add new fields and delete old fields in one release;
- Treat the default value as the true value of historical data;
- Backfill unconditionally covers online updates;
- Only look at the task success status and do not check business invariants;
- Soft Delete and then declare that the data has been completely deleted;
- Set TTL on master database but forget about blob, search and analysis replicas;
- Treat the online copy as a backup, or never verify whether the backup can be restored;
- Deleting the old Schema also loses the ability to interpret old backups and old events.

## 10. Output of this article

An executable data evolution design should leave:

1. Description of field semantics and compatibility of old and new Schemas;
2. The order of Expand, Adopt, Backfill, Verify, Cutover, and Contract;
3. Backfill’s idempotence, version conditions, Watermark and exception handling rules;
4. Data invariants that must be established before and after switching;
5. Respective retention and deletion rules for authoritative data, derived data, blobs and backups;
6. Verification checklist for hot/warm/cold placement, tenant deletion and restoration of old backups.

This is enough to explain how an application can safely change data. The lower-level storage implementation and the higher-level release and disaster recovery orchestration should be left in their respective chapters.
