# System design case template

## 1. Requirements clarification

- What are the users and core scenarios?
- What are the functional and non-functional requirements?
- What content is explicitly excluded?

## 2. Capacity estimation

- DAU, request volume, read-write ratio and peak QPS
- Data growth, retention period, bandwidth and cache

## 3. Interface and data model

- Core API
- Core entities, access patterns and indexes

## 4. High-level architecture

- Main components and responsibilities
- Write path and read path

## 5. In-depth design

- The most critical or riskiest subsystems
- Choice of Replication, Sharding, Cache, CDN, and Queue

## 6. Reliability and operation and maintenance

- Failures, retries, idempotence, degradation and recovery
- Metrics, Logs, Distributed Tracing, SLO and Alert

## 7. Tradeoffs and Evolution

- Current bottlenecks and alternatives
- The first change after increasing traffic tenfold

## 8. Interview questioning and review

- What parts might the interviewer delve into?
- Which assumptions, calculations or decisions need improvement?
