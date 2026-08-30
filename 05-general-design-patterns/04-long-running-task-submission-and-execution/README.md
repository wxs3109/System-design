# Long-running Task Submission and Execution

The long task link separates "receiving the request" and "completing the work": the API first reliably records an operation, and then the Queue and Worker execute it in the background. It is suitable for image processing, report generation, batch import, email sending and other tasks that do not need to occupy a synchronization request.

This article only discusses how Client, API, Operation Store, Queue and Worker collaborate. For the semantics of asynchronous, retry and idempotence, see [Synchronization, Asynchronous and Event-Driven] and [Impotent, Retry and Deduplication] (../../02-Core Concepts/06-Impotence, Retry and Deduplication/); for the single-component contract of Queue, see [Task Queue and Publish and Subscribe] (../../04-Infrastructure-Components/06-task-queues-and-pub-sub/). Multi-step, wait and compensation belong to [Workflow and Long Task Platform] (../../04-Infrastructure-Components/08-workflow-and-long-running-task-platforms/) and [Saga and Business Workflow] (../06-Saga and Business Workflow/).

## 1. Why is the simplest solution not enough?

Executing the task directly in the HTTP request is easiest and should be the default for short tasks. But when the working time may exceed the Timeout of the client, Gateway or load balancer, the following will occur:

- The client times out but does not know whether the task has been completed;
- The client retries, causing the same task to be executed repeatedly;
- Slow tasks occupy request threads, connections and memory for a long time;
- When traffic suddenly increases, ingress requests and background work are overloaded together;
- After the process is restarted, tasks that only exist in memory are permanently lost.

Just throwing tasks into a Queue is not complete either. The caller also needs stable task identity, status query, cancellation semantics and final result; the system also needs to answer "API has returned, but the message has not entered the Queue" how to recover.

## 2. Invariant of the link

First keep four invariants when designing:

1. After the API returns `Accepted`, the task intent has been persisted and can continue to be dispatched;
2. Retrying the same client will not create multiple independent tasks;
3. Worker may be executed repeatedly, but it cannot produce repeated business side effects;
4. Operation Store can explain the current progress, but the business results are still owned by the corresponding business store.

`Accepted` only means that the system has taken over the task, but it does not mean that the task has started, nor does it mean that the business has been completed.

## 3. Participants and status owners

| Participants | Responsibilities | Owned Status |
|---|---|---|
| Client | Submit task, save task identity, query or cancel | `idempotency_key`, `operation_id` |
| API | Authentication, verification, admission, creation Operation | Request context |
| Operation Store | Save externally visible task status | status, input reference, result reference, error, version |
| Dispatcher | Send accepted tasks to Queue | Scan Checkpoint or dispatch status |
| Queue | Buffers tasks and delivers work to available Workers | Message, visibility period, or acknowledgment status |
| Worker | Perform business actions, report progress and results | Temporary status of the current Attempt |
| Result Store | Save large results or business products | Files, reports, media objects, etc. |
| Reconciler | Find tasks that are stuck, missing dispatches, or have inconsistent results | Audit and remediation progress |

Operation Store is not a monitored copy of Queue. It expresses business-level operations to the caller; Queue is only responsible for delivery work, and the state names and retention times of the two do not have to be the same.

## 4. Minimal API and state model

Common interfaces are:

- `POST /operations`: Submit the task and carry stable `Idempotency-Key`;
- `GET /operations/{operation_id}`: Query status, progress and result references;
- `POST /operations/{operation_id}:cancel`: Requesting cancellation instead of promising immediate rollback;
- Optional webhook or event: proactive notification of final state, polling can still be used as fallback.

Successful submission usually returns `202 Accepted`, `operation_id` and status query address. For the exact same idempotent key, the API should return the existing Operation; if the same key corresponds to different parameters, it should be explicitly rejected instead of silently reused.

The minimum state can be:

| Status | Meaning |
|---|---|
| `Accepted` | Mission intent has been reliably recorded |
| `Queued` | Dispatched, waiting for Worker |
| `Running` | An Attempt is being executed |
| `Succeeded` | The results of the business definition have been submitted |
| `Failed` | Automatic recovery boundary reached, manual or caller decision required |
| `CancelRequested` | A cancellation intent has been received, but the running job may not have been stopped |
| `Cancelled` | No further work will be performed; side effects that have occurred may not be undone |

State migration should use conditional updates, for example, only workers whose current `Running` and Attempt match are allowed to write the final state. Don't let the late old Worker overwrite the results of the new execution.

## 5. How to ensure that Accepted will not be lost after

