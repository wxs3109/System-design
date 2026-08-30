# Consistency Model and Session Guarantee

The Consistency Model specifies what read and write history is allowed under concurrency and failures. The name of the model must correspond to the behavior that users can observe, otherwise "strong" and "weak" are just adjectives.

## Intuition of common models

| Model | Main Commitments | What Users Might See | Common Scenarios |
|---|---|---|---|
| Linearizability | Each operation occurs atomically at a certain point between the call and the return, and respects the real time sequence | Completed writes will not be ignored by subsequent reads | Lock, Leader Election, inventory ownership, account status |
| Sequential Consistency | All clients agree on the same operation sequence, but it is not required to match the real time | The newly completed write may be queued to the back in the global order | A few coordination scenarios, parallel computing |
| Causal Consistency | Causal operations are visible in causal order, unrelated concurrent operations can be out of order | Replies will not appear before the messages they reference; unrelated Post orders can be different | Social, collaborative documents, messaging systems |
| Consistent Prefix | What is read is the prefix of a legal history, and intermediate states will not be skipped | Can fall behind, but "step 3 is missing but step 2 is missing" | Asynchronous copy of ordered log |
| Eventual Consistency | After new writing is stopped and communication is restored, the replica finally converges | The old value is temporarily read, and the values ​​​​are different in different replicas | Derived View of Cache, Search Index, count, and Feed |

Different database documents may use these terms slightly differently. When designing, you must also write clearly: what guarantee the client actually gets, and what implementation prerequisites this guarantee depends on.

## Linearizability: suitable for coordinating "facts"

Assume that user A's `set(x=1)` has returned successfully, and then user B initiates `get(x)`. Linearizability requires that B cannot read the previous `x=0`. It makes a distributed object look like a single, live copy.

Suitable for operations that "must use the latest status to determine legality":

- `compare-and-set` preempts tasks;
- Leader Election and Fencing Token;
- Ownership of unique resources;
- Inventory is deducted from 1 to 0;
- Authoritative verification after changing password or revoking permissions.

The costs include: Leader/Quorum coordination, cross-region RTT, rejection of requests during Partition, and throughput cap on hotspot keys. In addition, if the Read Replica allows lag, it cannot claim that all reads are Linearizable - usually you have to read the Leader, use the Read Quorum, or use the Read Index confirmed by consensus.

## Sequential Consistency is not equal to Linearizability

Sequential Consistency only requires that all nodes see the same order, but does not respect the order of wall clock time. In other words, even if a write has returned in the real world, a read initiated later may still be queued before the write in the global order.

So when the user says "the save has been successful, another device must be able to see it when reading again", what he wants is Linearizability, or more specifically Session Guarantee, which cannot be achieved by Sequential Consistency alone.

## Causal Consistency: Maintain meaningful sequence relationships

If action B occurs after A is observed, we say A **happens-before** B. For example:

- Send a post first, then reply to this post;
- Join the group chat first, then send messages in the group;
- Upload the file version first, then comment on this version.

Causal Consistency requires: Other observers cannot only see B but not A (for example, seeing a lonely reply, but the original post has not yet appeared). There is no causal relationship between Posts sent by two unrelated users at the same time and can appear in different orders in different regions - this saves the cost of global coordination.

A common implementation is to make the request carry Logical Clock, Version Vector or dependency Token, and the reader will wait until the dependencies are satisfied before returning. The price is metadata volume, cross-shard dependencies, and complexity caused by offline clients.

## Eventual Consistency must complete four things

It is not enough to say "eventually they will be consistent". It also needs to be stated:

1. **Convergence Prerequisites**: There are no new writes, communication has been restored, and the Consumer continues to work;
2. **Target window**: For example, 99.9% of feed distribution is completed within 5 seconds - not an indefinite "final";
3. **Conflict rules**: Select by version, merge by business rules, use CRDT, or switch to manual;
4. **Anti-Entropy and Repair**: Event Replay, Merkle Tree, Full Backfill, Validation Job or Dead-Letter Queue.

Also make it clear what temporary exceptions may occur during the transition period—old values ​​being read, duplicates appearing, order changes, deleted objects briefly reappearing—which of these are acceptable and which must be filtered out on reads.

## Session Guarantee: Fix user experience at lower cost

Global Linearizability is often too strong. What many products really need is "no obvious regression within the same user and the same Session."

### Read-Your-Writes

After the user writes successfully, his subsequent reads will definitely see this write. For example, after changing the avatar and refreshing the page, you cannot change back to the old avatar.

Implementation options:

- Within a short period of time after writing, the user's read is routed to the Primary;
- Bring back the Commit Position or Version Token in the response, and wait for Replica to catch up with this version before responding;
- When Replica has not caught up, choose to wait, change to Primary, or merge a layer of Session Cache;
- Pin users to the same region - but still have version requirements after Failover.

### Monotonic Reads

Once a session sees version 10, it cannot subsequently go back to version 8. This one is most easily broken when the Load Balancer switches back and forth between Replicas with varying levels of lag. The method is that the client brings `min_version=10`, and the server picks a Replica that has reached version 10, otherwise it reads the Primary.

### Monotonic Writes

Writes in the same Session will take effect in the order they are initiated to avoid the second modification being implemented first and the new status being overwritten after the first modification. You can partition them into the same ordered queue by user/session, or use incrementing sequence numbers to directly reject late old writes.

### Writes-Follow-Reads (writes follow reads)

Writes initiated based on read status cannot fall to an older version. A user leaves a comment after reading version 12 of the document. This comment cannot be written on a copy that has not yet obtained version 12 - otherwise, "the comment points to non-existent content" will appear. Requests should carry dependency versions and wait for satisfaction, or be routed directly to the authoritative node.

## Example: Cross-region profiles

The user changed his nickname in Vancouver, wrote the main region generated version `v42`, and included `consistency_token=v42` in the response. The page then requests personal data:

1. If the local copy has reached `v42`, read the local copy directly;
2. If it hasn’t arrived yet, you can wait for a small time budget;
3. If the budget is exceeded, do an Authoritative Read for the main region instead of returning `v41`;
4. For other users without Token, the local copy allows short-term Stale.

This not only realizes the author's Read-Your-Writes, but also avoids having to read across regions once for each visitor.

## "Negative status" such as deletion and permissions are more sensitive

The most dangerous anomaly under Eventual Consistency is often not "new content appears late", but "things that have been deleted or revoked appear again." Common lines of defense:

- Authoritative Tombstone with monotonic version, retention time to cover the largest replication/offline window;
- The read path is above the Derived View, and the visibility or revoked version is checked again;
- Permission verification Fail Closed, Cache TTL is set short, and active Invalidation is supported;
- Deletion events are propagated idempotently, and background scans verify all derived copies;
- Tombstones must never be overwritten with old values, otherwise the object will be resurrected.

The News Feed case [Deletion and Consistency] (../../06-Case Design/02-Specific Application System/03-news-feed/08-Recoverable Production Version/07-Deletion and Consistency.md) illustrates why deletion requires a stricter read defense than ordinary addition.

## How to choose

- Needs sole ownership, needs coordination, needs to use the latest status to judge legality: consider Linearizability + Conditional Write.
- Only related events are required to be in the correct order, concurrent events can be out of order: consider Causal Consistency.
- The main problem is just "current user cannot see interface regression": consider Session Guarantee first, usually enough and much cheaper.
- Data is a rebuildable Derived View, ephemeral old values ​​are accepted: Eventual Consistency, but time window and repair path must be declared.

These choices ultimately fall on the success semantics of each API and each read path, rather than just "we used such and such a database."
