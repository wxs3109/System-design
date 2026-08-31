# Saga and Business Workflow

Saga and the business workflow model organize a cross-service, long-lasting business process into multiple local submissions and persistently recoverable state transitions. Here we discuss how `Workflow Engine + Service + Local Transaction` forms an operational link; for the principles of Saga, 2PC, compensation and isolation, see [Local Transactions, 2PC and Saga](../../02-core-concepts/09-concurrency-control-and-distributed-transactions/03-local-affairs-2pc-and-saga.md).

## Problem to be solved

A ticket booking may require seat locking, payment authorization and order confirmation; a data import may require verification, conversion, writing and publishing. They have common characteristics:

- The steps belong to different services and cannot be wrapped by an ordinary database transaction;
- A certain step may take a long time, wait for a callback, or the result is unknown;
- After the process is restarted, you must know where the process is executed;
- When subsequent failures occur, compensation, retry or manual processing is required;
- The caller needs to query the clear business status instead of maintaining an HTTP connection all the time.

## Try to narrow the border first

Saga introduces intermediate state, duplication of execution, compensation and operating costs. Select in the following order:

1. Can strong invariants be put into the same service and database and completed with a local transaction?
2. If it is just an independent background action, is Queue + Worker enough?
3. Use persistent workflows only when crossing multiple state boundaries, waiting, branching, or compensating.

If almost every write operation of two services must be submitted synchronously and no intermediate state can be accepted, the priority is to re-examine the service boundaries instead of putting a layer of Saga on each request.

## Orchestration Topology

```text
Client -> API -> Business Record
              -> Workflow Instance
                       |
                       +-> Activity -> Service A -> Local DB A
                       +-> Activity -> Service B -> Local DB B
                       +-> Activity -> Service C -> Local DB C
                       |
                       +-> timer / retry / signal / manual task
```

Workflow Engine saves process progress, timers, and pending activities; each business service only submits local transactions within its own authoritative storage. Workflow history answers "where did the process go?" and the business database answers "what are the facts about orders, payments, and inventory now?" The two cannot be confused as one piece of authoritative data.

For the platform’s External Contract and product differences, see [Workflow and Long-running Task Platform](../../04-Infrastructure-Components/08-workflow-and-long-running-task-platforms/).

## Minimum State Contract

A process instance requires at least the following identities and states:

| Field | Purpose |
|---|---|
| `workflow_id` | Platform execution identity for easy query and recovery |
| `business_id` | Stable business identity for orders, bookings or import tasks |
| `workflow_type/version` | Explanation of steps and support for continuation of old instances |
| `state` | Current business stage, such as `PAYMENT_PENDING` |
| `attempt/step_id` | Identifies a step execution, supports idempotence and tracking |
| `deadline` | When the entire process or current step fails |
| `last_error` | Classifiable recent failure, sensitive payload not saved |
| `created_at/updated_at` | Operation query and stuck detection |

Business records should also be kept in an externally interpretable state. Don't just know in Workflow Engine that the order is still being processed, but have the order table show that it's completed.

## A Happy Path

Taking booking as an example, we only explain the mode and do not expand the complete ticketing system:

1. The API creates `PENDING` subscription in the business library and reliably starts the Workflow identified with `booking_id`;
2. Workflow requests the inventory service to create a time-limited Hold;
3. Workflow requests the payment service for authorization;
4. After both are successful, the reservation service submits `CONFIRMED` with conditional state transition;
5. Workflow marks success and then asynchronously triggers notifications and other non-critical side effects.

Each step only modifies the local facts of the service it belongs to. The success of the activity does not mean the success of the entire process, and the failure of the notification should not turn the confirmed reservation into a failure again.

If atomic submission is not possible between business creation and workflow startup, you need to use [reliable event publishing link](../03-reliable-event-publishing-path/) or use a recoverable scanner to find "created but not started" records. A state is not acceptable: the API has returned success, but the process has neither started nor can it be re-started.

