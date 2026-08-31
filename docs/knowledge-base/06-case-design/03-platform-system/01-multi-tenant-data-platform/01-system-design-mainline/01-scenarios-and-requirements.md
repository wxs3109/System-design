# Scenarios and requirements

## 1. What platform is this?

Let's say a company offers a multi-tenant data analytics SaaS. Enterprise customers can:

- Create a team workspace;
- Access databases, files and event streams;
- Save original data and processed tables;
- Create Pipeline or Notebook to process data;
- Use SQL queries;
- Create Semantic Model and Report;
- Run tasks regularly;
- View the computing resources consumed by each team.

This type of platform can be compared to Microsoft Fabric, but the design goal is an abstract model, not a copy of Fabric.

## 2. A representative user story

A retail company wants to do sales analysis:

1. The administrator creates Tenant for the company and purchases Capacity.
2. The data team creates `Sales Analytics` Workspace.
3. Engineers create a Data Pipeline to ingest order data into Data Store Item.
4. Notebook or SQL Job cleans the data and generates a sales table.
5. The analyst creates a Semantic Model.
6. BI Workload generates a report based on the model.
7. The user opens the Report and performs an interactive query.
8. The computing consumption of all Job and Query is included in this Capacity.

This link is enough to bring out the most critical objects and issues of the platform.

## 3. Basic version functions

### Management class

- Create Tenant, Capacity and Workspace.
- Assign Workspace roles to users.
- Create, read, modify, share and delete Items.

### Data class

- Save files and tables.
- Pipelines ingest and transform data, representing long-term background workloads.
- SQL/Notebook Job processes data and represents a retryable batch computing Workload.
- Interactive Query / Report reads the results and represents the low-latency Workload that the user is waiting for.
- Semantic Model exists as Item type and query input, and the basic version does not delve into its internal calculation engine.

### Calculation class

- Submit interactive Query or background Job.
- Run, queue or reject based on Capacity.
- Record the Compute Units consumed by each operation.

## 4. Target scale, not first step implementation

This is a platform that serves a large number of enterprise users. The final design goals are assumed to be:

| Indicators | Design values ​​|
|---|---:|
| Tenant | 100,000 |
| Daily active users | 10,000,000 |
| Workspace | 10,000,000 |
| Item | 1,000,000,000 |
| Peak metadata reads | 500,000 QPS |
| Jobs/Queries running simultaneously | Millions |
| Total amount of data | EB level |

These numbers will affect the final architecture, but the explanation cannot jump directly to sharding and multiple regions. Use two levels of expression:

### Logical model is established from day one

- Each request comes with Tenant context;
- Item definitions and business data are stored separately;
- Background tasks go through the persistent queue;
- Capacity is an independent resource boundary;
- Failure of one Workload should not disrupt the control plane of other Workloads.

### Physical deployment is expanded step by step according to bottlenecks

- Services and databases are horizontally sharded by Tenant/Workspace;
- Big data does not pass through ordinary API Server;
- One Tenant or Capacity overload cannot bring down other clients.
- Use Cell to limit the blast radius of glitches and releases;
- Design cross-Region RPO/RTO based on data level.

The first step is to implement logical boundaries in a Cell; as QPS, Items, and Jobs grow, sharding, dedicated resource pools, more Cells, and disaster recovery Regions will be introduced. For the detailed sequence, see [Evolution Route and Current Boundary](./12-evolution-route-and-current-boundary.md).

These numbers are system design assumptions only and are not publicly available true scale for any specific product.

## 5. Non-functional requirements (design assumptions)

Different paths cannot share a general "platform availability" goal:

| path/property | target |
|---|---|
| Metadata Read | Normal load P99 < 100 ms, monthly availability 99.99% |
| Metadata Write | Normal load P99 < 300 ms; cross-AZ failure will not be lost after successful response |
| Interactive Admission | 99% decided to run, queue or reject within 200 ms |
| Interactive Query | Execution time is determined by Workload; must support Deadline, Cancel and explicit Partial / Failed status |
| Background Job | Accepted Operation is not lost silently; Attempt can be retried At-least-once, and only valid Fencing Token can submit output |
| Fairness | When a single Tenant/Capacity exceeds the quota, it will only queue or limit itself, and the new Tenant can still obtain the reserved Admission Capacity |
| Privilege propagation | Privilege revocation blocks new control and data plane access within 60 seconds; high-risk Secret revocation should be faster and Fail-closed |
| Cell isolation | A single Cell failure must not affect the Metadata and new Operation Admission of other Cells |
| Metadata Recovery | RPO < 1 minute, RTO < 30 minutes |
| Definition Recovery | RPO < 5 minutes, RTO < 1 hour |
| Derived Index | Allows rebuilds; access to Metadata by ID is still available in case of failure |
| Observability | Record success rate, P99, Queue Delay, Throttle and resource consumption by Tenant, Capacity, Workload and Cell |

These are hypothetical values ​​used to derive isolation, storage, and scheduling scenarios and do not represent public SLAs for Microsoft Fabric or other products.

## 6. Not doing it for now

- Study the internal engine of each Workload;
- Multiple writers across Regions;
- Third-party plug-in market and commercial settlement;
- AI Copilot and advanced data governance;
- Internal implementation of Power BI, Spark or SQL engines;
- Specific cloud vendor SKUs and prices.
