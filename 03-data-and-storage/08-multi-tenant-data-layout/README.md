# Multi-tenant Data Layout

The key to a multi-tenant system is not to "add an extra column to the table", but to allow each piece of data to answer: **Which tenant does it belong to, who can access it, where should it be placed, and how can it be individually migrated or deleted? **

This article only discusses the impact of these issues on data models and queries. Authentication, current limiting, cell architecture, capacity scheduling and fault isolation are the responsibility of other chapters.

## 1. First distinguish four types of boundaries

| Concept | Typical meaning | Whether it is usually used as a data isolation boundary |
|---|---|---|
| Tenant | Corporate, school or independent client | Yes |
| Workspace | Collaboration space within Tenant | Typically not a top-level isolation boundary |
| User | Login identity, can join multiple Tenants | No |
| Subscription / Capacity | Billing or computing resource ownership | Not necessarily, cannot replace Tenant |

For example, when a user joins two companies A and B at the same time, User is the global identity, and Membership expresses its role in each Tenant. Business Items usually belong to Tenant and may further belong to Workspace.

Before designing, it should be clear:

- Which field is the stable Tenant ID;
- Can objects be moved from one Tenant to another;
- What data can be aggregated across Tenants;
- Whether deletion of Workspace means deletion of Item;
- Whether billing ownership and data ownership are the same.

Don't omit these semantics just because your current product only has one organizational structure.

## 2. Three basic layouts

### 2.1 Sharing table

Multiple Tenants use the same set of tables, and each row carries tenant_id.

| Advantages | Cost |
|---|---|
| Low cost, unified Schema and operation and maintenance methods | Each query must correctly restrict Tenants |
| Small tenants have high utilization | Large tenants may affect shared resources |
| Function upgrade is simple | Single-tenant migration, recovery and export are more complex |

Suitable for tenants that are large in number and similar in size and whose isolation requirements are not so high that they must be physically separated.

### 2.2 Per-tenant Schema

Tenants share a database instance but use different schemas.

It provides clearer naming and migration boundaries than shared tables, but as the number of schemas grows, version upgrades and connection management will become complex. Also confirm whether the selected database actually treats the Schema as a security boundary and cannot just rely on the naming convention.

### 2.3 Per-tenant database

Each Tenant uses an independent database.

| Advantages | Cost |
|---|---|
| Isolation, single-tenant recovery and data residency are more straightforward | High number of databases, connections and upgrade costs |
| Capacity can be configured independently for large customers | Cross-tenant operational analysis requires additional summary links |
| Single tenant migration boundaries are clear | Small tenants have low resource utilization |

It's suitable for large tenants, strong isolation, independent keys, specific geographies or contract requirements, and is not the default answer.

### 2.4 Mixed layout

A hybrid approach is commonly used in real-life systems: a large number of small tenants share storage, and large tenants or regulated tenants use independent databases.

Hybrid placement requires an authoritative Tenant Placement record containing at least tenant_id, placement, region, and status. The business code checks routing based on Tenant ID instead of writing the database address into the object ID or business logic.

This article only defines this Data Contract; how to split, rebalance and handle Hotspot, see [Partition, Sharding and Hotspot Governance] (../../02-Core Concepts/08-Partition Sharding and Hotspot Governance/).

## 3. How to enter Schema with Tenant ID

In the shared table, tenant_id should appear in all tenant data and its query path.

Assuming that Item belongs to Workspace, the minimum relationship is as follows:

| table | primary key or stable identifier | key constraint |
|---|---|---|
| Tenant | tenant_id | Tenant globally unique |
| Workspace | tenant_id + workspace_id | workspace_id is at least unique within Tenant |
| Item | tenant_id + item_id | Item must refer to the same Tenant's Workspace |
| Membership | tenant_id + user_id | The same user has only one valid membership in one Tenant |

### Primary key and unique key

- If the ID is only generated within Tenant, the primary key must contain tenant_id.
- Even if item_id is globally unique, common indexes still tend to start with tenant_id because queries always limit tenants first.
- "Name is unique within the same tenant" should be expressed as a unique constraint of tenant_id + normalized_name instead of making name globally unique.
- If an idempotent key is only valid within a tenant, its unique constraint should also contain tenant_id.

### Foreign keys and references

Only saving the workspace_id may mistakenly connect the Item of tenant A to the Workspace of tenant B. Intra-tenant references in the shared table should also carry tenant_id, and composite foreign keys or equivalent constraints should be used as much as possible to ensure that the Tenants at both ends are the same.

If the database cannot express the constraint directly, the application must verify and continuously discover cross-tenant references using offline checks. "IDs will most likely not collide" cannot be regarded as an isolation guarantee.

### Index

