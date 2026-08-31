# Job Scheduler：Parking Lot

The following topics are not required for completion of this case. Only reopen when real demand or measurement bottlenecks occur to avoid infinite expansion of Job Scheduler into a general platform.

## 1. Production-level multi-tenant scheduling platform

Conditions for reopening: Multiple untrusted Tenants share the system, or there are clear SLO, RPO/RTO, compliance and operation and maintenance requirements.

Then redesign:

- Tenant Quota, fair scheduling, priority and anti-starvation.
- Backpressure, Admission Control and Retry Budget when MQ, Worker or downstream is overloaded.
- Complete Metrics, Logs, Traces, SLOs and Alerts.
- Backup and recovery of database, MQ and Region failures.
- Payload, webhook, management interface, security, auditing and operation and maintenance tools.

These are cross-case production governance issues, and learning them for the first time only requires knowing which fault and resource isolation contracts they change.

## 2. Workflow Engine

Reopening conditions: It is necessary to express cross-Job dependencies, not just to reliably execute a Job. An independent case should be established.

New dominant puzzles include:

- Workflow Definition, Run and Node Execution.
- DAG loop-free verification and ready node discovery.
- Fan-out/Fan-in hot spots.
- Failure propagation, Skip, Retry, Fail-fast and Compensation.
- Backfill and Workflow versions.
- Matching of CPU, GPU, region and Worker capabilities.

Workflow can reuse Execution, Attempt, Lease and Outbox, but is not the "next version" of Job Scheduler.

## 3. Online Rebalancing and Multiple Regions

Conditions for reopening: The fixed topology stress test cannot meet the capacity, or the business clearly requires cross-region disaster recovery.

Only then will we discuss:

- Online migration of Logical Shard to Physical Database.
- Epoch, Legacy Owner Fencing, Dual Read/Double Write and Phased Switchover.
- RPO/RTO in case of Region failure.
- Cross-Region trade-offs between scheduling latency, consistency, and availability.

Without measurement and recovery goals, complete protocols are not designed in advance.

## 4. Reopening rules

The Parking Lot theme will enter the main design line only if it meets the following conditions:

1. Real new requirements or measurement bottlenecks arise.
2. It changes the architecture, invariants, dominant capacity, failure semantics, or external contracts.
3. Be able to clearly explain the scenario in which it will fail if you don’t do it.
4. Set new completion standards and stopping points for it.

Otherwise, the Parking Lot status remains.
