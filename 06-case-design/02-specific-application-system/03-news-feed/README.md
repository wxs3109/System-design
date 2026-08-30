# News Feed: From minimal functionality to restorable production system

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Social Fan-out / Derived Timeline |
| Core invariants | Post and Follow are Source of Truth; FeedItem can be reconstructed; content that has been deleted or is not authorized to be viewed cannot remain for a long time |
| Quality attribute priority | Scalability → Availability → Freshness, while maintaining permission boundaries |
| Traffic / Data Shape | Read more and write less, attention graph is highly skewed, Celebrity Account, Fan-out and Hot Key |
| Failure strategy | Ranking failure can be downgraded to time sorting; Feed can be bounded stale; fact writes must be persisted and confirmed |
| Security Boundaries | Private Accounts, Blocks, Removal Propagation, Media Access and Abuse Prevention |
| Key Patterns | Outbox、Fan-out on Write / Read、Derived Read Model、Sharding、Replay、Reconciliation |

01–08 is an internal evolution of the same set of product functions; only in 09 did product capabilities such as Like, pictures, videos, replies, and forwarding begin to be added.

[Read first 01–08 Evolution Contract](00-0108-evolution-contract.md)

## Level 9 Route

| Level | Only solved at this level | New core capabilities | Still unresolved |
|---|---|---|---|
| [01 Basic Edition](01-basic-news-feed/README.md) | Minimal functional run-through | Single database, SQL, keyset cursor | Single point of failure, read pressure |
| [02 Data Reliable Version](02-data-reliable-version-news-feed/README.md) | Fact data will not be lost due to single node failure | Synchronize Standby, WAL, backup, PITR, RPO/RTO | Feed read pressure |
| [03 Read Extended Version](03-read-the-extended-version-news-feed/README.md) | Isolate and extend read traffic | Read Replica, Redis, Database Fallback Protection | Cache Miss still does JOIN |
| [04 Asynchronous Index Version](04-asynchronous-index-version-news-feed/README.md) | Establish reliable asynchronous data pipeline | Outbox, Events, Timeline, Following/Followers, Shadow Validation (bypass verification) | JOIN while still reading online |
| [05 Fan-out on Write (write-time distribution) version] (05-write-time distribution version/README.md) | Eliminate duplication JOIN | FeedItem, Fan-out Job/Queue, follow_id, Canary Cutover (low traffic switching) | Celebrity Account's Write Amplification |
| [06 Hybrid Fan-out version](06-hybrid-distribution-news-feed/README.md) | Celebrity Account's Fan-out cost is out of control | WRITE/READ, Mode History, two-way Merge | Single cluster capacity and hotspots |
| [07 Sharding Extended Edition](07-sharding-extension-news-feed/README.md) | Capacity, throughput and fault domain | virtual bucket, Shard Router, online migration | Silent Missing Writes, system recovery |
| [08 Recoverable Production Version](08-resumable-production-version-news-feed/README.md) | Discovery, hemostasis, repair and disaster recovery | Persistent version, Reconciliation (difference checking and repair), Replay (replay), Observability, Cross-zone recovery | New product features |
| [09 Rich Media and Interactive Version](09-rich-media-and-interactive-version-news-feed/README.md) | Expand product capabilities | Like, pictures, videos, Reply, Repost, Quote, Bookmark, Poll | Recommendation, search, DM, live broadcast |

## Fixed features and first occurrences

| Features | 01–08 | 09 |
|---|---|---|
| Plain text post/delete | Yes | Reserved |
| Follow/Unfollow | Yes | Reserve |
| Reverse chronological order Following Feed | Yes | Reserved |
| Like | None | First time joining |
| Pictures/Videos | None | First time joining |
| Reply/Repost/Quote/Bookmark/Poll | None | First time joining |

## How the data changes step by step

