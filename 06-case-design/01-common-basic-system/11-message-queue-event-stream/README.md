#Design Message Queue / Event Stream

## Case positioning

Message Queue, Pub/Sub, and Event Stream are all used for asynchronous decoupling, but they answer different questions. This case is reserved as a top-level case, and three types of contracts must be distinguished internally:

| Model | Core Contract | Mechanisms that must be deployed | Typical scenarios |
|---|---|---|---|
| **Work Queue** | A task is processed by one Worker in one delivery attempt; it can be reassigned after failure | Ack / Nack, Visibility Timeout or Lease, Retry / DLQ, Delay, Priority, fairness | Email sending, image processing, background tasks |
| **Pub/Sub** | One publication can serve multiple independent Subscriptions; each Subscription has its own progress and failure | Fan-out, Subscription Cursor, filtering, slow subscription isolation, independent Retry / DLQ | Domain events, notifications, multiple downstream integrations |
| **Partitioned Log / Event Stream** | Event persists by Partition during the retention period; Consumer Group maintains Offset and can Replay | Retention, Offset, Consumer Group, Rebalance, Ordering by Partition, Compaction | CDC, stream processing, audit events, derived indexes |

The three contracts are not interchangeable: Work Queue's Ack indicates the completion of a task processing; Pub/Sub's completion status belongs to each Subscription; Partitioned Log's Offset indicates the reading progress of a Consumer Group, rather than the event being globally "deleted". Before choosing a model, you must first answer whether the task can only be claimed by one Worker, whether independent Fan-out is required, and whether long-term retention and Replay are required.

The current text uses Kafka/Pulsar style **Durable Partitioned Log** as the main design line, and Work Queue and Pub/Sub serve as semantic comparisons within the same case. Future expansion does not require duplication of three complete Broker architectures, but state ownership, confirmation methods, sequence boundaries, failure isolation and recovery behaviors must be clarified respectively.

After studying this case, you should be able to answer: What exactly is confirmed by the Producer Ack, where is the authoritative copy of the Record, how does the Consumer Group ensure that the division of labor does not overlap, why business side effects and Offset cannot be naturally submitted atomically, and when the backlog should be expanded, limited, or downgraded.

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Durable Partitioned Log (current mainline) + Work Queue / Pub/Sub (semantic comparison) |
| Core invariants | Quorum Ack events can be recovered within the retention period; the same Partition is read according to Log Offset; the old Leader / old Consumer Generation cannot continue to write authoritative status |
| Quality attribute priority | Durability → Throughput → Availability → Delivery Latency |
| Traffic / Data Shape | Append-only, small to medium Events, burst writes, multiple independent Consumer Groups |
| Failure strategy | Producer safely retries through Idempotent Write; Consumer defaults to At-least-once; backpressure is applied instead of silently discarding when backlogged |
| Security Boundary | Producer/Consumer ACL, Tenant Quota, Secrets and PII in Events, Cross-Tenant Isolation |
| Key Patterns | Partitioned Log、Replication、Consumer Group、Offset、Idempotency、Replay、DLQ |

## Functional requirements

- Create a Topic and configure the number of Partitions, Replication Factor and Retention.
- Producer writes Event to the specified Topic and can provide Partition Key and Idempotency identification.
- Consumer Group consumes independently, submits Offset, and Rebalances when members change.
- Support pressing Offset or Timestamp Replay; expose Consumer Lag.
- Supports Retry Topic or DLQ for persistently failing Events, but does not pretend to provide end-to-end Exactly-once.
- Supports querying Topic/Partition metadata, Leader Epoch and valid Offset range.

## Out of scope

- The basic version does not implement arbitrary message priorities, complex workflows, and cross-topic transactions.
- Global ordering across Partitions is not committed.
- Do not treat Event Broker as long-term object storage; very large payloads should be written to Object Storage, and Events only carry reference and verification information.
- Exactly-once business effects are realized by stable Event ID, idempotent Consumer / Sink and Reconciliation.

## Non-functional requirements (design assumptions)

| Metrics | Goals |
|---|---|
| Peak writes | 1,000,000 Event/s, average Event 1 KB |
| Producer Ack | Normal load P99 < 50 ms |
| Online delivery delay | When there is no backlog P99 < 1 s |
| Durability | After Quorum Ack, single Broker or single AZ failure will not lose the confirmed Event |
| Availability | Automatically select the master when a single Broker fails; reject writes instead of reducing confirmation semantics when most replicas are unavailable |
| Retention / Replay | Default retention is 7 days and can be replayed from a valid Offset |
| Rebalance | Restore stable consumption within 30 seconds after the Consumer member changes |
| Tenant isolation | Limit bandwidth, storage and number of Partitions by Tenant / Producer |

These numbers are used to derive architecture and do not represent specific product commitments.

Capacity estimation cannot just write the final number of Partitions, but must at least derive:

- Approximately 1 GB/s for raw writes and approximately 605 TB of uncompressed data for 7 days; including replicas, indexes, and safety margin.
- The network needs to calculate Producer writing, Replica copying, and multiple Consumer Group readings separately, and cannot only count ingress traffic.
- The number of Partitions is determined by the throughput of a single Partition, the Broker disk and network upper limit, and the Consumer parallelism. It also explains the metadata and Rebalance costs of excessive Partitions.

## Conceptual model and authoritative status

When expanding in the future, it must be clear who owns the following states. You cannot just draw a group of stateless Brokers:

