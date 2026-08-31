# Load Balancers and Reverse Proxies

A load balancer selects a target from healthy backends. A reverse proxy accepts connections on behalf of backends and may perform TLS termination, HTTP routing, and connection management.

This article studies only the usage contract of off-the-shelf components. It discusses where scheduling algorithms apply without covering their implementation. For the complete design of a load balancer, see the [case study](../../06-case-design/01-common-basic-system/01-load-balancer/).

## 1. Position and Boundaries

    Client
      → Global entry
      → Public Load Balancer
      → API Gateway / Web Service
      → Internal Load Balancer
      → Service instances

- An external load balancer accepts entry traffic from the public Internet or an enterprise network.
- An internal load balancer provides a stable entry point for service-to-service calls.
- Global region selection belongs to [DNS and Global Traffic Entry](../01-dns-and-global-traffic-entry/).
- API-level authentication, quotas, and version policies belong to the [API Gateway](../03-api-gateway/).

## 2. L4 and L7

| Type | Visible information | Common capabilities | Suitable for |
|---|---|---|---|
| L4 | IP, port, and TCP/UDP connection | Connection forwarding and source-address handling | Non-HTTP protocols, high connection throughput, and end-to-end TLS |
| L7 | Host, path, method, and headers | Content routing, TLS termination, and HTTP observability | Web, REST, and gRPC |

L7 enables richer routing, but the proxy must understand the protocol, consumes more resources, and becomes part of TLS and HTTP semantics. Product support for HTTP/2, HTTP/3, gRPC, WebSocket, and UDP must be verified separately.

## 3. Input, Output, and Success Semantics

| Item | Description |
|---|---|
| Input | Connection or request, listener, routing rules, and a set of healthy backends |
| Output | Delivers the connection or request to one backend and returns the response |
| Successful forwarding | Selects a backend and completes the proxy operation defined by the component contract |
| Does not mean | Business success, durable data, or a response satisfying user semantics |

An L7 proxy should distinguish among no matching route, no healthy backend, a connection timeout, and a backend business error.

## 4. Backend Selection

| Method | Suitable for | Considerations |
|---|---|---|
| Round robin | Instances with similar capacity and requests with similar cost | Large differences in request cost cause imbalance |
| Weighted | Heterogeneous instances, canaries, and migrations | Weights are expected proportions, not exact proportions |
| Least connections | Workloads with significantly different connection durations | The amount of work per connection may still differ |
| Hash | Cache affinity or bounded session affinity | Instance changes remap keys, and popular keys remain hot spots |

Business correctness must not depend on “always selecting the same instance.”

## 5. Health Checks and Connection Draining

At minimum, verify:

- probe protocol, path, interval, timeout, and thresholds;
- when a new instance joins and whether it uses slow start;
- when an unhealthy instance stops accepting new traffic;
- whether existing connections close immediately or wait for connection draining;
- what is returned when all backends are unhealthy;
- how long control-plane updates take to reach every data plane.

Readiness means that an instance can safely accept new requests; it is not the same as the process still being alive. Endpoint removal by the load balancer cannot undo a write already in progress. For safe retries, see [Idempotency, Retries, and Deduplication](../../02-core-concepts/06-idempotency-retry-and-deduplication/).

## 6. TLS, Identity, and Long-Lived Connections

| TLS approach | Benefit | Cost |
|---|---|---|
| Terminate at the load balancer | Centralizes certificates and encryption and enables L7 routing | The path to the backend must be protected separately |
| Passthrough | Preserves end-to-end TLS to the backend | Usually exposes only a smaller set of L4/SNI capabilities |
| Terminate and re-encrypt | Combines L7 capabilities with internal encryption | Two certificate segments and additional performance cost |

When a proxy forwards the original IP, protocol, and host, the application may trust only fields written by a controlled proxy. The boundary must remove client-forged values before writing canonical headers.

WebSocket and gRPC streams turn request balancing into connection balancing. Scaling out does not migrate old connections. A deployment should stop accepting new connections before connection draining. Idle timeout must match the heartbeat, and clients must reconnect with backoff.

## 7. Boundaries of Sticky Sessions

A sticky session makes the same client tend toward the same instance and can improve in-process cache hits, but it cannot be the sole guarantee for critical state. Instance restarts, scaling, and failure-triggered endpoint removal all change the target.

Critical state should be externalized and recoverable, or the system should explicitly accept reauthentication. See [Stateless and Stateful Services](../../02-core-concepts/04-stateless-and-stateful-service/) for the concepts.

## 8. Capacity, Configuration, and Cost

| Metric | Impact |
|---|---|
| Concurrent connections | Connection tables and memory |
| New connections per second | Accept operations, TLS, and source-port resources |
| Request count | HTTP parsing, routing, and logging |
| Throughput | Bandwidth, buffering, and charges |
| TLS handshake rate | CPU and cryptographic capacity |
| Rule and target counts | Control-plane quotas and matching cost |

Also verify cross-availability-zone charges, static IP support, idle timeout, header and body limits, log charges, health-check quotas, and capacity pre-warming before scale-up.

## 9. Failure and Overload Behavior

| Situation | What a caller may observe |
|---|---|
| No healthy backend | A fast 5xx, connection refusal, or timeout |
| Backends slow down | Queueing, proxy timeouts, or connection-pool exhaustion |
| Load balancer reaches a quota | New connection failures, packet loss, or rising latency |
| Routing error | A 404, traffic sent to the wrong service, or failures on some paths |
| Instance goes offline immediately | In-progress connections are interrupted |

Retries at multiple proxy layers amplify traffic. Consider a bounded retry only when both the request and the failure type make it safe, and include it in the end-to-end budget.

## 10. Common Products and Selection

| Form | Examples | Selection focus |
|---|---|---|
| Managed L4 | AWS NLB, Azure Load Balancer, Google Cloud passthrough LB | TCP/UDP, connection throughput, and static entry points |
| Managed L7 | AWS ALB, Azure Application Gateway, Google Cloud Application LB | HTTP routing, TLS, and managed scaling |
| Self-hosted proxy | NGINX, HAProxy, Envoy | Flexible configuration; the team owns capacity, upgrades, and high availability |
| Kubernetes entry point | A concrete Gateway API or Ingress implementation | The contract depends on the controller and cloud implementation |

A product name does not replace validation of limits for the target protocol, geography, SKU, and deployment mode.

## 11. Application Responsibilities and a Small Case Study

The application must still provide a bounded-cost health-check endpoint, set deadlines, reject new traffic before connection draining on shutdown, avoid relying on sticky sessions for unique state, protect trusted headers, and monitor routes, backends, errors, latency, and connections.

For example, consider 20 stateless HTTP instances in one region with a small number of WebSocket connections. An L7 load balancer can terminate TLS and use default balancing for regular requests. During a deployment, mark each instance Not Ready before waiting for connection draining. Use longer draining and idle timeouts for WebSockets, and make clients responsible for reconnecting.

Before selection, answer:

- Is L4 or L7 required?
- Is this a global, regional, or service-internal entry point?
- How are “healthy” and “safe to accept traffic” defined?
- Where does TLS terminate?
- Are there long-lived connections and connection draining?
- What are the peak connection count, CPS, QPS, bandwidth, and handshake rate?
- What does the client observe when there are no healthy backends or the load balancer is overloaded?
