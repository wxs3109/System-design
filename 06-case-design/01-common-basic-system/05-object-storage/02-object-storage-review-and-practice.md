# Object Storage: review and practice

This article does not introduce new knowledge, but only tests whether the design can be re-derived without the document. Read [Progressive Design Mainline] (01-progressive design mainline.md) first, then close the document and complete it within 50–70 minutes.

Use the same framework for each answer:

```text
stress or malfunction
→ Why the current solution failed
→ Minimal new mechanism
→ Guarantee obtained
→ Cost and Boundary
→ a verification signal
```

Does not require full S3 API, precise erasure coding parameters, disk file format, consensus implementation, cross-region replication, or fixed node count.

## 1. Fixed learning contract

Limited to 5 minutes:

1. Use one sentence to describe the responsibilities of Object Storage in this case.
2. Why is it better to write an object as an immutable Version instead of modifying it in place?
3. What do PUT success, PUT Timeout, GET success and DELETE success mean respectively?
4. Why does the existence of Chunk on the Storage Node not mean that the Object exists?
5. What is Object Version ID / ETag used for in core? Why doesn't it automatically equal MD5?
6. Which requirements should use file systems, databases, or independent business workflows instead?

Passing criteria: Manifest is the authoritative state of object submission and visibility; object storage does not provide POSIX in-place writing, arbitrary business queries, or cross-Object transactions.

## 2. Rebuild single node and Commit Point

Limited time: 10 minutes:

1. Draw `Client → Object Server → Metadata + Data Disk`.
2. What will happen if you write Metadata first and then Data? What happens the other way around?
3. Draw `Staging Chunk → Durable → Atomic Manifest Publish → Response`.
4. Inject crashes before Chunk is written, after writing/before publishing, and after publishing/before response. What does the caller see?
5. Why is Manifest Publish a Commit Point?
6. Why does the `requestId` deduplication record have to submit atomic updates with the Manifest and bind Key, Checksum/Size and conditional parameters?
7. What should be done when the same `requestId` carries different contents? After the deduplication window expires, how can the caller avoid turning unknown results into duplicate overwrites?

Passing criteria: readers only see the old Version or the complete new Version; the Orphan can be cleaned up, but the Manifest cannot point to a Chunk Set that does not meet the persistence conditions.

## 3. Let pressure push out the structure

Don’t draw the final drawing first. Fill in the following:

| Stress or failure | Why current solutions fail | Minimal mechanisms | New guarantees | Costs/bounds |
|---|---|---|---|---|
| PUT crashes on non-atomic step | | | | |
| Object Count / Metadata QPS exceeds single machine | | | | |
| Data Capacity / Bandwidth exceeds single machine | | | | |
| Disk / Node / AZ failure | | | | |
| The cost of three EB-level copies is too high | | | | |
| Cold Object appears latent Bit Rot | | | | |
|TB-level upload disconnected midway | | | | |
| DELETE and GET / Repair concurrently | | | | |

When completed, you should naturally get:

```text
Key → Bytes
→ Immutable Chunk + Atomic Manifest
→ Metadata / Data Independent Sharding
→ Failure-domain-aware Replication
→ Erasure Coding + Versioned Layout
→ Checksum + Scrub + Repair Budget
→ Multipart + Atomic Complete
→ Tombstone + Safe GC
```

Passing criteria: Each mechanism has a clear source of stress; "S3 generally supports" or "distributed storage has" cannot be used as a reason.

## 4. Capacity, Request and Bandwidth Estimation

Assume using this case: $10^9$ Objects are added every day, 1 MB on average, 1 KB of metadata per Object, retention time is 5 years, read-write ratio is 10:1, and peak value is 3 times on average. A day is roughly calculated as $10^5$ seconds.

1. Calculate average/peak PUT/s and peak GET/s.
2. Calculate five-year logical Data and Metadata.
3. Calculate the average PUT Payload and peak GET Payload.
4. What is the magnitude of the physical data of the three copies? What is the theoretical magnitude of $(8+4)$ EC?
5. Why can’t both be directly used as purchasing capacity? What amplification and headroom are still missing?
6. If the average size drops to 1 KB and the total bytes remain unchanged, how will the Object Count, Metadata and Request pressure change?
7. Why must we bucket by Object Size instead of just keeping an average?

Passing criteria: PUT average/peak value is about $10{,}000/s$ / $30{,}000/s$, GET peak value is about $300{,}000/s$; five-year logical data is about 1.825 EB, Metadata is about 1.825 PB; average PUT is about 10 GB/s, peak GET is about 300 GB/s. The three copies are about 5.475 EB, and the theoretical cost of $(8+4)$ is about 2.738 EB. Headroom and run amplification are not included.

## 5. Metadata, Data and LIST

