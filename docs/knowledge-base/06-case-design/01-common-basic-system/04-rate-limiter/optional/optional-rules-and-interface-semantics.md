# Optional: rules and interface semantics

This article only retains the minimum Rule and Decision contracts that affect the call semantics, and does not list the complete API, CRUD, field types or error codes.

## 1. Descriptor and Composite Key

Gateway constructs the canonical descriptor after authentication and routing are complete:

```text
tenant_id = Authenticated tenant
route_id  = POST:/v1/orders
user_id = authenticated user
```

Rule is expressed separately:

- **Conditions**: Which requests match this rule;
- **Key Parts**: The fields according to which the quota will be shared after matching.

For example, all `POST:/orders` requests match, but the Counter Key uses `tenant_id + user_id`, which means that each user in the same tenant has independent traffic limit.

Key constructs must be unambiguous and limited in length. The original IP, User ID, and API Key do not appear directly in the metrics tag; the specific encoding, HMAC, and Redis Key format are an implementation choice.

## 2. Minimum Rule Contract

The core only needs to express:

```text
ruleId
match conditions
counter dimensions
algorithm + rate/window + burst
cost bounds
failure mode
mode: enforce | shadow (optional)
```

When the Key field is missing, "Do not match", "Use controlled default values" or "Reject" must be selected in advance, and all missing values ​​cannot be merged quietly into the same Counter.

## 3. Minimum Decision Contract

RLS receives a normalized Descriptor and a positive integer `cost`, and returns:

```text
decision: ALLOW | DENY | ERROR
limit / remaining
retryAfter
ruleId / reason
policyVersion
degraded: true | false
```

The transfer state of the Decision API is separate from the business Decision: a normal calculation of `DENY` can still be a successful RPC/HTTP call; Gateway then converts it to HTTP `429` or gRPC `RESOURCE_EXHAUSTED`. Dependency failure returns Error or explicitly Degraded, and cannot be disguised as ordinary Allow.

## 4. Policy Version and Counter Epoch

- **Policy Version**: Immutable release version of configuration content, used for convergence, interpretation and rollback.
- **Counter Epoch**: Changes only when the business explicitly requires the quota to be reset.

Ordinary text, condition, or limit updates should not create an entirely new Counter just because a new Policy Version is released. Rollback also releases a new monotonous Version instead of letting the old Version overwrite the new Version.

## 5. Multi-rule accounting

The request may hit Tenant, Route and User Rule at the same time. The core version uses rule-by-rule independent atomic accounting:

```text
Tenant: ALLOW and deductions
Route: ALLOW and deduct
User:   DENY
Overall: DENY
```

Therefore, requests that do not enter the Backend may still consume the quota of the first two Rules. Its advantage is that it is simple to implement and does not require cross-Shard transactions; the price is that the semantics are not equal to Accepted-only All-or-nothing.

If the business cannot accept this, it should refuse to inherit the core implementation and restart the multi-rule transaction design from [Parking Lot](../PARKING-LOT.md).

## 6. Idempotency: Just know it exists

RLS may have been deducted but the response timed out, and Gateway retries will deduct it again. High `cost` or auto-retry requests can carry an Idempotency Key, allowing short-term Decision digests to be saved within the same Counter consistency domain.

This increases writes and memory and should not be enabled by default for all normal requests. Deduplication TTL must cover the maximum retry window. The full Redis Slot co-location and Fingerprint contract are not part of the mainline.

## 7. Shadow: Just know it exists

Shadow Rule calculates "should have Deny" but does not change the Overall Decision. It should use an independent Counter, otherwise the official quota will be consumed.

Shadow is used to evaluate friendly fire and Key base risks, but will increase the cost of Counter and telemetry. The core only needs to know that this release method exists and does not design a complete canary platform.

## 8. Stopping point

It can stop after explaining the boundaries of normalized Key, minimum Decision, Version and Epoch, multi-rule independent accounting, Idempotency and Shadow. Do not continue writing the full OpenAPI/Proto, Policy CRUD, error codes or console models.
