# Optional: shard migration and hotspots

Read this article only if you need to compare mapping or migration implementations. The main line only requires that different keys can be sharded, member changes must be limited to Cold Miss, and ordinary Shard cannot expand a single Hot Key.

## 1. Mapping selection

| Method | Member Change | Main Cost |
|---|---|---|
| `hash(key) mod N` | Large area remapping when $N$ changes | Simple but big impact of expansion and contraction |
| Logical Partition / Slot | Only move part of the Partition | Requires maintenance Partition Ownership |
| Consistent Hashing | Moving adjacent ranges on the ring | Virtual nodes are needed to improve balance |
| Rendezvous Hashing | Calculate the highest weight for members | Member calculation cost for each route |

The algorithm only determines "which Keys to change owners" and is not responsible for controlling Origin peaks, processing old routes, or completing data recovery.

## 2. Client Routing and Proxy Routing

| Choice | Advantages | Costs |
|---|---|---|
| Client-side | One less network jump | SDK, topology propagation and version management are more complex |
| Proxy | Centralized routing logic | One more hop; Proxy also needs to be expanded and isolated |

Both must use versioned Routing Snapshot and define Wrong-owner, refresh, and limited retries; the product name does not override these semantics.

## 3. Entry How to get a new Owner

| Strategy | What to Gain | Key Risks |
|---|---|---|
| Lazy Fill | The simplest; data will be lost if you don’t move it | Cold Miss and back-to-origin peak |
| Pre-warm Top Keys | Recover the most valuable hits first | Hotspot list will expire |
| Copy from old Owner | Reduce Origin Read | Uses cluster bandwidth; may copy old values ​​|
| Dual Read/Write | Smooth switching | Expanded request cost and consistency window |

By default, batched Ownership switching + Lazy Fill is used first. Only add warm-up or copy if the Origin budget does not allow it; the cache does not need to simulate database migration for lossless migration.

## 4. Additional boundaries for failover

Planned expansion can be gradual, but sudden failures cannot. Therefore it is necessary to:

- Post-failure safety margin for remaining nodes and Origin.
- Replica and Owner are distributed in different Failure Domains.
- Monotonic Ownership Generation, preventing the old Owner from continuing to serve after recovery.
- Client uses limited retries and refreshes the full Snapshot.

The mainline does not expand the Metadata Authority consensus, Lease renewal, split-brain recovery and rolling upgrade protocols.

## 5. Three types of hotspots

| Problem | Minimum Priority Action | Escalation Signal |
|---|---|---|
| Hot Partition | Move or split Partition | Multiple Key aggregation causes Owner overload |
| Hot Key | Coalescing, isolation | Single Key has exceeded Owner bandwidth/QPS |
| Big Key | Limit Value size | Single network, serialization or memory cost is too high |

Hot Keys that read more and write less can add L1 or hot read replicas, but each additional replica increases the failure cost and stale window. Write hotspots cannot be solved by infinitely increasing read replicas.

## 6. Stopping point

Can explain that the mapping algorithm and the migration protocol are not the same thing, why planned expansion and failure recovery require different rhythms, and why the three hotspots cannot be handled with the same solution and then stopped. Do not continue to determine the number of virtual nodes, migration state machines, hotspot detection platforms, or product parameters.
