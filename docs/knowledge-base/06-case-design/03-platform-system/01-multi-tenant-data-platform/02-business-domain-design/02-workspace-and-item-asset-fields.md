# Workspace and Item asset fields

This domain answers: **What customer assets are in the platform, who do they belong to, and what are their current definitions? **

It is equivalent to the Resource Catalog of the platform. Managing Items is not the same as running Items.

## 1. Business boundaries

Responsible:

- Workspace creation, modification, move and deletion;
- Item identity, type, Owner, status and Workspace ownership;
- Immutable version of Item Definition;
- ETag concurrency control and idempotent creation;
- Item Soft Delete, recovery and final cleanup orchestration;
- Publish asset change events.

Not responsible for:

- Determine how the Pipeline will be executed;
- Save large-scale files and tables;
- Save data source Secret;
- Determines whether the Operation has a Capacity budget.

## 2. Authoritative object

```text
Workspace(tenant_id, workspace_id, capacity_id, name, region, state)
Item(tenant_id, workspace_id, item_id, item_type, owner_id, state)
DefinitionVersion(item_id, version, content_uri, content_hash, schema_version)
ItemReference(source_item_id, target_item_id, reference_type)
LifecycleTask(resource_id, action, state, cursor)
```

Metadata DB is the authoritative source of Workspace and Item identity; Definition Store is the authoritative source of definition content. Search and Lineage are derived views.

## 3. Internal capabilities

| Ability | Responsibility |
|---|---|
| Workspace Service | Workspace life cycle and Capacity binding |
| Item Catalog | Common Item CRUD, List and Status |
| Definition Service | Immutable versions, ETags and rollbacks |
| Lifecycle Orchestrator | Asynchronous deletion, recovery, and cross-storage cleanup |
| Outbox Relay | Reliably publish asset events |

The first version can be merged into one `Resource Catalog Service`, and the Definition content should still be placed in independent storage.

## 4. Main interface

```http
POST /tenants/{tenantId}/workspaces
GET /workspaces/{workspaceId}/items
POST /workspaces/{workspaceId}/items
GET /items/{itemId}
PUT /items/{itemId}/definition
GET /items/{itemId}/definitions/{version}
DELETE /items/{itemId}
POST /items/{itemId}:restore
```

To save a definition use:

```http
PUT /items/pipeline-42/definition
If-Match: "etag-8"
Idempotency-Key: save-9-request
```

After the new Definition is written successfully, `current_version` can be pointed to it in the Metadata DB.

## 5. Published and consumed events

release:

- `WorkspaceCreated`、`WorkspaceCapacityChanged`
- `ItemCreated`、`ItemDefinitionChanged`
- `ItemDeleting`、`ItemDeleted`、`ItemRestored`

Consumption:

- `WorkloadItemTypeRegistered`
- `TenantSuspended`
- `CapacityDeleted`

Search, Lineage, Schedule, and Permission Clearance all consume asset events, but cannot in turn become the authoritative source of whether an Item exists.

## 6. Cooperation with other domains

```text
Access domain: Determine who can create, edit, and delete Items
Workload field: Authentication type-specific Definition
Operation domain: Read a certain version and create a running snapshot
Connection field: Definition only refers to connection_id
Data plane: Data Store Item associated data namespace
```

When the Workload is temporarily unavailable, the Catalog should still be able to list items and read the last saved common metadata.

## 7. When will the service be dismantled again?

- When there is a significant difference between the Item list traffic and the Definition saved traffic, remove the Definition Service.
- Tenant/Workspace bulk deletion lasting several hours, tearing out Lifecycle Orchestrator.
- When Metadata fragments require independent routing, remove the Catalog Router.

Service boundaries should follow load and consistency requirements rather than having a catalog for each item type.