Operation Store and Queue are two state boundaries, and ordinary Dual Write will generate a Failure Window. There are two common starting points:

### Solution A: Operation Store also serves as the source to be executed

The API creates Operations within a Database Transaction. The Worker or Dispatcher collects the records that meet the conditions and uses Lease (temporary ownership with expiration time) to prevent long-term possession. This solution has few components and is suitable for scenarios where the throughput is not high and the query and collection pressure can be borne by the database.

### Plan B: Operation + Outbox, then dispatch to Queue

The API saves the Operation and the records to be dispatched in the same transaction, and the Dispatcher sends them to the Queue with recovery. This solution is suitable for scenarios that require Queue buffering, independent expansion of Workers, or isolation of task categories. The specific reliable release mechanism directly reuses [reliable event release link] (../03-Reliable event release link/). This article will not expand on Outbox and CDC.

Regardless of the solution, "Queue send call returned once" cannot be used as the only basis for recovery. It must be possible to rediscover unfinished tasks from a persistent state.

## 6. Happy Path and Success Semantics

1. Client generates idempotent keys and submits tasks;
2. API verifies parameters and quotas, and reliably writes Operation to Store;
3. API returns `202 Accepted`;
4. Dispatcher dispatches tasks to the corresponding Queue;
5. Worker receives the message and creates a new `attempt_id` or executes the generation;
6. Worker performs business actions and writes large products into Result Store;
7. Worker submits the result and `Succeeded` with conditional update;
8. Worker confirms the message after the result is submitted;
9. Client obtains the final state through query, Webhook or event.

There are at least three different Success Semantics here: API accepted, Worker received, and business results submitted. Monitors and APIs cannot combine them into a vague "success".

## 7. Lease, Heartbeat and Stale Worker

The Worker may crash after receiving the task. Queue's Visibility Timeout or Operation Store's Lease allow the task to be picked up again after a period of time. Long tasks should be periodically heartbeated or renewed to demonstrate that they are still progressing.

Lease expiration does not mean that the old Worker has stopped. After the network is restored, it may run concurrently with a new worker; such an instance that has lost its lease but is still executing is often called a **Stale Worker**. So each execution requires a stable generation, such as `attempt_id`, `lease_version` or incrementing `generation`:

- Worker must carry the current generation when updating progress and final state;
- Store only accepts writes that still hold valid generations;
- External side effects using stable `operation_id` as idempotent;
- Side effects that cannot be idempotent require querying external results or performing business reconciliation.

Heartbeat means that the Worker is alive, but does not necessarily mean that the task is actually progressing. Stages, processed quantities, or last progress times should also be recorded to identify "alive but stuck" tasks.

## 8. Retry, Failure and Cancellation

Retries should be classified by error:

| Error | Common handling |
|---|---|
| Temporary network errors, current limiting | Bounded retries, backoff and Jitter |
| Invalid parameter, permission denied | Terminate directly without meaningless retries |
| The external result is unknown | Query with the business ID first and then decide whether to try again |
| Program defects or poisonous data | Isolate tasks, alarms, and re-drive after repair |
| Downstream is unavailable for a long time | Stop automatic retry, switch to manual or delay recovery |

`Failed` is not an alias for "message entered DLQ", but a business end state with clear meaning to the caller. Error messages should distinguish whether retry is possible, but should not expose sensitive internal details.

Cancellation is usually collaborative: the API records `CancelRequested`, and the worker stops subsequent steps at a safe checkpoint and writes `Cancelled`. If the file has already been sent, the payment has been completed, or the external API does not support cancellation, the system cannot claim that cancellation amounts to revocation; separate compensation is required, or cancellation is explicitly denied.

## 9. Input, progress and result data

Queue messages should be as small as possible and usually only carry: `operation_id`, `tenant_id`, task type, input reference, version and Trace Context. Large files, long parameters and results are placed in object storage or business storage and accessed through immutable references.

Operation records require at least:

- Task identity: `operation_id`, idempotent key, tenant and creator;
- Execution information: status, Attempt/Generation, creation and update time;
- Input contract: task type, Schema version, input reference;
- Output contract: result reference, summary and expiration time;
- Recovery information: number of retries, next execution time, last Heartbeat;
- Diagnostic information: error category, Trace ID, but secrets are not saved directly.

Progress percentage is only reliable if the total effort is known. Otherwise, it is more honest to use the stage name or the processed number to avoid the task being stuck at `99%` for a long time.

## 10. Capacity Isolation and Backpressure

