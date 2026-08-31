# Capacity and resource governance domain

This field answers: **How ​​much logical computing budget does the customer have, can the current operation be started, how are multiple Workspaces and Workloads shared fairly, and how much is ultimately used? **

Capacity is a product and resource management object, not a machine, nor equal to a Worker Pool.

## 1. Business boundaries

Responsible:

- Capacity creation, status, specifications and Tenant ownership;
- Binding of Workspace and Capacity;
- Operation Admission, Reservation, concurrency and quota;
- Fairness of Interactive, Background and System traffic;
- Workload usage is normalized to Compute Units;
- Usage Ledger, Debt, quota reports and billing upstream data.

Not responsible for:

- Determine whether the Job dependencies are satisfied;
- Implement specific execution of Pipeline, SQL or BI;
- Directly maintain Item Definition;
- Replaces the underlying Kubernetes, VM or Engine Scheduler to allocate machines.

## 2. Authoritative object

```text
Capacity(capacity_id, tenant_id, sku, total_units, state)
CapacityAssignment(capacity_id, workspace_id, effective_at)
Quota(capacity_id, dimension, limit, window)
Reservation(operation_id, capacity_id, estimated_units, expires_at)
UsageEvent(operation_id, attempt_id, workload_id, quantity, schema_version)
UsageLedger(capacity_id, operation_id, consumed_units, period)
```

Capacity configuration and Usage Ledger are authoritative data for this domain. Real-time utilization and leaderboards can be derived views.

## 3. Internal capabilities

| Competencies | Answered questions |
|---|---|
| Capacity Service | What capacity has the customer purchased or been assigned? |
| Admission Controller | Can this Operation start now? |
| Fairness Controller | How do multiple queues share budget and concurrency? |
| Reservation Manager | How much of the budget has been approved but not yet completed? |
| Usage Meter | How to convert the original usage of different workloads into CU? |
| Usage Ledger | Who ultimately uses how much when? |

In the first version, Capacity, Admission and Metering can be deployed together, but Usage Ledger should use a traceable persistence model.

## 4. Admission decision

```text
ADMIT has a budget, creates a short-term reservation
DELAY No budget at the moment, try again later
THROTTLE Reduce concurrency or execution rate
REJECT request violates hard limit or Capacity is disabled
```

Check dimensions include:

- Capacity status, current window budget and Debt;
- Estimated resource requirements and deadline of Operation;
- Interactive/Background reservation ratio;
- Workspace, Workload and single Operation concurrency upper limit;
- Reserved resources for system cancellation and resume operations.

The estimated value is only used for Admission, and the actual usage is reported by Runtime. Debt is formed or a hard cap is triggered when the estimate is low, and the estimate cannot be regarded as the real bill.

## 5. Main interface

```http
POST /tenants/{tenantId}/capacities
PUT /workspaces/{workspaceId}/capacity-assignment
POST /capacity-admissions
POST /capacity-reservations/{operationId}:release
POST /usage-events
GET /capacities/{capacityId}/usage
GET /capacities/{capacityId}/top-consumers
```

Admission request example:

```json
{
  "capacityId": "cap-7",
  "operationId": "op-100",
  "workloadId": "pipeline",
  "class": "Background",
  "estimatedUnits": 120,
  "deadline": "2026-08-14T01:00:00Z"
}
```

## 6. Published and consumed events

release:

- `CapacityStateChanged`、`CapacityAssignmentChanged`
- `CapacityAdmissionDecided`
- `CapacityDebtChanged`、`CapacityThresholdReached`
- `UsageRecorded`

Consumption:

- `OperationReady`、`OperationFinished`；
- `RuntimeUsageReported`；
- `WorkspaceDeleted`；
- Capacity configuration events for packages or billing systems.

Usage Event uses `operation_id + attempt_id + sequence_number` to remove duplicates to avoid repeated measurement of network retries.

## 7. Cooperation with other domains

```text
Asset domain: Workspace holds the current capacity_id binding
Access Domain: Only authorized administrators can modify Capacity and bindings
Operation field: Request Admission after task Ready, release Reservation after completion
Workload domain: declare the estimated model and report the actual resource usage
Data plane: Scan bytes and IO can be usage inputs but do not directly determine CU policy
```

`Job Scheduler` should not copy the Capacity balance; it only consumes the Admission Decision. `Capacity Manager` also does not maintain DAG dependencies and Worker Lease.

## 8. When will the service be dismantled again?

- When Admission requires extremely low latency and high availability, it is separated from the configuration class Capacity Service.
- When the number of Usage Events is huge, remove the streaming Metering Pipeline.
- When bill settlement requires stronger auditing and recalculation capabilities, independent Usage Ledger and Billing Export.
- When large customers use dedicated computing pools, add Capacity-to-Pool Placement but maintain the same Capacity API.

The core of this domain is not charging, but establishing explainable, limitable, and verifiable resource boundaries on a shared platform.
