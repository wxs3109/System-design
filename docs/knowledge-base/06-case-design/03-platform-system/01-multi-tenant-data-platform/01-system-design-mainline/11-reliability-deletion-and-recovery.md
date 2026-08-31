# Reliability, deletion and recovery

The platform hosts not only computing tasks, but also customers' Item definitions, data, and permissions. The first step in reliability is not to "make copies of all components", but to first distinguish which states must not be lost and which states can be reconstructed.

## 1. Authoritative state and derived state

| Status | Authoritative Source | Post-Lost Processing |
|---|---|---|
| Tenant, Workspace, Item identity | Metadata DB | Restore from sync replica or backup |
| Item definition versions | Definition Store | Restored from replica, cannot be rebuilt by search |
| Committed versions of files and tables | Shared Data Storage | Restore from a storage copy or backup |
| Secret | Secret Store | Restoring from a safety copy or requiring rotation |
| Operation and Attempt status | Operation Store | Restore from persistent records or check after marking UNKNOWN |
| Capacity Usage | Usage Ledger | Replay and Reconciliation from Worker Usage Events |
| Search, Lineage, Cache | Derived data | Reconstruction from authoritative state and events |

If the Item cannot be found in the search, it does not mean that the Item does not exist; the loss of the Cache will not cause permissions to be bypassed.

## 2. Three key write links

### Save Item

```text
Write immutable Definition version
-> Update current_version + Outbox in Metadata DB transaction
-> Asynchronously update Search and Lineage
```

If the Definition is written successfully but the Metadata update fails, an unreferenced version will be left and will be cleaned up in the background; Metadata must not point to a Definition that has not yet been persisted.

### Submit Operation

```text
Write Operation snapshot + Outbox
-> Publish queued events
-> Worker uses Lease to receive
```

If the message publication fails, Outbox Relay will resend it; if the message is repeated, the Operation ID and idempotent key make it still represent only one logical run.

### Submit Job output

```text
Write staging output
-> Verification
-> Use fencing token to atomically commit new data version
-> Mark Operation SUCCEEDED
```

You cannot mark success first and then submit the data, otherwise the user will see "success" but cannot read the result.

## 3. What happens when common failures occur?

| Failure | User impact | Platform processing |
|---|---|---|
| API instance crash | Current request retry | Service stateless; idempotent keys prevent duplicate creation |
| Metadata main database switching | Temporarily unable to create or edit Item | Synchronous copy promotion; read requests can be limitedly downgraded |
| Event Bus delay | Search and Lineage become old | Metadata is still read by ID; Outbox Consumer catches up to the target offset later |
| Worker crashes | Operation slows down | Create new Attempt after Lease expires |
| Old Worker recovery | Duplicate submission possible | fencing token rejects old Attempt |
| Workload failure | Operation of this type failed or queued | Circuit break, limited retry; other Workload continues |
| Capacity Manager is temporarily unavailable | New operations cannot be admitted | Running tasks continue; new tasks are queued conservatively |
| Shared Data Storage failure | Query or Job cannot read or write | Retry, intra-region replica switching; no forgery successful |

When the Control Plane is unavailable, the Worker that has obtained the Lease and short-term data credentials can continue for a short period of time; but it cannot infinitely renew the Lease or obtain new permissions indefinitely.

## 4. Delete is not a DELETE

Item may be referenced by Report, Pipeline, Schedule, Cache and data files. Delete the adoption state machine:

```text
ACTIVE -> DELETING -> SOFT_DELETED -> PURGED
```

1. Accept the deletion request and record the deleter, time and idempotent key.
2. Block new operations and cancel cancelable operations.
3. Item disappears from the default list, but can be restored during the retention period.
4. Publish a deletion event to invalidate Search, Lineage, Schedule and Cache.
5. Asynchronously clean up Definition, data and Secret references after the retention period.
6. Keep necessary audit and usage records.

Deleting a Workspace or Tenant is a batch version of the same process that must support progress, retries, and partial failures and cannot rely on one overly large transaction.

## 5. Backup and disaster recovery objects are different

| Data | Example Target | Reason |
|---|---|---|
| Metadata | Low RPO, short RTO | Determine if all resources exist and to whom |
| Definition | Low RPO | User code and report definitions are often not rebuildable |
| Business data | Determine replication and backup based on customer level | The largest amount of data, the cost difference is obvious |
| Operation history | Allow slightly higher RPO | Running tasks need to be checked, old history can be archived hierarchically |
| Cache / Search | No backup required | Can be rebuilt from authoritative state |

The specific RPO/RTO is determined by the service level, but it must be defined separately. It cannot be said in general that "system cross-region backup".

## 6. Minimal observability

- Control plane: Item API success rate, P99, Metadata replication delay.
- Operation surface: The oldest waiting time of the queue, Operation success rate, Attempt retry rate.
- Capacity: CU utilization, debt, throttle and reject.
- Data plane: read and write error rate, submission failure, amount of staging orphan data.
- Isolation: Cross-tenant denial, permission cache version delay, credential issuance failure.
- Recovery: Outbox backlog, Search/Lineage lag, backup and recovery drill results.

Each Trace carries at least `tenant_id`, `workspace_id`, `item_id`, `operation_id` and `workload_id`; Secret or original customer data cannot be written in the log.
