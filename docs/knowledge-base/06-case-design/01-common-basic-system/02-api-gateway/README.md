# Design API Gateway

API Gateway is a unified entrance for business APIs. It implements common cross-business policies, such as authentication, authorization, Rate Limiting, routing, timeout, and auditing, before requests enter specific services.

It's not the way to go for all byte streams. Video playback, map tiles, static files, and large file uploads typically use a dedicated data path from a CDN or Object Storage.

## Functional boundaries of this case

- Receive API requests such as HTTP, REST, gRPC, etc.
- Select backend based on Host, Path, Method, Header or API version.
- Implement authentication, authorization, Rate Limiting, request size limitation and basic security policies.
- Unified propagation of Request ID, Trace Context and caller identity.
- Manage timeouts, limited retries, circuit breakers, grayscale routing and error mapping.
- Dynamically publish routes and policies, supporting grayscale, rollback and multi-availability zone operation.

This case does not put business logic such as pricing, order status or feed sorting into the Gateway.

## Non-functional requirements (design assumptions)

- A single Region peaks at 500,000 Request/s; the data plane is stateless and horizontally expanded across AZs.
- The new delay for normal API forwarding is P99 < 10 ms, and the monthly data availability target is 99.99%.
- Routing and policy changes propagate within 30 seconds; misconfigurations can be globally rolled back within 5 minutes.
- When the control plane is unavailable, the data plane runs with the last valid configuration for at least 24 hours.
- Fail-closed when the identity cannot be verified; whether the non-security-critical current-limited storage failure is Fail-open must be specified by Route.

## Reading order

1. [Responsibility boundaries and entry links](01-responsibility-boundaries-and-entry-links.md)
2. [Control plane and data plane](02-control-plane-and-data-plane.md)
3. [Request processing and security policy](03-request-processing-and-security-policy.md)
4. [Timeout retry and fault degradation](04-timeout-retry-and-fault-degradation.md)
5. [Long connections, large files and Direct Data Path](05-long-connections-large-files-and-direct-data-path.md)
6. [Capacity High Availability and Observability](06-capacity-high-availability-and-observability.md)

When accessing a specific application, use [Application Portal Design Checklist](../../02-specific-application-system/00-application-specific-entry-design-checklist.md) to record only the special strategy of the application and not to repeat the design of the entire Gateway.

## Make clear conclusions first during the interview

- Load Balancer mainly selects healthy instances; API Gateway mainly implements API semantics and policies.
- The data plane of the Gateway must be stateless for horizontal expansion, and the request path cannot be synchronously dependent on the control plane.
- Authentication information can be verified locally; shared status such as quotas only access external storage when necessary.
- Retry is not enabled by default, especially non-idempotent write requests such as payment and lock socket cannot be retried at will.
- Large traffic uses Direct Data Path, and Gateway is only responsible for authorizing and issuing short-term access credentials.

## Core question

- How to prevent all services from becoming unavailable when the Gateway itself fails or is overloaded?
- After the control plane hangs up, how long can the already running data plane still work?
- When there is an error in the new configuration, how can it only affect a small number of instances and roll back quickly?
- When the authentication service or current-limited storage is unavailable, should it fail-open or fail-closed?
- Why do multiple layers of retries amplify a glitch into a traffic storm?
