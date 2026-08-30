# Workflow and Long-Running Task Platforms

A workflow platform durably stores execution state that spans multiple steps, waits, retries, and process restarts. It suits long-running work such as order fulfillment, data imports, approvals, and media processing, but does not automatically create a cross-service transaction among multiple business systems.

## When It Is Needed

Start with the simplest solution:

| Requirement | Suitable starting point |
|---|---|
| Completes quickly within one request | Synchronous service call |
| One background action that can be retried independently | Queue + worker |
| Multiple steps, conditional branches, waits, or compensation | Workflow engine |
| Many independent tasks triggered at fixed times | Scheduler; its complete design belongs in the general infrastructure system case studies in chapter 06 |

A clear signal to introduce a workflow platform appears when step state has spread across database fields, scheduled scanners, and multiple queues, and it is difficult to answer “which step is executing now?”

## Position in the System

```text
Client -> API -> Workflow Platform -> Activity Worker -> Business Service / Database
                    |
                    +-> durable state, timer, retry, signal
```

The platform stores process progress and schedules the next step; workers execute business activities. Business facts should remain owned by business services or authoritative databases. Workflow history should not become the authoritative data for orders, payments, or inventory.

## External Abstractions

- **Workflow instance / execution:** one process instance with a stable business ID.
- **Step / state:** current process state or state-machine node.
- **Activity / task:** an external business action performed by a worker.
- **Timer / delay:** a durable wait that does not occupy an application thread.
- **Signal / event:** a change delivered by an external system to a running process.
- **Query / status:** a read of process progress.
- **History / checkpoint:** durable records the platform needs to recover execution.

Products use different names and programming models, but a design must always answer: who stores process state, who performs side effects, how the same execution is identified, how long state is retained while waiting, and how old instances continue after a code upgrade.

## Success Semantics

A long-running task API often returns 202 Accepted and an operation_id. This means the task was reliably accepted, not that the business operation completed. The caller later obtains the final result through a status API, webhook, or event.

Expose distinct states:

- Accepted: the platform recorded the execution.
- Running/Waiting: processing continues or awaits an external condition.
- Succeeded: every required step in the business definition completed.
- Failed: automatic retries ended and business or human handling is required.
- Cancelled: future scheduling stopped; external side effects that already occurred may not have been undone.

The platform stores “what to do next,” but cannot automatically combine an activity and an arbitrary external database update into one atomic commit. If an activity times out or its worker crashes, the platform may schedule it again, so external side effects still need to be idempotent or reconcilable. See [Idempotency, Retries, and Deduplication](../../02-core-concepts/06-idempotency-retry-and-deduplication/) for the principles.

## Layers of Timeouts and Retries

At minimum, distinguish:

| Time limit | What it constrains |
|---|---|
| Overall workflow limit | Maximum duration of the entire business process |
| Step/activity limit | How long one business action should run |
| Queue/schedule-to-start limit | How long a task remains meaningful while queued |
| Heartbeat limit | How long a long activity may show no progress before being considered disconnected |
| Retry backoff / maximum attempts | Automatic-recovery cadence and stopping condition |

A timeout means that no definite result arrived in time; it does not mean that an external action did not occur. Classify errors for retries: throttling and temporary network failures may use backoff; invalid parameters and permission denials should usually fail immediately; persistent business conflicts may require human judgment. Do not independently retry the same action at every gateway, workflow, and SDK layer.

## Waits, Callbacks, and Human-in-the-Loop Steps

When waiting for an external event, the workflow should sleep durably instead of holding a worker thread or polling frequently. External callbacks need a stable workflow ID, event ID, authentication, and rules for late events.

Human approval especially requires definitions for:

- wait duration and the default result on timeout;
- who may approve and what audit trail is retained;
- how duplicate submissions and withdrawal are handled;
- whether a late approval is ignored after the process was cancelled or advanced;
- whether platform retention covers the longest business wait.

## Versioning and Upgrades

A workflow may run for days or months, so old instances remain active when new code is released. Determine which compatibility model the product uses: a versioned state machine, continued execution of the old definition, version branches in code, or migration to a new instance.

