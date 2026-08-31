# Optional: calibration, repair and durability certification

This article is only read when you need to change "How durable is the data" from a slogan to a risk model, and is not a requirement for first completion.

## 1. Durability is not Availability

- Availability: Whether the request can be read and written successfully at this moment.
- Durability: Whether successfully confirmed data will be permanently lost in the future.

The system can reject PUT because the Metadata Quorum is unavailable, and Availability is reduced but no data is lost; it can also keep returning 200, but it cannot be recovered in the future due to incorrect copying or silent corruption. Availability appears to be normal but Durability has been destroyed.

Goals, indicators, and failure tests must be given separately.

## 2. End-to-end integrity chain

Checksum should cover the entire data journey:

```text
Client/Gateway receives bytes
→ Chunk segmentation
→ Encode/Copy
→ Network transmission
→ Media drop
→ Background Migration/Repair
→ GET reorganization and return
```

Relying only on the disk's own ECC or transport layer verification, it cannot detect application bugs, incorrect chunk splicing, incorrect location reads or writes, or damage being copied into "new truth."

Distinguish at least:

| Checksum level | What are the main findings |
|---|---|
| Fragment | Single media/transmission corrupted |
| Chunk / Stripe | Encoding, copying and rebuilding errors |
| Object | Part sequence, truncation, splicing and end-to-end content errors |

The ETag can be a version/conditional write identifier; unless the contract is explicit, it cannot be assumed to be an MD5 or Object Checksum.

## 3. Why Scrub is needed for latent errors

If only GET is used for verification, the corruption discovery time of cold objects may be close to the retention period. At this point another Replica may have experienced a related failure. The function of Scrub is to shorten the Latent Fault Exposure Window.

Scrub must at least prove:

- All Fragments are actually read and verified within the target cycle, instead of just scanning Metadata.
- Missions are not permanently starved by hot spots, cold tiers or slow nodes.
- Produce persistent Repair Work after damage is found, instead of just logging.
- Scrub itself is subject to bandwidth budget constraints and does not slow down front-end reading and writing.

Key indicators include `scrub_coverage_age`, checksum byte rate, Checksum Failure, uncovered Bytes and failed retries.

## 4. Repair safety process

Safe Repair does not cover "bad-looking" locations in-place:

1. Read the current Manifest Generation.
2. Rebuild from sufficient, verified fragments.
3. Write the new Fragment at the new location.
4. Reread or verify the new Fragment Checksum.
5. Use CAS to switch the Manifest from the old Generation to the new Generation.
6. Wait for the bounded Reader Generation Pin / Read Lease and safety window to end before handing the old / bad fragment to the GC.

In this way, even if the Repair Worker crashes, only the cleanable Orphan will be left, and the only recoverable copy will not be overwritten. Concurrent Repair is converged by Generation CAS.

## 5. Repair Window and Budget

Assume that the amount of data that needs to be repaired is $D_{repair}$, and the target time is $T_{target}$:

$$
BW_{repair,min}\ge\frac{D_{repair}}{T_{target}}
$$

This formula simply outputs a lower bound. EC Repair also reads at least $k$ pieces of information, and network and disk reads may be multiple times the output. The production budget also needs to consider:

- Front desk peak and tenant traffic.
- Scrub, Rebalance and Migration occurring simultaneously.
- Slow/bad nodes, retries and cross-AZ links.
- Repair Worker, Metadata and Encoding CPU.
- Capacity Watermark and new Fragment placement space.

The key metric is not "Repair Job finally completed", but whether the Age of Degraded Bytes / Object converges before the next related failure.

## 6. What inputs are required for "Multiple 9s"

The annual loss probability model relies on at least:

- Independent and correlated failure rates for Disk, Node, Rack/AZ.
- Failure Detection, Scrub Coverage and Repair Time distribution.
- Replica / EC Layout and Placement Compliance.
- Metadata loss, software bugs, accidental deletions and operational errors.
- Repair whether there is still Headroom when the capacity is almost full and the network is congested.
- Whether write acknowledgment semantics are degraded during failures.

Simple independent fault multiplication is often overly optimistic because power, firmware, deployment bugs, credential or operational errors can create dependent faults. Models should be calibrated through historical data, fault injection, and recovery exercises.

## 7. Minimum verification matrix

| Injection | Results to Observe |
|---|---|
| Single Fragment Bit Flip | Read / Scrub found, does not return silent error bytes |
| Single Disk / Node is lost | Degraded Read is successful, Repair enters the target window |
| Single AZ is lost | The remaining layout can be restored, Repair does not overwhelm the front desk |
| Repair crashes midway | Manifest still points to full old or full new Generation |
| Metadata Replica failure | Confirmed that Manifest is not lost; reject PUT when writing cannot be done safely |
| Capacity approaching Watermark | Repair / GC has reserved space, normal writes are controlled and restricted |
| Error deployment produces bad chunks in batches | Canary / batch release limits the impact and retains known good Generation; Checksum only finds byte inconsistencies relative to trusted expected values ​​and cannot block all common pattern semantic errors |

## 8. Versioning protects another type of risk

Preserving historical Object Version can recover logical accidental deletion or incorrect overwriting, but it cannot replace physical redundancy:

- All Versions may share the same failed Failure Domain.
- Software bug may delete the entire Version History by mistake.
- Versioning increases capacity and deletes management, and does not automatically create immutable backups.
- WORM/Legal Hold also requires independent authorization, retention and compliance contracts.

Therefore, Physical Durability, Logical Recovery, and compliance immutability are modeled separately.

## 9. When to stop

Stop after you can explain the following questions:

- What do Checksum, Redundancy, Scrub and Repair protect respectively.
- Why cold objects need to be actively verified.
- Repair How to avoid overwriting the last good data.
- How to convert Repair Window into capacity budget.
- Why the number of copies does not independently prove "11 nines".

Without true failure rates and operating data, precise annual loss probabilities to the decimal point cannot be produced.