## Success Semantics and API

Long process API usually returns `202 Accepted` and business ID. It means that the request has been reliably accepted, but does not mean that all steps have been completed. Callers can poll the status API, receive webhooks, or subscribe to completion events.

It is recommended to distinguish:

- `PENDING/RUNNING`: The process is still progressing;
- `WAITING`: Waiting for callback, manual operation or Timer;
- `SUCCEEDED`: All necessary facts to determine the success of the business have been submitted;
- `COMPENSATING`: Business invariants are being restored;
- `FAILED/NEEDS_ATTENTION`: Automatic processing ends and manual decision-making is required;
- `CANCELLED`: Stop subsequent steps, but external side effects that have occurred may not be undone.

HTTP timeout, Activity timeout and business failure are not the same thing. A timeout simply means that the caller did not get a definite result; the next step should generally be to query the downstream fact by business ID rather than repeating the side effect immediately.

## Compensation Path

If the payment authorization fails and the reservation fails to be confirmed, the authorization can be revoked and the hold can be released. Compensation is a new business action, not a database rollback; refunds, revocations, and apology notifications may fail, and may also leave a history visible to audits.

Each compensable step should be clearly defined:

- Business identity and success criteria for forward actions;
- Compensatory actions, business status allowed to be executed and deadline;
- Is it safe to repeat compensation?
- Which authoritative system should be queried first when the positive result is unknown;
- How long does it take to switch to manual after compensation failure;
- Which invariant must still be restored when it cannot truly be undone.

The order of compensation is usually the opposite of the forward steps, but should be determined by business dependencies. The email has been sent and cannot be withdrawn, and a valid subscription that has been delivered to the user should not be released due to notification failure.

## Orchestration and Event collaboration

### Orchestration

The central workflow explicitly determines next steps and saves global progress. Suitable for processes with strict sequence of steps, waiting, compensation and manual processing. The advantage is that status, timeout and operation entries are centralized; the cost is that the orchestrator understands more business processes and must do version management.

### Choreography

After each service publishes the event after submitting the local fact, the next service subscribes and continues:

```text
Order Created -> Inventory Held -> Payment Authorized -> Order Confirmed
```

Suitable for short, approximately linear event responses, or multiple independent subscribers taking their own actions on the same fact. When there are many steps, the compensation is complex, or it is often necessary to answer "Where are you stuck now?", pure Choreography tends to scatter the process status across multiple topics and services.

Real systems can be mixed: Workflows orchestrate critical business steps, and service-internal and non-critical derived actions use event orchestration. Don't have the same state transition triggered by both an orchestration command and a broadcast event without a unique owner.

## Idempotency, Concurrency and Late Result

Workflow may reschedule the activity after the Worker crashes or times out. Each step should use a stable business idempotent key, such as `booking_id + payment_authorize`, rather than generating a new identity with each retry.

Business services protect legal paths with conditional state transitions. For example, only `PAYMENT_PENDING -> CONFIRMED` is allowed, and the cancellation process only allows unconfirmed records to enter `CANCELLED`. For related mechanisms, see [State Machine, Compensation and Reconciliation](../../02-core-concepts/09-concurrency-control-and-distributed-transactions/04-state-machine-compensation-and-reconciliation.md).

The most dangerous race conditions usually involve cancellations, timeouts, and late successes all happening at the same time:

- After Workflow announces a timeout, third-party payment returns late and succeeds;
- When the user cancels, the inventory hold is being converted to confirmation;
- Compensation has started and the original forward Activity has been re-rolled.

The processing principle is to read the current authoritative state first, and then perform conditional conversion with version or pre-state. A late result cannot directly overwrite the new state; it may trigger compensation or manual reconciliation.

## Failure and Recovery

