# Rate Limiter Refactoring Review

## in conclusion

Refactoring has changed from a horizontal topic manual to a true learning thread. The current case only has one pressure-driven knowledge path and one closed-book exercise; algorithm implementation and rule interfaces are isolated as optional, multi-region and product capabilities enter the Parking Lot, and the old 01–08 documents have been deleted.

The default path is:

```text
README
→ 01-Progressive design main line
→ 02-Review and practice
→ Stop
```

## What to keep

Only retain knowledge that changes the architecture, correctness, fault semantics, or dominant capacity:

- Trusted Descriptor and Composite Counter Key.
- Token Bucket's expression of Rate and Burst.
- Different responsibilities of Local Limiter and Regional Shared Limiter.
- Multiple instances share Counter and Store atomic Check-and-consume.
- Sharding by Counter Key and strict Hot Key upper limit.
- Fail-open, Fail-closed and Local fallback.
- Control plane/data plane, immutable Rule Snapshot, versioning and rollback.
- Single Region accuracy boundaries, core invariants, capacity estimation and fault verification.

These contents now unfold according to the following causal chain:

```text
Single process Token Bucket
→Multi-Gateway amount distortion
→ Share Counter
→ Concurrency contention
→ Atomic deduction
→ Throughput and Hot Key
→ Sharding and Isolation
→ Dependency failure
→ Failure Mode
→ Dynamic rules
→ Snapshot and rollback
```

## What is isolated?

[`optional/Algorithm and Atomic Implementation.md`](optional/optional-algorithm-and-atomic-implementation.md) Only reserved:

- Selection of Fixed Window and Token Bucket.
- Token Bucket formulas and atomic script semantics.
- Timing, TTL and numerical accuracy risks.
- Implementation boundaries of Hot Key.

[`optional/Rules and interface semantics.md`](optional/optional-rules-and-interface-semantics.md) Only reserved:

- Descriptor and Composite Key.
- Minimal Rule/Decision contract.
- Policy Version and Counter Epoch.
- Multiple rules for independent accounting.
- The existence and boundaries of Idempotency and Shadow.

Multi-Region, Token Lease, complex multi-rule transactions and complete rate-limiting products are only recorded in [Parking Lot](PARKING-LOT.md).

## What was deleted or omitted

- Terminological encyclopedic architecture documentation.
- Complete TypeScript data types.
- Redis Key, Hash Tag, HMAC and Slot co-location details.
- Examples of microToken / BigInt implementations with precision risks.
- Full HTTP/gRPC request response, policy CRUD and error codes.
- Complete Release, Canary, Explain, Alert and Test Matrix.
- Expand Reservation, Outcome Report, Token Lease and Quota Ledger.
- Multi-tenant RBAC, auditing, console, DR and product-level SLA.
- Feature matrix for Envoy, Kong, Cloudflare, AWS and NGINX.
- Repetition of old 01–08 documentation covering the same architecture.

This content has engineering value but does not add to the core learning objectives of this case.

## Current granularity

- `README.md`: Learning contracts, architecture maps, invariants, and completion criteria.
- `01-Progressive Design Main Line.md`: The only main line of knowledge.
- `02-Review and Practice.md`: Algorithms, Concurrency, Failures, Capacity and Boundary Acceptance.
- `optional/`: Does not block the completion of two special materials.
- `PARKING-LOT.md`: Only trigger conditions, no product plan is expanded.

## Complete judgment

Learners can introduce Shared Limiter and atomic sharing counting from single-process Token Bucket in a closed book, and explain Local/Shared, sharding/Hot Key, Failure Mode, rule snapshot and main Trade-off. This case ends.
