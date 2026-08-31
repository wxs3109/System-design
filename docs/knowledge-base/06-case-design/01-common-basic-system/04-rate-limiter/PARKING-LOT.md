# Rate Limiter：Parking Lot

The following topics are not required for completion of this case. Reopen only when real demand or measurement bottlenecks arise.

## 1. Multiple Regions and Global Quota

Conditions for reopening: Multiple Regions must share the same business budget.

At that time, the accuracy contract needs to be determined first:

- Is strict intra-region and eventual cross-region consistency sufficient?
- When the network is partitioned, should we give priority to availability or not to over-delivery?
- What is the maximum acceptable over-issuance or false rejection?
- Should global financial quotas be switched to a reconciled Quota Ledger?

When there is no business error budget, the globally strongly consistent Counter is not designed by default.

## 2. Token Lease and local budget

Reopening conditions: Shared Store or strict Hot Key has been measured as the dominant throughput bottleneck, and the business allows bounded over-issuance.

At that time, the error upper bound is calculated based on the number of instances, Lease size, and In-flight requests, and the local budget is deduced from `maxOvershoot`. Token Lease is not a transparent performance optimization, it trades precision for throughput.

## 3. Complex multi-rule transactions

Reopening conditions: The business cannot accept the final Deny when other independent rules have already consumed the quota.

May require:

- Compile related Counters into the same consistency domain;
- Reservation / Commit / Cancel；
- Two-stage coordination;
- Explicit compensation semantics.

When learning for the first time, you only need to know the difference between independent accounting and all-or-nothing.

## 4. Complete current-limited product

Reopening conditions: The goal changes from learning cases to real multi-tenant products.

Then redesign:

- Policy CRUD, Validate, Simulate, Publish, Canary and Approval.
- Multi-tenant Quota, Temporary Waivers, RBAC, Auditing and Console.
- Complete Decision Explain, Usage queries and high-cardinality governance.
- Reservation, Outcome Report, Complex Action and Product SLA.
- Multi-Region disaster recovery, migration and compatibility protocols.

## 5. Reopening rules

The Parking Lot theme will enter the main design line only if it meets the following conditions:

1. Real demand or measurement bottleneck occurs.
2. It changes the architecture, invariants, dominant capacity, fault semantics, or call contract.
3. Can explain the specific scenario in which it will fail if you don’t do it.
4. Set new completion standards and stopping points for it.

Otherwise, the Parking Lot status remains.
