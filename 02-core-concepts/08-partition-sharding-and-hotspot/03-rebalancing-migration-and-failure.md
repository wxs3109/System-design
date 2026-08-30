# Rebalancing, Migration and Failure

The difficulty of the sharding solution is not the initial distribution, but how to change ownership when nodes are added or removed, hotspots are moved, or machine fails. Live migration must answer what happens when writes occur before, during, and at the switchover instant of a replicated snapshot.

## 1. Why does a simple copy lose writes?

```text
t1 copies the snapshot from the source Shard
t2 user writes a new version in the source
t3 target loads old snapshot
t4 route switches to the target
```

Without the incremental log, the write of `t2` is lost. If both the source and target accept writes during migration, and there is no single commit order, conflicts or duplicate side effects may occur.

## 2. Common online migration protocols

```text
1. PREPARE: Create a target copy and record the migration epoch
2. SNAPSHOT: Copy the Snapshot before a certain Log Offset
3. CATCH_UP: Continue to chase the Incremental Log from this Offset
4. VALIDATE: Compare the number of rows, checksums, business invariants and sampling queries
5. CUTOVER: Freeze briefly or use consensus to switch the only writer to increase route epoch
6. FORWARD: short-term forwarding/returning of old routes MOVED
7. CLEANUP: Observe the window before deleting the source copy
```

Switching can choose to temporarily stop writing, which has simple semantics but causes visible delays; or Dual Write, which has better entrance availability but requires Idempotency, Ordering, Conflict and Rollback Protocol. Most Source-of-Truth Data Migration is more suitable for "Source Single Write + Log Catch-up + Short Cutover".

## 3. Correctness during migration

- **Routing version**: Both client cache and server mapping have versions;
- **Single writer**: Only the current epoch can be submitted at any time;
- **Idempotent Replication**: Log replay can be repeated safely;
- **Tombstone**: Deletion must also be migrated, and old target data cannot be resurrected;
- **Verification**: Not only compare the total number of rows, but also compare the business invariants and key indexes;
- **Rollback**: The source read-only copy is retained after the switch, but the old source cannot be allowed to receive new writes again;
- **Rate Limit**: Migration and backfill must not eat up the online IO and network budget.

## 4. What to do during migration during failure

The migration state itself needs to be persistent and reentrant:

| Failure moment | Recovery actions |
|---|---|
| Snapshot interruption | Continue from checkpoint or idempotent copy |
| Catch-up Interrupt | Continue from Confirmed Log Offset |
| Cutover previous source failure | Election based on replication submission point; if insufficient, stop writing |
| Target failure after Cutover | Only cut to the copy with the current epoch and committed data |
| Control plane unavailable | Use signed/versioned last routing snapshot, limit changes |

Target Write cannot be enabled at the same time just because the Source "looks like Timeout"; this turns a normal Failure into a Split Brain.

## 5. Rebalancing Strategy

An even distribution of the number of partitions is usually not enough and should be weighted according to multiple dimensions:

- Storage bytes and growth rate;
- Read and write QPS, CPU and IOPS;
- P99 and queue length;
- Tenant priorities and fault domains;
- Migration costs versus current recovery traffic.

Avoid frequent moves back and forth: set a hysteresis threshold, minimum dwell time, and maximum migration amount per round. Automatic balancing requires a pause switch and audit records.

## 6. Verify migration is complete

At a minimum observe: source/destination log gaps zeroed, routed old version requests decayed, double read differences zero or within threshold, business count/unique constraints hold, P99 and error rate not crossing SLO. The longest client route cache and retry window should elapse before deleting the origin.

Please refer to [News Feed: Online Migration and Consistency Verification](../../06-case-design/02-specific-application-system/03-news-feed/07-sharding-extension-news-feed/04-online-migration-and-consistency-verification.md).

[Previous section: Sharding keys and routing](./02-shard-key-and-routing-strategy.md) · [Return to the entrance of this chapter](README.md) · [Next section: Hotspots and cross-shard operations](./04-hotspot-and-cross-shard-operation.md)
