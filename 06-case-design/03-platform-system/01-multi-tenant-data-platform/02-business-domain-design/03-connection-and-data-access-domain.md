# Connection and data access domain

This field answers: **How ​​can a certain operation access external data sources or platform data without exposing long-term keys? **

Connection is a logical resource configured by the user; Credential is a short-term authorization generated during execution. The two cannot be mixed.

## 1. Business boundaries

Responsible:

- Connection Metadata and data source types;
- Secret Reference, Secret rotation and revocation;
- Test connection and network reachability check;
-Issue short-term, least privilege credentials based on Operation context;
- Data access policies and sensitive credential auditing.

Not responsible for:

- Move data from data source to target table;
- Save Pipeline Definition;
- Save files and tables in the data lake;
- Perform Workspace Role management for general users.

## 2. Authoritative object

```text
Connection(tenant_id, connection_id, source_type, endpoint, auth_method)
CredentialReference(connection_id, secret_reference, version, state)
DataAccessPolicy(resource_id, principal_or_workload, allowed_actions)
CredentialGrant(operation_id, scope, expires_at, state)
```

The Connection Metadata Store is the authoritative source of endpoints and authentication methods; the Secret Store is the authoritative source of long-term keys. Logs, events, and Definitions cannot contain real Secrets.

## 3. Internal capabilities

| Ability | Responsibility |
|---|---|
| Connection Service | Connection CRUD and connection testing |
| Secret Broker | Save, rotate, and reference long-term Secrets |
| Credential Broker | Exchange for short-term execution credentials |
| Data Authorization | Check the data access scope of Operation |
| Access Audit | Record who accessed what for which Operation |

In the first version, these capabilities can be deployed together, but the Secret Store must maintain independent security boundaries.

## 4. Main interface

```http
POST /workspaces/{workspaceId}/connections
POST /connections/{connectionId}:test
POST /connections/{connectionId}:rotateCredential
POST /execution-credentials:issue
POST /execution-credentials:revoke
```

The Worker carries the Operation Token when requesting credentials:

```json
{
  "operationId": "op-100",
  "tenantId": "contoso",
  "connectionId": "orders-db",
  "requestedActions": ["Read"],
  "requestedScope": "orders/2026/08/13"
}
```

After the Credential Broker verifies the Operation, Tenant, Item permissions and Workload identity, it only issues short-term credentials within this range.

## 5. Published and consumed events

release:

- `ConnectionCreated`、`ConnectionDeleted`
- `CredentialRotated`、`CredentialRevoked`
- `ConnectionHealthChanged`

Consumption:

- `ItemDeleted`, clean up unreferenced Connections;
- `PermissionChanged`, revoke the affected Grant;
- `OperationFinished`, terminate or recycle execution credentials.

## 6. Cooperation with other domains

```text
Asset field: Item Definition saves connection_id but does not save Secret
Access domain: Determine whether the caller and Operation have Data.Read / Data.Write
Operation domain: Provides unforgeable Operation execution context
Workload domain: Worker uses short-term credentials to connect directly to the data source
Data plane: Issue limited-scope access tokens for internal files and tables
```

Connection Service does not forward terabytes of data. It is located in the control path, and the real data takes the direct path between the Worker and the data source.

## 7. When will the service be dismantled again?

- Independent Credential Broker when the credential issuance QPS and security level are much higher than Connection CRUD.
- When different network environments require Private Link, proxy or gateway, remove the Connectivity Runtime.
- When the data policy contains row-level rules, tear out the Data Authorization Service.

The primary goal of this domain is not convenience, but to keep long-term Secrets from ever entering common business services and task definitions.
