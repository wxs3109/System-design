# Object Storage Refactoring Review

## in conclusion

The original README is a 27-line list of topics: the direction is basically correct, but Bucket API, erasure coding, Versioning, life cycle, cross-region, permissions and "11 nines" are tiled on the same layer. It does not define when the Object is submitted, how the Metadata and bytes are kept matched, nor does it use capacity and failure to roll out the architecture, nor does it have practice and stop conditions.

After refactoring there is only one default path:

```text
README
→ 01-Progressive design main line
→ 02-Review and practice
→ Stop
```

## What remains in the main line?

Only keep content that changes the Object Storage contract, schema, dominant capacity, or failure consequences:

- Immutable Object Version, Manifest Commit Point and PUT results are unknown.
- `requestId` idempotent windows, conditional PUT and single Key concurrency coverage bounds.
- Authoritative relationship and independent sharding of Metadata/Data.
- Object Count, Logical Bytes, Metadata, Request/s and Bandwidth estimates.
- Cross Failure Domain Replication with safe write confirmation.
- Capacity amplification, Degraded Read and Layout Generation of Erasure Coding.
- End-to-end Checksum, Scrub, Repair Window and Repair Budget.
- Multipart's Staging Part and Atomic Complete.
- Tombstone, Reader/Repair Safety and delayed GC.

The causal chain becomes:

```text
Key → Bytes
→ Write crash exposing half object
→ Immutable Staging + Atomic Manifest
→ Object Count / EB / Bandwidth exceeds single machine
→ Metadata / Data Independent Sharding
→ Disk / Node / AZ failure
→ Failure-domain-aware Replication
→ The cost of three copies is too high
→ Erasure Coding + Versioned Layout
→ latent damage
→ Checksum + Scrub + Repair Budget
→ Terabyte transfer failed
→ Multipart + Atomic Complete
→ Delete race condition
→ Tombstone + Safe GC
```

## What is isolated?

[`optional/Erasure coding and layout evolution.md`](optional/optional-erasure-coding-and-layout-evolution.md) Expand only:

- Failure and cost bounds for Replica/EC.
- Layout Generation, CAS Migration and Degraded Read.
- Reopening conditions for small object Packing.

[`optional/Verification Repair and Durability Proof.md`](optional/optional-calibration-repair-and-durability-certification.md) Expand only:

- Integrity chain of Fragment / Chunk / Object.
- Scrub Coverage, Repair Safety and Repair Budget.
- Durability risk model with minimal fault injection.
- The difference between Versioning and physical Durability.

Cross-Region, Full Versioning/WORM, Access Encryption Platform, Lifecycle Products, Small Object Storage Engine, and Full S3 Compatibility Enter [Parking Lot](PARKING-LOT.md).

## What is omitted

- All S3 APIs, headers, error codes and product function matrix.
- Fixed Chunk / Part / Stripe size, $k,m$, Quorum and number of nodes.
- Reed–Solomon / Galois Field, disk file formats and block allocation algorithms.
- Metadata consensus protocol, master selection code and complete Placement Scheduler.
- Bucket Policy, Signed URL, KMS, Auditing, Accounting and Console.
- Lifecycle Rule combinations, archive recovery charges, and product-level storage levels.
- Global Namespace, cross-Region conflicts and disaster recovery.
- Exact "11 nines" calculation of breakaway failure rate and measured Repair Time.

This content has engineering value, but should not block first learning when there are no real product requirements or measurement bottlenecks.

## Fixed error-prone expressions in Review

- "When PUT is successful, the file has been written to disk" is changed to "Atomic release of manifest after data persistence conditions are met."
- "PUT timeout can be retransmitted" is added as the result is unknown and the same `requestId` must be used or queried first.
- "Three copies to ensure high durability" supplements Failure Domain, latent damage, Repair Window and related faults.
- "$m$ of EC indicates that $m$ AZs can be lost" is changed to only indicate the Fragment loss upper limit, and the domain guarantee is determined by Placement.
- "ETag is MD5" is changed to ETag is conditional writing/version identification, and Checksum semantics are declared separately.
- "DELETE delete object" is split into Tombstone visible, historical retention and physical Fragment recycling.
- "LIST Strong Consistency" is limited to page-level contracts; cross-page global Snapshots are not guaranteed by default.
- "Versioning improves Durability" was changed to mainly protect logical accidental deletion/overwriting and does not replace physical redundancy.
- "11 Nines" changed from a goal slogan to a conclusion requiring models, metrics, Repair Capacity and drills.

## Current granularity and stopping point

- `README.md`: Learning Contract, External Contract, core model and completion standards.
- `01-Progressive Design Main Line.md`: The only main line of knowledge.
- `02-Review and Exercise.md`: Closed-book derivation, capacity, crash, repair and boundary acceptance.
- `optional/`: Two on-demand puzzles that are not prerequisites for completion.
- `PARKING-LOT.md`: Only record real reopening conditions.

Learners can launch Manifest Commit, independent sharding, cross-domain redundancy, EC, Repair, Multipart and Safe GC from a single node in a closed book, explain the critical failure window, and complete a capacity and Repair Bandwidth estimate. This case ends.
