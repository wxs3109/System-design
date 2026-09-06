# DP-10: Physical storage envelopes

> Status: not started. Depends on DP-08 and DP-09. Completes M4.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Translate retained logical data into explicitly owned physical storage pools and capacity proposals. Bind Object Storage capacity to executed writes in a new behavior version. Database/Search bindings follow DP-15; their physical forecasts can already be estimated here.

Physical bytes describe the modeled storage requirement. Object identity, occupancy, reservation, and commit are bounded in-run accounting state; they do not store actual object payloads or implement disks, fsync, erasure encoding, or a production object API. Atomic reservation means one indivisible simulation state transition. Durability and rebuild factors are declared assumptions, not a durability guarantee.

## Input and output contract

`PhysicalStorageProfileV1` identifies primary, derived, and backup pools; their source data; metadata/index/derived-data amplification; replication or erasure-coding factor; independent retention/snapshot schedule; provisioned bytes; maximum fill fraction; and rebuild reserve. Every factor has provenance and one accounting owner.

Outputs separate retained logical data, occupied physical bytes, reserved rebuild bytes, required provisioned bytes, and projected crossing date for each pool. Pools are not combined into one interchangeable capacity limit. Optional hot/warm/cold tiers are explicit pools with movement rules; a day-boundary movement removes bytes from one pool when adding them to another unless an explicit overlap window is modeled.

The Object Storage adapter maps capacity proposals to a versioned `capacityBytes` limit and reports current occupancy, write-capacity rejections, and deleted bytes. Other behavior versions without storage admission remain estimated-only until their adapters implement it.

## Calculation and execution rules

- Compute occupied primary data from its declared content factors and durability factor. Backup occupancy derives from its own snapshot contents, durability, and retention. Do not multiply all backups by the primary replication factor unless backup storage explicitly has that same factor.
- For occupied bytes O, rebuild reservation R, and maximum fill fraction f in `(0,1]`, `requiredProvisioned = ceil((O + R) / f)`. An alternative additive headroom input h means `f = 1/(1+h)`; expose only one active policy so headroom is not added twice.
- A projected crossing is the first day when `occupied(t) + reserved(t) > provisioned * maxFillFraction`. If a required factor is unknown, the crossing remains unknown; online throughput passing does not resolve it.
- For Object Storage writes, reserve the positive physical size delta atomically before execution so concurrent writes cannot each claim the same free space. Commit on success; release on failure/cancellation. Deletes free committed bytes on successful completion. Replacements preserve old committed data until successful commit.
- Preserve actual occupancy through reduced provisioned capacity; reject new growth as necessary, rather than deleting data to fit the new limit. Maximum-fill is a planning criterion; hard physical admission uses the explicit capacity limit and any separately configured runtime reserve.
- Forecasted future occupancy is not injected into a short run. Runtime storage events count only executed operations and the initial snapshot. Keep forecast and runtime ledgers separate.
- Read/write bandwidth from DP-08 and declared IOPS/rebuild-throughput constraints appear beside bytes. Unsupported IOPS or repair behavior stays unverified; fitting in storage does not imply all constraints pass.

## Acceptance cases

1. Logical data 100 bytes, content factor 1.2, and primary replication 3 occupy 360 primary bytes. Two unreplicated full backups of the 120-byte content occupy 240 backup bytes. At max fill 0.8 and no rebuild reserve, provision 450 primary and 300 backup bytes.
2. Raising primary replication from 3 to 4 adds 120 primary occupied bytes and leaves the declared backup pool unchanged.
3. Required occupied bytes 600 with 100 bytes rebuild reserve and max fill 0.7 require 1,000 provisioned bytes. The equivalent headroom conversion produces the same value.
4. Two concurrent 60-byte inserts into an empty 100-byte Object Storage pool cannot both commit. A cancelled reserved write releases its reservation; failed writes do not consume durable occupancy.
5. Deleting an object changes executed occupancy only after success. A future retention chart does not silently delete it during an unrelated short run.
6. A locked insufficient capacity returns an unmet constraint. Applying a supported Object Storage capacity increase changes admission behavior; an estimated-only Database profile does not claim that result.

## Completion evidence

- [ ] Pool ownership, backup, fill, rebuild, admission reservation, and mutation accounting cases pass.
- [ ] Storage forecast and online capacity evidence remain separate in the UI.
- [ ] Legacy behavior compatibility, focused checks, and `pnpm check` pass; results and commit are logged here.