1. Why is Metadata much smaller than Data, but still needs to be independently sharded and replicated?
2. What semantic information should be saved in the Manifest, and which specific fields do not need to be expanded for the first time?
3. What Keys drive Namespace Range Partition and Data Chunk Placement respectively?
4. Why does Key remain stable but Fragment Location can change?
5. How to page the Range-partitioned Namespace in order by Key? What is the minimum requirement for Continuation Token?
6. Why is the default multi-page LIST not a global Snapshot during concurrent PUT/DELETE? What must the caller tolerate?
7. Which layer should Hot Prefix, Single Hot Key and Hot Object Download be pressed to?

Passing criteria: A single Key version/Tombstone is in a Metadata consistency domain; LIST is a Namespace contract, and Data Placement is a byte layout contract. Both cannot use a set of Hash to explain all problems.

## 6. Replication, erasure coding and fault domains

1. Why can’t Checksum replace redundancy? Why can't redundancy replace Checksum?
2. Three replicas are all in the same rack. What can and cannot resist?
3. Under what conditions can PUT release the manifest? Why might PUT be rejected when the dependency is unavailable?
4. Compare the capacity, normal read, degraded read, write and repair of three replicas and $(k+m)$ EC.
5. Why doesn’t $m=4$ automatically equal “four AZs to lose”? How should $(8+4)$ be placed to resist complete failure of any one of the three AZs?
6. Why can old and new Fragments coexist in Layout Migration, but Manifest can only point to a complete Generation?
7. When is small Object more suitable for Replica/Packing rather than direct EC?

Passing criteria: When selecting a redundancy scheme, the Failure Domain, acknowledgment conditions, capacity amplification, read path and Repair cost are expressed simultaneously; annual durability cannot be directly derived from the number of replicas.

## 7. Checksum, Scrub and Repair

1. What do Object, Chunk and Fragment Checksum protect respectively?
2. Why can’t cold objects be protected by only verifying during GET?
3. What do Scrub Coverage Age and Repair Age prove respectively?
4. Why should Repair create and verify new Fragments, CAS switch manifests, and then delay the recycling of old Fragments?
5. What is Degraded Object? By what risk should the Repair Queue be sorted?
6. If the fault domain loses $D_{repair}=10$ PB and hopes to repair it within 7 days, use $BW_{repair,min}\ge D_{repair}/T_{target}$ to estimate the minimum output throughput.
7. Why must front-end capacity stress testing be conducted in conjunction with Repair/Rebalance?
8. What evidence is missing for “Three copies equals 11 nines”?

Passing criteria: Minimum repair output of about 16.5 GB/s, actual read amplification, encoding, retry and front-end margin will be higher; durability comes from failure rate, correlation, discovery window, repair window and drill, not replica number slogans.

## 8. Multipart, DELETE and GC

1. Why can’t Multipart Part be seen by ordinary GET before Complete?
2. What result should be obtained by retrying the same Session + Part Number + Checksum? What about when the same Part Number carries different contents?
3. After the Complete response is lost, why can’t a new Upload be initiated directly? What should happen when the Part List conflicts with the same Session?
4. Which Chunks can be skipped by Range GET? What integrity information still needs to be verified?
5. What physical data may still exist after DELETE releases Tombstone?
6. When long GET, Layout Repair and GC are concurrent, how to prevent Fragment from being deleted in advance?
7. Why are logical invisibility, end of recovery window, and erasure of all physical copies different completion points?

Passing criteria: Multipart only changes the transmission and retry granularity, but does not change the Object atomic visible unit; DELETE first changes the Metadata, and then reclaims the physical data through reference safety and delayed GC.

## 9. Boundary judgment and completion judgment

Determine whether the following changes should be entered into Optional, Parking Lot, or a separate case, and indicate which contract is changed:

1. It is necessary to randomly rewrite the middle 4 KB of the file and support Rename / Directory Lock.
2. The three Regions must confirm the same Current Version simultaneously.
3. Users must restore data for 30 days after accidental deletion and support Legal Hold.
4. Client transmits directly through short-term Signed URL, but the permission can be revoked within one minute.
5. Any combination of queries needs to be executed by Tag, Owner and Content Type.
6. A popular video generates Tbps of download traffic.
7. 1 KB Object needs to be packaged into EC Stripe to reduce metadata and media overhead.
8. It is necessary to accurately calculate the annual loss probability of a certain layout.

Finally, give ten minutes of dictation:

1. 2 minutes: Contracts, Immutable Versions and Commit Points.
2. 2 minutes: Metadata/Data sharding and capacity estimation.
3. 2 minutes: Replica, EC and Failure Domain.
4. 2 minutes: Checksum, Scrub, Repair and Persistent Evidence.
5. 2 minutes: Multipart, DELETE/GC, three trade-offs and stop points.

After everything is satisfied, this case ends:

- Ability to eject components from pressure instead of backing S3 functionality.
- Ability to pass through PUT's crash window and interpret unknown results.
- Can do Object Count, Byte, Metadata, Request, Bandwidth and Redundancy estimation.
- Can explain how confirmed data can be recovered under Failure Domain loss and Bit Rot.
- Ability to leave cross-Region, POSIX, WORM, Signed URL and full product management out of scope.

Stop after final dictation; no more Object Storage product details are added without new real contracts, failure models, or measurement bottlenecks.
