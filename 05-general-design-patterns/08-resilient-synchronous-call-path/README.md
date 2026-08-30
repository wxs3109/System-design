# Resilient Synchronous Call Path

The value of Synchronous Call is to allow the Caller to get a definite result immediately; its risk is that the Caller will inherit the Latency, Capacity and Failure of Downstream at the same time. Instead of turning on all Retry, Circuit Breaker and Fallback, Resilient Call Path uses Deadline to constrain the total waiting time, uses Resource Isolation to limit Blast Radius, and only recovers or falls back when business semantics allow it.

This article discusses the combination of Caller, Gateway / Service and Downstream. The definitions of Timeout, Retry, Isolation and Fallback are in [Fault Tolerance, Downgrade and Disaster Recovery] (../../02-Core Concepts/07-Fault Tolerance, Downgrade and Disaster Recovery/), and the single product contracts for Gateway, Load Balancer and Service Communication components are in [Infrastructure Components] (../../04-Infrastructure-Components/).

## Problems to be solved and invariants

The call chain must first be clear:

- The maximum amount of time the entire user request is allowed to wait;
- Which downstream results are necessary to complete the request and which can be missing or added later;
- Whether external side effects may have occurred after the timeout;
- How to protect caller threads, connections, memory and downstream capacity when dependencies slow down;
- What security, funding, permissions, or inventory invariants cannot be broken by downgrading.

The core principle is that each downstream call consumes the same end-to-end latency budget, rather than each layer individually regaining an entire timeout.

## The simplest solution and upgrade signal

The simplest solution is a direct call with an explicit timeout. Only when specific problems are observed will the next layer of mechanisms be added:

| Problem signals | Added mechanics | New costs |
|---|---|---|
| Transient network errors and operations are safe to retry | Bounded retries + backoff + Jitter | Requests and downstream load are amplified |
| Downstream persistent failure | Circuit Breaker | Requires status, threshold and recovery detection |
| One dependency exhausts shared resources | Bulkhead / Independent connection pool and concurrency quota | Capacity utilization may decrease |
| Non-critical dependencies are unavailable | Fallback / Caching or omitting fields | Returning older or incomplete results |
| Traffic exceeds safe capacity | Admission Control / Load Shedding | Some requests are explicitly rejected |

If the business does not require immediate results, it should be changed to asynchronous tasks or event links instead of using longer Timeout to maintain the illusion of synchronization.

## Participating components and responsibilities

| Components | Main Responsibilities | Critical Status |
|---|---|---|
| Caller | Set total deadline, pass request identity, interpret results | Remaining time, idempotent keys, calling purpose |
| Gateway / Upstream Service | Authentication, routing, admission and overall budget allocation | Routing, quotas, request context |
| Client Library / Sidecar | Connection management, single Timeout, limited Retry, Circuit Breaker | Connection Pool, concurrency, Breaker status |
| Downstream | Processing requests within its capacity contract | Business status and own resources |
| Fallback Source | Provide old cache, default values, or simplified results | Data versions and expiration times |

Retry and Circuit Breaker can be implemented by the code library, Sidecar, Service Mesh or Gateway, but the same call must have a clear Policy Owner. Multiple levels of independent Retry will form Amplification.

## Happy Path and Success Semantics

A normal call can be organized as follows:

1. The entrance sets the end-to-end deadline for the request and passes the remaining budget to the downstream;
2. Each hop reserves network return and local processing time from the remaining budget;
3. Admission Control confirms that the service and key dependencies still have safe capacity;
4. The call is executed in an independent resource pool to avoid one dependency occupying all threads or connections;
5. Only when a confirmed response that can be interpreted by the business is received, success will be returned according to the corresponding semantics;
6. If using Fallback, the response should be identifiable by the caller or at least distinguishable in telemetry.

HTTP 200 and RPC OK only indicate that the interface returned successfully according to the protocol, but cannot automatically prove that the cross-service business process has been completed. Write operations also need to distinguish between committed, accepted, and unknown results.

## Deadline and Timeout

Deadline is the latest completion time of the entire request; Timeout usually restricts a certain attempt or a certain hop. The combination should satisfy:

- The downstream single Timeout is smaller than the current remaining deadline;
- Time must be allowed for the return path and upstream finish;
- Queue waiting, connection establishment, DNS and TLS also consume budget;
- After the upstream has been canceled or the deadline has expired, the downstream should stop meaningless work as soon as possible;
- You cannot use infinite timeouts to disguise resource leaks as reliability.

For example, if the user request budget is 800 ms and the upstream local processing takes 100 ms, we cannot give the two serial downstreams 700 ms each. Budgets should be allocated by critical path and validated against tail delays rather than average delays.

## Retry can only have clear boundaries

Suitable for automatic retries are usually transient failures, current throttling, or connection failures before sending, and the request is read-only, idempotent, or carries a stable idempotent key. You cannot blindly retry in the following situations:

