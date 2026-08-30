# Event Ordering and Logical Clock

## 1. First ask “who needs and who needs to be in order”

The global total order is very expensive, and most businesses only require local order:

| Sequential ranges | Examples | Common implementations |
|---|---|---|
| Single entity | State transition of the same Payment | Version / Sequence |
| Single user | Message or feed updates from the same user | `user_id` partition |
| Single session | Client read-after-write | Session Token / Sticky Route |
| Single partition | Same Kafka Partition event | Partition Offset |
| Global | Strict global ledger sequence | Single Leader or consensus log, high cost |

If two events are unrelated to each other, there is no need to establish a unified order for them.

## 2. Happens-before

if:

- A occurs before B in the same process;
- The message sent by A is received by B;
- or the above relationship can be transitive;

Then A happens-before B. Otherwise, two events may be concurrent, and causality cannot be asserted based on physical timestamps alone.

Example: User updates avatar first, then publishes post. If the post consumer sees `PostCreated` first, it may read the old avatar. The solution is not to require all systems to be globally ordered, but to:

- Post saves the author ID and reads the current avatar when displaying;
- Or the event carries the required Snapshot/Version;
- Or the same entity event is put into the same ordered partition;
- or the Version that the consumer waits on.

## 3. Sequence Number

Each entity maintains an incremental version:

```text
Payment p1 version 7: PROCESSING
Payment p1 version 8: SUCCEEDED
```

When the consumer has already processed version 8, late version 7 should be ignored. Sequence also helps:

- Detect old events;
- Found version gaps;
- Implement condition updates;
- Tell Cache to only accept newer versions.

Sequence usually only makes sense within an entity or partition. Do not compare the offsets of different partitions.

## 4. Lamport Clock and Vector Clock

### Lamport Clock

Each node maintains a logical counter, which is carried when sending and updated when receiving:

$$
L_{new} = \max(L_{local}, L_{received}) + 1
$$

If A happens-before B, then $L(A) < L(B)$; the reverse is not necessarily true. It can construct a consistent ordering, but it cannot determine whether two writes are truly concurrent.

### Vector Clock / Version Vector

Save version vectors for multiple write sources, you can determine:

- One version contains another version;
- Two versions are concurrent and conflicts need to be merged or retained.

The trade-off is that the metadata grows with the number of write sources. Suitable for limited copies or offline synchronization, not suitable for saving huge vectors for massive temporary clients.

## 5. The cost of Last-Write-Wins

LWW keeps "newer" writes based on timestamps or comparable versions. The advantage is automatic convergence, but the disadvantage is that a concurrent write may be lost silently.

Suitable:

- Coverage semantics such as user preferences and last active time;
- Losing one concurrent write is acceptable;
- The product explicitly uses "last set" as a rule.

Not suitable for:

- Balance, inventory, and like collection;
- Edits on both sides must be retained;
- The clock is not trusted and writes are concurrent.

Balances should use ledgers or atomic increments; collections can use merge semantics; documents need version conflict prompts.

## 6. Sequence boundaries of message systems

The order of records can usually be guaranteed in the same Partition, but you should still pay attention to:

- Multi-Producer concurrency;
- Retry reinserts old messages;
- Consumer completes order changes after parallel processing;
- During Rebalance, the two Consumers are briefly handed over;
- DLQ replays messages much later than new messages.

The consumer must use an Entity Version or state machine to reject state regression and cannot just trust the arrival order.

## 7. Case: Delete event late

May appear in News Feed:

```text
PostCreated(version=1)
PostDeleted(version=2)
Late PostUpdated(version=1)
```

If the Timeline Consumer unconditionally Upserts in order of arrival, the post will be "resurrected". Correct handling:

- The deletion status of the Post fact table is authoritative;
- The event carries `post_id + version`;
- Derived indexes only accept higher versions;
- Visibility filtering is still performed before display;
- Reconciliation fixes silent inconsistency.

Refer to [Deletion and Consistency] (../../06-Case Design/02-Specific Application System/03-news-feed/08-Recoverable Production Version/07-Deletion and Consistency.md).

## 8. Trade-off

```text
Stronger, larger order
-> More coordination and single hotspots
-> Higher latency, lower availability and throughput
```

The correct strategy is not to pursue "global ordering", but to route business entities that must be ordered to the same authoritative sequence, and let cross-entity processes use state machines, idempotence, and reconciliation.
