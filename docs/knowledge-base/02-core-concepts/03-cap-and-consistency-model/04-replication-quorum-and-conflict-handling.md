# Replication, Quorum and conflict handling

The Consistency Model describes promises, and the Replication protocol determines whether the system can fulfill these promises. This page focuses on the relationship between Leader, Quorum, member changes, versions, and conflict handling.

## Single-Leader Replication

All writes are sorted by the Leader and then copied to the Follower. The advantage is that the writing order and conflict points are clear, suitable for Conditional Write, Unique Constraint and Transaction.

### Synchronous Replication

The Leader waits for confirmation from the designated replica or a majority of replicas before returning.

- Benefits: When the Leader fails, confirmed writes are less likely to be lost, and the RPO can be made smaller;
- Cost: Write latency is dragged down by the slowest replica; writes cannot be confirmed when quorum is lost.

### Asynchronous Replication

The Leader returns after local submission, and the Follower catches up in the background.

- Benefits: Low write latency, easier to expand remote replicas and Read Replica;
- Cost: Old data is read from the replica; if the Leader hangs up before the replication is completed, successfully restored writes will be lost; Failover may also cause a timeline bifurcation.

When reading Follower, you must specify whether Stale is allowed. If you want Read-Your-Writes, you can let the response carry Commit LSN/Token, wait for Replica to catch up with this position, or temporarily change the Leader.

### Leader Election also requires Fencing

The old leader may have simply lost contact with the cluster, but it is still connected to the external storage. After the new leader takes office, if the old leader is still writing, it is a split brain. The method is that each leader gets a monotonically increasing Epoch/Fencing Token, and the downstream only accepts requests that are no less than the Epoch it has seen.

Just relying on "I got the lock" and regular heartbeats are not enough - an old process that wakes up after GC Pause for 30 seconds will think that it still holds the lock, when the lock has long expired and been taken away by others. Only downstream fencing checks can block it.

## Leaderless and Quorum

Suppose the number of replicas is $N$, a write requires $W$ replicas to confirm, and a read query requires $R$ replicas. Common intersection conditions are:

$$
R + W > N
$$

It means that the read set has at least one intersection with the last successfully written set. If you want any two Quorums to intersect, you usually need:

$$
2W > N
$$

For example $N=3, W=2, R=2$: writing can tolerate one replica being unreachable, and the read and write sets intersect, but reading has to wait for two replicas. $N=3, W=3, R=1$ makes reads faster, but any replica failure will block writes.

This is the trade-off between latency and availability in Tunable Consistency:

- $W$ is large: writes are slower and more susceptible to failures, but confirmed values ​​are spread more widely;
- $R$ is large: reading is slower and more likely to be dragged down by slow replicas, but there is a greater chance of discovering new versions;
- Both $R$ and $W$ are small: more available and lower latency, but insufficient intersection, more conflicts and old reads.

## Why $R+W>N$ is not automatically equal to Linearizability

This formula only proves that the sets intersect. It neither guarantees that the system picks out the correct value from the intersection, nor does it solve the following problems:

- Two clients write concurrently, which version is considered newer?
- When reading multiple versions, how to determine whether they are causal or concurrent?
- Sloppy Quorum If the write is temporarily placed on a copy outside the original collection, do the read and write collections really intersect?
- During cluster expansion and contraction, are the $N$ and member lists seen by the two requests consistent?
- The write timed out, but some copies were actually successful. Will the client generate another value if it retries?
- Can a lagging replica answer read requests alone when Read Repair and Hinted Handoff are not completed?
- When the client clock drifts, will Last-Write-Wins judge an updated causal write as an old write?

To truly achieve Linearizability, it is usually necessary to use consensus to determine the order of members and submissions, correct read protocols, versions/Epoch, clear Failover rules, and how to handle uncertain results such as timeouts.

## The meaning of timeout is "result unknown"

The client waits for $W$ confirmations until timeout, which does not mean that the write did not occur. It might actually be:

- Not a single copy has taken effect;
- took effect on fewer than $W$ replicas and was later fixed or overwritten;
- In fact, the submission conditions have been met, but the response packet was lost.

