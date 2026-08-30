# Design a multi-person collaborative editing system

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Realtime Shared State |
| Core invariants | Confirmed editing operations cannot be lost silently; all clients with permissions must eventually converge to the same Revision; edits cannot be submitted after the permissions are revoked |
| Quality attribute priority | Convergence Correctness → Realtime Latency → Durability |
| Traffic / Data Shape | Long connections, small and high-frequency operations, multiple writers, offline editing and Hot Document |
| Failure strategy | Presence and Cursor can be lost; Operation must be persisted and confirmed; disconnected clients can be restored through Revision Catch-up or Snapshot |
| Security Boundary | Document Permissions, Shared Links, Revocation, Cross-Tenant Isolation, Sensitive Content and Revision History |
| Key Patterns | Operation Log、Revision、Snapshot、OT / CRDT、WebSocket、Presence、Fencing |

## Functional boundaries

- Create and share documents, supporting real-time editing, cursor and online status by multiple people.
- Supports short-term offline modification, reconnection synchronization, version history and recovery.
- Comments, rich text plugins, complex forms and end-to-end encryption as future extensions.

## Acceptable NFR (Design Assumptions)

- For the basic version, choose OT + single-document ordered Operation Log; CRDT is compared as an alternative and does not implement two sets of protocols at the same time.
- Ordinary document editing broadcast P99 < 200 ms; Ack Operation must be recoverable after the client reconnects.
- After any allowed concurrent editing and message replay, all authorized clients eventually converge to the same Revision Hash.
- New Operations will be blocked within 30 seconds after deprivation; Presence and Cursor can be lost and allowed to expire for 10 seconds.

## Core business closed loop

1. Client opens a Document and reads the Snapshot and current Revision;
2. Client enters Document Session through Connection Gateway;
3. Edit is encoded as Operation with `base_revision` and `operation_id`;
4. Collaboration Service Verify permissions, remove duplicates, sort or convert Operation;
5. After the Operation is persisted to the Operation Log, the Ack is returned and broadcast to other Clients;
6. Snapshot Worker periodically merges operations to generate new Snapshots;
7. Use Revision Cursor Catch-up when the client is disconnected, and reload the Snapshot when it is out of date.

## Core topics

- Data boundaries for Document, Operation, Revision, Snapshot and Presence.
- Single document sequence, Operation Idempotency and multi-device editing by the same user.
- What capabilities OT and CRDT provide respectively, and what rules the application is still responsible for.
- Offline Edit, Reconnect, Catch-up, Conflict Visualization and Convergence verification.
- Session Placement, Fan-out, Snapshot and Backpressure for Hot Document.
- Permission revocation, share link, Revision History, deletion and restoration.

## Minimum data list

| Data | Is it authoritative | Typical storage |
|---|---|---|
| Document Metadata / ACL | Yes | Relational / Metadata Store |
| Operation Log | Yes, logs accepted edits | Ordered Log / Partitioned Database |
| Snapshot | Can be reconstructed by Operation, but is a critical recovery point | Object Storage / Document Store |
| Presence / Cursor | No, can be lost | Memory / Ephemeral Store |
| Client Revision Cursor | for Catch-up | Client + Session Store |

## Key Trade-off

- More fine-grained operations improve the collaboration experience, but increase throughput, log and merge costs.
- Single document and single leader simplifies the order, but limits the write expansion and failover of Hot Document.
- More frequent Snapshots shorten recovery time but increase ongoing computing and storage costs.
- Extended offline editing improves usability, but also makes Merge, permission revocation, and user interpretation more complex.

## Interview questions

- Two users insert text at the same position at the same time. How does the client finally converge?
- If the user's permission is revoked during offline editing, how to handle the operation after reconnection?
- When hosting a Hot Document that can be viewed by 100,000 people and edited by thousands of people, which states need to be layered?

## Subsequent expansion sequence

1. Operation Log of single document and single Session Server;
2. Revision, Snapshot, Ack and disconnection Catch-up;
3. Concurrent Operation, OT/CRDT boundary and convergence verification;
4. Hot Document, Partition, Failover and Backpressure;
5. ACL, revocation, historical version, recovery and Multi-region.
