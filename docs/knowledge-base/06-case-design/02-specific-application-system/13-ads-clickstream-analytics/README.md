# Design Ads and Clickstream Analytics systems

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Write-heavy Stream Analytics |
| Core invariants | The same business event cannot be billed repeatedly; the original event must be traceable; the aggregation result must be recalculated through Replay or Backfill |
| Quality attribute priority | Ingestion Durability → Analytical Correctness → Freshness |
| Traffic / Data Shape | Extremely high Write Throughput, Append-only Event, Duplicate, Late / Out-of-order Event and multidimensional aggregation |
| Failure strategy | Dashboard can be temporarily stale; original events are persisted first; consumers can replay; billing results need to be settled after reconciliation |
| Security Boundaries | User Behavior Privacy, Consent, Data Retention, Advertiser Isolation, Fraud and Event Forgery |
| Key Patterns | Event Stream、Partitioning、Deduplication、Window、Watermark、Stream / Batch Processing、Reconciliation |

## Functional boundaries

- Receive Impression, Click and Conversion Events.
- Provides minute-level real-time metrics, historical reporting, and verifiable aggregations for billing.
- Ad Serving, bidding and the full recommendation model are not included in the Basic version.

## Acceptable NFR (Design Assumptions)

- Peak ingestion 5,000,000 Event/s; Raw Events accepted can be replayed during the retention period.
- 95% of real-time indicators can be queried 2 minutes after the Event Time, and can be corrected by late data by version.
- Dashboard allows minute-level staleness; billing results must wait for the closing window and complete deduplication, Backfill, and Reconciliation.
- Same `event_id` duplicate arrivals cannot be billed again; deletion, Consent and PII retention rules must be propagated to Raw and Derived Data.

## Core business closed loop

1. Client/Server SDK sends Event with `event_id`, `event_time` and business dimensions;
2. Ingestion Gateway verifies identity, Schema, size and Quota;
3. Event Stream saves the original Event according to the stable Partition Key;
4. Stream Processor performs deduplication, Window Aggregation and real-time indicator updates;
5. Raw events are synchronized into long-term storage, and Batch Job processes Late Events and Backfill;
6. Serving Store provides low-latency queries for Dashboard;
7. Billing Pipeline uses the closing window, Reconciliation and Audit Record to generate settlement results.

## Core topics

- `event_id`, Event Time, Ingestion Time, Processing Time and Schema Version.
- Partition Key, Ordering Boundary, Consumer Lag and Backpressure.
- Deduplication and Idempotent Aggregate under At-least-once Delivery.
- Tumbling / Sliding Window, Watermark, Allowed Lateness and Correction Event.
- How to merge Stream Result and Batch Backfill, and how to avoid indicator jumps and repeated billing.
- Raw Event Retention, PII, Consent, Delete Request, Fraud Detection and Tenant Isolation.

## Minimum data list

| Data | Roles | Typical Storage |
|---|---|---|
| Raw Event | Replayable authoritative input | Event Stream + Object Storage |
| Dedup State | Determine whether the Event has been processed | Stateful Stream Store |
| Realtime Aggregate | Minute-level Derived Data | Key-value / Analytical Store |
| Batch Aggregate | Calibration results after processing Late Event | Data Warehouse / Lakehouse |
| Billing Record | Auditable settlement facts | Relational Ledger Store |
| Schema / Consent Metadata | Validation and Governance Rules | Metadata Store |

## Key Trade-off

- Longer Allowed Lateness improves final accuracy, but delays closing and increases state capacity.
- Exactly-once end-to-end commitments are usually expensive; more realistic are At-least-once, Stable Event ID, Idempotent Sink and Reconciliation.
- High-dimensional real-time aggregation improves the query experience, but will cause State Explosion and High Cardinality costs.
- Keeping Raw Events for a longer period of time facilitates recalculation and also increases cost, privacy and compliance risks.

## Interview questions

- The event is repeated three times and spans multiple windows. How to avoid repeated billing?
- Which report and Billing Period should be modified by the Conversion arriving two days later?
- After a Stream Processor Bug persists for an hour, how can I backfill and safely replace the wrong results?

## Subsequent expansion sequence

1. Event Contract, Ingestion, Partition and Raw Storage;
2. Consumer, Deduplication, Window and Watermark;
3. Serving Store, real-time query and High Cardinality;
4. Batch Backfill, Result Version and Traffic Cutover;
5. Billing, Fraud, Privacy, Reconciliation and Recovery.
