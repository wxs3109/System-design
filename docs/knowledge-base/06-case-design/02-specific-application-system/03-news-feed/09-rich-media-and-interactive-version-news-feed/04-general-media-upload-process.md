# General media upload process

## Why can’t it go through Post Service?

Images and videos are much larger than JSON requests. If the file goes to Post Service first:

- Application bandwidth and memory are occupied by large files;
- Instance scaling and upload connection binding;
- Upload retries will go through the business service again;
- Video upload times may exceed normal API timeouts.

So the control plane goes through Media Service, and the data plane goes directly to Object Storage.

## Three-stage process

### 1. Create Upload Session

```text
Client → Media Service → Media Metadata Store
```

Media Service verifies the file declaration, user quota and rate limit, creates `media_id` and upload session, and returns the pre-signed multipart upload URL.

### 2. Direct upload

```text
Client → Object Storage Staging Bucket
```

The client uploads in parts, and only the missing part is retransmitted when it fails. Submit the checksum, part list, and `media_id` when completed.

### 3. Scanning and processing

```text
ObjectCreated → MediaEvents → Scan Worker → Image/Video Pipeline
```

The server re-sniffs MIME, verifies size and checksum, performs malicious file scanning, content security detection and transcoding. Only Media that is `status = READY` and allowed by the audit policy can be bound to a public Post.

## How to cite Media when posting

Client call:

```json
{
  "text": "hello",
  "media_ids": ["m1", "m2"],
  "idempotency_key": "request-123"
}
```

Post Service must verify:

- Media belongs to the current user;
- Media is READY, or the product explicitly allows PROCESSING placeholder publishing;
- The type, quantity and combination comply with the rules;
- Media has not been bound to other Posts that do not allow reuse;
- moderation_state allows publishing.

Post, PostMedia and Post Outbox are submitted in the same transaction. Object storage cannot participate in this database transaction, so the Media state machine and orphan cleanup are very important.

## Orphan object

Users may never post after uploading. The Cleanup Worker periodically deletes objects and variants that have exceeded their retention period and have no PostMedia references.

Do not hard delete immediately after the upload session has timed out: the client may be completing the last part. Cleanup requires a grace period and is subject to the reference status of the Metadata Store.

## Download path

```text
Feed API returns Media Variant metadata
Client → CDN → Media Origin / Object Storage
```

Public media uses URLs that are unguessable and versionable. Protected content uses short-lived signed URLs, signed cookies, or CDN Edge Authorization.

[Return to the ninth edition directory](README.md)
