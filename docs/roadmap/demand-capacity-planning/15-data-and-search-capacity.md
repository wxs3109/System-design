# DP-15: Database and Search capacity

> Status: not started. Depends on DP-07 and DP-10. Extension milestone: M5.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Add capacity adapters for Database and Search using their actual data-access, partition, copy, and visibility semantics. Deliver Database and Search as separately checked increments. Include shared Search indexing throughput and storage admission; database-engine internals, compaction, quorum, and real repair protocols remain outside scope.

All execution here is within the declared simulation model: synthetic keys, versions, occupancy, cost rules, and virtual-time visibility are sufficient. Do not require a real database, SQL execution engine, text index, or production transaction implementation. Add state only when a stated capacity/visibility experiment needs it; unknown semantics stay explicit.

## Input and output contract

Inputs include bound read/write actions, data models, keys/indexes, existing shards/copies, read preference, per-copy connection limits, size/row estimates, partition distribution, storage pools, and physical amplification assumptions. Reuse executed access-cost calculations rather than writing a second planner-only query-cost model.

Outputs distinguish read work, write work, query fan-out/merge work, per-partition/per-copy load, replication work, indexing bytes, retained storage, and constraints. Knobs include supported shard/copy counts, connections, aggregate indexing bandwidth, and versioned storage capacity. Arbitrary servers, CPU, memory, and IOPS require explicit support declarations; default to estimated-only when no executable resource exists.

## Database rules

- Apply read preference and actual copy eligibility. Adding read copies cannot automatically multiply primary write throughput. Replication traffic/work is counted once where the behavior executes it; estimated physical durability is a separate storage dimension.
- A hot partition uses its own service limit. Shard sizing projects the declared key distribution; a key that remains singular cannot be split merely by increasing shard count.
- Use DP-10 physical pools and atomic reservation for new storage-capacity bindings. Initial schema cardinality contributes once. Successful updates/deletes alter committed occupancy; failed/cancelled actions release reservations.
- Candidate enumeration increases supported shard and copy counts within bounds and locks; choose minimum shard count, then minimum additional copies, satisfying every declared constraint. If the current runtime cannot represent a needed write/partition resource, report it unverified instead of extrapolating a global connection limit.

## Search rules

- Reads project executed shard fan-out and merge work; writes project indexed bytes and selected copy propagation. More shards may increase query work even when write distribution improves.
- Bind indexing throughput to DP-06/DP-07 shared work and remove duplicate per-request throughput delay in the upgraded version.
- Keep indexed storage, source data, and replica storage in explicit pools. Do not count a derived Search index again as the source Database's local index without an explicit separate owner.
- Storage/throughput passing does not imply fresh search results. Evaluate visibility lag with its own supported metric and observation requirements.
- IOPS estimates require declared work per access and per-unit limits. Until an IOPS resource executes, that criterion remains estimated-only and cannot receive a simulated pass.

## Acceptance cases

1. A read-heavy Database fixture gains supported read capacity from eligible copies; a primary-write fixture does not receive the same multiplier.
2. Increasing shard count under an unchanged hot-key distribution leaves the hot partition constrained. A uniformly distributed fixture changes according to the executed partition model.
3. Two concurrent Search indexing jobs share configured aggregate indexing throughput. Raising query concurrency alone cannot eliminate indexing backlog.
4. More Search shards can increase query fan-out/merge cost; the adapter evaluates candidate effects rather than assuming every shard increase improves every metric.
5. Capacity-full writes, failed writes, deletes, and initial rows reconcile physical occupancy. Primary and derived Search storage are counted in their own pools.
6. Sufficient storage with excessive indexing visibility lag fails the freshness criterion. Unknown IOPS leaves that selected criterion inconclusive.

## Completion evidence

- [ ] Database adapter, partition/copy semantics, and storage admission pass.
- [ ] Search adapter, shared indexing, visibility, and storage ownership pass.
- [ ] Browser comparisons, focused checks, and `pnpm check` pass; capability table and commit are logged here.
