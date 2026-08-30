# Request processing and security policy

## What steps does the request go through?

It is recommended to order cheaper and more conclusive tests first, and more expensive treatments last:

1. Accept the connection and complete TLS.
2. Limit URL, Header and Body sizes, and reject malformed requests.
3. Generate or verify the Request ID and receive the standard Trace Context.
4. Match Host, Path, Method and API version.
5. Verify the identity and obtain the user, application or service subject.
6. Perform tenant, scope, or coarse-grained permission checks.
7. Enforce Rate Limiting, quotas, and concurrency limits.
8. Select a backend, set timeout and forward requests.
9. Record structured access logs and indicators, and return unified errors.

Unknown routes should return `404` as early as possible, Method is not allowed to return `405`, requests that are too large return `413`, and Rate Limiting returns `429`. Do not forward these requests to business services.

## Authentication and Authorization

### JWT

The Gateway can cache the Identity Provider's public key and locally verify the signature, Issuer, Audience, and expiration time. In this way, normal requests do not need to call the authentication service synchronously.

### Opaque Token

If the token must be introspected remotely, short TTL caching, strict timeouts, and circuit breakers should be used. When the authentication service fails, sensitive write APIs are usually fail-closed, and public read APIs can take independent anonymous routes.

### The client cannot trust the identity header

The Gateway must delete the internal identity headers such as `X-User-Id` and `X-Tenant-Id` passed in by the client, and then write its own verified value. Internal links can also use mTLS or signatures to prevent callers from forging their identities.

Gateway is suitable for coarse-grained authorization, such as "Does this Token have `posts:write` Scope?" "Whether the user owns this order" depends on business data and should be judged by the Order Service.

## Current limit and quota

Common dimensions include:

- IP: Protect the anonymous interface, but consider the IP shared by multiple people under NAT;
- User: limit a single user;
- API Key/Client: restrict partner applications;
- Tenant: ensure multi-tenant fairness;
- Route: protect a single expensive interface;
- Global: Protect the entire system.

The local token bucket has low latency, but can only approximate the global quota; centralized counting is more accurate, but increases network dependencies and hot spots. The complete algorithm and storage design are placed in [Rate Limiter](../04-rate-limiter/README.md).

## Request rewrite policy

It is safe to join or normalize:

- Request ID and Trace Context;
- Verified caller identity;
- Trusted chain of client IP;
- Unified overtime budget;
- Internal header required for routing to backend.

Complex JSON business conversion should not be done within Gateway. The more complex the protocol conversion, the greater the CPU consumption, release coupling, and failure surface.

## Security boundaries in logs

Do not record passwords, complete tokens, bank card numbers, uploaded file text, or sensitive query parameters in access logs. Document hashes, truncation values, field existences, and business-generated security IDs when troubleshooting is required.
