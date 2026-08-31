# Service-to-Service Communication Infrastructure

Service-to-service calls require protocols, connection management, identity, and traffic policies. Applications can use HTTP/gRPC clients directly or centralize some common capabilities in proxies or a service mesh.

This article discusses only the communication stack's contract, configuration, and failure behavior. For the principles behind deadlines, retries, circuit breakers, and overload protection, see [Core Concepts](../../02-core-concepts/). For composing resilient call chains, see [General Design Patterns](../../05-general-design-patterns/08-resilient-synchronous-call-path/).

## 1. Define the Call Contract First

| Item | Question to answer |
|---|---|
| Protocol | HTTP/JSON, gRPC, streaming, or another protocol? |
| Address | Is it resolved by DNS, a registry, a platform service, or a proxy? |
| Identity | How do caller and service authenticate each other? |
| Deadline | At what latest time must the entire call end? |
| Size | What are the upper limits for requests, responses, and streams? |
| Concurrency | What are the connection-pool, per-connection concurrency, and call limits? |
| Success | Which status codes represent business success, rejection, or retryable failure? |
| Version | How does the schema remain compatible with old and new callers? |
| Observability | How are traces, metrics, and logs correlated with a call? |

A framework's ability to send a request does not mean the business contract has been defined.

## 2. Usage-Level Differences Between HTTP/JSON and gRPC

| Dimension | HTTP/JSON API | gRPC |
|---|---|---|
| Schema | Can be described with OpenAPI and is often looser at runtime | IDL generates strongly typed clients |
| Readability | Text is easy to debug, with broad browser and external ecosystems | Binary transport usually requires tooling for inspection |
| Call form | Request/response is most common, but streaming is also possible | Unary and multiple streaming modes |
| Compatibility | Field and status-code conventions must be agreed upon | Field numbers and schema-evolution rules are important |
| Typical use | Public APIs, browser access, and general integration | Strongly typed internal APIs, high-frequency calls, and streaming interfaces |

This table does not imply a universal performance conclusion. Payload, TLS, proxies, serialization, and connection reuse all affect results. Start with client ecosystem, schema management, and call pattern, then validate using the actual workload.

## 3. A Connection Pool Is Also a Capacity Boundary

Clients usually reuse connections. Examine:

- maximum connections per downstream service, instance, and process;
- idle connections, maximum connection lifetime, and endpoint changes;
- concurrent stream count under multiplexing;
- whether requests queue in the client, proxy, or downstream service;
- behavior when connections reset, are exhausted, or rebuild in a burst;
- how long-lived connections drain during deployment, scale-in, and failover.

A pool that is too small causes queueing; one that is too large may overwhelm the downstream service or exhaust ports. Derive the configuration from instance count, per-instance concurrency, call duration, and downstream capacity.

## 4. Where Proxies and Service Meshes Fit

Central proxies can provide:

- integration with service discovery and load balancing;
- mTLS, service identity, and certificate rotation;
- deadlines, connection pools, and controlled retry policies;
- traffic splitting, canaries, mirroring, and fault injection;
- call metrics and distributed-tracing context;
- egress control and basic access policies.

A mesh is usually configured through a control plane, while sidecars or another data-plane form process traffic. It adds capabilities but also increases resource use and the complexity of configuration, upgrades, and troubleshooting.

## 5. A Mesh Does Not Understand Business Success

A proxy usually does not know:

- whether a POST is safe to retry;
- whether an external provider accepted a payment;
- whether an empty response is a valid result or missing data;
- whether the current user owns a business resource;
- when compensation or reconciliation is complete.

Therefore, idempotency keys, business error classification, transaction boundaries, and reconciliation remain application concerns. Before a retry is configured centrally, the API owner must declare which operations are retryable and define the budget.

## 6. A Deadline Must Propagate Through the Call Chain

If the upstream caller has only a 500 ms budget, each downstream cannot use a one-second timeout. Clients, proxies, and service frameworks should propagate the remaining deadline and reserve budgets for connection setup, individual attempts, and retries.

Verify:

- which layer sets the total deadline and which sets the per-attempt timeout;
- whether cancellation stops unnecessary downstream work;
- whether proxy retries overlap SDK retries;
- whether the business operation may have succeeded after the timeout;
- which idle and total limits apply to streaming and long polling.

For budgeting methods, see [Latency, Throughput, and Tail Latency](../../02-core-concepts/02-latency-throughput-and-tail-latency/).

