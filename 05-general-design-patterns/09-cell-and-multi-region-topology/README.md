# Cell and Multi-region Topology

Cell uses multiple mutually isolated complete Service Units to limit Blast Radius; Multi-region Topology uses different Regions to undertake low latency, Data Residency and Disaster Recovery. The two can be combined, but they are not the same problem: a system can have multiple Cells in a single Region, or it can be deployed across Regions but still share a huge Failure Domain.

This article only talks about how to combine routing, state attribution, isolation, switching and recovery. For the principles of replication, consistency and network partitioning, see [CAP and Consistency Model] (../../02-Core Concepts/03-CAP and Consistency Model/), and for RPO/RTO and disaster recovery concepts, see [Fault Tolerance, Downgrade and Disaster Recovery] (../../02-Core Concepts/07-Fault Tolerance, Downgrade and Disaster Recovery/).

## Problems to be solved and invariants

Design goals typically include:

- A Cell failure only affects a part of the Tenants or users it hosts;
- Requests can reach the Cell/Region with data and capacity based on stable attribution;
- When the Region is disconnected, there are clear business rules for allowed operations and rejected operations;
- Switching will not cause two write owners to appear at the same time;
- Data residency, security, and tenant boundaries persist during migrations and failures;
- After recovery, it can verify that the data, routing and capacity are consistent, and then gradually flow back.

The core of Cell is not to replicate more Service Instances, but to reduce synchronization dependencies across Cells. If all Cells rely on the same Database, Cache or Control Service to handle requests, the actual Blast Radius is still global.

## Start with a simple topology

| Stages | Topology | Clear upgrade signals |
|---|---|---|
| Early stage | Single Region, one deployment unit | A single failure affects all users, or regional requirements must be met |
| Isolation in the same Region | Multiple Cells, Tenant/user fixed ownership | Single Cell Capacity and Blast Radius need to be controlled |
| Disaster recovery | Primary Region + Standby Region | The business has a clear RTO/RPO and the risk of a single Region is unacceptable |
| Global Read | Read-local / Write-home | Users are widely distributed and read latency is the main problem |
| Multiple writes | Active-Active | Continue to accept writes when the business really needs Region isolation, and can define conflict semantics |

Active-Active is usually the last step, not the default starting point. If the business cannot explain how to merge simultaneous updates of the same object in two Regions, then the multi-write topology has not been defined.

## Participating components and state owners

| Components | What is responsible for | Key data |
|---|---|---|
| Global Router | Region selection based on location, health, and resource ownership | Region health and routing rules |
| Cell Directory | Query Tenant/User's current affiliation | Home Region, Cell ID, Routing Epoch |
| Cell Router | Send requests to services within this Cell | Cell routing and capacity status |
| Cell | Independently hosts computing, caching, asynchronous processing and data access | Business status and resources within Cell |
| Control Plane | Create, migrate, configure, and retire attributions | Desired state, migration state, and auditing |
| Replication / Transfer Path | Send data that is allowed to be copied or migrated to the target location | Replication location, version, backlog |
| Failover Controller | Perform switchover by controlled state machine | Failover evidence, Fencing Epoch, switchover phase |

The control plane can be managed centrally, but the data plane should not depend on the control plane synchronously on every request. Directory results should be cacheable and carry versions or epochs; when the control plane is temporarily unavailable, existing Cells should still be configured to serve the last known security configuration.

## Cell’s Data Contract

At least you must be able to answer who owns the following fields or equivalent information:

- Tenant / user’s Home Region;
- Current Cell ID;
- Routing Epoch or Assignment Version;
- Data residency and allowed migration destinations;
- the current writing owner;
- Migration, failover or normal state;
- Whether the target Cell has sufficient capacity and required version capabilities.

The request carries the Tenant Context, and the routing layer obtains the ownership based on the Directory; the Cell still needs to verify the Tenant in the authorization and data access layers, and network routing cannot be regarded as an isolation boundary. For multi-tenant data layout, see [Multi-tenant data layout](../../03-data-and-storage/08-multi-tenant-data-layout/).