Avoid:

- deleting steps that old instances still access;
- changing step semantics while reusing the same version;
- new workers that cannot parse old inputs or histories;
- introducing nondeterministic behavior into workflow logic in a replay-based engine;
- discovering only after deployment that old processes cannot be cancelled, compensated, or queried.

Exact constraints depend on the product's programming model and should be validated in selection and upgrade exercises.

## Key Configuration and Capacity

Selection and capacity planning should consider at least:

- workflow and activity starts per second;
- number of concurrently running, waiting, and timed instances;
- step count, history size, and maximum lifetime per instance;
- average and tail activity latency, retry amplification, and worker concurrency;
- payload and result size; large objects should live in external storage and be passed by reference;
- quotas for platform APIs, status queries, timers, signals, and history retention;
- separate worker queues by tenant, workflow type, or activity.

Worker concurrency is constrained not only by CPU but also by downstream database connections, third-party API quotas, and business ordering. Fast dispatch by the platform does not mean a downstream service can accept work safely.

## Failure Behavior

| Scenario | What the platform/caller observes | What the application must handle |
|---|---|---|
| Worker crashes | Activity is rescheduled after timeout | Side effects that occurred but were not recorded |
| Activity returns an unknown outcome | Process enters failure or retry | Query external state, then decide whether to retry |
| Platform briefly unavailable | Cannot start, signal, or query; existing executions recover according to product contract | Client timeout and unknown acceptance result |
| Downstream keeps failing | Retries, increased delay, and eventual failure | Stopping condition, degradation, and human handling |
| Poison workflow | One instance repeatedly fails or its history grows excessively | Isolation, fixed version, and redrive |
| Incompatible worker deployment | Old instances fail at particular steps | Version routing and rollback |
| Duplicate or late signal | A step may be triggered again or the event rejected | Event identity and state-machine validity |

Observability must cover both platform and business: start/completion/failure rates, end-to-end age, queue and run time per step, retry reasons, worker saturation, stuck instances, and missing orders found through reconciliation against business state. A workflow showing success is still insufficient to prove that every external system is correct.

## Common Products

| Product form | Typical product | Characteristics and considerations |
|---|---|---|
| Durable execution platform | Temporal | Code-defined workflows, activities, timers, and signals; requires understanding determinism and version-upgrade constraints |
| Cloud state machine | AWS Step Functions | Managed state machines and service integrations; examine transitions, execution types, history, and cost |
| Cloud function orchestration | Azure Durable Functions | Integrates with Functions; examine orchestrator replay rules, storage, and hosting plan |

Compare programming model, degree of management, execution and history-retention limits, long timers, signals/callbacks, versioning strategy, observability, private networking and compliance, throughput quotas, and billing units. Product syntax is not the focus of system design, but product limits directly alter the business contract.

## What the Platform Does Not Do for the Application

- It does not define the business state machine or valid transitions.
- It does not give arbitrary external activities exactly-once side effects.
- It does not automatically generate correct compensation actions.
- It does not decide which errors are retryable or when to involve a human.
- It does not replace an authoritative business database, reconciliation, or auditing.
- It does not automatically solve cross-version compatibility or tenant fairness.

For Saga business semantics, see [Local Transactions, 2PC, and Saga](../../02-core-concepts/09-concurrency-control-and-distributed-transactions/03-local-affairs-2pc-and-saga.md). Workflow-and-service composition belongs in [General Design Patterns](../../05-general-design-patterns/06-saga-and-business-workflow/); the ordinary Queue-and-worker long-task flow is “Long-Running Task Submission and Execution” in the same chapter.

## Interview Checklist

1. Why is Queue + worker no longer sufficient?
2. Where do workflow state and authoritative business facts reside, respectively?
3. What do 202 Accepted, activity success, and whole-business success each mean?
4. If an activity times out after its side effect actually occurred, how does the system recover?
5. How are waits, cancellation, late signals, and human intervention defined?
6. How do long-running instances continue across code versions?
7. How are platform and business data reconciled to find stuck or missing processes?
