# Design Serverless / Developer Platform

## Case positioning

This case designs an application platform from source code or artifact to accessible Revision. It forms Build, Deploy, Runtime, Routing, Autoscaling, Observability and Metering into a closed loop for developers, covering the common platform issues of Functions and containerized applications.

The focus is not on implementing a certain language framework, nor on designing just a function scheduler, but on clarifying the delivery chain, runtime isolation, and version traffic contracts.

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Build → Deploy → Isolated Runtime → Versioned Traffic |
| Core Invariants | A Deployment is bound to immutable Artifact/Config; traffic only enters Ready Revision; Rollback restores known versions; codes, Secrets and metering of different Tenants are isolated from each other |
| Design Drivers | Developer Experience、Deployment Safety、Elasticity、Cold-start Latency、Isolation、Cost |
| Traffic / Data Shape | Burst requests, long-tail applications, a large number of low-frequency Revision, Build Burst, log stream, Scale-to-zero |
| Failure strategy | Build/Deploy asynchronously fails explicitly; the old version is retained when the new Revision is not Ready; runtime overload is handled according to the Queue/Shed/Fallback contract |
| Security Boundary | Untrusted Code, Supply Chain, Artifact, Secret, Network Egress, Tenant / Project, Build and Runtime Identity |

## Core Object Model

Future expansion tense defines at least:

- `Project / Application`: Tenants, permissions, quotas, environments and billing boundaries.
- `Build`: Source code reference, Builder, dependencies, status, Provenance and logs.
- `Artifact`: Immutable digest, signature, SBOM, scan results and retention policy.
- `Deployment`: Target environment, Artifact, Config/Secret Version and desired release strategy.
- `Revision`: immutable run version, resource configuration, health, capacity and runtime identity at once.
- `Route`: Domain, Path, Traffic Split, Revision, Retry / Timeout and TLS.
- `Invocation`: Request ID, Deadline, Revision, execution results, resource usage and metering records.

## Must answer life cycle

### Build Plane

- How does source code or artifacts enter the platform; how do Build Queues, caching, concurrency, fairness, and cancellation work?
- How does the build environment isolate untrusted scripts, restrict networks and secrets, and generate verifiable Provenance/SBOM?
- When Build fails, times out, or is triggered repeatedly, are the status and artifacts reproducible and auditable?

### Deploy / Control Plane

- How is Deployment parsed into Revision; when will Artifact, Config, Secret and Runtime versions be solidified?
- How are Rolling, Canary, Blue/Green and percentage traffic expressed; which signal triggers Promote or Rollback?
- How to prevent traffic from entering unready instances between Route update and Revision Ready?

### Runtime / Data Plane

- Sandbox choose Process, Container, MicroVM or other isolation; what are the startup, reuse and destruction boundaries?
- What are the Deadline, Concurrency, Queue, Cancellation, Retry and Streaming contracts of Invocation?
- How is Cold Start decomposed into Placement, Sandbox, Image/Artifact Load, Runtime Init and User Init?
- How do scale-to-zero, warm pools, min instances, max concurrency, and burst capacity weigh cost versus latency?

## Version traffic, downgrade and rollback

- Traffic Split changes must be versioned, atomically visible and rollable; clarify how Sticky Session and long connections are handled.
- Passing the new Revision health check does not mean that the business is correct. Error Rate, Latency, Saturation and custom indicators Guardrail should be defined.
- When the Control Plane fails, whether the existing Route and Revision will continue to serve; how the Data Plane uses Last-known-good Config.
- Clarify the order of Queue, Load Shed, 429 / 503, old Revision Fallback or regional Failover when the Runtime capacity is insufficient.
- Rollback should restore Artifact, Config, Secret references and Route, rather than just changing the code version back.

## Multi-tenancy, security and governance

- What Principals are used for Project, Application, Build, Revision and Invocation respectively? When and how are Secrets injected?
- Limit CPU, Memory, Duration, Concurrency, Build Minute, Artifact Storage, Log Volume and Network Egress.
- Handles Sandbox Escape, dependency poisoning, malicious builds, Crypto Mining, SSRF, sensitive logs and cross-tenant Side Channel.
- Define outbound network, private network access, Domain/Certificate, data residency and deletion propagation contracts.

## Logs, Metrics and Measurements

The platform must associate Build ID, Deployment ID, Revision ID, Route Version, Invocation ID and Tenant ID. Expose at least Build Queue / Duration, Deploy Progress, Revision Readiness, Cold-start Rate / Breakdown, Invocation Latency / Error, Queue Delay, Throttle, Scale Decision, Resource Usage, Log Drop and Metering Lag.

Measurement records must describe authoritative submission points, deduplication, late events, price versions, and reconciliations. Easily lost running logs cannot be directly regarded as billing facts.

## Faults and acceptance that must be covered

- Whether the Artifact obtained by repeatedly building the same source code is reproducible; how to locate dependencies or environment drift when it is not reproducible.
- Deployment can be restored to a clear state after any step of creating Revision or switching Route crashes.
- When the new Revision fails to start or the indicators deteriorate, the old Revision remains serviceable and can be rolled back automatically/manually.
- When burst traffic is expanded from zero, explain the queuing upper limit, Cold-start SLO, drop policy and cost protection.
- A single Tenant's Build, Log or Invocation spike will not bring down other Tenants.
- Secret Rotation, Certificate Renewal, Artifact Deletion, and Project Deletion can propagate and leave audit evidence.
- How to downgrade and recover running services, debugging capabilities, and accounting respectively when logs or Metering Pipeline are backlogged.

## Differences from adjacent platform cases

- [Declarative Resource Control Platform](../02-declarative-control-platform/) provides a universal Resource / Controller / Placement contract; this case hides underlying resources for application developers and provides a closed loop from source code to traffic.
- [Multi-tenant Data Platform](../01-multi-tenant-data-platform/) focuses on data assets, Capacity and multiple data Workloads; this case focuses on Artifact, Revision, Route and Invocation.

## Review Question

- "Deployment successful" means that the Artifact has been saved, the Revision has been created, it is Ready, or it has received and passed real traffic?
- What costs are saved with Scale-to-zero, and what latency and capacity risks are transferred to the first requests?
- Why should existing applications continue to serve when the Control Plane is unavailable; what changes must be stopped?
- How to prove which code, configuration, Secret and Route Version are used for an Invocation?
- When the runtime log is lost, why can't it be directly inferred that the Invocation did not occur or does not need to be billed?
