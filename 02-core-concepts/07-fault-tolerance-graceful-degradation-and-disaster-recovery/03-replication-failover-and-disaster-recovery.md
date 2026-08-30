# Replication, Failover and Disaster Recovery

## 1. Replica, Failover and Split-brain

Failover (failover) at least includes: failure detection, selecting a new primary, preventing the old primary from continuing to write, updating routing, catching up on replication progress, and verifying business semantics. If the detection is too fast, it will be accidentally switched due to network jitter; if it is too slow, it will be unavailable for a long time.

### Fencing prevents the old Primary from continuing to write

Just relying on the lease timeout may cause the old owner to resume after suspension and still think that it holds the lease. Monotonically increasing fencing tokens can be issued to each leadership authority, and the storage only accepts writes that are no less than the current token. Even if the old master is restored, its smaller token will be rejected.

### The trade-off between synchronous and asynchronous replication

| Copying methods | Advantages | Costs |
|---|---|---|
| Synchronous cross-replica commit | Confirmed data is less likely to be lost when switching masters | Write latency increases; write availability decreases when the replica is unreachable |
| Asynchronous replication | Low write latency; the master node can accept writes independently | Replication lags behind; switching masters may lose recent writes or read old values ​​|

For key facts such as payment ledger, ticket inventory, etc., it should be clear that the confirmation point requires persistence of several fault domains. For rebuildable search indexes or feed caches, asynchronous replication or even no replication can be accepted, with the source reconstructed after a failure.

## 2. RPO and RTO

- **RPO (Recovery Point Objective)**: The maximum amount of data that can be lost. The RPO is 5 minutes, meaning you can go back up to 5 minutes after the disaster.
- **RTO (Recovery Time Objective)**: The longest time from the occurrence of a disaster to the recovery of target service capabilities. An RTO of 1 hour does not mean that all derived functions must be fully restored at the same time.

In addition, it should be defined:

- **MTPD/MAO**: The maximum interruption time that the business can tolerate; RTO must be less than it;
- **Recovery Tier**: Read-only service recovery, critical write recovery and full-function recovery can have different RTOs;
- **Data Category**: Fact data, derived indexes, cache should not use the same RPO.

### Example: News Feed Hierarchical Recovery Target

| Data | Target Examples | Recovery Methods |
|---|---|---|
| Post / Follow Facts | RPO $\le$ 5 minutes, RTO $<$ 1 hour | Cross-zone replication + log/PITR backup |
| Outbox / Job | No loss of confirmed tasks, RTO $<$1 hour | Cross-zone copy or rebuild from fact record |
| Timeline/FeedItem derived index | RPO can be relaxed, recovery within hours | Snapshot + event replay + reconciliation |
| Redis cache | No commitment to durability, restore hotspots first | Rebuild from persistent storage |

The key principle is: **Restore the irreplaceable Source of Truth first, then rebuild the Derived Data, and finally warm up the Cache**. See [News Feed: Migration, Recovery and Acceptance](../../06-case-design/02-specific-application-system/03-news-feed/08-resumable-production-version-news-feed/13-migration-disaster-recovery-and-acceptance-from-07-to-08.md).

## 3. Backup, Replication and Reconciliation solve different problems

| Mechanism | Main solution | Cannot be solved alone |
|---|---|---|
| Online replica | Hardware/node failure, fast switchover | Logical accidental deletion will be quickly copied to all replicas |
| Snapshot | Restore to a certain point in time | Data within the snapshot interval; Log catch-up after recovery |
| WAL/incremental log/PITR | Accurate recovery to the target time | The log itself is damaged, the key is lost, and the process is not verified |
| Immutable/offline backups | Ransomware, malicious deletions, permission incidents | Slow recovery times |
| Reconciliation and verification | Silent omissions, derived data errors | Unable to recover without a reliable source of truth |

A backup plan must contain at least:

- Backup objects, frequency, retention period and region;
- Encryption keys and key recovery methods;
- Integrity check and periodic actual recovery;
- Non-database state such as Schema, configuration, queue locations, and object storage;
- Recovery sequence, responsible person, authority and operation manual;
- How deletion/privacy requirements are implemented in backup retention.

"Backup task successful" only means that the file was written out, not that it can be restored. Only when the time taken to actually restore and verify data in an isolated environment is measured, can there be evidence of RPO/RTO.

## 4. Common disaster recovery topologies and trade-offs

| Model | Features | Costs and Risks |
|---|---|---|
| Backup & Restore | Create a new environment and restore backup in case of disaster | Low cost, longest RTO |
| Pilot Light | Key data layers are retained in the target region, and calculations are started on demand | Medium cost, expansion and configuration need to be verified |
| Warm Standby | Long-term operation of the reduced version of the complete stack in the target region | The RTO is short and rapid expansion is required after the switch |
| Active/Passive | The backup region is close to full capacity and usually receives little or no traffic | The cost is high and the process is relatively clear |
| Active/Active | Multiple regions simultaneously | RTO has the shortest potential, but write conflicts, routing and consistency are the most complex |

Don’t choose Active/Active just for “zero downtime.” If the business has an indivisible global inventory or ledger, multi-master conflict handling may be more risky than briefly rejecting writes.

## 5. Checklist

- How to fencing master node switching and how to avoid dual masters?
- How many independent fault domains do confirmed writes need to fall to?
- What is the respective RPO/RTO for facts, derived indexes, and caching?
- Was the backup actually restored, and can the keys and schema be restored as well?
- What are the true costs and consistency penalties of current disaster recovery topologies?

[Return to detailed directory](README.md)
