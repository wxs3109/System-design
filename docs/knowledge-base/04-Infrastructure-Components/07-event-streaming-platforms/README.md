# Event Streaming Platforms

An event streaming platform appends events to a retained log that can be reread by position. It suits multiple consumers continuously reading a stream of facts at their own pace, and supports replay and derived data. It is not the default answer for every asynchronous task.

## Differences from a Task Queue

| Dimension | Task queue | Event stream |
|---|---|---|
| Core abstraction | Work waiting to be completed | An ordered, append-only event record |
| After consumption | The message is usually deleted or hidden | The message remains readable during retention |
| Progress | Broker manages acknowledgment/lock | Consumer group maintains offset/checkpoint |
| Replay | Usually not a primary capability | Rereading from an old position is a core capability |
| Unit of parallelism | Message, session, and similar scopes | Partition |
| Common uses | Sending email and generating thumbnails | Behavior events, CDC, analytics pipelines, and derived views |

If the requirement is only “find one worker to complete a task,” start with [Task Queues](../06-task-queues-and-pub-sub/). If durable process state and long waits are required, start with a [Workflow Platform](../08-workflow-and-long-running-task-platforms/).

## Position in the System

```text
Producers -> Topic / Partitions -> Consumer Group A -> Search Index
                              -> Consumer Group B -> Analytics
                              -> Consumer Group C -> Notifications
```

A consumer group represents one independent progress position. Instances in a group share partitions; different groups can each read the same event. Adding consumers to a group cannot provide more parallelism than the number of partitions.

## External Data Model

An event record usually contains:

- key: determines partition and local order, such as order_id;
- value: event payload;
- topic: event category or lifecycle boundary;
- partition: unit of parallelism and ordering;
- offset/sequence: position within a partition, not global business time;
- timestamp, headers, and schema version: time, tracing, and compatibility information.

An event should express a fact that occurred, such as OrderPaid, rather than an ambiguous OrderUpdated. The platform stores bytes and positions; it does not understand whether fields are sufficient to reconstruct a business fact.

## Success Semantics

### Production

Successful production means the platform accepted the record at the selected acknowledgment level. It does not prove that all consumers processed it or that the event and a producer database update are atomic. Publication across a database and an event stream belongs in [Reliable Event-Publishing Flows](../../05-general-design-patterns/03-reliable-event-publishing-path/).

### Consumption

Reading a record, producing a business result, and committing an offset are three actions. If the consumer commits the offset before writing the result, a crash may omit processing. If it writes the result before committing the offset, a crash may duplicate processing. Platform transactions and exactly-once capabilities have defined scopes and cannot automatically cover arbitrary external databases and APIs.

### Retention

Retention states how long a record can be reread; it is not a business backup. After time- or capacity-based retention expires, a slow consumer may permanently lose unprocessed data. A compacted topic that keeps a representative latest record for each key also cannot replace a complete audit history.

## Partitioning, Ordering, and Parallelism

The partition key is one of the most important data contracts:

- the same key usually enters the same partition and therefore obtains order within that key;
- there is no reliable global order across partitions;
- a skewed key distribution creates hot partitions;
- changing the partition count may alter key-to-partition mapping, and product behavior must be verified;
- too few partitions limit consumption parallelism, while too many increase cost, metadata, and rebalance overhead.

If the business requires events for the same account to be processed in order, partition by account_id. Requiring global order across the entire system usually reduces parallelism to one partition; first verify that this is truly a business invariant. For the principles, see [Partitioning, Sharding, and Hot-Spot Management](../../02-core-concepts/08-partition-sharding-and-hotspot/).

## Consumer Groups and Rebalancing

Within one group, a partition is usually assigned to one consumer instance at a time. When an instance joins, leaves, loses contact, or partitions change, the platform reassigns partitions. Consumption may pause during a rebalance, and duplicate processing may occur around ownership handoff.

The application must define:

