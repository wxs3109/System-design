# 02 Data Reliable Version: News Feed

> The functions, API and query methods are exactly the same as 01. This version only solves single master database failure and confirmed write loss, without caching or feed pre-generation.

## Reading order

1. [Why solve data reliability first](01-why-solve-data-reliability-first.md)
2. [Replication, Failover and Consistency](02-replication-failover-and-consistency.md)
3. [Backup, recovery and drill](03-backup-restore-and-drill.md)
4. [Migration and upgrade signals from 01 to 02](./04-migration-and-upgrade-signals-from-01-to-02.md)

## Inheritance 01

- Continue to use the three fact tables User, Post, and Follow.
- All write requests go to PostgreSQL Primary.
- The home page is still executing Follow JOIN Post in the database.
- No changes to `POST /posts`, `DELETE /posts/{id}`, Follow API and `GET /feed`.

## This version only adds

- Synchronous or quasi-synchronous Standby, undertaking Primary Failover;
- WAL persistence, archiving and point-in-time recovery;
- Automatic backup, off-site backup copy and regular recovery drills;
- Clear RPO, RTO, write confirmation and failover rules.

## One sentence design

The API still accesses a logical database endpoint; the Primary returns success after submitting and meeting the Replication Acknowledgement Policy, and the Standby is used for Failover instead of accepting ordinary feed queries.

[Return to evolution route](../README.md)
