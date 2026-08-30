# System Design Learning Map

This set of notes is used for system design interview preparation. In the first stage, a complete knowledge skeleton is established to clarify the questions to be answered for each topic; later, principles, cases, architecture diagrams and trade-offs are added layer by layer.

## Learning path

1. [Interview Method](00-interview-method/): How to clarify requirements, control scope and advance design.
2. [Back-of-the-Envelope](01-Back-of-the-Envelope/): Estimate traffic, storage, bandwidth, and number of machines.
3. [Core Concepts](02-core-concepts/): From SLO, performance and consistency, to design decisions of asynchronous, idempotent, sharding, transactions and recovery.
4. [Data and Storage](03-data-and-storage/): Starting from the access mode and data model, select storage, Schema, index and life cycle rules.
5. [Infrastructure Components](04-Infrastructure-Components/): Understand the external contracts, key configurations, limitations and failure behavior of individual off-the-shelf components.
6. [General Design Patterns](05-general-design-patterns/): Combine multiple storage and components into reusable and recoverable data flow and control flow.
7. [Case Design](06-case-design/): It is divided into reusable general basic systems, end-to-end specific application systems, and platform systems that carry multiple types of resources and workloads.
8. [Security and Observability](07-security-and-observability/): Authentication, encryption, monitoring, SLOs, and incident response.
9. [Template and Review](08-templates-and-review/): Unify answer templates, checklists and review records.

## Principles of the first stage

- Understand the problem space first and don’t memorize the only answer.
- Each topic first lists core issues, key terms and trade-off points.
- Each case covers the same required check items, but chapters can be organized according to dominant problems to facilitate horizontal comparison.
- All size figures are estimated first, and then the architecture is discussed.
- Every time a component is introduced, the problem it solves and the cost of adding it must be explained.

## Terminology convention

- Terms that the industry usually uses directly in English remain in English, such as `Fan-out`, `Backpressure`, `Watermark`, `Backfill`, `Traffic Cutover`, `Read Replica`, and `Circuit Breaker`.
- It can be written as "English term (natural Chinese explanation)" when it appears for the first time, and the English term will be used directly thereafter.
- The already accurate and natural Chinese continues to be used, such as "cache", "sharding", "transaction", "primary key" and "index".
- Don’t create your own abbreviations or slang. "Batch splitting" should be written as `Batching` or "divided into multiple bounded Batch"; "tiing" should indicate which `Offset`, `Version` or `Watermark` the catch up is; "stream cutting" should indicate whether it is `Traffic Cutover`, `Read Cutover` or `Write Cutover`.
- Terms must carry objects and boundaries. Don't just write "back to origin" "water level" or "failback", specify whether it is CDN `Origin Fetch`, cache `Database Fallback`, which `Watermark`, and whether it is executing `Rollback` or `Failback`.

## Suggested order of cases

Load Balancer → API Gateway → Cache → Rate Limiter → Object Storage → Message Queue / Event Stream → Job Scheduler → URL Shortener → News Feed → Chat → Video Streaming → Maps & Navigation → Booking → Payment。

## Subsequent iterations

- Round 2: Supplement core principles and minimal examples for each basic topic.
- Round 3: Supplement case architecture diagram, data flow and capacity estimation.
- The fourth round: rectifying fault scenarios, weighing and comparing, and interview questioning.
- The fifth round: limited time simulation and review to form a personal answer routine.
