# Load Balancer Refactoring Review

## in conclusion

The original README is a 42-line list of topics: the boundaries and keywords are generally correct, but L4/L7, algorithm, session, cross-region and high availability appear side by side. There is no fixed design object, and there is no explanation of what pressure is introduced into the mechanism and what the caller sees when it fails. Capacities are only target numbers, with no calculations used to derive the architecture; learning completion criteria are also missing.

After refactoring there is only one default path:

```text
README
→ 01-Progressive design main line
→ 02-Review and practice
→ Stop
```

## What remains in the main line?

Only keep content that changes the Load Balancer contract, schema, dominant capacity, or failure consequences:

- Explicit design target for Single Region L7 HTTP/Unary gRPC.
- Different semantics for Backend Response, No Route, No Eligible Endpoint, Overload and unknown result.
- Membership, active Health, passive Ejection, Slow Start and Draining.
- Advance from Round Robin to Weight and local load aware selection.
- Request/s, New Connections/s, Concurrent Connections and Bandwidth Quad Capacity.
- Data Plane Fleet across AZ, no shared request state.
- Full immutable Snapshot, atomic install, grayscale, rollback and Last Known Good.
- Bounded In-flight, Load Shedding, Deadline and Retry Budget.

The causal chain becomes:

```text
stable entrance
→ Single L7 Reverse Proxy
→ Endpoint dynamic changes and failures
→ Membership + Health + Draining
→ Uneven request costs and instance capabilities
→ Weight + Local Load-aware Choice
→ The four-axis capacity of a single machine is insufficient
→ Multi-AZ Data Plane Fleet
→ Fleet configuration changes and control plane failures
→ Versioned Snapshot + LKG
→ Backend slows down and Retry amplifies
→ Bounded In-flight + Shedding + Retry Budget
```

## What is isolated?

[`optional/Health status and configuration convergence.md`](optional/optional-health-status-and-configuration-convergence.md) Expand only:

- Differences between Membership, Readiness and Local Passive Health.
- Health Detection Window, misjudgment and recovery.
- Snapshot installation, Version Skew and Control Plane fault matrix.

[`optional/Protocol long connection and affinity.md`](optional/optional-protocol-long-connection-and-affinity.md) Expand only:

- L4/L7 contract differences.
- Three load units: Connection, Stream and Request.
- Long connection failures, draining, sticky and TLS trust boundaries.

Global portal, L4 Fast Path, advanced algorithm implementation, complete protocol/certificate platform and managed product governance enter [Parking Lot](PARKING-LOT.md).

## What is omitted

- Function matrix and configuration syntax of cloud vendors, NGINX, HAProxy, and Envoy.
- Code implementations for Round Robin, Least Connections, Maglev, Rendezvous, EWMA.
- Fixed Health Interval, Threshold, Timeout, Weight and number of nodes.
- NAT, DSR, eBPF, DPDK, VIP/BGP and Packet Processing details.
- Complete HTTP/2, HTTP/3, QUIC, WebSocket and gRPC protocol state machines.
- Full Route API, configuration schema, certificate rotation, RBAC, auditing, billing and runbooks.
- DNS/Anycast global scheduling and cross-Region data failover.

These have engineering value, but should not block first-time learning without real protocol requirements or measurement bottlenecks.

## Fixed error-prone expressions in Review

- "Send to healthy instances" is changed to "Send to instances in the current Snapshot that are locally judged to be healthy and accept new traffic"; Health is a lagging signal.
- "Connection Draining Try to Complete Requests" adds deadlines, configured propagation windows and existing connections that may still fail.
- "Least Connections Handling Long Connections" adds that the number of connections under HTTP/2 / gRPC Multiplexing does not represent the workload.
- "LB Failover" adds that Fleet can only undertake new traffic, and existing connections to the failed node will not be automatically migrated.
- "Continue service in case of control plane failure" added that LKG will become stale and unable to obtain new members, emergency removal and Route updates.
- "Retry to improve success rate" is changed to the default single Attempt; only limited retries are made when semantic safety, deadline is sufficient, and Budget has margin.
- "Multi-AZ i.e. 99.99%" is changed to require capacity margin, ingress dependency and fault injection verification, the topology itself does not prove SLO.

## Current granularity and stopping point

- `README.md`: Learning Contract, External Contract, Architecture Map and Completion Standards.
- `01-Progressive Design Main Line.md`: The only main line of knowledge.
- `02-Review and Practice.md`: Closed-book derivation, four-axis capacity, failure and boundary acceptance.
- `optional/`: Two on-demand topics, which are not completed prerequisites.
- `PARKING-LOT.md`: Only record real reopening conditions.

This case ends after the learner can launch Health, Scheduling, Multi-AZ Fleet, Snapshot and overload protection from a single agent in a closed book, explain the critical failure window, and complete a four-axis capacity estimation.
