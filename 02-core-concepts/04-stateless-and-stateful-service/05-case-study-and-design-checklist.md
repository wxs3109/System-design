# Case study and design checklist

## 1. Shopping cart: Should I put cookies, instance memory, or database?

### Instance memory

It's fast and simple, but it will be lost if you change instances, releases or failures. Sticky Routing can only reduce the probability of this happening, but cannot meet the requirements of cross-device access and failure recovery.

### Put the complete content in Cookie

Server-side storage is eliminated, but the size is limited and the content is fully visible to the client. The signature must be tamper-proof; the price and inventory must be done an Authoritative Read at checkout anyway - the shopping cart in the cookie can never be the source of fact for the price, otherwise the user can place an order at the old price if he changes it.

### Share Cart Store

Supports cross-instance, cross-device and failure recovery at the expense of remote access latency and concurrent merge semantics. This is usually chosen to let the client carry the Cart ID; users who are not logged in use a short-term anonymous ID, and then merge it explicitly when logging in.

## 2. Video upload: why can’t we just record the progress in the API memory?

The multi-part upload of large files may take several minutes. During this period, Gateway releases and network interruptions are common. The upload session, completed Part list, and final object version should be persisted by the object storage or upload metadata service; the API instance is only responsible for verifying and issuing the upload certificate.

The client must use the same upload ID when retrying `CompleteUpload` and return the same result idempotently. In this way, the API layer can be expanded statelessly, and the real object state is managed by the Data Plane, which specializes in handling large objects. See [YouTube](../../06-case-design/02-specific-application-system/05-video-streaming/README.md).

## 3. Common mistakes

| Presentation | Missing questions | Should be added |
|---|---|---|
| "Services are stateless, so highly available" | Shared dependencies themselves may be single points | Database/Cache replicas, timeouts and degradation scenarios |
| "Save the session with Sticky Session" | What to do if the instance disappears | External, rebuildable, or explicitly accept re-login |
| "State is stored in Redis" | Is Redis the source of truth or Cache | Persistence, backup, loss semantics, and the path to read back to the source |
| "Worker has Lease and will not be executed repeatedly" | Old Worker may be restored | Fencing Token, idempotent submission |
| "With a copy, data will not be lost" | Copying will also make a copy of accidental deletions | Backup, PITR, recovery drills |
| "Autoscaling can solve traffic growth" | State dependencies and hotspots will not expand | Connection budget, sharding strategy, tenant fairness |

## 4. Design template

Fill out one copy for each component:

```text
Components:
Authoritative status:
Temporary/derived state:
Status scope: request/user/connection/partition/global
Effects of instance disappearance:
Recovery source and RTO:
Routing mode: any /sticky/directory/partition
Possibility of concurrent owners:
Epoch / Fencing rules:
Migration during expansion and contraction:
Connection Draining：
Key indicators:
```

## 5. Review questions

- The moment the user sees "success", where does the fact exist and how many fault domains has it been replicated to?
- After each local state is lost, is it performance degradation, session interruption, or business error?
- When the shared Session/Cache is unavailable, choose Fail Open or Fail Closed?
- How to restore requests or connections after Sticky expires?
- How to do Connection Draining when the long connection service is released, and how does the client avoid reconnection storms?
- Status Partition Is there any hotspot? When the Owner changes, how can the old Owner be fencing out?
- Can Snapshot and log replay be completed within RTO?
- Will Backfill and replay consume online traffic?
- Will Autoscaling fill up the database connection pool or downstream quota?
- Was the backup and recovery drill really performed, or was it only confirmed that "the backup task was executed successfully"?

[Previous section: Recovery of Stateful Service](04-scaling-and-recovery-of-stateful-service.md) · [Return to the entrance of this chapter](README.md)