| Status | Minimal Identity | Authoritative Position / Owner |
|---|---|---|
| Topic Configuration | `topic_id` | Metadata Quorum / Controller |
| Partition routing | `topic_id + partition_id + leader_epoch` | Metadata Quorum, Broker executes by version |
| Event Record | `topic_id + partition_id + offset` | Partition Replica Set |
| Producer deduplication status | `producer_id + epoch + sequence` | Current Partition Leader, and restored with the replica status |
| Consumer Membership and Ownership | `group_id + generation + member_id` | Group Coordinator |
| Consumer Progress | `group_id + partition_id -> committed_offset` | Replicated Offset Store |
| Retry / DLQ Event | Original `event_id` + independent `delivery_attempt_id` + source location | Normal Retry Topic / DLQ Topic |

There are four confusing positions to distinguish here: Log End Offset, High Watermark, Consumer Fetch Position and Committed Offset.

## The interface and process must be explained clearly

The interface is not required to be bound to a certain product protocol, but at least the request semantics, idempotent keys, error codes and retry conditions of `CreateTopic`, `Produce`, `Fetch`, `JoinGroup / Heartbeat`, `CommitOffset` and `ResetOffset` must be given.

The final manuscript will at least carry out the following processes:

1. Normal writing: Metadata Lookup → Partitioning → Leader Append → Replica Quorum → Producer Ack.
2. Leader failure: Fault detection → Select qualified replica → Add Leader Epoch → Reject old Leader → Producer Refresh / Retry.
3. Normal consumption: Join Group → Assignment → Fetch → Execute business side effects → Commit Offset.
4. Consumer failure and Rebalance: Stop old Generation submission, reallocation, and reread from the last Committed Offset.
5. Poison Event: Limited Retry, backoff, DLQ, manual repair and replay from original event.

The architecture diagram must distinguish between the Control Plane (Topic configuration, Placement, Leader Election, Quota) and the Data Plane (Produce, Replicate, Fetch), and explain whether existing Partitions can continue to read and write when the control plane is temporarily unavailable.

## Core topics

- Topic, Partition, Segment, Replica, Leader and ISR.
- Partition Key, local order, Hot Partition and online partition expansion.
- Producer Ack, Batch, Compression, Idempotent Producer and Duplicate.
- Consumer Group, Offset Commit, Rebalance, Lease and Poison Event.
- Retention, Compaction, Replay, Backpressure, Quota and Fairness.
- Broker/AZ failure, Leader Election, Unclean Election and data repair.

## Suggested draft order

Future expansions will be organized by problem, rather than listed by product function:

1. **Scope and Semantics**: First fix the Log main line, Delivery Guarantee and content that is clearly not to be done.
2. **Scale and API**: Derive capacity from throughput, retention period and Consumer Fan-out, and then define the protocol.
3. **Single Partition baseline**: Segment, Offset, Batch, Index, Flush and Fetch.
4. **Horizontal expansion**: Partition Key, Placement, Hot Partition, expanded Partition and Key sequential migration.
5. **Replication and Failure Recovery**: Replica, Quorum Ack, High Watermark, Leader Epoch and Data Truncation/Repair.
6. **Consumer Group**: Coordinator, Assignment, Heartbeat, Offset Store, Rebalance and Fencing.
7. **End-to-end processing semantics**: At-most-once / At-least-once, idempotent Sink, Outbox / Inbox, Reconciliation.
8. **Backlog and Life Cycle**: Retention, Compaction, Replay, Retry/DLQ, Backpressure and Disk Pressure.
9. **Multi-tenancy and operation and maintenance**: ACL, Quota, fairness, cross-AZ, expansion and contraction, indicators, alarms and disaster recovery.
10. **Model comparison and selection**: Compare Visibility Timeout / Ack / Priority of Work Queue, independent Subscription / Fan-out of Pub/Sub, and Retention / Offset / Replay of Partitioned Log; explain when another model should be selected.

## Required fault testing and acceptance criteria

The completion of the design is not subject to "mentioning the Kafka term". It must at least provide verifiable results for the following scenarios:

- The Producer will try again after receiving no Ack, and no unexplainable duplicate events will be generated.
- Broker crashes at any stage of Append, replication or Ack, which can indicate whether the Event is lost, duplicated or recoverable.
- Consumer crashes after completing business writing but before Commit. Replay will not allow the business results to take effect again.
- The late Commit of the old Consumer during Rebalance was rejected by the Generation Fence.
- When the Offset of a slow Consumer falls outside the Retention, an explicit failure and warning will occur, and it cannot silently jump to the latest position.
- There are clear current limiting, migration and downgrade strategies for a single Hot Key, a single Tenant or when the disk is almost full.
- After adding Partition, clearly explain the mapping changes from Key to Partition and the local order boundary.
- Distinguish between Broker layer Delivery Guarantee and end-to-end business effects, and do not claim that the infrastructure alone can achieve Exactly-once.

## Boundaries with other cases

- [Job Scheduler](../06-job-scheduler/) determines when and on which Worker the task will run; this case is responsible for persistent delivery and retention of Events. Delayed messages can overlap, but are not extended to full DAG scheduling here.
- [Object Storage](../05-object-storage/) saves large payloads and long-term archives; Broker retains the Log required for online consumption.
- [Rate Limiter](../04-rate-limiter/) provides ingress rate control; the Broker itself still needs to perform Storage / Bandwidth Quota and Backpressure according to the Tenant.
- [Metrics Monitoring](../10-metrics-monitoring/) consumer Broker indicator; this case must produce signals such as Producer Error, Under-replicated Partition, Consumer Lag, Rebalance and Disk Headroom.

## Interview questions

- Why does the Broker provide At-least-once and still make the payment results not valid again?
- After adding Partition, how to migrate Producers and Consumers that depend on Key order?
- When the Consumer Lag continues to grow, should we expand the Consumer, limit the Producer, or discard the data?
- Why does Consumer "read in order by Offset" not equal to business "complete in order"?
- Which scenarios should use Work Queue, Pub/Sub or Durable Event Stream; which client contracts will be changed by switching models?
