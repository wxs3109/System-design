# Fault Tolerance, Graceful Degradation and Disaster Recovery

Fault tolerance is not "retry every error", downgrade is not "just return old data", and disaster recovery is not "have a backup". The three jointly answer: When a component inevitably fails, how to limit the impact, preserve key business semantics, and restore to a verifiable state within the target time.

## Learning sequence

1. [Fault model, timeout and overload protection](01-failure-model-timeout-and-overload-protection.md)
2. [Bulkhead, Circuit Breaker and Graceful Degradation](02-bulkhead-circuit-breaker-and-graceful-degradation.md)
3. [Replica, Failover and Disaster Recovery](03-replication-failover-and-disaster-recovery.md)
4. [Recovery drills, observations and cases](04-recovery-drill-observability-and-case-studies.md)

## Remember four points first

- Use deadlines, bounded resources, and isolation to limit the failure radius before considering retrying.
- Downgrades must protect business invariants; authorizations, funds, and inventory are often fail-closed when they cannot be confirmed.
- Online copies address hardware failures and are not a substitute for recoverable backups to deal with accidental deletions and corruption.
- Fact data, derived indexes and caches should have different RPO, RTO and recovery order.

## Decision main line

> Clarify Failure Domain → Set up Resource Boundary → Isolate fault → Press Invariant to do Graceful Degradation → Restore Source-of-Truth Data → Rebuild Derived Data → Reconciliation

The penetration cases include API Gateway dependency failure, News Feed sharding backlog, ticket inventory master node loss, and database accidental deletion.

[Return to core concept entrance](../)
