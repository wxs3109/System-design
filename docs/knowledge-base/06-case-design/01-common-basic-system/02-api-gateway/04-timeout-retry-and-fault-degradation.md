# Timeout retry and fault degradation

The Gateway is located at the shared entrance, and incorrect retry and timeout settings can expand a small service failure into a site-wide failure.

## Timeout budget

The outer timeout must be greater than the inner timeout to allow time for error returns and network fluctuations. For example:

| Hierarchy | Example timeout |
|---|---:|
| Client | 3,000 ms |
| API Gateway | 2,500 ms |
| Backend Service | 2,000 ms |
| Database | 1,500 ms |

Gateway should not just set a global timeout. The reasonable budgets for query interfaces, lock sockets, export tasks and long polling are different and should be configured according to routes and set upper limits. Long tasks should instead be submitted asynchronously and return the task ID.

## When can you try again?

Gateway should only retry if the following conditions are simultaneously true:

- The request is idempotent, or carries an Idempotency Key that is truly supported by the backend;
- The failure occurs at a clearly retryable stage, such as a connection failure or the backend has not yet received the request;
- The total overtime budget is still sufficient;
- The number of retries is small and Jitter is used;
- Does not span incompatible backend versions.

`GET` can usually be retried on a limited basis. Write requests such as payment, locking, and sending messages are not automatically retried by Gateway by default; even if there is an Idempotency Key, the deduplication semantics of the backend must be confirmed.

## Retry zooming in

If Client, Gateway and Service each try at most 3 times, in the worst case a user request may generate:

$$
3 \times 3 \times 3 = 27
$$

downstream calls. The service is already overloaded and additional requests will extend recovery time. Therefore, a unique retry layer should be specified and a full-link Retry Budget should be set.

## Overload protection sequence

1. Set the maximum number of connections and concurrent requests per instance.
2. The queue will be rejected immediately after reaching the short upper limit, and unbounded queuing will not be performed.
3. Prioritize key traffic such as health check, login, and payment callback.
4. Return `429` or `503` for expensive or non-critical interfaces, and give a reasonable `Retry-After`.
5. Circuit Breaker (circuit breaker) The backend that continues to fail will be restored periodically with a small number of probe requests.

When a Gateway overloads itself, the sooner you reject it, the better. Requests that are queued for a few seconds and then fail only consume the connection and memory.

## Choices when dependencies fail

| Dependencies | Common Strategies | Reasons |
|---|---|---|
| Routing configuration control plane | Using the last stable snapshot | Old routing is usually better than a site-wide outage |
| Authentication public key source | Use local public key cache that has not expired | Normal JWT validation does not rely on remote calls |
| Authentication services for sensitive APIs | Fail-closed | Availability cannot be exchanged for unauthorized access |
| Global throttling storage for non-critical APIs | Downgrade to more conservative local throttling | Maintain protection capabilities, but acknowledge approximate counts |
| Log backend | Asynchronous buffering and limited discarding of common access logs | Logs cannot be allowed to block user requests |
| Target business services | Circuit Breaker, fail-fast, or read-only degradation | Avoid filling up Gateway resources |

Fail-open or fail-closed must be determined based on specific policies and API risks, and a unified answer cannot be set for the entire Gateway.
