# Batch and Streaming Data Pipeline

Data pipelines continuously or periodically process source data into another piece of usable data. The real design focus is not the choice between Batch or Streaming, but: whether the input range can be determined, where to continue after processing is interrupted, whether repeated processing of the same data will corrupt the results, and when the output can be declared available to readers.

This article only talks about the combination of Source, Ingestion, Processor and Sink. For the single product contract of the messaging platform, see [Event Streaming Platform](../../04-Infrastructure-Components/07-event-streaming-platforms/), and for the role boundaries of online data and analytical data, see [Online Data and Analytical Data](../../03-data-and-storage/07-online-data-and-analytical-data/).

## Problems to be solved and invariants

A recoverable data pipeline must maintain at least four things:

- Which processing range each input belongs to can be identified;
- Processing progress can be restored, and process restart does not require memory guessing;
- Replay or Retry will not quietly create repeat business results;
- Readers only see the complete and verified version of the output.

“Complete” here must be defined by the business contract. A daily report might require all data due for a particular day; a real-time dashboard might only require that 99% of events be visible within five minutes, and allow late data to be revised later.

## Start with the simplest solution

| Requirements | Good starting point | When to upgrade |
|---|---|---|
| Small data volume, updated once a day | Scheduled batch tasks directly read the source and write the results | Full scan times out, or the cost of re-running after failure is too high |
| Minute-level freshness, can be processed in small windows | Micro-batch | Window waiting can no longer meet business delays |
| Second-level response, continuous input | Event streaming + resident Processor | Only used when there is a low-latency contract and continuous traffic |
| History results need to be fixed | Independent Backfill task | Online traffic paths should not be used to secretly recalculate the entire history |

Batch, Micro-batch and Streaming can share a set of business transformation logic, but their triggering, progress and release methods are different. Don’t introduce resident stream processing just for “real-time”; don’t continue to rely on adding machines to cover up the lack of incremental boundaries after the full daily tasks have exceeded the execution window.

## Participating components and state owners

| Components | What are responsible for | What should not be responsible for |
|---|---|---|
| Source | Provide files, table snapshots, changes or business events | Determine whether the results have been released for the downstream |
| Ingestion | Accept input, save location or batch boundary | Define business indicator caliber |
| Processor | Perform transformations, filtering, correlations and aggregations | Treat in-process memory as the only progress |
| Checkpoint Store | Saves confirmed input locations, windows, or batch states | Acts as a business results store |
| Sink / Output Store | Save details, indexes, features or summary results | Default claims that all writes are fully visible |
| Publisher / Catalog | Expose the verified output version to readers | Switch the current version before verification |
| Reconciler | Checks whether the source, progress and output are consistent | Replaces the normal processing link |

Authoritative business facts typically remain at Source or its upstream business system. Most of the Sink is derived data and should be able to be reconstructed; if the Sink itself becomes an authoritative ledger, its writing and auditing contracts must be additionally defined, and the assumption of "lose it and then calculate it again" cannot be applied.

## Happy Path and Success Semantics

A robust link usually proceeds in the following order:

1. Determine the input range of this round, such as file list, event location interval or business date;
2. The Processor reads the input and generates a stable Run ID for this run;
3. The results are written to the staging area with Run ID, window or output version;
4. Verify the number of records, key aggregations, invariants and error ratios;
5. Atomicly publish Manifest, Catalog pointers or current version tags;
6. Only after the release is completed, readers will consider the version available;
7. Save auditable input ranges, code versions, Schema versions, and output versions.

Different "successes" cannot be confused:

| Success position | Just means nothing |
|---|---|
| Ingestion Acceptance | The input has entered a position where processing can continue |
| Processor completed | This calculation is over and may not have been released |
| Sink writing completed | The data has been written, but may not be complete or pass verification |
| Checkpoint moves forward | The corresponding input is confirmed and processed, and must match the order of result submission |
| Output Release | The specified version has become the current result visible to readers |

## How Checkpoint and Result work together

Processing results and checkpoints are often located in two systems, and we cannot pretend that they are naturally submitted atomically:

- Advance Checkpoint first and then write the results. A crash may result in data leakage;
- Write the results first and then advance the checkpoint. After a crash, the process will be repeated;
- So usually accept at least once processing and make Sink writes idempotent by event ID, business key + version, window + output version;
- External side effects that are not idempotent should be moved out of the normal analysis pipeline, or clear deduplication and reconciliation boundaries should be added.

Exactly-once can only be established within the scope of the product's explicit coverage and cannot be automatically extended from the stream processing engine to any database, mail, or third-party API. For related semantics, see [Idempotent, Retry and Deduplication](../../02-core-concepts/06-idempotency-retry-and-deduplication/).

## Trade-offs between Batch, Micro-batch and Streaming