The index should be derived from the real access pattern, for example:

- Check by Tenant and Item ID;
- Paging by Tenant, Workspace, and update time;
- List background tasks by Tenant and status;
- Query Membership by Tenant, User.

tenant_id is not mechanically placed first in every index; however, any intra-tenant query must have a query path that both limits the tenant and complies with the filtering and sorting methods. For the specific order of indexing, see [Index and Query Path] (../04-INDEX AND QUERY PATH/).

## 4. Query must carry Tenant Context

Tenant IDs should not be arbitrarily claimed by clients and then trusted directly. After the request is authenticated and membership checked, the service forms a trusted Tenant Context and passes it to the data access layer.

The data access interface should be prioritized to "get the Item from a certain Tenant" instead of "get the record by Item ID, and then the caller remembers to check the Tenant". Background tasks, scheduled cleaning, and export tools must also carry Tenant Context; they are often more likely to miss filter conditions than online APIs.

Possible lines of defense include:

1. The Repository method requires tenant_id;
2. The query constructor automatically injects Tenant conditions;
3. Database Row-Level Security serves as an additional line of defense;
4. Log and audit event recording Tenant ID;
5. The test specially constructs the same local ID of two Tenants, and verifies that cross-reading or cross-writing cannot occur.

The semantics and connection pooling behavior of Row-Level Security must be determined by the specific product documentation. It reduces risk but is not a substitute for proper data models and authorization checks.

## 5. What data contracts are required for large tenants to be placed independently?

When migrating a large tenant from a shared library, the Tenant ID of the business object should remain unchanged. Applications rely on Tenant Placement to find the data location, rather than sensing "which database is this".

The data layer must support at least:

- Complete enumeration of authoritative records by Tenant;
- Identify new writes that occur during migration;
- Compare quantities, versions and key business invariants between source and target;
- Prevent the old location from continuing to accept writes after switching;
- Keep auditable migration status and switchover time.

The concern here is "what data must be enumerable and verifiable". The operating mechanisms of Dual Write, Replay, Cutover and Rollback belong to the general migration mode and will not be discussed in this article.

## 6. Data Residency, Export and Delete

### Data Residency

Tenant Placement should record the authoritative territory. New objects, derived indexes, analysis data, and backups all need to inherit the corresponding region or compliance tags. You cannot just place the main database in a designated region and declare that data residency is complete.

The global catalog should ideally hold only the minimal metadata required for routing. Whether tenant names, user IDs or content summaries can be saved needs to be confirmed according to specific compliance requirements.

### Tenant-level export

A verifiable export shall state:

- What authoritative objects and relationships are included;
- Whether to include blobs, historical versions and audit records;
- whether derived indexes are omitted since they can be rebuilt;
- Which Point-in-time or Version Checkpoint does Export correspond to?
- How to check record count, object checksum and referential integrity.

### Tenant level deletion

Deleting a Tenant does not mean deleting a Tenant table. The removal manifest should cover references in authoritative databases, object stores, search indexes, caches, analytical replicas, and asynchronous tasks.

You can first mark the Tenant as deleting to prevent new writes, and then delete and verify according to the list. The expiration method, legal retention and audit evidence in the backup must be stated separately; we cannot promise that all copies will disappear instantly after the database is deleted.

For details on Soft Delete, Tombstone, Retention and Derived Data Cleanup, see [Schema Evolution and Data Lifecycle] (../09-Schema Evolution and Data Lifecycle/).

## 7. Common mistakes

- Only tenant_id is saved in the top-level table, and sub-tables can be inferred through multiple joins;
- Treating User ID as Tenant ID cannot indicate that a user belongs to multiple organizations;
- The unique key forgets the Tenant boundary, resulting in different customers not being able to use the same name;
- Online API has Tenant filtering, but background tasks and management scripts do not;
- Use the sub-database name to carry the tenant identity, and the object identification will change after migration;
- The main database is sufficient for data residence, but search, analysis or backup will copy the data to other regions;
- Only verify "cannot find other people's data", cross-tenant writing and references will fail without verification.

## 8. Output of this article

After completing your multi-tenant data design, you should be left with:

1. Relationship and ownership rules of Tenant, Workspace, User, and Subscription;
2. Choice of shared tables, per-tenant Schema, per-tenant database or hybrid layout;
3. The position of Tenant ID in primary key, unique key, foreign key and index;
4. Tenant Context delivery rules for online requests and background tasks;
5. Tenant Placement, data residency, export and deletion contracts;
6. At least one set of cross-tenant string read, string write, and error reference tests.

This is enough to support application-level design. Cells, capacity isolation, shard migration and scheduling strategies should be left to core concepts, general patterns or specific platform cases.
