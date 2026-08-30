# List of roles, components and data

This chapter first fixes the independent nodes that should appear in the 09 architecture diagram. When drawing, don't combine the Media Service, transcoding workers, object storage, and CDN into one "media system" box.

## User role

| Role | Behavior |
|---|---|
| Author | Upload media, post, reply, quote, delete |
| Reposter | Repost or Cancel Repost |
| Engager | Like、Bookmark、Vote、Report |
| Feed Reader | Browse feeds, expand threads, play media |
| Moderator | Moderate, restrict, restore content |

## Synchronization Service

| Service | Read | Write or Return |
|---|---|---|
| API Gateway / Auth | token, current limiting policy | Authenticated request |
| Post Service | Media Status, Policy, Author Mode | Post, PostMedia, Post Outbox |
| Media Service | User quota, Media Metadata | Upload Session, pre-signed URL |
| Upload Completion Service | part, checksum, object metadata | Media status, MediaUploaded |
| Interaction Service | Post visibility, existing relationships | Like/Repost/Bookmark/Vote + Outbox |
| Conversation Service | Post, Conversation Index | Conversation tree and cursor |
| Feed Query Service | FeedItem、Post、Media、Count、Policy | hydrated Feed |
| Playback Service | Post/Media/Policy | Short-term manifest authorization |
| Policy Service | Follow、Block、Account、Moderation | allow / blur / deny |
| Moderation Service | Reports, model results, policies | Audit status and audit records |

## Topic and Queue

| Name | Type | Producer | Consumer |
|---|---|---|---|
| MediaEvents | Topic | Media Outbox / Storage Notification | Scan、Metadata、Moderation、Pipeline Coordinator |
| ImageProcess Queue | Task Queue | Media Coordinator | Image Worker Pool |
| VideoProbe Queue | Task Queue | Media Coordinator | Probe Worker Pool |
| VideoTranscode Queue | Task Queue | Transcode Coordinator | Transcode Worker Pool |
| VideoPackage Queue | Task Queue | Transcode Coordinator | Packager Worker Pool |
| PostEvents | Topic | Post Outbox Relay | 08's Timeline/Fan-out + Conversation + Search |
| InteractionEvents | Topic | Interaction Outbox Relay | Counter、Notification、Feed、Analytics |
| ModerationEvents | Topic | Moderation Service | Policy Cache、Feed Cleanup、CDN Purge |
| DeleteEvents | Topic | Post/Media Outbox | Feed、Conversation、Search、Media Cleanup、CDN Purge |

Topic is used for an event to be processed independently by multiple consumers; Task Queue is used for a transcoding or image task to be received by only one Worker in the Worker pool.

## Worker

| Worker | Responsibilities | Idempotent keys or conditions |
|---|---|---|
| Upload Verifier | MIME, checksum, part, quota | media_id + upload_generation |
| Malware Scan Worker | Untrusted file scanning | media_id + scan_version |
| Image Worker | Rotate, clean metadata, generate variants | media_id + variant + generation |
| Probe Worker | Read video metadata | media_id + generation |
| Transcode Coordinator | Generate rendition subtasks and summarize | transcode_job_id |
| Transcode Worker | Generate a single rendition | media_id + rendition + generation |
| Packager Worker | HLS/DASH segments and manifest | package_job_id |
| Thumbnail Worker | Video cover and preview | media_id + thumbnail_version |
| Moderation Worker | Text, image, video content detection | asset_id + policy_version |
| Conversation Index Worker | Reply/Delete Update Conversation Index | post_id + event_version |
| Counter Worker | Update interaction count | event_id deduplication |
| Notification Worker | Create and aggregate notifications | recipient_id + event_id |
| Media Cleanup Worker | Remove orphans and expired products | media_id + generation |
| CDN Purge Worker | High-risk deletion and permission revocation | asset_id + purge_version |

## Database and Storage

| Data | Recommended Storage | Partition Key | Key Content |
|---|---|---|---|
| Post / PostMedia | Distributed SQL | post_id | Text, Relation, Media Order, Outbox |
| Media Metadata | Distributed SQL or KV | media_id | State machine, owner, object key, audit status |
| Media Variant | KV / wide column | media_id | generation, variant, format, size |
| Original Media | Object Storage | object key | Original upload object |
| Derived Media | Object Storage | object key | Image variations, segments, manifest, subtitles |
| Upload Session | KV + TTL | upload_id | parts, expiry, checksum, status |
| Interaction | Distributed KV/SQL | user_id or post_id | Like, Repost, Bookmark, Vote |
| Conversation Index | Wide column/KV | conversation_id + bucket | parent, post, rank, visibility |
| Counter Store | Distributed Counter/KV | post_id + stripe | Near real-time display counting |
| Notification Store | Wide column/KV | recipient_id | Notification, aggregation status, read status |
| Moderation/Report | SQL + Audit Storage | target_id | Reporting, policy results, manual decision-making |

## Caching and CDN

| Cache | Key | Description |
|---|---|---|
| Post Cache | post_id | Text, relationship, deletion and visibility summary |
| Media Metadata Cache | media_id + generation | Variant information required for Feed hydration |
| Count Cache | post_id | Impression count, allow for short lags |
| Policy Cache | viewer/author/target version | Authorization results can only have short TTL and are subject to version control |
| CDN | media URL | images, manifests, segments; object URLs can be versioned |

## Minimum architecture diagram splitting suggestions

Don’t start by drawing a giant picture. It will be broken down into at least:

1. Image uploading and processing;
2. Video upload, transcoding and playback;
3. Reply / Repost / Quote event link;
4. Feed Hydration；
5. Deletion, review and CDN expiration.

[Return to the ninth edition directory](README.md)
