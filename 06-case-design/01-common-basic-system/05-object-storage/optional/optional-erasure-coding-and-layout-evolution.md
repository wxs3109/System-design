# Optional: Erasure coding and layout evolution

This article is only read when you need to compare Replica, Erasure Coding and online migration in depth, and is not required for first time completion.

## 1. Select layout from fault contract

Redundant design answers first:

```text
What kind of faulty unit is protected?
→ The maximum number of units allowed to be lost at the same time
→Write when to confirm
→ Is Degraded Read acceptable?
→ How soon redundancy must be restored
```

Replica/Fragment quantities alone cannot answer these questions. If three Replicas fall in the same power domain, they can only protect some of them from Disk/Node failures. $m$ in $(k+m)$ is the encoding upper limit of lost Fragment; if multiple Fragments share a Failure Domain, domain failure may lose multiple Fragments at one time.

## 2. Minimal comparison of Replica and EC

| Dimensions | Three copies | $(k+m)$ EC |
|---|---|---|
| Theoretical capacity amplification | $3\times$ | $\frac{k+m}{k}$ |
| Normal reading | Choose a good copy | Read enough Data Fragment, different layouts can be optimized |
| Degraded Read | Change to another copy | Read more Fragments and decode |
| Write | Copy complete Chunk | Split Stripe, encode and write multiple Fragments |
| Repair | Copy a complete Chunk | Read at least $k$ pieces of information and reconstruct missing Fragments |
| Small objects | Simple but expensive in space | Padding, Packing and random I/O are complex |
| Common uses | Hot data, Metadata, small objects | Capacity-dominated large/cold objects |

The formula only describes theoretical Data Amplification. Real physical capacity also includes:

- Stripe Padding and small object Packing.
- New and old layouts coexist during staging and migration.
- Checksum, Index, Metadata and Fragment Header.
- Repair Space, Watermark and Growth Margin.

## 3. Write confirmation must be bound to Layout Generation

Manifest needs to express at least:

```text
objectVersion
layoutGeneration
codec(k, m) or replica count
fragment identities and locations
fragment / chunk checksums
logical size
```

PUT can publish the Manifest only after the confirmation conditions of the current Generation are met. You can't release a layout that will be "completed in the future" and still claim full durability. If the business chooses to allow Degraded Write, it must be defined as a different contract and limit the exposure window.

## 4. Online layout migration

Use Copy-on-write when converting from Replica to EC, adjusting $k,m$, or replacing Storage Node:

1. Reader fixedly reads the old Manifest Generation $g$.
2. Migrator reconstructs the content from the verified Fragment.
3. Generate all fragments of new Generation $g+1$.
4. Verify the new fragment, fault domain distribution and encoding results.
5. Perform CAS on Metadata: switch to $g+1$ only if Current Layout is still $g$.
6. Wait for the bounded Reader Generation Pin / Read Lease and Repair Safety Window to end and then recycle $g$.

If CAS fails, it means that another Repair / Migration has changed the layout; the current task cannot overwrite the new state, and you should re-read or mark the Fragment you generated as Orphan.

This process separates the "object content version" and the "internal layout version": the same Object Version can migrate the storage layout without changing the caller's ETag.

## 5. Degraded Read and Repair amplification

When Fragment is missing, the system may need to read at least $k$ pieces of information from other Failure Domains, and then return the target Range after network and decoding. Small Ranges may also trigger read amplification across Stripe.

So measure:

- Normal/Degraded Read Bytes Amplification.
- Encode / Decode CPU。
- Repair Read / Write Bytes。
- East-West networking and Storage Node I/O during single domain failure.
- The interaction between front-end P99 and Repair Backlog.

Encoding saves capacity, but moves some of the cost to network, CPU, latency, and recovery.

## 6. Boundary of small object Packing

If a large number of 1 KB Objects form Stripe individually, the Metadata, Fragment Header, random I/O and Padding will get out of control. You can package multiple immutable Object Chunks into a larger container, and then EC the container.

This will introduce:

- Secondary positioning of `object → pack + offset + length`.
- Space cannot be reclaimed immediately after deletion, and Compaction/Repack is required.
- One Pack damage affects many Objects, Repair priority and Blast Radius change.
- Read Amplification appears for Range Read and random small reads.

Only re-enable Packing when small object metadata / IOPS have been measured as the dominant bottleneck; for first time learning just know that Size Distribution changes layout choices.

## 7. When to stop

Stop after you can explain the following questions:

- Why $m$ is not a synonym for Failure Domain number.
- Where to place costs between Replica and EC.
- Manifest Generation How to make migration not expose mixed layout.
- Repair / Migration Why use CAS and delayed recycling.
- Why can't small objects be mechanically applied to large objects EC?

Don't keep deriving Galois Field implementations, precise Stripe parameters, disk file formats, and vendor product configurations.