## Happy Request Path

Take Tenant fixed to a Home Cell as an example:

1. Global Router selects the Region to which the Tenant belongs, instead of only selecting the region closest to the network;
2. Cell Directory returns Cell ID and Routing Epoch;
3. Cell Router sends the request to the Cell;
4. Cell completes authentication, business processing and local data access internally;
5. If the request reaches the old Cell, the old Cell refuses to write or returns a verifiable redirection based on the Epoch;
6. Background copy, backup, and fork processing do not change the current write owner.

Successful routing only means that the target Cell has been found; business success is still determined by the submission boundary of authoritative data in the Cell.

## Three common Multi-region Topologies

| Topology | Write Location | Advantages | Major Costs |
|---|---|---|---|
| Active-Passive | Normally only writes in the primary Region | Ownership and conflicts are clearest | Switching is interrupted, and spare capacity and data may fall behind |
| Read-local / Write-home | Nearby read, fixed Home Region write | Global read latency is low | Read may be stale, cross-region write latency still exists |
| Active-Active | Multiple Regions accept writes | Regions can continue partial writes when isolated | Conflicts, global constraints and recovery merge are the most complex |

Systems can be mixed by business object. For example, public content is allowed to be read from multiple locations, account security settings always write back to the Home Region; like counts allow final aggregation, and balance deductions only allow a single write owner. Topologies should be selected by operation rather than giving an Active-Active label to the entire system.

## What is allowed during Region Partition?

When network partitions occur, designers must decide on a class-by-class basis:

| Operations | Possible strategies | Risks that need to be explained |
|---|---|---|
| Public content read | Return local copy or cache | Data is at most old |
| Personalized feed | Return existing list and omit new results | Sorting and completeness degraded |
| New post creation | Only accepted in Home Region, or staged in quarantine queue | Repeat, order and user confirmation semantics |
| Permission changes | Usually return to Home Region or Fail-closed | Old permissions lead to risk of unauthorized access |
| Inventory/Balance Deductions | Typically maintained with single write owner | Double write resulting in oversold or negative balance |
| Telemetry events | Local buffering and post-transmission | Buffer capacity and loss window |

"Available priority" must be implemented in specific operations. The reason for allowing stale reads cannot be extended to authorization or funds writes.

## Failover is a controlled state machine

Safe switching typically involves:

1. Use multi-source signals to confirm faults to avoid misjudgment by a single probe;
2. Stop or Fencing the old write owner;
3. Confirm the data location and acceptable loss window of the target Region;
4. Promote the new write owner and add Routing Epoch;
5. Update Directory and Global Router;
6. First release a small amount of traffic to verify the error rate, delay and business invariants;
7. Gradually expand the flow and record the scope that requires subsequent reconciliation.

Fencing is key: when the old Region is restored or Network Flapping occurs, writes carrying old Epochs must be rejected. Simply modifying the DNS does not prevent the old instance from continuing to write to the database. Fencing refers to using Epoch/Token to deny old owners who have lost write permissions.

Automatic failover isn't always better. If mistaken switching is more dangerous than temporary unavailability, or if the degree of backwardness of the target data cannot be automatically determined, manual confirmation or semi-automatic processes can be used.

## Tenant / Cell Migration

Normal migration is different from failover, but versioned routing can be reused:

1. Reserve capacity for the target Cell and check data residency;
2. Copy Baseline Data, and at the same time catch up incremental changes to the declared version/offset;
3. Compare the records, versions and business invariants of the source and target;
4. Temporarily freeze writing or establish a single forwarding point;
5. Improve the Assignment Version and route new requests to the target;
6. Observe and allow rollback within a limited time;
7. Clean the source copy after confirming that the old route has expired.

Client, cache, and asynchronous messages may carry old cell information. The target Cell should verify the version, and the old Cell should reject old Epoch writes or secure forwarding, and cannot rely on all caches to expire at the same time.

## Cross-Cell dependencies and global functions

Prioritize requests to access only one Cell. When global capabilities are really needed, first distinguish:

- **Request external control plane**: tenant creation, cell allocation, configuration release, can tolerate short-term unavailability;
- **Cacheable reference data**: function switches, public directories, and versioned copies can be saved in Cell;
- **Global Strong Constraints**: Unique user names and global quotas may become synchronization bottlenecks. You should reconfirm whether global real-time strong consistency is really needed;
- **Asynchronous Aggregation**: Global search, analysis, usage, can aggregate and accept freshness contracts from each Cell.

Synchronous calls across cells will propagate the failure of one cell to other cells, and will also make the "independent cell" exist in name only.

## Capacity Headroom and Blast Radius

It is impossible to take over a failed cell when each cell is full; however, it is very expensive to reserve a full double capacity for each cell. Need to be clear:

- How much load should be taken over when a single Cell, Availability Zone or entire Region fails;
- Is the spare capacity permanent, preemptible, or obtained through rapid expansion;
- Which tenants and requests are prioritized in case of failure;
- Can non-critical workers, backfill and analysis tasks be temporarily shut down to free up capacity;
- Whether the large tenant will occupy the Cell exclusively or split it into a dedicated isolation unit.

Fault drills must be verified with the actual available quotas, connections, Cache Pre-warming, and database capacity of the target Region, and cannot be inferred based on the Autoscaling configuration alone.

## Failure, Recovery and Validation

| Failure | Possible manifestations | Recovery highlights |
|---|---|---|
| Single Cell overload | The Cell's tail delay and rejection increase | Limit to this Cell, gradual reflow after migration or expansion |
| Directory is unavailable | New ownership cannot be queried | Use versioned cache to stop dangerous ownership changes |
| Router holds old ownership | Request reaches old Cell | Epoch verification, rejection or safe redirection |
| Region isolation | Cross-region replication and Home write failure | Execute allow/deny rules by operation |
| Primary Region failure | Some or all writes interrupted | Fencing, promoting new owner, updating routing |
| Old Region recovery | May receive traffic again or retain forked data | Maintain isolation, reconcile accounts first and then decide to resynchronize or discard old branches |
| Global control plane failure | Creation, migration, and configuration changes blocked | Existing cells continue data plane services |
| Insufficient spare capacity | Second overload after Failover | Priority downgrade, Load Shedding, reserved capacity verification |

Recovery completion must also verify that: routing only points to the current Epoch, there is only one write owner, the target data meets the business RPO, there are no conflicts in key invariants, the asynchronous backlog is controllable, and user traffic does not overwhelm the newly restored system.

## Observation and Exercise

Observe at least by Region, Cell, Tenant, and Operation Type: Request Volume, Error Rate, Tail Latency, Rejections, Capacity Utilization, Replication Backlog, Route Version Mismatch, and Data Reconciliation Differences.

The drill should cover Cell overload, Directory unavailability, Region network isolation, incorrect routing, old Region resurrection, and insufficient spare capacity. Each exercise should measure the real failover time, possible data loss, degradation scope and failback steps, rather than just proving that DNS can be changed.

## Applicable conditions and counterexamples

Cell is suitable for platforms that have a large user base and require limited Blast Radius and Tenant Assignment stability. If a single Region can meet the goal of a small system, it is easier to use Availability Zone Redundancy and Clear Recovery Process first.

Common counter-examples include: all Cells share a database; each request synchronously queries the global control plane; only routes based on geographical proximity but ignores data ownership; switching only changes DNS without fencing; Active-Active does not have conflict semantics; and there is no real spare capacity for fault drills.

## Interview Checklist

1. What computing, storage and asynchronous resources does Cell really isolate?
2. Where do the Tenant/user’s Home Region, Cell ID and Routing Epoch exist?
3. When a Region is isolated, which operations are continued, downgraded, or rejected, and why?
4. How to ensure that there is only one write owner during switchover?
5. Can the spare capacity handle the target failure scenario, and what should be reserved first?
6. How to deal with old routes, old messages and old Regions after they are restored?
7. How to verify that routing, data, invariants and backlog have been restored before reflow?