Therefore, important writes must be equipped with Idempotency Key and queryable status. A more appropriate approach for the payment interface is to return `PENDING`/`UNKNOWN` and allow querying by Idempotency Key, rather than treating the timeout as a failure and creating a new payment.

## Conflict detection

### Monotone version or log location

Incremental version, Term/Index or LSN can be used under a single Leader. Select a higher committed version when reading, Conditional Write requires `expected_version`. This is fine for a single sequence scenario, but across multiple independent Writers, comparing a local integer is not enough.

### Version Vector

Record the observed counts for each replica or participant, allowing you to distinguish between the two conditions:

- A is an ancestor of B: B directly covers A;
- Concurrency between A and B: must be merged, or retained as Siblings and handed over to the upper layer for processing.

The advantage is that concurrency will not be misjudged as overwriting; the cost is that the metadata will grow, the identity of the client/replica must be managed, and the pruning logic is also complicated.

### Physical timestamp and LWW

Last-Write-Wins is simple, but "last" is usually just "maximum timestamp":

- Client clock will drift;
- An incorrect future timestamp may suppress all subsequent normal writes for a long time;
- Two concurrent modifications that are both valuable will be silently lost.

It is suitable for data that inherently covers semantics and is not costly to lose concurrent values, such as certain interface preferences; it is not suitable for balance increases and decreases, shopping cart operations, and document editing.

## Conflict merge strategy

| Strategy | Applicability | Key Risks |
|---|---|---|
| Reject and retry (Optimistic Concurrency Control) | Edit data, inventory Conditional Write | Many retries under high contention, conflicts need to be resolved by the user |
| Merge by business rules | Shopping cart, calendar, business workflow | Rules must be able to handle delete, duplicate and non-interchangeable operations |
| CRDT | Counters, collections, collaborative data | State/metadata overhead, business semantics may not naturally match |
| LWW | Low-value coverage setup | Clock issues, silent loss of writes |
| Switch to manual | Low-frequency but high-value conflicts | Delay and operational costs |

Don’t just write “merge on conflict”, give a specific example. If the shopping cart simply retrieves and merges the items, the items deleted by the user on the phone will be added back by the old copy on the tablet. A better model is: each addition generates a unique entry, and when deleting it refers to the "observed version of the entry"; it is re-verified by the inventory authority at checkout.

## Read Repair, Anti-Entropy and Tombstone

- **Read Repair**: When reading that the old and new versions coexist, write the new version back; only the read Key can be repaired.
- **Hinted Handoff**: When the target replica is unreachable, the write is temporarily stored elsewhere, and then transferred after recovery; this will change the set of replicas that actually participate in Quorum.
- **Anti-Entropy**: Compare copy digests in the background to repair data that has not been read for a long time and therefore can never be touched by Read Repair.
- **Tombstone**: Use versioned deletion markers to overwhelm old values; cleaning up too early will allow an old copy that has been offline for a long time to resurrect the object.

These mechanisms determine whether "eventually" it will really converge. Repair Backlog, Maximum Version Difference, Hint Age, Number of Tombstones, and Replication Lag must be monitored.

## Membership changes and disaster recovery

Expansion, reduction, and failover are themselves part of the consistency protocol. If the old member set and the new member set can independently gather the quorum, they will each confirm the conflicting write. Reliable systems rely on consensus configuration changes, Joint Consensus, or a clear single Control Plane to ensure that there is always intersection between the old and new member sets.

Backing up and restoring data will turn back time, which is equally dangerous. After recovery, a new Epoch must be enabled to prevent the old Leader, old events, and old Cache from mistakenly overwriting the data before and after the recovery point. In addition, only restoring the database without synchronizing the Consumer Offset of the message will cause events to be processed repeatedly or missed.

## Design Check

Answer each item when choosing the Replication solution:

- How many replicas and which fault domain confirmations are needed to return success?
- Where do the reads come from, and what is the maximum allowable lag?
- After writing timeout, how to check the status and how to retry safely?
- How to detect, select or merge concurrent writes?
- How to prevent Split Brain from Leader Epoch and member changes?
- How long do Tombstones last? How long does it take for an offline copy to come back?
- What are the indicators of Anti-Entropy, Backfill and recovery, and how to do the drill?

The formula is only the starting point, the complete fault semantics is the design.
