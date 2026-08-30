# Platform system

A platform system does not only complete one user scenario, nor does it only provide one basic component. They uniformly carry multiple types of resources, workloads, developers and end users, and provide scalable platform contracts upwards.

## Differences from the other two types of cases

| Classification | Main Questions | Examples |
|---|---|---|
| Universal basic system | How to design a basic capability into a reliable service? | Cache, Scheduler, Object Storage |
| Specific application system | How to complete an end-to-end business closed loop? | News Feed, Booking, Video Streaming |
| Platform system | How to make multiple workloads run on a unified control plane and resource model? | Microsoft Fabric, Kubernetes, Snowflake-like platforms |

## Current case

| Case | Core object of unified hosting | Main in-depth points |
|---|---|---|
| [Multi-tenant data platform](01-multi-tenant-data-platform/) | Tenant, Capacity, Workspace, Item, Workload, Shared Data Storage | User isolation, unified Item model, multiple Workloads, computing units and data pipelines |
| [Declarative Resource Control Platform](02-declarative-control-platform/) | Resource, Spec, Status, Controller, Node, Workload | Desired / Observed State, Watch, Reconciliation, Admission, Placement, Extended Resource Contract |
| [Serverless / Developer Platform](03-serverless-developer-platform/) | Project, Application, Build, Artifact, Deployment, Revision, Route, Invocation | Build / Deploy / Runtime, version traffic, Rollback, Sandbox, Cold Start, Scale-to-zero, metering |

The three cases cover data assets and computing capacity, declarative resource convergence, application delivery and runtime respectively. They can share control planes, scheduling, quotas, and multi-tenancy mechanisms, but have different primary platform contracts for training:

| Platform type | What users submit | What the platform promises | Core feedback loop |
|---|---|---|---|
| Multi-tenant data platform | Data assets, queries or data Workloads | Store, process and govern data under unified Tenant / Workspace / Capacity | Operation / Job and data state convergence |
| Declarative resource control platform | Resource Spec (desired state) | Continuously converge the Observed State to the Desired State | Watch → Reconcile → Status |
| Serverless / Developer Platform | Source code or Artifact, deployment and routing configuration | Build, publish, run, scale up and down, and route traffic to Revision | Build / Deploy / Runtime and Traffic Rollout |

## Additional questions that platform systems must answer

- What is the platform core resource model and immutable identity?
- Which capabilities belong to the shared control plane, computing plane and data plane?
- How can new workloads or resource types be accessed without modifying all core platform services?
- What is the explosion radius when a Workload, Tenant or Capacity is overloaded?
- Who is responsible for resources, permissions, data, running status and metering?
- How to version, grayscale and rollback platform contracts?
- How can the platform itself be divided into cells, recover across regions, and avoid global single points?
- What SLOs are promised for the Metadata API, interactive queries, and background jobs respectively, rather than giving a general availability number for the entire platform?
- How to use observable indicators to prove that Noisy Neighbor is isolated, Quota is implemented and the measurement results are traceable?

## Minimum contract for platform cases

In addition to following the [Unified Specifications] (../00-Case Writing and Acceptance Specifications.md), the platform chapter must also treat cross-domain protocols as first-class design objects:

- Designate a unique authoritative writer for each type of resource, and other domains can only propose changes through commands, APIs or events;
- Establish a unified event directory, fix event names, Schema, Partition Key, idempotent keys, versions and compatibility strategies;
- Separate Desired State, Observed State, Operation State and business data, and explain their respective convergence conditions;
- All asynchronous operations clearly indicate the status of Accepted, Running, Succeeded, Failed, Canceled, Timed-out, etc. and the final state submission point;
- Calls on the control plane, computing plane and data plane are routed and isolated using Tenant, Cell, Resource Version/Epoch and Principal Context;
- Cross-domain success cannot rely on double writing without a recovery solution, and Outbox, CAS, Workflow, Reconciliation or other closed-loop mechanisms must be provided;
- Platform contract upgrades to account for N/N-1 compatibility, canary, Schema Migration, Drain, Rollback and legacy client behavior.

Each cross-domain arrow in the platform diagram should be able to map to a contract and answer the question of how to converge when failures, duplications, out-of-order or inconsistent versions occur.
