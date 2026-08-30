# Design ticket booking system

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Scarce-resource Transaction |
| Core Invariants | The same seat cannot be successfully sold twice; the status of Hold, Order, Payment and Ticket must evolve legally |
| Quality attribute priority | Correctness → Fairness → Peak Availability |
| Traffic / Data Shape | Extreme bursts at the time of sale, a small number of events form a Hotspot, many reads and concentrated write competition |
| Failure strategy | Fail-closed when the inventory cannot be confirmed; Hold has a clear TTL; query instead of blindly retrying when the payment status is unknown |
| Security Boundaries | Bots, Scalpers, Account Takeovers, Payment Data, PII and Fair Queuing |
| Key Patterns | Waiting Room、Conditional Update、Hold、Idempotency、State Machine、Saga、Reconciliation |

## Functional boundaries
- Search for events, select seats, lock seats, pay, issue tickets and refund.
- Payment is used as an external system call; this case only designs relevant states, idempotence, callbacks and compensation, and does not repeatedly expand the internal Ledger.

## Acceptable NFR (Design Assumptions)

- The peak reading of the popular launch is 1,000,000 QPS, and the locking attempt is 100,000 QPS; core writing is controlled through the Waiting Room.
- The same seat cannot be successfully sold twice under any concurrency and retries; Fail-closed when inventory is uncertain.
- Hold TTL example is 5 minutes and can be reallocated within 30 seconds after expiration; queue order and purchase limit rules are auditable.
- The search is allowed to be stale at the second level, and the lock result P99 < 1 second; the payment in unknown status enters Pending and is queried/reconciled.

## Core topics
- Seat inventory model, temporary lock and timeout release.
- Concurrency control, idempotence, overselling prevention and queuing.
- Order state machine, payment callbacks, compensation and Reconciliation (difference checking and repair).
- Popular sales, read and write isolation and downgrade.

## Interview questions
- What should I do if the payment is successful but the lock has expired?
