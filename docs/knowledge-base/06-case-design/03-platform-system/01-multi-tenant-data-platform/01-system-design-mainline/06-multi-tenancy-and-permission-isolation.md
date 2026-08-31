# Multi-tenancy and permission isolation

## 1. Tenant is the highest isolation boundary

Tenant represents an enterprise customer. Different tenants may share servers and database clusters, but cannot see each other:

- Workspace and Item;
- Documents and tables;
- Users, permissions and auditing;
- Job, log and calculation consumption;
- Caching and search results.

Therefore `tenant_id` must exist in:

- Database primary key and query conditions;
- Cache Key;
- Object storage path;
- Messages and Jobs;
- Logs, Metrics and Trace;
- Capacity usage records.

## 2. Permissions are divided into three levels

| Levels | Questions answered | Examples |
|---|---|---|
| Tenant | Does the enterprise allow a certain feature? | Whether to allow external sharing |
| Workspace | What can users do in a team space? | Admin, Contributor, Viewer |
| Item/Data | Can a user access an object or the data within it? | Read Report, run Pipeline, read a table |

Workspace permissions are suitable for default inheritance, and Item permissions are used for exceptional sharing. Tables, rows, or columns in the Data Store can also have more granular data permissions.

Identity itself does not equal Tenant. The minimum relationship is:

```text
Principal --member_of--> Tenant --contains--> Workspace
Principal --role_on----> Workspace --contains--> Item
```

The same external user can join two Tenants. The token or request context must be explicitly the current `tenant_id`, you cannot guess the tenant after seeing a `user_id`.

## 3. How to authorize a request

```text
1. API Gateway authenticates the user's identity.
2. Get tenant_id and user_id from Token.
3. Read the Tenant to which the resource belongs based on workspace_id / item_id.
4. If the Token Tenant is different from the resource Tenant, reject it immediately.
5. Calculate Workspace role and Item permission.
6. Data access permissions are checked again when the Workload is executed.
```

The user can open the Report, but may not be able to directly read all the original tables behind the Report. These two actions require different permissions.

## 4. User isolation is different from computing isolation

### User permission isolation

Prevent Alice from reading items that Bob does not have permission to share.

### Tenant data isolation

Prevents Contoso from reading any of Fabrikam's data.

### Capacity resource isolation

This prevents a team's large job from running out of computing resources, making it impossible for other customers to query.

The three solve different problems, and you cannot rely on just one ACL table.

## 5. Logical isolation and physical isolation

| Level | Practice | Applicable scenarios |
|---|---|---|
| Shared infrastructure, logical isolation | Rows with `tenant_id`, storage paths and Cache Keys with Tenant | Most tenants, lowest cost |
| Shared services, independent shards | Large tenants with independent metadata shards or queue partitions | Hotspot tenants or performance commitments |
| Independent Cell / Compute Pool | Independent fault domain on control plane or computing plane | Strong isolation, compliance or very large tenants |

Multi-tenancy does not mean that every machine is shared by all customers forever. The platform can maintain the same API and object model, with the option of varying physical isolation by tenant level.

## 6. Permission caching

To avoid accessing the permissions database for each Query, you can cache:

```text
(tenant_id, user_id, resource_id, action, policy_version) -> allow / deny
```

When permissions change, increase `policy_version` and publish an invalidation event. Sensitive writes and administrator operations should still read the latest permissions; sensitive access is denied by default when the permissions service fails.

## 7. Prevent cross-tenant bugs

- The data access library mandates `tenant_id` and is not allowed to be omitted by the caller.
- Use a composite primary key, such as `(tenant_id, item_id)`.
- Cache Key cannot only be `item_id`.
- Worker token only allows access to the Tenant and Item to which this Operation belongs.
- Search index partitioned by Tenant and perform permission filtering again.
- Continuously inject wrong Tenant IDs during testing and verify that all layers will reject it.

## 8. Noisy Neighbor

Even without overstepping their authority, a large client can harm others:

- Limit API QPS per Tenant.
- Limit Compute Units per Capacity.
- Limit concurrent jobs per Workspace and Item.
- Large Query limits memory, scan bytes and runtime.
- Background tasks and interactive queries use different queues.
- Very large customers can be placed into independent Shard or dedicated computing pool.