Asynchronization absorbs short-term bursts and does not create downstream capacity. If the arrival rate is higher than the processing rate for a long time, the Queue will continue to grow. When designing, calculate at least task arrival rate, cost per task, worker concurrency, completion throughput, and oldest acceptable task age.

Common isolation dimensions include task type, tenant, priority, and downstream dependencies. Interactive tasks and large offline tasks can use different Queues or concurrency quotas to prevent large tasks from occupying all Workers. Workers also need to pull based on database connections, third-party quotas, and memory limits, and cannot expand infinitely based on CPU alone.

Priority is not guaranteed. Sustained high-priority traffic may starve ordinary tasks, thus requiring quotas or weighted fairness. Complex timing triggers, global priorities, and large-scale scheduling algorithms are Scheduler cases and will not be discussed in this article.

## 11. Failure and Recovery

| Fault location | Visible status | Recovery action |
|---|---|---|
| Operation failed before submission | No accepted tasks | Client retries with the same idempotent key |
| Operation failed after submission but before response | The result is unknown, but the task already exists | Press the idempotent key to return to the existing Operation |
| Accepted but not dispatched | Operation stopped at `Accepted` | Dispatcher rediscovered and dispatched |
| Queue repeated delivery | The same Operation is received again | Stable identity, condition update and side effects idempotence |
| Worker crash | Lease/Visibility expiration | New Attempt takeover |
| The old Worker submitted late | There is a new generation in the Store | Fencing rejects the old Attempt |
| The result has been submitted, but the message has not been confirmed | The message appears again | The Worker recognizes the final state and safely confirms it |
| Webhook delivery failed | The task has been completed but the Client has not received the notification | Webhook retries, and the Client uses status query to fall back |
| The result object is lost or expired | Operation claims success but the result is unreadable | Business verification, reconstruction or clear expiration semantics |

The Reconciler should regularly identify operations that have not been dispatched for a long time, leases have expired, heartbeats have stalled, final states are inconsistent with business results, and notifications have not been delivered for a long time. Recovery tools should support per-task, tenant, and time window rate limiting for re-driving to prevent repair traffic from overwhelming online systems.

## 12. Observation and verification

At least observe:

- Submission volume, acceptance failure rate and idempotent hit rate;
- `Accepted` to `Queued`, queue waiting, execution and end-to-end completion delays;
- Queue Depth and the age of the oldest task, not just the number of messages;
- Worker concurrency, saturation, Heartbeat, Lease expiration and repeated Attempt;
- Retry, failure, cancellation and manual intervention statistics by error category;
- Fairness across tenants, task types and priorities;
- Reconciliation difference between the final state of the operation and the real business results.

During verification, you should actively kill workers, interrupt Dispatcher, create queues for repeated delivery, delay the completion response of old workers, and confirm that tasks will not be lost, late writes will be rejected, and repeated side effects will be controlled. Also practice backlog recovery to confirm that recovery throughput will not disrupt online paths.

## 13. When to upgrade or keep it simple

| Scenario | Suitable solution |
|---|---|
| Completes quickly and the caller needs immediate results | Synchronous calls |
| A background action that can be retried independently | Operation + Queue + Worker in this article |
| Multiple steps, branches, long waits, manual approval or compensation | Workflow Engine / Saga |
| Fixed time triggering and large-scale task orchestration | Scheduler case |
| Just broadcast the fact that it happened | Reliable event publishing link |

Don't make all requests asynchronous just because there is a Queue. Asynchronous interfaces add state saving, polling, cancellation, retention, recovery, and reconciliation costs; short, reliable operations that remain synchronized are often easier to understand.

## Reuse method

- Video platform: Create a transcoding operation after the upload is completed, and the result references multiple definition files;
- Data platform: Submit Notebook or Pipeline to run, and independently track admission, queuing, execution and cancellation;
- Reporting system: generate large reports and return object storage links after completion;
- Batch import: save input file references and report verification and import results in stages;
- Notification system: Send a traceable batch as Operation to control tenant quotas.

## Interview Checklist

1. Why can’t tasks continue to be executed synchronously?
2. What has been persisted when `202 Accepted`, how to ensure that it can still be distributed?
3. Who owns the Operation Store, Queue and business results respectively?
4. How to remove duplicates when Client, Dispatcher and Worker retry?
5. After the Worker Lease expires, how to prevent late Attempts from overwriting new results?
6. Does cancellation stop subsequent execution, or does it require undoing existing side effects?
7. How to isolate large tasks, tenants, and priorities, and determine when a backlog is getting out of control?
8. How to discover tasks that "show success but are not actually completed" from authoritative business results?