## 7. Scope of Traffic Policies

| Policy | Direct use | Primary risk |
|---|---|---|
| Traffic split | Route by proportion or version | A correct traffic proportion does not mean the business sample is unbiased |
| Canary | Gradually send traffic to a new version | Schema and rollback compatibility remain application responsibilities |
| Request mirroring | Copy traffic for validation | A mirrored request must not produce real side effects |
| Outlier ejection | Temporarily remove an abnormal endpoint from the balancing pool | During general overload, it may further reduce capacity |
| Connection draining | Stop accepting new requests during release or scale-in | Long-lived connections and streams need separate policies |
| Egress policy | Restrict services from reaching external targets | Misconfiguration can cause widespread blocking |

Every policy should define matching conditions, scope, duration, and fallback.

## 8. Critical Capacity and Cost Factors

- requests per second, concurrent requests, and call size;
- service-instance, proxy, and connection counts;
- CPU and memory overhead from TLS and proxies;
- telemetry label cardinality and sampling rate;
- streaming-connection duration and bandwidth;
- control-plane object count, configuration-propagation time, and proxy-reload time;
- cross-region and egress network charges.

Small per-sidecar overhead becomes significant across many instances. Measure the actual deployment density and traffic.

## 9. Failure Behavior

### Local Proxy Unavailable

An application may lose access to every downstream service even when those services are healthy. Define proxy startup ordering, readiness, upgrades, and crash recovery.

### Control Plane Unavailable

Existing proxies can often continue forwarding with their last known configuration, but new endpoints, certificates, or routes may not take effect promptly. Verify configuration-cache duration and certificate-expiration risks.

### Configuration Error

A global retry, routing, or authorization rule can affect many services. Configuration needs validation, canary rollout, scope restrictions, auditing, and rapid rollback.

### Telemetry Backend Slows Down

The data plane should not block requests while exporting logs or traces. Verify buffering, sampling, dropping behavior, and resource caps.

### Retry Amplification

An SDK, sidecar, gateway, and load balancer may each retry, creating multiplicative amplification. Critical calls must identify one responsible layer and a total attempt budget.

## 10. When a Service Mesh Is Unnecessary

Language SDKs, platform services, and a small number of shared libraries may suffice when:

- there are few services and implementation languages;
- the platform can provide mTLS and identity simply;
- traffic-splitting and observability needs are limited;
- the team cannot yet operate control-plane and proxy upgrades;
- a mesh does not solve the current primary problem.

Re-evaluate a mesh when consistent cross-language security policies, large-scale certificate rotation, complex traffic management, or uniform service identity becomes necessary.

## 11. Product Forms as Navigation Only

| Form | Representative implementations | Verify first |
|---|---|---|
| RPC/HTTP framework | gRPC, language HTTP clients | Deadlines, connection pooling, schemas, and error models |
| General-purpose proxy | Envoy, HAProxy, NGINX | Protocols, routing, connections, observability, and deployment boundaries |
| Service mesh | Istio, Linkerd, Consul Service Mesh | Data plane, identity, policies, upgrades, and resource cost |
| Cloud-platform communication | Platform services and managed meshes | Regions, quotas, integration, and vendor boundaries |

Specific guarantees come from the documentation for the selected version and deployment mode.

## 12. Case Study: Synchronous Order Query

An Order Service calls Inventory and Payment:

- the API contract defines stable IDs, error codes, and the remaining deadline;
- client connection pools limit concurrency to avoid downstream overload;
- the mesh provides mTLS, endpoint routing, and tracing;
- only read requests declared safe receive controlled retries;
- if Payment times out, a proxy retry cannot prove to Order that payment failed; the application must query business status or reconcile.

Communication infrastructure is responsible for transport and common policies. The service contract still defines business outcomes.

## 13. Checklist

- [ ] Defined protocol, schema, error codes, deadline, and size limits.
- [ ] Derived connection-pool and concurrency limits from total instance count and downstream capacity.
- [ ] Avoided stacking SDK, proxy, and gateway retries.
- [ ] Did not mistake mTLS identity for business authorization.
- [ ] Defined control-plane, data-plane, and telemetry failure behavior.
- [ ] Included scope, canarying, audit, and fallback in traffic policies.
- [ ] Kept business idempotency, success decisions, and reconciliation in the application.
- [ ] Established a clear need and affordable operating cost before introducing a mesh.

[Back to this chapter's contents](../README.md)
