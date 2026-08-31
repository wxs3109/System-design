# Local affairs, 2PC and Saga

## 1. First reduce the transaction boundary

The most reliable Transaction is usually a Local Transaction within a single Source-of-Truth Database:

```text
Write Business Facts + Write Outbox
COMMIT
```

Search, cache, notification, and analytics data are then updated asynchronously. This not only maintains the atomicity of business facts and event intentions, but also prevents remote systems from participating in long transactions.

Case: [News Feed Outbox](../../06-case-design/02-specific-application-system/03-news-feed/04-asynchronous-index-version-news-feed/02-outbox-events-and-derived-indexes.md).

## 2. Why can’t one ordinary transaction wrap multiple services?

Database transactions only control this database. The following pseudocode is not atomic:

```text
BEGIN local transaction
  reserve seat
  call payment provider
  create ticket
COMMIT
```

The payment institution will not reverse the deduction with local rollback; network timeout may also make the call result unknown. Putting RPC in a transaction will only hold the lock for a long time and cannot create cross-system atomicity.

## 3. What is 2PC?

Two-phase commit uses a Coordinator to coordinate multiple Participants that support the transaction protocol:

```text
Phase 1 Prepare: All participants persist "can commit" and lock resources
Phase 2 Commit/Abort: Coordinator tells unified commit or rollback
```

A few suitable scenarios:

- Participants are all controlled by the same organization;
- Native support for database or transaction middleware;
- Transactions are short;
- Strong atomicity is more important than availability and latency.

cost:

- Resources are locked after Prepare;
- Coordinator or network failure may cause participants to wait for resolution;
- Large cross-region delay;
- External payments, emails, object storage, etc. usually cannot participate;
- Complex operations, recovery and observability.

So you can't end a system design interview question with "Go to 2PC", you have to prove that the participant and usability goals allow this.

## 4. Saga: a string of local transactions

Saga splits a long business process into multiple steps that can be submitted independently. After each step succeeds, the status is advanced; compensation is performed when subsequent failures occur:

```text
Create order
-> Lock seat
-> Initiate payment
-> Confirm ticket issuance
```

Possible compensation:

```text
Ticket issuance failed -> Initiate refund -> Release seats -> Close order
```

Saga does not provide isolation. While the process is in progress, other requests may see `PAYMENT_PENDING` or `REFUND_PENDING`. Intermediate states must therefore be expressed using explicit state machines, rather than disguised as transient atomic transactions.

## 5. Orchestration and collaboration

### Orchestration

The central Workflow/Order Service decides the next step:

```text
Order Service -> Seat Service -> Payment Service -> Ticket Service
```

Advantages: The process and status are clear, and it is easy to answer "Where are you stuck now?" Disadvantages: The orchestrator bears more business coupling.

### Choreography

Each service is advanced through events:

```text
OrderCreated -> SeatHeld -> PaymentSucceeded -> TicketIssued
```

Advantages: Publisher and consumer are decoupled. Disadvantages: Process fragmentation, circular dependencies, and event storms are harder to observe.

Critical transactional processes are generally suitable for explicit orchestrators; large numbers of independently derived processes are suitable for event orchestration.

## 6. Compensation is not database rollback

Refunds do not allow users to "never be charged", and sent emails cannot be atomically retrieved from the inbox. Compensation is a new business action:

- May fail and need to try again;
- Must be idempotent;
- Fees may apply;
- Audit required;
- Certain situations can only be handled manually.

So the goal of Saga is to ultimately restore business invariants, rather than pretending that all external side effects never happened.

## 7. Case: Booking + Payment

Reference [Ticket Booking](../../06-case-design/02-specific-application-system/08-ticket-booking/README.md) and [Payment System](../../06-case-design/02-specific-application-system/09-payment-processing/README.md):

1. Create `Hold` with a local transaction in the inventory database.
2. Create `Payment Intent` and use business idempotent keys.
3. When the external payment returns timeout, it will enter `PAYMENT_UNKNOWN` and cannot directly deduct money again.
4. Confirm the payment result through query or asynchronous callback.
5. If the payment is successful but the hold has expired, enter the refund/manual processing strategy instead of covering other people's seats.
6. Regular reconciliation revealed message loss and status inconsistency.

## 8. Selection principles

```text
Can be put into local transactions of the same database -> Prioritize local transactions
Need fact and event atoms -> local transaction + Outbox
Short transactions and supported natively by all participants -> 2PC is evaluated only
Long process across services or including external systems -> state machine + Saga + reconciliation
```
