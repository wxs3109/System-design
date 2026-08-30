# Specific application system

This section discusses end-to-end systems that directly complete user or business scenarios. The focus is on how the business status changes and how to combine common basic systems to form a complete link.

Each case must first use the [Portal Design Checklist] (00-Portal Design Checklist.md) to distinguish between ordinary APIs, large files, static content, long connections and high-frequency data flows. You cannot simply let all traffic pass through the API Gateway.

The case directory maintains one case per location and does not split folders based on a single quality attribute. This README also provides a multidimensional index organized by system prototypes, quality attributes, traffic shape, technical problems, and learning paths.

## Case Map

| Case | Core business closed loop | Key reused basic capabilities |
|---|---|---|
| [URL Shortener](01-url-shortener/) | Create a short link and complete the jump | API Gateway, Cache, Rate Limiter, Metrics |
| [Pastebin](02-pastebin/) | Create, share and read text | API Gateway, Object Storage, Cache, cleanup tasks |
| [News Feed](03-news-feed/) | Post, follow and read the timeline | API Gateway, Cache, Queue, Object Storage, Notification |
| [Chat System](04-chat-system/) | Establish a connection, send messages and synchronize across devices | API Gateway, Connection Gateway, Queue, Notification |
| [Video Streaming](05-video-streaming/) | Upload, transcode, distribute and play videos | API Gateway, Object Storage, Scheduler, CDN, Cache |
| [Maps & Navigation](06-maps-navigation/) | Map tiles, location search and route planning | API Gateway, CDN, Cache, stream processing |
| [File Sync](07-file-sync/) | Multi-device synchronization, sharing and conflict handling | API Gateway, Object Storage, Notification, Scheduler |
| [Ticket Booking](08-ticket-booking/) | Search, lock, pay and issue tickets | API Gateway, Cache, Queue, Scheduler, Payment |
| [Payment Processing](09-payment-processing/) | Payment, refund, accounting and Reconciliation (difference checking and repair) | API Gateway, Queue, Scheduler, Notification, Metrics |
| [Ride Dispatch](10-ride-dispatch/) | Location reporting, ride calling, matching, itinerary and pricing | API Gateway, Location Ingestion, Notification, Payment |
| [Search / Autocomplete](11-search-and-autocomplete/) | Ingest documents, build indexes, and complete search and completion | API Gateway, Event Stream, Scheduler, Cache, Index Storage |
| [Collaborative Editor](12-collaborative-editor/) | Multi-person real-time editing, offline modification and version recovery | API Gateway, Connection Gateway, Operation Log, Object Storage |
| [Ads / Clickstream Analytics](13-ads-clickstream-analytics/) | Receive events, real-time aggregation, query reports and billing verification | Event Ingestion, Event Stream, Stream Processing, Batch Processing |
| [E-commerce Order System](14-ecommerce-order-system/) | Browsing, ordering, inventory reservation, payment and fulfillment | API Gateway, Cache, Queue, Scheduler, Payment, Notification |
| [Recommendation System](15-recommendation-system/) | Generate candidates, sort, online services and continuously improve through feedback and experiments | API Gateway, Feature Store, Event Stream, Stream / Batch Processing, Cache |

The "Case Portrait" at the beginning of each case's README uses the same fields to help with horizontal comparison. `Primary Archetype` indicates the leading problem, but does not mean that the case can only be classified into one type.

The case portrait gives priority, which must then lead to a set of acceptable design assumptions. At least clarify the size, P95/P99, Availability / Durability, Freshness or propagation window of the critical link, and return the old value, Pending, Partial Result or Fail-closed on failure. Numbers are used to derive designs and do not pretend to be real product SLAs.

The case also follows the [Unified Specifications] (../00-Case Writing and Acceptance Specifications.md). When only building the skeleton, the topic selection, scope, dominant constraints, required questions, and dependency contracts should be fixed; there is no need to mark the degree of completion, and the list of component names cannot be regarded as a demonstrated design.

## Classification method

