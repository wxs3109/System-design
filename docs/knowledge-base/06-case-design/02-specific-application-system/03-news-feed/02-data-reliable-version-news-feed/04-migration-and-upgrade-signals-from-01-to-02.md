# Migration and upgrade signals from 01 to 02

## Migration steps

1. Record the backup and recovery baseline of the current Primary.
2. Create a standby from a consistent snapshot.
3. Let Standby catch up to the recorded WAL position and verify the row count, constraints, and sampling checksum.
4. Practice promoting and fencing when not accepting traffic.
5. Change the application connection to Stable Endpoint.
6. Switch a small proportion of instances first to confirm that transactions and delays are normal.
7. Enable synchronous confirmation policy and monitor commit latency.
8. The migration is not complete until the Failover and PITR drills are completed.

Migration does not change the table structure, so there is no need to double-write business data. Rollback simply returns the application connection to the original endpoint, but only if the original Primary is still the only writing node.

## Add new fault

| New Risks | Response |
|---|---|
| Slow synchronization of Standby leads to write delays | Timeout budget, replacement of failed replicas, and non-silent reduction of durability |
| Automatic failover misjudgment | Arbitration, fencing, manual confirmation strategy |
| Replication slot or WAL backlog fills disk | Capacity alarm and cleanup strategy |
| Backup leaks | Encryption, least privileges, auditing |

## Signal to enter 03

- Business facts have achieved RPO/RTO targets;
- Home page query occupies most of Primary’s CPU or I/O;
- Feed slow query begins to affect posting and following P99;
- The cost of simply upgrading the database vertically exceeds the budget.

At this point the next step is to move the read load to Read Replica and Redis.

[Enter 03 Read Extended Version](../03-read-the-extended-version-news-feed/README.md)

[Return to the second version directory](README.md)
