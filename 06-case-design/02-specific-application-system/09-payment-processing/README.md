# Design Payment Processing System

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Financial Ledger / Distributed Workflow |
| Core invariants | The same business request cannot produce duplicate funding effects; Ledger must be balanced, cannot be modified silently, and is auditable |
| Quality attribute priority | Correctness → Security / Auditability → Availability |
| Traffic / Data Shape | QPS is usually not the biggest problem; external channels, asynchronous callbacks, Retry and Unknown Outcome dominate |
| Failure strategy | Query and Reconciliation when the result is unknown; cannot blindly retry deductions; sensitive writing Fail-closed |
| Security Boundaries | Payment Credentials, Fraud, mTLS/Signature, PCI Scope, Auditing and Segregation of Duties |
| Key Patterns | Payment Intent、Idempotency、Immutable Ledger、Outbox、State Machine、Saga、Reconciliation |

## Functional boundaries
- The basic version supports Payment Intent, payment confirmation, refund, merchant callback, double accounting and Reconciliation (difference checking and repair).
- Complete Fraud Model, Chargeback/Dispute process and cross-border clearing as subsequent extensions.

## Acceptable NFR (Design Assumptions)

- Based on the global peak of 20,000 Payment Confirm/s, channel Callback reaches 2 times the peak value in a short time; based on Merchant and Route isolation quota and Retry Budget.
- The same business Idempotency Key cannot produce duplicate funding effects; each Ledger Journal Entry debit and credit is balanced and only additional corrections are made.
- Internal journal write availability target 99.99%, confirmed Journal Entry RPO close to 0, RTO < 30 minutes.
- Channel synchronization response P99 is subject to external SLA constraints. It will turn into Pending when it exceeds the deadline, and the timeout will not be interpreted as a failure.
- Merchant callback is At-least-once, signed and replayable; 95% are delivered within 1 minute after the status is determined. Continuous failure will result in DLQ.

## Core business closed loop

1. Merchant uses the business order number, amount, currency and Idempotency Key to create a Payment Intent; the system fixes the business semantics of this fund request.
2. Client uses Tokenized Payment Method to confirm payment; Payment Orchestrator completes permissions, limits and basic risk checks, and creates a unique Payment Attempt.
3. Channel Adapter calls the external channel with a stable Provider Request ID; synchronization success, clear failure and Unknown Outcome enter different states respectively.
4. Synchronous responses or verified asynchronous callbacks advance the Payment State Machine; repeated, out-of-order and delayed callbacks must not produce repeated funding effects.
5. After confirming the funding results, write the balanced Journal Entry using idempotent commands and publish the status changes through Outbox.
6. Webhook Dispatcher delivers signed events to Merchant At-least-once; Merchant can use Event ID to remove duplicates, or actively query the final status.
7. Refund creates independent Workflow and Journal Entry and does not overwrite the original Payment; continuous pending or cross-system differences are detected and repaired by Reconciliation.

## Core topics

- Payment Intent, Payment Attempt, Provider Request ID and multi-layered Idempotency Boundary.
- Legal status migration of Authorized, Captured, Failed, Cancelled, Refunded and Pending/Unknown.
- Double Bookkeeping, Immutable Journal, Correction Entry, Balance Derivation and Period Close.
- Channel Routing, Deadline, Circuit Breaker, Asynchronous Callbacks, Retry Budget and Compensation.
- Transactional Outbox, Webhook Delivery, event sequence, Deduplication and queryable final state.
- Reconciliation, basic risk controls, Tokenization, auditing, separation of duties and PCI boundaries.

## Minimum data list

| Data | Roles | Consistency Focus |
|---|---|---|
| Payment Intent | The business identity of a merchant fund request | Merchant + Idempotency Key is unique; the amount and currency cannot be changed silently after confirmation |
| Payment Attempt | An actual attempt on a channel | Stable Provider Request ID; logs synchronous response and Unknown Outcome |
| Provider Event | Channel Callback / Original evidence of query results | Verify signature, retain Payload Hash, and remove duplicates by Provider Event ID |
| Journal Entry / Posting | Internal accounting facts | Debit and credit balance, Append-only, corrected with Correction instead of overwriting |
| Refund | Independent refund Workflow | Cannot exceed the refundable amount; can be retroactively associated with the original Payment and Ledger |
| Outbox / Webhook Delivery | Internal and external status propagation records | At-least-once, stable Event ID, save Attempt and confirmation status |
| Reconciliation Record | Differences between channels, Payment State and Ledger | Interpretable, rerunable, auditable repair actions |

## Key Trade-off

- Synchronously waiting for the final state of the channel makes the API more intuitive, but it will spread external jitter to the system; setting Deadline and returning Pending can isolate the fault, but requires complete closed loop of query, Webhook and Reconciliation.
- Unable to rely on a global Exactly-once Transaction across local databases and external channels; stable business IDs, idempotent Channel APIs, Immutable Ledgers and reconciliations are more reliable than "blindly retry until success".
- Put Payment State and Ledger into the same database to facilitate atomic submission, and split them into independent services to improve isolation and governance; after splitting, Outbox, idempotent consumption, and difference detection must be used to handle inconsistency windows.
- More aggressive channel Failover improves the success rate, but may cause repeated deductions when the results of the original channel are unknown; it can only be switched if it can be proven that the original Attempt is not effective or shares idempotent boundaries.
- Real-time balance materialization can reduce query latency, but authoritative facts should still be immutable Posting; Snapshot and Cache must be able to be reconstructed from Journal Replay.

## Interview questions

- How to deal with "unknown status" without repeated deductions?
- Provider first returns a timeout, then Callback succeeds, and Merchant has initiated Retry. How does the status converge?
- When the Ledger has been accounted for but the Payment Event has not been posted, how to restore it and avoid repeated posting?
- When Refund is successful and Merchant Webhook fails for a long time, what should be displayed in external inquiries and internal accounts respectively?
- What are the safety prerequisites for multi-channel failover, and what errors must not automatically switch channels?

## Subsequent expansion sequence

1. Payment Contract, Intent, Attempt, Idempotency Key and state machine;
2. Channel Adapter, Unknown Outcome, Callback, Retry and channel query;
3. Immutable Ledger, Posting, Balance and Correction;
4. Outbox, Merchant Webhook, Refund, Saga and Compensation;
5. Reconciliation, Fraud, Audit, PCI Boundary, Recovery and Multi-region.