- whether offsets commit automatically or manually after business work completes;
- where to commit when only part of a batch succeeds;
- whether one poison event can block an entire partition;
- how to stop fetching, finish in-flight work, and save progress before a rebalance;
- whether a new consumer group begins at the earliest position, latest position, or a specified time.

## Key Configuration and Capacity

| Decision | Primary impact |
|---|---|
| Partition count | Maximum consumer parallelism, ordering scope, and cost |
| Replication/acknowledgment level | Write latency, availability, and durability contract |
| Retention time/capacity | Replay window and storage cost |
| Record/batch size | Throughput, latency, memory, and failure scope |
| Fetch batch and wait time | Call overhead and end-to-end latency |
| Consumer timeout and heartbeat | Failure-detection speed and false rebalances |

Capacity estimates should include events per second, average and maximum event size, retention duration, storage multiplier from replication, producer and consumer throughput, partition-key skew, and target latency for every consumer group. Do not let aggregate throughput hide the hottest partition.

## Failure and Overload Behavior

| Scenario | External behavior | Primary risk |
|---|---|---|
| Producer times out | Outcome is unknown; a retry may create a duplicate | Event identity and idempotency |
| Broker/partition unavailable | Writes or reads fail and latency rises | Selected acknowledgment and failure contract |
| Consumer slows down | Lag and oldest-event age rise | Exceeding retention |
| Consumer crashes | Rebalance and takeover by another instance | Duplicate processing and a brief pause |
| Hot partition | Lag rises on one partition while aggregate metrics may look normal | Key design and local scaling limit |
| Poison event | One partition stalls or repeatedly fails | Isolation, skipping, repair, and replay |
| Incompatible schema | Old and new consumers parse incorrectly or disagree semantically | Compatibility rules and canary upgrades |

Key metrics include produce/fetch errors, end-to-end event age, per-partition lag, rebalance count, throughput and throttling, and disk/retention pressure. Interpret lag count together with event rate: the same backlog of 100,000 events can represent seconds or hours at different traffic levels.

## Product Forms

| Product | Usage-level characteristics | Primary tradeoff |
|---|---|---|
| Apache Kafka / managed Kafka | Mature partitioned log and ecosystem | Self-hosting is operationally heavy; managed service still requires topic, schema, capacity, and consumer management |
| Apache Pulsar | Rich topic/subscription capabilities with a different storage and serving architecture | Team experience, ecosystem, and operational complexity |
| Azure Event Hubs | Managed event ingestion using partitions and consumer groups | SKU quotas, throughput units, retention, and scope of Kafka compatibility |
| Amazon Kinesis Data Streams | AWS-managed partitioned stream | Shard capacity, scaling, and consumption modes |

Selection compares contracts and constraints: throughput scaling unit, maximum message size, retention limit, ordering scope, consumer-group count, cross-region capability, schema tooling, networking, and egress cost—not merely feature lists.

## Remaining Application Responsibilities

- Select a stable, well-distributed partition key.
- Define event schemas, compatibility policy, event identity, and semantic ownership.
- Handle duplicates, late events, out-of-order events, poison events, and partial batch success.
- Decide when to commit offsets and protect external side effects.
- Isolate capacity for backfill or replay so online consumers are not disrupted.
- Validate derived results and prepare to rebuild them from authoritative facts.
- Monitor every partition and consumer group rather than only cluster averages.

For asynchronous, ordering, and idempotency principles, see [Core Concepts](../../02-core-concepts/). Batch/streaming pipelines and reliable publication belong in [General Design Patterns](../../05-general-design-patterns/).

## Interview Checklist

1. Why is replay required instead of a regular queue?
2. Which key determines the partition, and what is the business ordering scope?
3. Does the partition count support target consumer parallelism, and are there hot keys?
4. What successes are represented by write acknowledgment, offset commit, and business result?
5. What is the maximum allowed lag, and does retention cover failure recovery and replay?
6. How are schema changes, poison events, and full rebuilds handled?
