# CAP, Partition and PACELC

## What on earth is CAP talking about?

CAP discusses whether a data system with Replication can provide the following three properties at the same time when Network Partition occurs.

- **Consistency**: This specifically refers to Linearizability - each operation appears to happen atomically in the instant between call and return, as if there is only one copy. Note that it is not the same as the C in ACID.
- **Availability**: Every request that reaches a non-faulty node will eventually get a non-error response, but there is no guarantee that the latest value will be returned. This definition is much stricter than the "99.99% availability" in the daily SLO - it requires a response to **every** request.
- **Partition Tolerance**: Messages between nodes can be arbitrarily delayed or dropped, while the system still has well-defined behavior.

When two replicas that are still providing services cannot communicate with each other, they have no way to confirm each other's latest status, so there are only two ways:

- Both sides continue to accept and answer requests → Availability is preserved, but may give conflicting or out-of-date results;
- At least one side rejects, waits, or becomes read-only to maintain a single order → the availability of this operation is sacrificed.

So the accurate statement is: During **Network Partition, for a certain type of operation, you choose between "consistent response" and "continuous response". **

## When do you need to consider CAP?

CAP must be explicitly discussed when the following four conditions are simultaneously true:

1. There are multiple copies of the same logical data that can be used externally;
2. Communication between replicas relies on a network that may fail and may be delayed for a long time;
3. More than one replica can independently receive reads or writes;
4. The business really cares about "whether to continue the service during the Partition or to maintain a single fact."

Typical scenarios: cross-AZ database, cross-region Active-Active, multi-master Cache, Distributed Lock, configuration center, and inventory service. Even if the cloud network is reliable, long-tail delays, switch failures, certificate expirations, routing configuration errors, and GC Pause will all create the same kind of uncertainty—is the other party dead or just slow? ** From this point of view, these two situations look exactly the same.

The following scenarios should not be applied rigidly to CAP:

- Data structure concurrency within a single process;
- Discuss whether the disk can be persisted;
- Transaction Isolation of single-copy database;
- Scaling of Stateless HTTP service without replicated state.

They each have their own concurrency, durability, or availability issues, but none fall under CAP's model.

## CP and AP are not permanent labels affixed to the entire product.

### Partition is consistent in time partiality (often referred to as CP)

The side that cannot form a legitimate quorum refuses or awaits action. Suitable:

- Balance deduction and ledger entry;
- Seat confirmation, unique username registration;
- Leader Election, Lock and Lease;
- Security-sensitive operations such as permission changes.

The cost is that some requests will time out or fail during Partition, and cross-regional coordination will also increase delays. The product level must design "processing", "standby", "retry later" or read-only mode for this, instead of throwing the technical Timeout directly to the user.

### Partition time bias is available (often referred to as AP)

The quarantined replica continues to accept requests and merges again after communication is restored. Suitable:

- Offline shopping cart and drafts;
- Likes, playback events, Telemetry collection;
- User preferences that can be merged;
- DNS or configured Data Plane continues to use the Last-Known-Good version.

The price is that you have to clearly define conflict semantics. Simple Last-Write-Wins may silently lose writes; direct union of collections may "resurrection" deleted items; sorting based on client timestamp will be affected by clock drift.

### The same system is mixed according to operations.

A shopping website can be arranged like this:

- Read the old value in Cache when product details are in Partition;
- The shopping cart allows offline modification on multiple devices and then merges it;
- Recheck price and inventory at checkout;
- Inventory deductions are refused to be confirmed if the authoritative Partition cannot be contacted;
- Recommendations, search and analytics continue to be served using old data.

This set of answers is much more credible than the sentence "Choose AP for e-commerce systems".

## P is not a function that you can choose not to use

A real distributed system cannot guarantee that the network will never partition. What is called a "CA system" usually means one of three things:

- Reduce the system boundary to a single node or a single synchronized fault domain;
- During Partition, all external services will be stopped;
- Or simply ignore the behavior during the failure and not think about it.

The first two may be completely reasonable engineering choices - it is normal for small-scale systems to load a single master database first - but it cannot be inferred that "network Partition does not exist".

## In addition to CAP, look at PACELC

CAP only talks about how to choose during Partition, but most of the time the system does not have Partition at all. PACELC makes up for normal period trade-offs:

> **If Partition (P), choose between Availability (A) and Consistency (C); Else (E) Normal period, choose between Latency (L) and Consistency (C). **

Three typical options across regions:

- All writes are synchronized to the remote majority replica before returning: the order is stronger and the RPO is smaller, but the write delay requires at least one cross-region RTT;
- Return to the nearest region first, background asynchronous replication: low latency, but remote reads may be old, and region-level failures will lose writes that have not yet been replicated;
- Pin users to the main region (Sticky Routing): This Session is easier to do Read-Your-Writes, but Failover and global load balancing are more complicated.

So even if there is no Partition, we must ask: In order to reduce the delay of normal requests, how much lag do I allow the replica to lag, and how much data do I allow to be lost in the event of a failure?

## Three cases

### Case 1: Booking tickets

Invariant is a maximum of one seat confirmed for one order. Seat IDs can be routed to a single authoritative Partition, using version number or status to do a Conditional Update: only valid `AVAILABLE -> HELD -> CONFIRMED` conversions will succeed.

If you cannot contact the authoritative copy during the Partition, you cannot "sell first and then merge" on the other side, otherwise it will be a double sale - and the double sale of seats cannot be smoothed out with compensation. Old snapshots of the seating map can be shown, but the confirmation request must be moved to Pending, Alternate, or Failed. This is consistent in operation.

### Case 2: Shopping cart

Users should be able to add things to the car when they are offline, so each end can record operations with unique IDs, or maintain versioned collections and merge them after being connected to the Internet. There must be clear rules for quantity and deletion: deletion should be for "the version of the item that has been observed", rather than blindly taking the union of the two sets - otherwise the items deleted on the phone will be added back by the old copy on the tablet.

Checkout is not a continuation of cart merging, it is revalidated against authoritative inventory and prices. This means that browsing/editing is more usable and checkout is more consistent.

### Case 3: Configuration platform

Control Plane requires Quorum and a monotonically increasing version number to publish new configurations, preventing two administrators from concurrently publishing two different "latest versions"; when Data Plane loses contact with Control Plane, it continues to use the verified Last-Known-Good configuration to ensure that business traffic is not interrupted.

The Control Plane is more consistent, and the Data Plane is more usable. The [control plane and data plane](../../06-case-design/01-common-basic-system/02-api-gateway/02-control-plane-and-data-plane.md) in the API Gateway case is also disassembled in the same way.

## How to express CAP in an interview

Don’t just say “I choose CP”, tell the whole chain:

> Seat confirmation cannot be sold twice. Each seat only accepts Conditional Write from its master Shard, and success will be returned after the majority of replicas have submitted. When the Quorum is lost, the seat map with timestamp is still allowed to be read, but the order is not confirmed; the client receives "temporarily unable to confirm" and can be placed on the waiting list. Press Commit Log after recovery to continue processing rather than merging the two confirmed owners.

This paragraph includes: consistency objects, mechanisms, behavior during Partition, semantics for users, and recovery rules.
