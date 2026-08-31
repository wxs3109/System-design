# Scaling and Recovery of Stateful Service

Databases, Message Brokers, search shards, Stream Processors, and Schedulers all must manage state. The goal is not to eliminate the state, but to make the four things of state ownership, replication, migration and recovery provable.

## 1. When is it reasonable to have state?

- Business facts must be persisted and constraints must be enforced;
- The same Key requires local order or transaction;
- Putting a large amount of data and calculations together can significantly save network overhead;
- Memory index can be restored from log or checkpoint;
- The single-writer model can greatly simplify concurrency in high-conflict scenarios.

For example, if you press `conversation_id` to route messages to the same Partition, you can allocate increasing serial numbers within this Partition; if you press `show_id` to route a ticket to the authoritative Partition, you can rely on serialization to prevent oversales. The price is the throughput limit of the hotspot Partition and the complexity of reassigning the Owner.

## 2. A complete stateful Partition

At a minimum, include this information:

```text
partition_id
owner / leader
epoch or fencing token
Copy member list and submission location
Persistent log/snapshot
restore checkpoint
routing version
```

Just having a `partition -> worker` mapping table is not enough. During Network Partition, the old Worker may still be running, but the new Owner has taken over - at this time both processes consider themselves the Owner. Therefore, each external submission must carry a monotonically increasing Epoch/Fencing Token, and the storage layer rejects requests with smaller Epochs to truly block Split-Brain Write.

## 3. What does Replica solve and what does it not solve?

Replica is used for fault redundancy and read expansion, but must be clearly defined:

- To what extent is the writing considered as submission: single copy, majority in this region, or cross-region persistence;
- Can Replica be read when it falls behind, and can it satisfy Read-Your-Writes;
- How to elect the leader when it fails, and how to isolate the old leader;
- An accidental deletion was copied to all copies, where to recover.

**Replication is not Backup** - This is the most critical sentence. Synchronizing to more fault domains can reduce RPO, but it will increase write latency, and writes will become unavailable when quorum is lost; asynchronous replication latency is lower, but during Failover, writes that have been successfully replied but have not been replicated may be lost. Regardless of whether it is synchronous or asynchronous, a `DELETE` will be faithfully copied to every copy.

## 4. Recovery protocol

After the status node fails, generally follow this order:

1. The Lease times out, or the old Owner is confirmed to have expired by consensus;
2. The new Owner gets a higher Epoch;
3. Load the latest Snapshot;
4. Replay from the persistent log to the committed position;
5. Verify status and dependent versions;
6. Open for reading first, then for writing;
7. Digest the backlog at a limited speed to avoid getting stuck again in the moment of recovery.

Recovery time depends on the state size and the amount to be replayed. Checkpointing too frequently will increase the overhead of online writing, and setting checkpoints too sparsely will lengthen the RTO. This balance point should be measured through actual fault drills, rather than just writing "support automatic recovery" in the document.

## 5. Case: Job Scheduler

Scheduler can have multiple stateless API instances, but task ownership is truly stateful coordination:

```text
API creation operation (persistence)
Scheduler assigns Lease + Fencing Token to Attempt
Worker execution and periodic Checkpoint
Commit Store only accepts atomic commits carrying the current Token
```

The Worker can safely retry after timeout; even if the old Worker later comes to life, the Token in its hand will be smaller, and the submission will be directly rejected. Here **Lease is responsible for "finding faults and reassigning", and Fencing is responsible for "ensuring correctness"**. The two have different divisions of labor and cannot replace each other - Lease is just a timeout judgment. It cannot prevent a process that has expired but still thinks it is valid from writing data.

## 6. Case: Control plane and data plane

The Control Plane metadata of the multi-tenant platform is suitable for persistence and then handed over to stateless API management; while the Data Plane that executes queries, saves intermediate Shuffle data, and maintains Partition Cache is naturally stateful. Separating the two allows for independent expansion and also limits the fault domain.

But the Control Plane cannot assume that its call to the Data Plane happens exactly once. Operation must be queryable, callbacks must be idempotent, and deletion and recovery must be coordinated through a state machine. See [Platform Infrastructure](../../06-case-design/03-platform-system/01-multi-tenant-data-platform/01-system-design-mainline/05-infrastructure.md).

[Previous section: Long connections and Connection Draining](03-long-connection-sticky-routing-and-connection-draining.md) · [Return to the entrance of this chapter](README.md) · [Next section: Cases and checklists](05-case-study-and-design-checklist.md)