| Dimensions | Batch | Micro-batch | Streaming |
|---|---|---|---|
| Trigger | Time or data set ready | Short-cycle mini-batch | Continuous processing after input arrives |
| Progress unit | File, partition, batch | Small window, location interval | Partition Offset / Checkpoint |
| Typical latency | Hours to days | Seconds to minutes | Milliseconds to seconds, depending on link |
| Recovery method | Rerun failed Batch | Rerun small window | From Checkpoint Replay |
| Major costs | Peak resources, full recalculation | Scheduling and small file overhead | Resident capacity, state, and operational complexity |
| Interpretability | Easiest to determine full scope | Moderate | Must deal with lateness, out-of-order, and ongoing revisions |

Selection is based on freshness contracts, data size, lateness data, recalculation costs and team operational capabilities, not technical designations. A one-minute Micro-batch is sufficient for many “real-time” boards.

## Late Data, Out-of-order and Window

Streaming results must distinguish between event occurrence time and platform processing time. When designing, write clearly:

- Which time the window is calculated according to;
- How late you are allowed to be late, i.e. Watermark or cut-off rule;
- After the window is closed, whether late records are ignored, saved, or revised versions are published;
- What stable identity is used to remove duplicates when the same event arrives repeatedly;
- How to isolate when business time is missing or obviously wrong.

Watermark is a running judgment of "where you are willing to go given the current information," not proof that an earlier event will never arrive. Strong business cutoffs such as financial closing should be defined by business rules and cannot rely solely on the Watermark engine.

## Backfill should not corrupt online results

Backfill is used for first-time loading, fixing code defects, catching up on late data, or rebuilding derived results. It should be a controlled standalone run:

1. Fixed input time range, code version and target output version;
2. Use independent Run ID and temporary storage location, and do not directly overwrite the current results;
3. Rate limit by partition to avoid preempting online Ingestion, Broker and Sink capacity;
4. Compare the number of records, sampled data and key aggregations with the current version;
5. Execute read pointer cutover after verification passes, and keep the old version if it fails;
6. Record the covered range and allow the task to continue running idempotently.

When online streams and Backfill write the same business key at the same time, there must be version priority or isolation output, otherwise older historical recalculations may overwrite newer online results.

## Failure, Recovery and Validation

| Failure | Possible states | Recovery methods | What must be verified |
|---|---|---|---|
| Source is temporarily unavailable | The input range of this round is not completed | Keep boundaries and avoid subsequent runs | No files or locations are skipped |
| Processor crash | Part of the output has been written, Checkpoint has not been moved forward | Replay from old Checkpoint | Repeated writing does not change the result |
| Sink partial write failure | Only some partitions in the same batch | Rewrite failed partition or the entire output version | Readers did not see the semi-finished product |
| Checkpoint unavailable | Calculated but unable to confirm progress | Stop forwarding and Replay | No progress faked from local memory |
| Schema incompatibility | Poison Record or entire batch parsing failed | Replay after isolating input and fixing compatibility | Number of error records and business impact |
| Consumption backlog | Output freshness continues to decline | Rate Limiting Backfill, capacity expansion or downgrade non-critical processing | Oldest Event Age fall back |
| Conversion logic is defective | Wrong derived results have been released | Roll back to the old version and Backfill | Differences between old and new results and affected scope |

Recovery is completed not by re-running the Worker, but by re-consistent input range, progress, output and release version.

## Capacity and Observation

At a minimum, estimate: number of input events and bytes, peak ingest, cost per transition, state size, sink write throughput, retention window, and additional capacity required for replay.

Key indicators include:

- End-to-end data age, not just the number of Consumer Lag items;
- The processing speed of each Partition/input partition and the hottest partition;
- Number of success, failure, Retry and Poison Record;
- Checkpoint age and output release version;
- Differences in source record number, sink record number and key business aggregation;
- The capacity and latency impact of backfill on the online path.

## Applicable conditions, counterexamples and upgrade signals

Suitable for behavioral analysis, search index building, indicator aggregation, feature production and data import. If a small amount of data conversion can be completed in one request, direct synchronization is usually simpler; if the goal is to perform a business action with a clear completion status, Queue + Worker or workflow should be used instead of pretending to be a data flow.

Upgrade signals include: full tasks exceed the window, Data Freshness is not up to standard, Replay will overwhelm the online system, readers see half-finished products, and the inability to answer which input and code version produced a certain result.

## Interview Checklist

1. Where are the input boundaries, progress and output versions?
2. Why does current freshness require Batch, Micro-batch or Streaming?
3. What happens if the Processor crashes between writing the results and submitting the Checkpoint?
4. How to deal with Duplicate, Late Data, Out-of-order and Poison Record respectively?
5. How does Backfill isolate capacity and avoid overwriting new online results?
6. At what point is the output visible to readers, and what is verified before publishing?
7. How to prove that there are no omissions, duplications, or errors after recovery, rather than just the task turning green again?
