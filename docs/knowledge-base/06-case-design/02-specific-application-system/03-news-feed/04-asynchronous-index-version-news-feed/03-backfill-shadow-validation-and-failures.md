# Backfill (historical data supplementation), Shadow Validation (bypass verification) and faults

## Initial Backfill

The new index cannot only consume events after going online, otherwise historical data will be permanently lost.

1. First deploy the Outbox table and write code so that all new transactions can reliably record changes.
2. Record the fact base consistency snapshot location `T0` and the corresponding Outbox high watermark.
3. Batch backfill historical Posts and current Follows from snapshots.
4. Also retain the Outbox/CDC events after `T0`.
5. After Backfill is completed, continue to consume incremental events until the entity version catches up.
6. Only after the Consumer crosses the recorded Outbox high watermark, the index is marked as caught_up.
7. Compare the row count, sampling checksum, and time bounds for each partition.

## Shadow Validation

Online `GET /feed` still returns the old JOIN result, but background sampling calculation:

- Following obtained from old query;
- Following obtained by new Following index;
- Differences between Post table and Author Timeline.

Only logs diff, does not affect response. Differences are categorized as "missing, extra, inconsistent fields, wrong order".

## Possible failure

| Failure | Result | Repair |
|---|---|---|
| Outbox Relay stops | Index delay | Monitor oldest unpublished age; consume to target Outbox offset after recovery |
| Duplicate events | Possible duplicate writes | Unique key and version check |
| Worker crashes before confirming after writing | Message re-delivery | Idempotent upsert |
| Historical Backfill missing partition | Silent less data | Partition list, checksum, Reconciliation (difference check and repair) |
| Events out of order | Old state overwrites new state | entity version / occurred_at + version |
| The entire derived library is lost | Online is not affected | Rebuilt from fact snapshot + event |

## rollback

04 The online read path has not been changed, so the rollback only needs to stop the Relay/Worker. Outbox can be retained and published after repair; factual data should not be deleted.

[Return to the fourth edition directory](README.md)
