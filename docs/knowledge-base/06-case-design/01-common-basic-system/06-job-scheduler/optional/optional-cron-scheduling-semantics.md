# Optional: Cron scheduling semantics

Read only if the core requirements explicitly include periodic tasks. Cron is responsible for continuously generating Executions, but does not change the reliable execution core of Execution → Attempt → Lease.

## 1. Occurrence Identity

Periodic Job saves Cron expression, time zone and `scheduleVersion`. A scheduled trigger is uniquely identified by the following combination:

```text
(jobId, scheduleVersion, scheduledAt)
```

The unique constraint guarantees that a Coordinator retry or repeated scan will not generate two identical occurrences. Add `scheduleVersion` when modifying the expression to avoid confusion between the old and new plans.

## 2. Time zone and DST

Cron expressions must be bound to an explicit time zone and cannot rely on the Coordinator native time zone. Products need to be predefined:

- Whether the local time skipped by daylight saving time will be run back;
- Whether the local time of daylight saving time repetition is executed once or twice;
- Use UTC Instant when saving `scheduledAt` while preserving the time zone and schedule version for interpretation.

This is a user-visible contract and cannot be left to some Cron Library's default behavior.

## 3. Misfire Policy

When the Scheduler is down or backlogged, multiple scheduled times may be missed. Common strategies:

| Strategy | Behavior | Applicable Scenarios |
|---|---|---|
| Skip | Skip missed occurrences and only calculate the future one | Only care about the latest moment |
| Fire once | Combined into one immediate execution | Refresh and synchronization tasks |
| Catch up | Run several times in order | Every occurrence has business significance |

Catch up must set the maximum number of catch ups and be limited by normal capacity and tenants to avoid traffic peaks during recovery.

## 4. Overlap Policy

When the last Execution has not yet ended:

| Strategy | Behavior | Cost |
|---|---|---|
| Allow | New occurrences are queued normally | The same business status may be modified concurrently |
| Queue | Wait until the previous one ends before joining the queue | Delay may continue to accumulate |
| Skip | This occurrence enters `SKIPPED` | Explicitly discard a plan execution |

Overlap is Job-level scheduling semantics and should not be implemented through accidental preemption of Workers.

## 5. Modify, pause and resume

- Modify Cron: generate new `scheduleVersion`, old version no longer materializes new occurrences.
- Pause: Stop generating new Executions; Executions already `QUEUED/RUNNING` will continue to completion by default.
- Resume: Determine how to handle occurrences during the suspension period based on the Misfire Policy.
- Cancellation: Stop future occurrences; forced termination of a running business requires another set of cooperative cancellation protocols.

## 6. Stopping point

Can interpret occurrence uniqueness, DST, Misfire, Overlap and version modification semantics before stopping. No further work on the Cron Parser implementation, all calendar boundaries, or the product UI.
