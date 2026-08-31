# Evolution route and current boundary

The platform should not pretend to have exabytes of data and millions of concurrencies from day one. The correct way to put it is to let the link be established first, and then let each evolution only solve a new bottleneck.

## Level 1: Single cluster runthrough

```text
a Region
A Metadata DB
a persistent queue
Multiple Workload Worker Pools
A Shared Data Storage
```

Already have logical boundaries of Tenant, Workspace, Item, Operation and Capacity, but share the physical infrastructure for the time being. The focus is on correct object relationships, permissions and complete running links.

Bottlenecks: Metadata DB, queues, and shared Worker Pools can become hotspots; large tenants can impact other tenants.

## Level 2: Isolation by Tenant and Capacity

- Metadata is sharded by `(tenant_id, workspace_id)`.
- The queue is partitioned by `capacity_id + workload + priority`.
- Limit API QPS per Tenant, limit CU and concurrency per Capacity.
- Very large Tenants can be moved into independent Metadata Shard or Worker Pool.

Solution: Scaling and noisy neighbor.

Not yet resolved: A Region failure will still affect all tenants.

## Level 3: Cellization

A Cell contains a relatively independent set of:

```text
API / Metadata Shards / Operation Queues / Capacity Manager / Worker Pools
```

Tenant is assigned to a certain Cell, and the global directory is only responsible for `tenant_id -> cell_id` routing. A single cell failure will not bring down the entire platform, and new versions can also be grayscaled by cells.

Addressed: Explosion radius, independent scaling, and release risks.

## Level 4: Cross-Region Recovery

- Tenant has Home Region.
- Metadata and Definition are copied asynchronously to the disaster recovery Region.
- Shared Data Storage replicates data levels.
- Operation Queue is not blindly active and active; retryable tasks are rebuilt based on the persistent state during failover.
- Clarify RPO and RTO for different resources.

Solution: Region-level disaster recovery.

At this point, there is still no need to adopt cross-region multi-master writing by default, because Item editing conflicts, Capacity metering, and Operation deduplication will all be significantly complicated.

## Contracts that remain the same at every level

The bottom layer has evolved from a single library to Cell, and users still see the same set of core objects:

```text
Tenant -> Workspace -> Item -> Operation
Tenant -> Capacity -----------^
Workload ---------------------^
```

This is the value of the abstract object model: deployment topologies can evolve, and platform APIs and user minds don't need to be reinvented.
