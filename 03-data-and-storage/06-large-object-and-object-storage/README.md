# Large Object and Object Storage

Pictures, videos, compressed packages and model files are accessed differently from ordinary business lines. Application-level designs usually put binary content into object storage and queryable business metadata into databases.

This section only discusses this data layout and object contract, and does not design the disk, replication or erasure coding inside the object store.

## Why not put it directly into the business database?

Large objects usually have these characteristics:

- A single object is large, mainly read in whole blocks or in byte ranges;
- The content is rarely modified in place after it is written;
- The total capacity and download bandwidth are much larger than metadata;
- Requires separate retention, archiving and delivery strategies;
- The client can upload or download directly without having the application server forward all bytes.

Treating large objects as database BLOBs is not always wrong. It is probably simplest when the objects are small, few in number, and must be committed in a local transaction with the business line. But in video and file platforms, this often leaves database backup, replication, query I/O, and capacity scaling burdened by large byte streams.

## Save the two types of data separately

| Location | Saved content | Typical queries |
|---|---|---|
| Metadata Database | Owner, Status, Visibility, Object Key, Size, Type, Checksum, Version | Enumeration by Business ID, Lists and Permissions Checks |
| Object Storage | Raw bytes, transcoded results, thumbnails, fragmented files | Get, write, delete or Range Read by Object Key |

`object_key` in the database is a stable reference; temporary upload URLs, download signature URLs, and CDN URLs usually expire and should not be used as permanent business identifiers.

```text
MediaAsset
  asset_id
  owner_id
  object_key
  content_type
  size_bytes
  checksum
  state          // PENDING, READY, DELETING, DELETED
  object_version
  created_at
```

Metadata records answer "Who does this object belong to and can it be used?"; object storage answers "Where are these bytes?" Just knowing the Object Key does not equal having read permissions.

## Object Storage’s application layer capabilities

| Capabilities | What you need to know when designing |
|---|---|
| Key access | Usually positioned according to the complete Object Key, and does not undertake any business field query |
| Large capacity and high throughput | Suitable for saving large amounts of immutable bytes; actual latency, throughput, and request quotas depend on product and region |
| Range Read | You can read only a section of the file, suitable for video playback and breakpoint resume downloading |
| Metadata / Tag | Suitable for a small number of object attributes and does not replace business databases that can be queried complexly |
| Versioning | Historical versions can be retained, but will increase capacity and delete management costs |
| Lifecycle | Can be cold, archived or expired according to rules; recovery time and cost vary with storage tier |
| Checksum / ETag | Can be used to determine transmission integrity or version; please check the product contract for specific semantics |
| Signed URL | Allows the client limited access, the application is still responsible for authorization, validity period and revocation policy |

Common products include Amazon S3, Azure Blob Storage, and Google Cloud Storage. Do not infer consistency, coverage, enumeration, and cross-region recovery guarantees based on product category alone; check the public contracts for corresponding products and configurations when selecting.

## Objects are best immutable

When modifying content, first write a new Object Key or a new version, and then let the metadata switch references. This avoids the following problems:

- CDN or client cache continues to save old content with the same name;
- Process tasks while reading the object being overwritten;
- The previous version cannot be found when rolling back;
- It is impossible to determine which version of the input the late task is processing.

For example:

```text
tenant/42/assets/9f3a/source/v1
tenant/42/assets/9f3a/hls/720p/build-17/segment-00042.ts
```

Paths can help with operation and maintenance positioning, but directory semantics cannot be regarded as the only security boundary. True tenant ownership and permissions should still be determined by authoritative metadata and authorization policies.

## Completion of uploading does not mean that the business is visible

Object writes and database commits are usually not a local transaction, so there must be explicit state:

1. Create `PENDING` metadata and assign Object Key;
2. The client or service writes the object;
3. Verify object existence, size and Checksum;
4. Metadata is switched to `READY`;
5. Only `READY` objects can be officially referenced by posts, videos or Items.

If the object is written successfully first and the metadata fails to be written later, an orphan object will be generated; if the metadata exists but the object is incomplete, a dangling reference will be generated. Applications should scan for both types of differences and clean up or retry respectively. For details on messages, idempotence and retries of reliable workflows, see [General Design Pattern](../../05-general-design-patterns/).

## Life cycle and deletion

Each type of object must define at least:

- How long original content, derivatives and temporary uploads are retained respectively;
- What content can be transferred to cold storage or archived, and how long it takes to restore it;
- Whether the deletion is immediately invisible or the physical erasure is completed immediately;
- How database records, object versions, derivatives, and CDN replicas are deleted together;
- When are objects that have not been uploaded completed and those that have failed to be processed determined to be orphans;
- Whether physical removal is prevented by legal retention or audit requirements.

"Invisible to users" and "All physical copies cleared" are two completion points. External API and internal task status should be clearly distinguished.

## Case: YouTube-style video platform

In [YouTube case](../../06-case-design/02-specific-application-system/05-video-streaming/), it can be divided like this:

| Data | Placement | Role |
|---|---|---|
| Video ID, author, title, visibility, processing status | Metadata database | Authoritative business record |
| Original video | Object storage | Authoritative content object |
| Different code rates, Manifest, Thumbnail | Object storage | Reconstructible derived products |
| Playback URL | Generated at runtime | Short-term access capability, not persistent identity |
| Playback events | Event/analysis storage | Analysis input without blocking video metadata reading |

When publishing a video, it should not return "playable" immediately because the original object has been uploaded. The status goes to `READY` only if the metadata points to a set of verified playable products.

## Do not expand in this section

- Node layout, replication, erasure coding and consensus of object storage;
- Complete reliability links for upload queue, transcoding Worker and Workflow;
- CDN cache, Purge and multi-CDN strategies: see [Infrastructure Components](../../04-Infrastructure-Components/);
- Designing S3 itself: see [Object Storage Case](../../06-case-design/01-common-basic-system/05-object-storage/).

## Checklist

- [ ] Binary content and queryable metadata are stored separately;
- [ ] The Object Key is persisted, not the short-term URL;
- [ ] Each reference contains information required for version, size and integrity verification;
- [ ] `PENDING`, `READY`, deletion and other statuses have clear meanings;
- [ ] can detect dangling references and orphan objects;
- [ ] defines the life cycle of original objects, derived products and temporary objects;
- [ ] Permission judgment does not rely on "knowing the URL" or "unguessing the Key".