- Folder represents the case entity and answers "where is the document";
- `Primary Archetype` represents the dominant data flow or coordination model that best differentiates the case;
- Quality Attributes, Traffic Shape and Technical Problems are overlapping labels;
- The case portrait indicates the key points of learning, but does not mean that the system only has these requirements;
- No need for simple High/Medium/Low ratings. Specific invariants, failure strategies, and trade-offs should be explained during the interview.

## Select by Primary Archetype

| Primary Archetype | Case | The most worthy training question |
|---|---|---|
| Read-heavy Lookup | [URL Shortener](01-url-shortener/), [Pastebin](02-pastebin/) | Cache, Hot Key, ID, TTL, delete propagation and abuse protection |
| Social Fan-out / Derived Timeline | [News Feed](03-news-feed/) | Fan-out、Derived Read Model、Celebrity Account、Freshness |
| Realtime Messaging | [Chat System](04-chat-system/) | Long connection, message sequence, Delivery Semantics, multi-device synchronization |
| Large-object Media Pipeline | [Video Streaming](05-video-streaming/) | Direct Upload, asynchronous transcoding, Object Storage, CDN, bandwidth cost |
| Geospatial Query / Realtime Stream | [Maps & Navigation](06-maps-navigation/), [Ride Dispatch](10-ride-dispatch/) | Spatial index, location stream, nearby search, real-time calculation |
| Multi-device State Sync | [File Sync](07-file-sync/) | Change Log, Version, Conflict Resolution, Offline Modification |
| Scarce-resource Transaction | [Ticket Booking](08-ticket-booking/) | Hotspot Contention, Hold, overbooking prevention, fairness |
| Financial Ledger / Distributed Workflow | [Payment Processing](09-payment-processing/) | Idempotency、Ledger、Unknown Outcome、Reconciliation |
| Distributed Search / Ranking | [Search / Autocomplete](11-search-and-autocomplete/) | Inverted Index, Query Fan-out, Ranking, Index Freshness, Delete Propagation |
| Realtime Shared State | [Collaborative Editor](12-collaborative-editor/) | Operation Ordering、Convergence、Offline Edit、Revision |
| Write-heavy Stream Analytics | [Ads / Clickstream Analytics](13-ads-clickstream-analytics/) | Event Time、Watermark、Window、Deduplication、Backfill |
| Long-running Business Workflow | [E-commerce Order System](14-ecommerce-order-system/) | Inventory Reservation、Order State Machine、Saga、Fulfillment |
| Personalized Retrieval / Ranking | [Recommendation System](15-recommendation-system/) | Candidate Generation、Feature Freshness、Ranking Deadline、Feedback Loop、Experiment Integrity |

`Primary Archetype` is used only to point out leading problems. For example, Ticket Booking also includes Payment Workflow, and Ride Dispatch also includes Transactional State Machine, but their primary training goals are different.

## Select by quality attribute

