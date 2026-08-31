# Optional: protocol, long connection and affinity

Mainline derivation based on L7 HTTP/Unary gRPC's "select endpoint per request". This article only explains why protocol changes will change load units, fault semantics, and release methods, and does not expand on protocol implementation.

## 1. L4 and L7 are different contracts

| Dimensions | L4 | L7 |
|---|---|---|
| Select unit | TCP / UDP Flow or Connection | HTTP Request / gRPC Call, long Stream is still bound by the connection |
| Visible information | IP, Port, connection status | Host, Path, Header, Method and protocol status |
| TLS | Commonly Passthrough | Can be terminated and re-encrypted |
| Resource hot spots | Packet Rate, Connection, NAT / Flow Table | HTTP parsing, Request, Header, TLS and Backend Pool |
| Error semantics | Reset, Timeout, packet loss | Route, HTTP Status, partial response can also be distinguished |

If the requirement is high-throughput TCP, UDP or end-to-end TLS, you should re-estimate based on Connection/Flow as the main line instead of adding an L4 switch to the current design.

## 2. Connection balance is not equal to Request balance

HTTP/1.1 Keep-alive will reuse connections for multiple requests; HTTP/2 and gRPC can also concurrently send multiple streams on one connection. This results in three layers of distribution that are not necessarily consistent:

```text
Client Connection Distribution
≠ Active Stream Distribution
≠ Backend Work Distribution
```

Least Connections is only a good sign if the number of connections correlates with the workload. For multiplexing, at least observe Active Request / Stream, byte rate and latency.

Backend Connection Pool will also change the results: LB can send different requests to different Backend connections while the client connection remains unchanged; but once a WebSocket or bidirectional Stream is established, it is usually fixed to the same Backend during the life cycle.

## 3. Long connection changes expansion and fault semantics

- Expansion only affects new connections or new streams, and existing connections cannot be automatically migrated.
- A single Data Plane failure will disconnect the client connections it holds, and Fleet can only accept reconnections.
- A single Backend failure will interrupt the Stream bound to it, and LB usually cannot transparently resume transmission from the intermediate state.
- Idle Timeout must be aligned with Heartbeat / Keepalive, otherwise healthy connections will be closed by mistake.
- The client needs to reconnect with Backoff and Jitter, and restore the application layer Session/Offset.

Therefore, "LB cross-AZ high availability" means that the entrance can accept new connections, but it does not mean that all long connections will be without interruption.

## 4. Draining must have a deadline

Planned offline is usually in the following order:

```text
Stop receiving new Connection/Request/Stream
→ Wait for existing work to be completed
→ Send protocol level shutdown signal at deadline
→ Forcefully close remaining connections
```

Without a deadline, a never-ending WebSocket will block publishing. If the deadline is too short, a large number of simultaneous reconnections will be created. Release Cadence, Drain Deadline, Client Reconnect Backoff, and Fleet Headroom must be verified together.

Draining is not a transaction barrier: forwarded write requests may complete, fail, or have unknown results; closing the connection cannot roll back the business side effects.

## 5. Boundary of Sticky / Hash Routing

Affinity can be used for:

- Improve certain Backend local cache hits.
- Reduce long polling or Session context migration in bounded time.
- Send the same Key to the same processor as much as possible.

But it cannot provide:

- Endpoint remains fixed to the original instance after failure.
- Zero remapping when scaling up or down.
- Automatic extension to Hot Key.
- Change the in-process Session to a restorable state.

Critical Sessions should be external or have recovery protocols. If business correctness relies on "always hitting the same instance", it goes beyond the normal LB contract.

## 6. TLS and origin identity

| Plan | Benefit | Consideration |
|---|---|---|
| LB terminates TLS | Can be connected by HTTP Route, centralized certificate, and reused Backend | LB becomes a clear text boundary, and internal links need to be protected separately |
| TLS Passthrough | Backend maintains end-to-end TLS | Typically has less L4/SNI capabilities |
| Re-encryption after termination | L7 capabilities with internal encryption | Two-part handshake, certificates and CPU cost |

If the original Client IP, Scheme or certificate identity is passed to Backend, LB must delete the header with the same name passed by the client and then write it to the controlled agent. Applications only trust values ​​from authorized proxies. The full certificate lifecycle belongs to the Parking Lot.

## 7. When to stop

Stop after you can explain the following questions:

- Why connections, streams and requests are three different load units.
- Why Fleet high availability does not mean long connections without interruption.
- Why Draining requires agreement, headroom, and deadlines.
- What can Sticky optimize and why it cannot save unique business status.
- When the requirement has changed to L4 or full long connection platform design.

Do not continue to expand HTTP/2 Frame, QUIC, Proxy Protocol, Certificate Rotation Implementation, or Kernel Socket Tuning.