- After timeout, it is not known whether side effects such as payment and order placement have occurred;
- Invalid parameters, permission denial or business conflicts;
- Deadline is no longer enough to complete another attempt;
- The downstream is already overloaded, and retrying will only increase the queue;
- Multiple layers of calls are prepared to retry the same operation.

Each of the three layers is retried three times. At worst, one entry request may be amplified into 27 bottom-layer attempts. A common practice is to perform limited retries at a layer close to the failed dependency and set a Retry Budget: retry traffic should only account for a small portion of the total traffic.

## Circuit Breaker, Bulkhead and Admission Control

The three solve different problems:

| Mechanism | Basis for refusal | Objects to be protected |
|---|---|---|
| Circuit Breaker | Recent failures or slow calls indicate an unhealthy dependency | Avoid waiting for known failed dependencies |
| Bulkhead | A certain type of call has exhausted the independent concurrency or connection quota | Other dependencies and request types |
| Admission Control | The service currently has insufficient capacity | The entire service and critical traffic |

Breaker fails quickly after opening, which does not mean that dependencies have been restored. When entering Half-open, only a small amount of detection traffic is released; after the detection is stable and successful, it gradually increases to prevent the full amount of traffic from instantly overwhelming the newly restored dependency.

Isolation dimensions should be close to real fault boundaries, such as splitting by downstream, tenant, request priority, or read-write type. A connection pool for each downstream can more easily limit the spread of faults than a large pool shared by the whole service, but a pool that is too small will also reduce normal utilization.

## Fallback must have business semantics

Acceptable fallback examples:

- Return popular content when the recommendation service fails;
- Return placeholder image when reading non-critical avatar fails;
- Product browsing returns cached prices with version and maximum age, for display only.

Examples that should typically fail-closed include permission verification, payment confirmation, inventory deductions, and sensitive data access. Default "allowed" or legacy data cannot be traded for superficial availability.

When designing Fallback, write clearly: where the data comes from, how old it is at most, which fields are missing, whether the caller can identify it, how to return to the main path after recovery, and whether the downgrade result will trigger irreversible side effects.

## Failure and composition behavior

| Scenario | Link Behavior | Risk Control |
|---|---|---|
| Single connection failure | Limited retry by a policy layer within budget | Idempotent, backoff, Jitter, Retry Budget |
| Downstream persistent timeouts | Breaker on, fast fail or fallback | Avoid filling up threads and connections |
| Downstream is only slow for a certain tenant | Tenant-level concurrency and quota isolation | Prevent noisy neighbor |
| Caller traffic surge | Ingress admission, throttling, and priority denial | Preserve critical request capacity |
| Primary path fails but cache is available | Returning identifiable stale results | Maximum staleness time and business tolerance |
| The result of the write request is unknown | Use idempotent keys to query or retry, and reconcile if necessary | Do not treat Timeout as not executed |
| Dependencies have just been restored | A small amount of detection, gradually restore traffic | Avoid recovery storms |

If a request calls multiple dependencies in parallel, you also need to define whether they must all succeed, satisfy the Quorum, or allow partial results. Fan-out will amplify Tail Latency. For related principles, see [Tail Latency and Fan-out Amplification].

## Observation and verification

Monitoring must distinguish between original requests and attempts:

- Ingress request volume, attempt volume, retry amplification rate and Retry Budget usage rate;
- Queuing, connection, service and end-to-end latency at each hop;
- Timeout, cancellation, current limit, Breaker open and Fallback ratio;
- Concurrency, queues and rejections for each Bulkhead;
- Freshness and business impact of downgrade response;
- Depends on the detection success rate and traffic recovery speed after recovery.

Verification cannot rely solely on unit tests. Slow response, connection failure, partial instance failure and overload should be injected to ensure that deadlines can be propagated, cancellations can take effect, resource pools will not drag each other down, and key services remain unchanged during downgrades.

## Applicable conditions and counterexamples

Suitable for online reading and writing, inter-service calls that require immediate confirmation. For actions such as email sending, thumbnail generation, and offline analysis that do not require blocking the user, asynchronous links are usually more suitable.

Common counterexamples include: all layers retry three times by default; connections and reads share a very large Timeout; all dependencies share a thread pool; Breaker only looks at the error rate but not slow calls; the cache can be downgraded by default if it exists; and downstream continues expensive calculations after the caller cancels.

## Interview Checklist

1. What is the end-to-end deadline, and how is it allocated and delivered to each hop?
2. Which layer has a retry policy, and why can operations be retried safely?
3. What is the worst-case retry amplification and how to limit the Retry Budget?
4. Which dependency requires independent Bulkhead, and what is protected when rejected?
5. How old is the data in Fallback? Will it destroy business invariants?
6. After the write request times out, how to determine whether side effects have occurred?
7. How to detect and gradually reflow after dependency recovery?