| Want to focus on training | Preferred cases | Focus questions |
|---|---|---|
| Availability and Graceful Degradation | URL Shortener, Video Streaming, Maps & Navigation, News Feed, Search, Recommendation | Which reads can return old values? Which features can be downgraded? What else can be done after a Region failure? |
| Correctness vs. Strong Consistency | Ticket Booking, Payment, E-commerce | Which business invariant must never be broken? Reject, query or compensate when results cannot be confirmed? |
| Durability and Recovery | Payment Processing, File Sync, Chat, Video Streaming, Collaborative Editor | What facts can’t be lost? What Derived Data can be replayed or reconstructed? |
| Security and Auditability | Payment, File Sync, Chat, Ads Analytics, Recommendation | What assets are protected? Where is policy filtering Fail-closed? Do audit records prove what happened? |
| Privacy | Ride Dispatch, File Sync, Chat, Maps & Navigation, Collaborative Editor, Ads Analytics, Recommendation | Who can see locations, messages, files, documents, portraits, or behavioral events? How long does it take for revocation, consent change and deletion to take effect? |
| Low Latency and Freshness | Chat, Ride Dispatch, Maps & Navigation, News Feed, Search, Recommendation, Collaborative Editor | Do Latency and Freshness both matter? How old data can be tolerated? |
| Cost Efficiency | Video Streaming, Maps & Navigation, News Feed, File Sync, Search, Recommendation, Ads Analytics | Does the cost mainly come from Egress, Storage, Compute or Write Amplification? |
| Fairness vs. Overload Protection | Ticket Booking, Ride Dispatch, Payment Processing, Ads Analytics, E-commerce | Can a popular event or a single tenant exhaust capacity? Need a Waiting Room or Quota? |
| Abuse Prevention | URL Shortener, Pastebin, Chat, Video Streaming, Search, Recommendation, Ads Analytics, E-commerce | How to deal with Phishing, Spam, scraping, Fraud, Bot, order manipulation and resource consumption attacks? |
| Convergence and Conflict Correctness | File Sync, Collaborative Editor | How to avoid silent overwriting and final convergence when multiple writers are offline or modify concurrently? |
| Analytical Correctness | Ads / Clickstream Analytics | How do Duplicate, Late Event, Out-of-order, and Backfill affect metrics and billing? |
| Can Experiment Integrity and Feedback Correctness | Recommendation, Ads / Clickstream Analytics | Assignment, Exposure, Click, and Conversion be stably associated? How do biases, dropouts, and skewing affect conclusions? |

`Security`, `Correctness` and `Availability` cannot be mixed into one level. Payment is usually Fail-closed when authentication fails; but "avoiding repeated deductions" belongs to business Correctness, not just Security.

## Select by Traffic and Data Shape

| Traffic / Data Shape | Case | Architectural Impact |
|---|---|---|
| Read-heavy, small objects, Hot Key | URL Shortener, News Feed, Search | Cache, Read Scaling, Hot-key Protection |
| Large Objects and High Egress | Video Streaming, File Sync | Direct Data Path, Object Storage, CDN, Multipart Upload |
| Long connections and two-way messages | Chat, Collaborative Editor | Connection Gateway, Session Routing, Connection Draining |
| High-frequency location streaming | Maps & Navigation, Ride Dispatch | Dedicated Ingestion, Stream Processing, timeliness and regional sharding |
| Bursty Hotspot | Ticket Booking、News Feed、E-commerce | Admission Control、Queueing、Hotspot Isolation |
| Fan-out | News Feed、Chat、Search Query | Fan-out on Write / Read、Batching、Backpressure、Result Merge |
| Multi-device or multi-user offline writing | File Sync, Chat, Collaborative Editor | Cursor, Version, Catch-up, Conflict Resolution |
| External callbacks and indeterminate results | Payment, Ticket Booking, E-commerce | Idempotency, State Machine, Reconciliation |
| Asynchronous calculation Pipeline | Video Streaming, News Feed, Maps & Navigation, Search | Queue, Scheduler, Retry, DLQ, Replay |
| Write-heavy Event Stream | Ads / Clickstream Analytics | Partitioning、Consumer Lag、Window、Watermark、Backfill |
| CPU-heavy Distributed Query | Search、Maps & Navigation | Query Fan-out、Deadline、Result Merge、Overload Protection |
| Multi-stage online inference and feature reading | Recommendation | Candidate Budget, Feature Freshness, Ranking Deadline, Fallback, Cost Guardrail |
| Multi-entity long transactions | E-commerce, Payment, Ticket Booking | Reservation, Saga, Compensation, Reconciliation |

## Check based on core technical problems

