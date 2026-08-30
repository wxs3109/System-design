# Workload platform domain

This field answers: **What processing capabilities does the platform support, how is the new Workload accessed, and which runtime should the Operation be routed to? **

Workload is a capability and execution engine, not an Item created by the user, nor a specific run.

## 1. Business boundaries

Responsible:

- Workload registration, version, health status and grayscale;
- Item Type, Definition Schema and supported Operation types;
- Universal execution contract and runtime routing;
- Workload Runtime fault isolation;
- Type-specific Definition verification and reference extraction;
- Usage reporting format.

Not responsible for:

- Common Tenant, Workspace and Item identities;
- Determine whether the user has Item permission;
-Determine how many CUs the customer has left;
- Save the authoritative state of the Operation.

## 2. Authoritative object

```text
Workload(workload_id, version, state, runtime_endpoint)
ItemType(item_type, workload_id, definition_schema_versions)
OperationType(name, workload_id, execution_class, retry_contract)
RuntimeDeployment(workload_id, region, cell_id, version, health)
MeteringSchema(workload_id, schema_version)
```

This domain owns the Workload extension contract. The specific Item instance is still owned by the asset domain, and the specific Operation is still owned by the scheduling domain.

## 3. Control plane and runtime

```text
Workload Control Plane
├── Registry
├── Schema / Contract
├── Version and rollout
└── Runtime routing

Workload Runtime
├── Pipeline Workers
├── Notebook Workers
├── SQL Workers
└── BI Query Workers
```

The control plane is unified, and the runtime is separated by workload. BI Runtime failures should not prevent Pipeline Runtime from continuing to run.

## 4. Workload registration contract

```json
{
  "workloadId": "bi",
  "version": "2.0",
  "itemTypes": ["SemanticModel", "Report"],
  "operations": ["Query", "Refresh"],
  "definitionSchemas": ["1.0", "2.0"],
  "runtimeEndpoint": "workload://bi-runtime",
  "meteringSchema": "cu.bi.v1"
}
```

The platform understands "what can be processed" and "how to call it" through contracts. There is no need to understand chart rendering, SQL optimization or Notebook kernel.

## 5. Main interface

```http
POST /workloads:register
POST /workloads/{workloadId}/definitions:validate
POST /workloads/{workloadId}/references:extract
GET /workloads/{workloadId}/runtime-route
POST /runtime/operations:execute
POST /runtime/operations/{operationId}:cancel
```

The run call uses the standard Execution Envelope, which contains at least Operation, Tenant, Item, Definition Version, Capacity, Deadline and short-term execution Token.

## 6. Published and consumed events

release:

- `WorkloadRegistered`、`WorkloadVersionChanged`
- `WorkloadHealthChanged`
- `ItemTypeRegistered`
- `RuntimeUsageReported`

Consumption:

- `OperationAdmitted`、`OperationCancelRequested`
- `DefinitionValidationRequested`
- `CredentialRevoked`

## 7. Cooperation with other domains

```text
Asset domain: saves the general Item shell and the Workload verification type-specific definition
Operation field: Delivers standard operational envelopes and receives status
Capacity field: Executed after Admission, real usage reported during operation
Connection field: Obtain short-term data credentials within the Operation scope
Data plane: reads input and transactionally commits output
```

## 8. When will the service be dismantled again?

- Deploy Registry and Runtime routes separately when different availability targets are required.
- When the resource model, release cycle, and fault domain of each workload are different, use an independent Worker Pool.
- Add sandbox, contract authentication and stricter network boundaries when third-party Workload is connected.

The Workload domain provides plug-in extension capabilities, but the core contract of the platform must be stable, versioned, and compatible with old Item Definitions.
