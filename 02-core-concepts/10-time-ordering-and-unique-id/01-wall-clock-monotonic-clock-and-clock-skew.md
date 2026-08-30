# Wall Clock, Monotonic Clock and Clock Skew

## 1. A machine also has two kinds of "time"

### Wall Clock

Represents calendar time, such as `2026-08-13T10:00:00Z`. Suitable:

- User display;
- Audit records;
- Exchange business time across systems;
- Scheduled tasks.

Wall Clock is corrected by NTP and may suddenly jump forward or backward.

### Monotonic Clock

It is only guaranteed to continue forward during the life cycle of a single process. Suitable:

- Calculate the request time;
- Timeout and Deadline remaining time;
- Lease renewal interval in this process;
- Performance indicators.

Monotonic times cannot be written to a database for interpretation by another machine, because the starting points of different machines have no common meaning.

## 2. Why can’t you use Wall Clock to measure timeout directly?

```text
start = wall_clock()
Clock is corrected back 30 seconds
elapsed = wall_clock() - start
```

The calculation result may be negative, causing the request to far exceed the budget and still not time out. In-process duration measurement should use Monotonic Clock.

When delivering deadlines across services, absolute UTC deadlines can be sent, but each hop must:

1. Reserve network and return budget;
2. Set local upper limit;
3. Use the local monotonic clock to perform timing;
4. Don’t wait indefinitely because the other party’s deadline is too large.

## 3. What will clock drift affect?

- Lease: The two nodes have different judgments on "whether it has expired";
- Last-Write-Wins: incorrectly letting old writes overwrite new ones;
- Scheduled tasks: repeated triggers or missing triggers;
- TTL: early/late expiration of cache or credentials;
- Log sorting: Trace seems to receive the response first and then send the request;
- Snowflake class IDs: Clock rollback may generate duplicate or out-of-order IDs.

Lease correctness therefore cannot rely solely on client comparison times; authoritative Lease services and downstream fencing tokens must participate. See [Optimistic Locking, Pessimistic Locking and Leases](../09-concurrency-control-and-distributed-transactions/02-optimistic-lock-pessimistic-lock-and-lease.md).

## 4. Event Time and Processing Time

```text
Event Time: The time when the business event actually occurred
Ingestion Time: The time when the platform receives the event
Processing Time: The time when Worker processes events
```

The Event Time of clicks uploaded two hours after the phone was offline may be much earlier than the Ingestion Time. Real-time stream processing requires selection:

- Aggregation by Event Time is more consistent with business facts, but late data must be processed;
- Aggregation by Processing Time, simple and low latency, but the window results will be biased.

A common method is Watermark: a certain lateness window is allowed, and events that exceed the window enter the correction or offline backfill process.

## 5. Correct use of timestamps

Can:

- Display creation time;
- as part of the sort key;
- Set retention period and business deadline;
- Auxiliary troubleshooting log.

Don't use it alone:

- Demonstrate the causal sequence of two events;
- as a unique ID;
- Determine duplicate messages;
- Protect the old holder of the Lease from writing;
- Execute LWW unconditionally in multiple regions with uncontrolled clocks.

## 6. Case: Operation Deadline

In [Multi-tenant Platform Operation](../../06-case-design/03-platform-system/01-multi-tenant-data-platform/01-system-design-mainline/08-from-item-to-operation-define-how-to-become-a-run.md):

- Operation saves the submission time and absolute deadline that are understandable by the user;
- Queue waiting will consume Deadline;
- Worker uses local monotonic clock to calculate remaining budget;
- Attempt Lease is determined by the scheduling system and assigned a fencing token;
- A late worker cannot submit old results even if it thinks it has not timed out.

## 7. Observability considerations

Clock synchronization is still important, but perfection cannot be assumed:

- Monitor NTP Offset and synchronization status;
- Trace records Wall Clock and Duration simultaneously;
- Logs reconstruct cause and effect through Trace/Span relationships, not just sorted by timestamp;
- Set alarms for clock rollback and jumps;
- Scheduled tasks use stable trigger identities to deduplicate tasks instead of believing that "this time only occurs once".
