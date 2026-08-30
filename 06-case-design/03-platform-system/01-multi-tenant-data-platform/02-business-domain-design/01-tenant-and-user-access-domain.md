# Tenant and user access domain

This field answers: **Who is the current caller, which enterprise does it belong to, and what actions are allowed to be performed on which resource? **

It manages identity mapping and authorization relationships within the platform, but does not save user passwords. Login, MFA, and password policies are typically taken care of by external Identity Providers such as Entra ID, Okta, and others.

## 1. Business boundaries

Responsible:

- Tenant activation, deactivation and organization-level policies;
- Mapping of external identities to platform Principals;
- Tenant Membership for users, user groups and Service Principals;
- Workspace Role, Item Permission and policy calculation;
- Permission revocation, permission cached versions and access auditing.

Not responsible for:

- Save Workspace and Item contents;
- Schedule Job or allocate Compute Units;
- Save data source secrets such as database passwords;
- Handle login passwords for external Identity Providers.

## 2. Authoritative object

```text
Principal(principal_id, principal_type, external_identity_id)
Tenant(tenant_id, name, state, policy_version)
TenantMembership(tenant_id, principal_id, tenant_role, state)
WorkspaceRole(tenant_id, workspace_id, principal_id, role)
ItemPermission(tenant_id, item_id, principal_id, action, effect)
```

This domain is the authoritative source for Membership, Role, and Permission. The asset domain is still responsible for whether Workspace and Item exist.

## 3. Internal capabilities

| Ability | Responsibility |
|---|---|
| Tenant Service | Tenant Lifecycle and Organizational Policy |
| Principal Service | Stable mapping of external identities to internal Principals |
| Membership Service | Which Tenants the user or group belongs to |
| Authorization Service | Calculate whether an action is allow or deny |
| Policy Cache | Cache authorization results and expire by version |
| Audit Writer | Records sensitive management and authorization operations |

The first version can deploy the first four items as a `Access Control Service`, but the data model still needs to be distinguished.

## 4. Main interface

```http
POST /tenants/{tenantId}/members
DELETE /tenants/{tenantId}/members/{principalId}
PUT /workspaces/{workspaceId}/roles/{principalId}
POST /authorization:check
GET /principals/{principalId}/memberships
```

An authorization check request contains at least:

```json
{
  "tenantId": "contoso",
  "principalId": "user-7",
  "resourceType": "Item",
  "resourceId": "report-42",
  "action": "Run"
}
```

You cannot just pass `user_id + action` because the same user may belong to multiple Tenants.

## 5. Published and consumed events

release:

- `TenantStateChanged`
- `MembershipChanged`
- `WorkspaceRoleChanged`
- `PermissionChanged`
- `PolicyVersionChanged`

Consumption:

- `WorkspaceCreated` and `WorkspaceDeleted`
- `ItemDeleted`

After the asset is deleted, this domain will clear the remaining ACL asynchronously; synchronous authentication is still based on whether the asset exists.

## 6. Cooperation with other domains

```text
Asset domain: Provides resource ownership and default permission boundaries
Operation field: Check Item.Run before submitting it to run
Connection field: Check Data.Read / Data.Write before issuing data credentials
Capacity domain: Check Tenant.Admin before managing capacity
```

When the permission service fails, reading public metadata can be degraded to a limited extent; sensitive operations such as running jobs, modifying permissions, and issuing credentials are denied by default.

## 7. When will the service be dismantled again?

- When the authorization check QPS is much higher than the Tenant management QPS, remove the Authorization Service.
- Tear down the Membership Service when enterprise directory synchronization and group expansion become bottlenecks.
- Detach the Audit Service when independent retention and permission boundaries are required for compliance auditing.

Do not create a super `User Service` that takes care of logins, tenants, permissions, and profiles just because a `User` object exists.
