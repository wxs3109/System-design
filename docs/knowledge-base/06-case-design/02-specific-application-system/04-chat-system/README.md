# Design chat system

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Realtime Messaging / Connection State |
| Core invariants | Confirmed messages must be recoverable; the same session maintains a stable order according to the Sequence accepted by the server; retries cannot produce user-visible duplicate messages |
| Quality attribute priority | Realtime Latency → Message Durability → Availability |
| Traffic / Data Shape | Massive long connections, two-way small messages, group chat Fan-out, sudden reconnection |
| Failure strategy | Presence can be stale; pass Cursor Catch-up after disconnection; cannot return durable ack without persistence |
| Security Boundaries | Device Identity, Session Membership Permissions, Message Privacy, Spam and Malicious Attachments |
| Key Patterns | WebSocket Gateway、Session Routing、Message Log、Per-conversation Ordering、Push Notification |

## Functional boundaries
- Single chat, group chat, online status, attachments and multi-device synchronization.

## Acceptable NFR (Design Assumptions)

- Supports 10,000,000 long connections, peak 1,000,000 Message/s; online message end-to-end P99 < 500 ms.
- Durable Ack is returned only after the message has entered cross-fault domain durable storage; the service does not commit to global ordering across sessions.
- Presence is allowed to age for 30 seconds; start pressing Cursor Catch-up within 10 seconds after disconnection and reconnection.
- The basic group chat limit is 1,000 people; super large groups evolve as independent Fan-outs.

## Core topics
- WebSocket connection management, session routing and service discovery.
- Message ID, sequence, delivery confirmation, retries and deduplication.
- Offline messages, history, unreads and push notifications.
- Group chat Fan-out, very large groups, privacy and encryption boundaries.

## Interview questions
- How to define "sent, delivered, read"?