| Failure scenarios | What the system sees | Recovery methods |
|---|---|---|
| The API has written business records, but the Workflow has not started | The business has been stuck in the initial state for a long time | Start the link reliably or scan and start again |
| Worker crashes after external action | Workflow considers result unknown and retries | Query or idempotent redo with same business key |
| Downstream continues to be unavailable | Steps repeatedly fail or wait | Bounded retries, persistent timers, post-deadline compensation/manual |
| Duplicate or late callbacks | The same state may be pushed again | Event ID deduplication and legal state transitions |
| Compensation failed | Process stopped at `COMPENSATING` | Independent retry, upgrade alarm and manual operation entrance |
| The Workflow platform is temporarily unavailable | New processes or Signals cannot be accepted | The call result is unknown; persistent instances will continue after the platform is restored |
| New code is incompatible with old instances | Long-term process fails at one step | Versioned definitions, old workers or explicit migrations |
| Workflow shows success but business facts do not match | Platform history and business library drift | Reconcile according to business invariants and fix the facts |

Recovery cannot rely solely on platform retries. Must be able to query all critical systems by `business_id`, re-drive security steps, perform compensation, and transfer instances that cannot be automatically determined to a manual queue.

## Reconciliation and Observability

At least observe:

- Process initiation, success, failure, cancellation and compensation rates;
- The number of instances in each state and the age of the oldest instance;
- Queuing time, execution time, number of retries and error classification for each step;
- The result is unknown and the number of manual instances transferred;
- The number of Workflow success statuses that are inconsistent with business facts;
- Worker saturation and downstream throttling by tenant or process type.

Reconciliation should check business invariants instead of just comparing the number of log entries. For example, a `CONFIRMED` reservation must have a valid inventory confirmation and a payment status that meets the rules. There should be clear remediation actions and audit records after discrepancies are discovered.

## Version and retention period

The process may span multiple deployments. New versions cannot assume that all instances start from the first step. It must be clear: the old instance continues to run the old definition, or is migrated in a safe state; the activity input and output must be backward compatible; the deleted steps and workers must be retained until the old instance is completed.

The retention period of Workflow history, Timer, idempotent records and business audits must cover the longest process, latest callback and maximum retry window. Large files and large results are stored in object storage, and Workflow only saves reference and verification information.

## Trade-off and selection

| Solution | Advantages | Main Costs | Suitability |
|---|---|---|---|
| Local transactions in a single database | Direct semantics and clear isolation | Restricted by single state boundaries | Strong invariants that can be shared together |
| Queue + Worker | Simple asynchronous, easy to expand | Multi-step status and waiting need to be managed by the application | Single independent background action |
| Orchestrated Workflow | Clear global progress, timer, compensation and manual entry | Platform, version and process coupling costs | Cross-service long process |
| Event Choreography | Service decoupling to facilitate the addition of independent responses | Global state, debugging and compensation decentralization | Short processes or independent subscribers |

## When not to use it

- Can be completed with a local transaction within the same authoritative database;
- There is only one background action that is safe to retry;
- The business cannot define intermediate status, compensation and manual processing rules;
- Attempt to use Workflow Engine to obtain Exactly-once across any external system;
- In order to "microservice", the invariants that must be submitted together are split into multiple services.

## Which cases are reused?

- [Ticket Booking](../../06-case-design/02-specific-application-system/08-ticket-booking/): Inventory Hold, payment and confirmation;
- [Payment System](../../06-case-design/02-specific-application-system/09-payment-processing/): Unknown results, refunds and reconciliations;
- Media processing: uploading, transcoding, review and publishing;
- Data platform: import, verification, conversion, publishing and manual approval.

## Interview Checklist

1. Which business invariant really spans services? Can the transaction boundaries be narrowed first?
2. Where are the Workflow status and business authoritative facts?
3. What do `Accepted`, step success, and process success mean respectively?
4. What are the idempotent identities, timeouts, result lookups, and compensation for each step?
5. Who owns the final state transition when race conditions occur between cancellation, compensation, and late success?
6. How to continue after the worker or platform is restarted, and how to run the old version instance?
7. Which failures will be transferred to manual work? How to reconcile and prove the recovery of business invariants?
