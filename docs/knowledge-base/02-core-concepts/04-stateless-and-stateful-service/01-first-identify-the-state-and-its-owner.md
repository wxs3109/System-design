# First identify the State and its Owner

Before discussing "whether this service is stateless", let's honestly list the status. Many seemingly stateless services actually control connections, caches, deduplication keys, or the progress of background tasks; conversely, many stateful services themselves are composed of a set of replaceable computing instances and a persistent log.

## 1. State is not just a record in the database

| Status Category | Example | What happens if lost | Where is it usually placed |
|---|---|---|---|
| Authoritative business facts | Orders, balances, Posts, seat attributions | Business errors, or permanent data loss | Fact storage that supports persistence and constraints |
| Coordination status | Lease, Leader Epoch, Task Owner | Repeated execution, Split Brain, or the whole stuck | Strongly consistent storage, or scheduling library with Fencing |
| Session State | Login session, shopping cart, idempotent results | Being logged out, repeated side effects, experience regression | Signed Token or shared Session Store |
| Connection status | Socket, subscription list, sending buffer | Disconnection, short-term missed push or replay | The node where the current connection is located, equipped with a recoverable cursor |
| Derived State | Search Index, Feed Inbox, Statistical View | Temporarily not found or Stale | Rebuildable storage, and record Source Offset |
| Cache | Object Cache, configuration snapshots | Back-to-origin is slower; but this should never result in loss of facts | Local Cache or Distributed Cache |
| Progress status | Consumer Offset, Job Checkpoint | Work is repeated or missed | Broker, task library, or atomic write Checkpoint |

## 2. Assign an authoritative Owner to each status

A state can have many copies, but there must be a clear authoritative source. Take News Feed as an example:

```text
Post Store = Post fact
Follow Store = Follow the fact of the relationship
Feed Inbox = Rebuildable Derived ReadView
Redis = Disposable Hot Cache
Search Index = Rebuildable search view
```

If the Feed Inbox is lost, you can backfill from Post, Follow, and event logs; but if the Post Store is lost, you cannot deduce the complete facts from the Inbox - there is only the distributed part in the Inbox. This difference directly determines the backup strategy, replication method, RPO and recovery sequence.

## 3. Determine whether it can be externally installed

States suitable for external use usually have these characteristics:

- Multiple Instances need to read or write it;
- It must still be there after the Instance is restarted;
- It requires Unique Constraint, Transaction, Version or Audit;
- Accessing it requires no nanosecond local latency;
- External storage can be copied, partitioned and backed up on demand.

There is no need for an external state:

- A connection object tied to the TCP/WebSocket life cycle;
- Local Cache that can be quickly reconstructed from authoritative sources;
- Intermediate results within a single request;
- An in-memory index that is exclusive to a Partition Worker and has a persistent log or checkpoint recoverable.

Externals are not free. Accessing the shared Session Store for every request will increase network latency and the load of this dependency; moving fine-grained stream processing state to the remote end may directly destroy data locality. This should be decided based on recovery goals and access frequency, rather than trying to achieve a "stateless" appearance.

## 4. Each state must have a life cycle

Complete these six items for each status:

- **Creation**: which action is generated and whether it is atomic;
- **Update**: Who can write, how to handle concurrency;
- **Expiration**: TTL is based on physical time or business status;
- **Restore**: From which facts, logs or backups to rebuild;
- **Delete**: After authoritative deletion, how to prevent Cache or old events from resurrecting it;
- **Observability**: How to know that this state has been Stale, lost, or Split Brain has appeared.

For example: when the login Session is placed in Redis, you cannot just say "Set 30 minutes TTL". It is also necessary to clarify: whether the renewal is sliding, whether Redis is Fail Open or Fail Closed, how to automatically invalidate permissions when revoked, whether they are shared across Regions, and whether multiple Sessions will be generated when the client retries.

## 5. Case: Why Operation and Attempt should be separated

In the data platform, `Operation` represents a user's business intention, and `Attempt` represents a specific execution of a Worker. Worker's memory is a temporary execution state, while Operation/Attempt must be persistent.

```text
Operation RUNNING
├─ Attempt 1: Lease expired and the result is invalid
└─ Attempt 2: Get a higher Fencing Token and submit successfully
```

If you only store "the task is running" in the Worker memory, once the Worker disappears, the Scheduler will have no way to judge whether it should be retried or has been completed. And if there is no Fencing Token, the restored old Worker may also overwrite the new results - it does not know that its Lease has expired long ago. Can be compared with [Operation and Job scheduling domain](../../06-case-design/03-platform-system/01-multi-tenant-data-platform/02-business-domain-design/05-operation-and-job-scheduling-domain.md).

[Return to the entrance of this chapter](README.md) · [Next section: Stateless Scaling and Session external](02-stateless-scaling-and-session-external.md)