| Technical Difficulties | Preferred Cases | Comparison Cases |
|---|---|---|
| Cache and Hot Key | URL Shortener | News Feed, Maps, Search |
| Fan-out | News Feed | Chat、Search |
| Ordering and Delivery Semantics | Chat | Payment, Collaborative Editor |
| Idempotency and Deduplication | Payment | Ticket Booking, Chat, Ads Analytics |
| Conflict Resolution | Collaborative Editor | File Sync, Chat multi-device synchronization |
| Hotspot Contention | Ticket Booking | News Feed Celebrity Account、E-commerce Flash Sale |
| Large-object Pipeline | Video Streaming | File Sync |
| Geospatial Index | Maps & Navigation | Ride Dispatch |
| Distributed Index and Ranking | Search | News Feed |
| Multi-stage recommendation and feedback closed loop | Recommendation | News Feed Ranking, Search Ranking, Ads Optimization |
| Event Time, Window and Watermark | Ads Analytics | Maps Traffic Aggregation |
| Reconciliation | Payment | News Feed、Ticket Booking、Ads Analytics、E-commerce |
| State Machine and Saga | E-commerce | Payment Processing, Ticket Booking, Ride Dispatch |
| Graceful Degradation | Maps & Navigation | News Feed、Video Streaming、Search |
| Privacy and Dispatch | File Sync | Chat, Ride Dispatch, Collaborative Editor, Recommendation |
| Offline Catch-up and Convergence | Collaborative Editor | File Sync, Chat |

## Suggested learning route

Before entering cases that rely on a large number of asynchronous links, first complete [Message Queue / Event Stream] in the general base system (../01-general base system/11-message-queue-event-stream/).

### Correctness route

URL Shortener → Ticket Booking → Payment → E-commerce

From unique mapping and idempotent creation, to shared inventory competition, ledgers and uncertain outcomes, and finally to the coordination of inventory, orders, payments and fulfillment.

### Realtime Route

Chat → Collaborative Editor → Ride Dispatch → Maps & Navigation

From long-connect messaging, to multi-person sharing and offline modification, to location streaming, matching, and large-scale geocomputing.

### Data Distribution Route

News Feed → Search → File Sync → Video Streaming

Train Fan-out and Derived Read Model, Distributed Index, cross-device synchronization, and global storage and distribution of large objects in sequence.

### Streaming Analytics Route

Chat → Maps Traffic → Ads / Clickstream Analytics

From event order and Consumer Lag, to location stream aggregation, and finally processing Event Time, Watermark, Window, Late Event and Backfill.

### Retrieval and Ranking route

News Feed → Search → Ads / Clickstream Analytics → Recommendation

First understand the derived content flow and candidate set, then learn retrieval and ranking, behavioral event quality and experimental indicators, and finally string Candidate Generation, Feature Retrieval, Ranking, Serving, Feedback Loop and Experimentation into a closed loop.

### Reliability Route

Pastebin → Chat → Collaborative Editor → Payment

Starting with object lifecycle and recovery, moving into message confirmation, Operation Log and Catch-up, and finally dealing with financial facts, auditing and Reconciliation.

### Scale and Cost Route

URL Shortener → News Feed → Search → Video Streaming

From read expansion and hot key, to write amplification, CPU-heavy query, and finally analyze storage, transcoding and CDN egress.

## How to use case portraits

After entering the case, first read the "Case Portrait" in the README and expand it in the following order:

1. Determine which writes cannot accept error results from core invariants;
2. Find the dominant capacity and cost from Traffic / Data Shape;
3. Clarify Retry, Degradation, Fail-closed or Recovery for each type of failure;
4. Determine authentication, authorization, privacy, auditing and Abuse Prevention based on security boundaries;
5. Select Queue, Cache, CDN, Database or other components last.

When the needs of the same case change, the portrait will also change. For example, the Security, Moderation, Latency, and Cost priorities of enterprise private videos and public short videos are not the same.

## Additional questions to be answered in the application case

- Who are the participants and what is the complete user journey?
- Which data are facts that cannot be lost, and which are simply derived data that can be reconstructed?
- Which business state requires Strong Consistency and where is Eventual Consistency accepted?
- How to avoid repeated locking, repeated deductions or repeated sending when retrying the same request?
- What problem does each common underlying system solve here; how does the business degrade when it fails?
- In the next phase, should we first add product features or solve scale and reliability bottlenecks?

For each key base dependency, at least complete "business responsibilities, call and data contracts, semantic assumptions, failure effects, degradation/recovery, ownership boundaries". Applications do not need to repeatedly implement common system internals, but must answer what results the business promises to users when dependencies time out, duplicate, backlog, old values, or are unavailable.
