# Long connection, Sticky Routing and Connection Draining

WebSocket, TCP sessions and Streaming RPC must save Socket, send buffer and subscription information on the current node - there is no escape from this. But this does not mean that all business states must remain in memory along with the connection. A more stable dividing line is: **Connect locally, the fact is external, and can be restored from the cursor**.

## 1. When is Sticky Routing needed?

Sticky Routing is used to reduce state relocation or maintain connection locality, and is suitable for these situations:

- Subsequent frames of the WebSocket must be sent to the node holding that Socket;
- Partition Worker relies on memory index to continuously process the same Key;
- Repeatedly loading large session contexts from shared storage is too expensive;
- The protocol handshake produces a state that is only valid for the current connection.

Ordinary independent HTTP requests do not have these requirements, and Sticky Routing should not be turned on by default. It will cause uneven instance load, large-area remapping when scaling up and down, centralized user failure on a bad instance, and will also slow down grayscale release and fault removal.

## 2. Routing methods and choices

| Method | Advantages | Risks |
|---|---|---|
| Cookie/Session ID hash | Simple, changes in client IP will not affect | Massive remapping as soon as the number of nodes changes |
| Consistent Hashing | Small migration volume when nodes change | Hotspot Key will still overwhelm a single node |
| Directory: `connection_id -> node` | Accurate, suitable for directed message delivery | Directory updates, TTL and outdated mapping are troublesome |
| Broker Topic/Partition | The sender does not need to know which node the connection is on | One more hop of delay to deal with duplication and backlog |

IP hashes are often broken by NATs, mobile networks, and proxies, and can potentially push an entire company's egress users onto the same instance.

## 3. Reconnection must be a normal path, not an abnormal path

Connections are interrupted due to releases, network switches, idle timeouts, and instance failures - this is the norm. The agreement must be clearly defined:

1. The client exponentially backs off and adds Jitter to prevent everyone from reconnecting at the same time;
2. Bring the last confirmed `sequence` or Resume Token when reconnecting;
3. The new node reissues this gap from the message log/session storage;
4. When the gap exceeds the retention window, it degrades to a full synchronization;
5. Duplicate messages are deduplicated by `message_id`;
6. Presence has TTL, so that "online" will not be permanently displayed after disconnection.

A system that only performs heartbeat keep-alive and does not perform disconnection recovery cannot withstand a real failure.

## 4. Connection Draining must be done before release and scaling.

```text
Instance marked DRAINING
-> no longer accept new connections
-> Send a reconnect prompt to existing clients, or wait for a short grace period
-> Checkpoint / Submit the confirmed Offset
-> Forcefully close the remaining connections after exceeding the deadline
->Instance exit
```

Connection Draining is to stop an instance from receiving new connections and give existing connections a period of time to migrate or end naturally. It must have a timeout limit, otherwise a long connection that never closes can jam the entire publishing process. The client must be able to recognize the "retryable" shutdown code; the Load Balancer's health check interval, the connection Idle Timeout, and the application's Grace Period must also match.

## 5. Case: Chat System

Chat Gateway saves `connection_id -> socket`, Presence Service saves the online status with TTL, and session messages are assigned sequence numbers and persisted by the authoritative message store. Failure to push to a connection that is offline or has just been migrated does not mean that the message is lost - the client can just pull it back according to the serial number after reconnecting.

Trade-off adds persistence and a set of replay logic. In exchange, Gateway can failover at will, and message semantics do not depend on any specific machine. On the other hand, if you only record "sent messages" in the Gateway memory, as soon as the node exits, you will no longer be able to tell which ones have been displayed, which ones have not been sent, and which ones need to be replayed. See [Chat System](../../06-case-design/02-specific-application-system/04-chat-system/README.md).

[Previous section: Stateless Scaling](02-stateless-scaling-and-session-external.md) · [Return to the entrance of this chapter](README.md) · [Next section: Recovery of Stateful Service](04-scaling-and-recovery-of-stateful-service.md)
