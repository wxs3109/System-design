# Stateless Scaling and Session external

## 1. When to prioritize statelessness?

When the request meets the following conditions, priority is given to making it a stateless computing layer:

- The request itself carries the identity and parameters required for processing;
- Business facts are stored in a shared authoritative store;
- Any Instance can access dependencies within Deadline;
- There is no requirement for the same process to maintain an implicit order between requests;
- Instance exit will not cause the data that has been successfully confirmed to disappear.

Typical scenarios are API Gateway, CRUD API, authentication service and read aggregation layer. The benefit is not that the database is no longer needed, but that the Instance can be replaced by the Load Balancer at will: expansion only requires registering a new instance, failure only requires removing the Endpoint, and rolling release does not require relocating any user sessions.

## 2. Three designs of Session

### Solution A: Signature Token

The client carries a token with signature and expiration time, and the instance can verify it locally.

Suitable for: The identity statement is relatively small, reads more and writes less, and can accept the Token to continue to be valid in the short term.

Prices and considerations:

- Revoking permissions will not make the issued Token disappear automatically - this is its biggest weakness;
- Token is not suitable for holding large objects that change frequently or are sensitive;
- Must verify signature, Issuer, Audience, expiration time, and process Key Rotation;
- High-risk permission changes should be protected by revocation lists or very short TTLs.

### Solution B: Shared Session Store

Only a random Session ID is placed in the Cookie, and the Instance reads the Session content from Redis or the database.

Suitable for: Session content changes frequently, active logout is required, and unified control by the server is required.

Prices and considerations:

- Session Store enters the critical path of every request;
- To clearly define whether it is rejected, downgraded, or falls back to Source of Truth when it is unavailable;
- To prevent Session Fixation attacks, the Session ID must be rotated after successful login;
- The semantics of TTL, renewal, multi-end concurrent login and cross-region must be clearly written.

### Solution C: Instance memory Session + Sticky Routing

The implementation is the simplest, but once the instance fails, the session will be gone, the expansion and contraction will be remapped, and the release of Connection Draining will take a long time. It is only suitable for small systems or temporary transition scenarios that can accept "letting users log in again". Don't think of Sticky Routing as a means of persistence - it only guarantees that the request returns to the same machine, not that the machine is still there.

## 3. Local Cache is not equal to stateful business service

Stateless Instance can have Local Cache, as long as this Cache maintains the following boundaries:

- Losing it only affects performance and does not change any business facts;
- Cache Miss can return to the source to read the Source of Truth;
- Allow each Instance to temporarily see different versions;
- High-risk reads such as permissions and deletions have authoritative verification, or the invalidation window is extremely short;
- Cold Start and full Invalidation won't knock Origin down.

Common protection methods include TTL plus Jitter, Request Coalescing, Origin Concurrency Limit, Negative Cache and hotspot Key preheating.

There is a clear criterion: if the code increments the "balance" or "inventory" in the Local Cache, then it is no longer a Cache - it is secretly saving the Source-of-Truth State, and this state is not persisted, not copied, and disappears as soon as the process exits.

## 4. Stateless expansion also has boundaries

Expanding API instances only increases calculation concurrency, and the following will not be automatically expanded:

- Number of database connections and write throughput;
- Quotas for downstream services;
- The carrying capacity of a single tenant or a single hotspot Key;
- Cost aggregation across Shards;
- Synchronized Tail Latency for Fan-out.

Therefore, the indicators of Autoscaling cannot only look at CPU, but also look at request queue length, P99, error rate, downstream connection pool occupancy and load of each tenant. The expansion speed itself must also have an upper limit - if the expansion is faster than the connection growth that the downstream can bear, it is to DDoS your own database.

## 5. Case: API Gateway

Gateway's routing rules, traffic limiting policies, and certificates all come from Control Plane, but the instances that handle requests should be as replaceable as possible:

```text
Control Plane publishes versioned configuration snapshots
             ↓
The Gateway instance reads the local snapshot and handles the request
             ↓
Rate Limiting status by user/tenant count, placed in a clear consistency boundary
```

Local configuration snapshots allow business to continue even if the Control Plane fails briefly - snapshots are derived states that can be re-pulled. The global accurate current limit count requires remote coordination, which will increase the delay of each request; a common practice in engineering is to pre-allocate a batch of quotas locally, trading a little accuracy for availability and throughput. See [API Gateway: Control Plane and Data Plane](../../06-case-design/01-common-basic-system/02-api-gateway/02-control-plane-and-data-plane.md).

[Previous section: State and its Owner](01-first-identify-the-state-and-its-owner.md) · [Return to the entrance of this chapter](README.md) · [Next section: Long connection and Connection Draining](03-long-connection-sticky-routing-and-connection-draining.md)
