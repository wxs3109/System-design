# Object Storage：Parking Lot

The following topics are not required for completion of this case. Reopen only when real demand or measurement bottlenecks arise.

## 1. Cross-Region and global Namespace

Reopening conditions: The Region must still meet clear RPO/RTO after a disaster, or multiple Regions must concurrently read and write the same Key.

It will then need to be redefined:

- Synchronous/asynchronous replication and write acknowledgment locations.
- Current Version conflict, Region Fencing and Failover Authority.
- Cross-Region propagation of LIST, DELETE/Tombstone and Lifecycle.
- Egress, replication backlog, Seed/Rebuild and disaster drills.

Cross-AZ redundancy of a single Region cannot pretend to be Region-level disaster recovery.

## 2. Complete Versioning, WORM and compliance deletion

Conditions for reopening: The business requires user accidental deletion recovery, non-overwriteable retention, Legal Hold or provable physical erasure period.

Then design:

- Version Listing, Restore, Retention and Delete Marker product semantics.
- Object Lock, Governance/Compliance Model, Authorization and Auditing.
- Encryption Key Destruction, media erasure and external Replica / Cache deletion proof.
- A combined state machine of Version/Tombstone, Lifecycle, and Replication.

Versioning protects against logical errors and does not automatically improve physical data durability.

## 3. Complete access and encryption platform

Reopening conditions: The goal changes from storage kernel learning to real multi-tenant products.

Then redesign IAM/ACL, Bucket Policy, Signed URL, KMS Envelope Encryption, Key Rotation, Secret Isolation, Auditing and Revocation Propagation. The core path only retains the Tenant Namespace, authorized authorization boundaries after authentication, and data and does not enter the ordinary log.

## 4. Lifecycle, hot and cold layers and archiving products

Reopening conditions: Media costs, access frequency or compliance retention have become the dominant issues measured.

Then redesign:

- Migration strategy for Hot/Cool/Archive.
- Restore Job, read latency, Minimum Retention and cost.
- Lifecycle Rule conflicts, Version / Tombstone and failed retries.
- Cross-media layout migration and capacity procurement.

For the first time, you only learn "layout version migration" and do not expand the complete storage level matrix.

## 5. Small object Packing and storage engine details

Restart conditions: True Size Distribution indicates that Metadata, Fragment Header, Random IOPS, or Padding is the dominant bottleneck.

Only then will you look into Pack File, Index, Compaction, Space Reclamation, Write Amplification, SSD / HDD Placement and disk file formats. Don't design LSMs, extents, or block allocators ahead of time without small object measurements.

## 6. Full S3 Compatible Products

Reopening Conditions: The goal is protocol compatibility or commercial hosting services, not just System Design learning.

Will be covered by then:

- Complete Bucket / Object API, Header, error codes and compatible behaviors.
- Tag, Notification, Inventory, Batch Operation, Select and other functions.
- Tenant Quota, billing, console, support tools and migration.
- SLA, full monitoring, runbooks, upgrades, backups and audits.

## 7. POSIX / File Storage and arbitrary queries

Reopening conditions: The caller must randomly write, Rename, Directory Lock, shared mount in place, or query by any business field.

These requirements change the core data model and should be changed to File System, Database / Search or independent Metadata Service cases, not by constantly adding switches to Object Storage.

## 8. Reopening rules

The Parking Lot theme will enter the main design line only if it meets the following conditions:

1. Real requirements, fault models or measurement bottlenecks occur.
2. It changes the architecture, invariants, dominant capacity, fault semantics, or call contract.
3. Can explain the specific scenario in which it will fail if you don’t do it.
4. Set new completion standards and stopping points for it.

Otherwise, the Parking Lot status remains.
