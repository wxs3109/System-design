# Optional: cache and source data boundaries

Read this article only if your business requires stronger read semantics than "allow bounded staleness". For the complete Cache-Aside process on the application side, see [Cache Read Link] (../../../../05-Generic Design Patterns/01-Cache Read Link/); here we only analyze the race conditions that will change the cache contract.

## 1. Baseline Contract

```text
Read: Cache HIT, or MISS after reading the Source and try to Fill
Write: Submit Source of Truth first, then invalidate Cache
```

The baseline guarantees that Source is the business fact, but it does not guarantee that the latest value is read every time. Must first declare:

- Maximum acceptable Staleness Window.
- Whether to require Read-your-writes after writing.
- When Cache or invalidation action fails, whether to read old, bypass or reject.

Without these contracts, "Database is consistent with Cache" is not verifiable.

## 2. There is still a window after deletion after submission

When the Source has been submitted and the Cache has not been deleted, the Reader can hit the old value; when the deletion fails, the old value may be retained until the TTL. TTL only limits the returnable time from Fill time; if Late Fill exists, the bounded time of read requests and failure propagation will also be added, so TTL itself is not a proof of Source-relative Staleness.

A more dangerous intersection than "delete Cache first, then write Source" is:

```text
Writer Delete Cache
→ Reader MISS, read Source old value v1
→ Writer commits new value v2
→ Reader backfill v1
```

Therefore, the baseline usually commits the Source first and then deletes the Cache, but still clears the stale window.

## 3. Late Fill

Even using commit-after-delete, this may occur:

```text
Reader A: MISS, read Source v1, paused
Writer B: Submit v2, delete Cache
Reader A: Backfill v1 after deletion
```

Simply putting `version=1` in Value is not enough to stop it: Cache may have forgotten to have seen v2 after deletion. To reject Late Fill, a comparable version lower bound is also required when writing.

Optional mechanisms and costs:

| Mechanism | What to gain | Cost / Boundary |
|---|---|---|
| Short TTL | Limit the longest natural survival of old values ​​| Cannot block windows, increase return to source |
| Bypass after writing | Current writer can Read-your-writes | Other Readers may still read old |
| Conditional Fill + Version Floor | Reject Fill below known lower bound | Requires monotonic version, atomic comparison and Floor recycling |
| Reliable failure event | Deletion failure can be eventually repaired | Still during propagation; duplication and disorder need to be dealt with |
| Authoritative reading | Directly satisfy strong semantics | Give up cache hit benefits |

## 4. When to upgrade

The baseline will only be exceeded if the following requirements are met:

- Read-your-writes must be read immediately after successful writing.
- Old values ​​for permissions, prices, or configurations have unacceptable consequences within the specified window.
- Late Fill or invalidation failures have become a source of measurable errors.
- Origin cannot afford Bypass or shorter TTL.

If linearly consistent reads are required, you should go back to authoritative storage or choose a system that provides this consistency model. Do not continue to stack "double delete" and delay parameters to pretend to be strong consistency.

## 5. Stopping point

It can stop after explaining "Deletion after submission will still be stale", "How Late Fill occurs", "Why Version Floor has one more layer of status than Value's own Version". No further design of event schema, CDC platform, multi-region failure or code implementation.
