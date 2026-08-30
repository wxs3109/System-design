# Recovery Drill, Observability and Case Studies

## 1. Security sequence for a zone switch

The following is a general sequence for systems with a single master fact base:

1. Declare the incident and freeze unnecessary changes;
2. Fencing writes in the original region to prevent dual masters;
3. Confirm the replication sites in the target region and quantify the actual data loss window;
4. Improve the target region’s fact base;
5. Restore critical read-only first, and then restore necessary writes;
6. Restore Outbox, Queue and Worker, and limit the catch-up rate;
7. Gradually rebuild the hotspot cache and derived index from the fact store;
8. Directed reconciliation of failure time windows;
9. Verify user semantics, SLI, data verification and actual RPO/RTO;
10. Maintain the original geographical isolation, develop a controlled failback, and do not switch back immediately.

DNS switching is also affected by TTL, client cache, and long connections; "modifying DNS" cannot be considered an instantaneous completion.

## 2. Recovery drill and fault injection

### What to practice?

- Kill a process, node or an availability zone;
- Injects high latency, packet loss, DNS failures, and connection pool exhaustion;
- Let the database copy fall behind and perform master cut;
- Clear a rebuildable derived partition;
- Restore the backup at a specified point in time;
- Simulate misconfiguration, certificate expiration and permission revocation;
- Rate-limited replay of DLQs and verification that no duplicate side effects occur.

### How to control risks

The drill should have clear assumptions, scope of impact, stopping conditions, rollback methods, and observation indicators. Execute in test environment and single instance/single tenant first, and then expand to availability zone or region. Don't just verify "the process is up", but also verify:

- User request correctness and SLO;
- Data invariants, row counts/checksums and reconciliation differences;
- Whether Retry, Circuit Breaker and Graceful Degradation trigger as expected;
- Actual RPO and RTO;
- Whether the on-call staff can complete the recovery using the runbook alone.

## 3. Mapping from alarms to recovery actions

Basic indicators include:

- User success rate, P95/P99, downgrade ratio;
- Timeout Rate, Error Rate and Circuit Breaker status of each dependency;
- Concurrency, connection pooling, queue length and number of rejections;
- Queue lag and oldest message age;
- Replication Lag, Primary/Replica roles and Failover times;
- Backup age and restore test results;
- DLQ age, replay progress and reconciliation differences.

"The oldest feed task is older than 30 seconds and still growing" is a better indicator of user impact than "queue has 1 million messages". The former can also guide consumption reduction, sharding repair, and rate limiting catch-up. See [News Feed: Observability and Recovery](../../06-case-design/02-specific-application-system/03-news-feed/08-resumable-production-version-news-feed/12-observability-and-recovery.md) for the complete case.

## 4. Three specific decision-making cases

### Case A: Recommended service failure

Home page assembly relies on recommendation services, and continuous timeouts lead to accumulation of web threads. Set 100 ms Timeout, independent concurrency pool, and Circuit Breaker; fallback to popular content when Circuit Breaker Open. Only a small number of Probe Requests are placed after recovery.

**Trade-offs**: The quality of personalization decreases, but the homepage is still usable; popular lists need to have expiration caps and obvious monitoring.

### Case B: Ticket inventory master node loses contact

The read copy can still display the seat map, but it cannot confirm which party has the latest writing rights. Stop locking/payment confirmation, select a new master through consensus or fencing, and then resume writing.

**Trade**: Sacrifice write availability during partitioning to avoid oversold and double confirmation. Read-only pages must indicate that inventory may change.

### Case C: Accidentally deleting database table

Three online replicas will quickly replicate `DROP TABLE`, so replicas cannot replace backups. Immediately prevent further writing, select the PITR time point before accidental deletion to restore to the isolation environment, replay the allowed incremental log, verify the business invariants and then perform controlled switching.

**Trade-off**: The closer you get to zero RPO, the more complex the logging and recovery process becomes; continuing writes during recovery also makes merging more difficult.

## 5. Acceptance Checklist

- How to perform regional recovery sequence, rate limit catch-up, directed reconciliation and failback?
- What were the actual RPO/RTO and open issues from the most recent exercise?
- Can the time window, shards, tenants and data objects affected by the failure be located?
- After recovery, are business invariants verified instead of just looking at instance health?
- Were the runbooks, permissions and owners actually available at the time of the incident?

[Return to detailed directory](README.md)