| Level | Fact data changes | New derived data | Migration methods |
|---|---|---|---|
| 01 | User, Post, current Follow | None | Create the table and use it |
| 02 | Table structure unchanged | None | Create Standby from snapshot; catch up to target WAL position |
| 03 | Table structure unchanged | Redis performance copy | Read Replica Shadow Read (bypass read); Cache-aside lazy loading |
| 04 | Post/Follow same transaction adds Outbox | Timeline, Following, Followers | Snapshot location + Historical Backfill (historical data supplement) + Consumption to target Outbox offset + Shadow Diff (Bypass result difference) |
| 05 | Follow migrated to follow_id life cycle | FeedItem, Fan-out Job | Valid Follow Backfill initial follow_id; FeedItem Backfill; Canary Read Cutover (low traffic switching read path) |
| 06 | Post adds distribution_mode/mode_version | Mode History; Timeline goes online | History Post defaults to WRITE; enable READ by author whitelist |
| 07 | The factual logical model remains unchanged | Shard placement, Shard Map | bucket snapshot + CDC + Shadow Read + epoch switching |
| 08 | The factual logical model remains unchanged | Persistent version, Reconciliation status, audit and recovery data | Audit first and then repair; acceptance after disaster recovery drill |
| 09 | Newly added Interaction, PostMedia, Media | Counter, Conversation, Notification, etc. | New function data starts from null; old Post is compatible with null relationships |

## The most important loss risk at each level

| Level | Risk | Line of Defense |
|---|---|---|
| 01 | Primary or disk failure lost confirmed writes | Enter 02 |
| 02 | Accidentally deleted copied to all replicas | Immutable Backup + PITR |
| 03 | Replica lag / stale cache causes temporary invisibility | lag routing, read-your-write, short TTL, fact filtering |
| 04 | DB has been submitted but events occur rarely; Backfill misses partitions | Outbox, idempotent, partition list, checksum, Shadow Diff |
| 05 | Missing FeedItem due to Batch misses or Missing Writes | Comparison of persistent jobs, unfinished scans, Backfill and old JOIN |
| 06 | Timeline Missing Writes causes READ Post to be missed | Post→Timeline Reconciliation, Shadow Read before Traffic Cutover (traffic switching) |
| 07 | Bucket Migration leaks increments or forms dual masters | CDC, authoritative writer, fencing, epoch |
| 08 | Cache staleness, DLQ backlog, Silent Missing Writes, region failure | Version verification, Replay, Reconciliation, RPO/RTO drill |
| 09 | Media/Interaction events and derived products are lost | State machine, Outbox, idempotent Worker, object and metadata Reconciliation |

## Upgrade threshold example

The following are example values ​​for discussion during interviews, not real X data, nor production thresholds that must be copied. The actual system is subject to capacity testing and cost budget.

| From | Example Threshold | Why Move to Next Edition |
|---|---|---|
| 01 → 02 | Entering formal production; single machine failure cannot be accepted and confirmed Post | Data security comes before performance expansion |
| 02 → 03 | Primary continuous CPU > 60%–70%, feed reading accounts for the majority of I/O, and write P99 is dragged down by slow queries | Move rollback read traffic out of Primary |
| 03 → 04 | cache miss Feed P99 > 500 ms; the scanning volume of high-profile users continues to grow; Redis failure can consume all Read Replica capacity | Access directions need to be organized in advance |
| 04 → 05 | Outbox/Consumer P99 lag < 10 seconds; Shadow Validation difference < 0.01%; Rebuild drill passed | The asynchronous index is trustworthy enough before tangential feed |
| 05 → 06 | A single post is expected to have a fan-out of more than one million, or a few authors contribute > 20% of the queue workload | Change to READ for extreme authors |
| 06 → 07 | The capacity or throughput utilization of any Store continues to exceed the 60%–70% safety threshold, or the hot key cannot be mitigated by caching/copying | Sharding by stable access key is required |
| 07 → 08 | The system has multiple fault domains, but Silent Missing Writes, DLQ recovery and regional RPO/RTO cannot be quantified | Establishing a closed loop for production recovery |

## "Lost data" can be divided into three categories

| Type | Example | Whether business facts are missing |
|---|---|---|
| Fact loss | Confirmed Post disappears after Primary failure | Yes, must be prevented by replication and backup of 02 |
| Derived-data Missing Write | Post exists, but one FeedItem or Timeline is missing | No, but it will temporarily miss the post and requires Replay/Reconciliation |
| Visibility is stale | The post has been unblocked or deleted, but Replica/Cache still returns the old candidate | No, but it violates product semantics and requires fact filtering and version control |

## Reading method

Each level only asks four things: what indicators at the previous level exceeded the standard; what has been added at this level; how to safely migrate data; and what new risks have been created at this level. Don't backload the final architecture to the previous version.

[Return to case design directory](../README.md)
