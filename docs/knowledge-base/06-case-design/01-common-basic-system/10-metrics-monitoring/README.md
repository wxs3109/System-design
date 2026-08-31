# Design a Metrics Monitoring System

## Functional Scope
- Collect metrics, validate labels, store and query data, and manage dashboards and alerting rules.
- Support retention policies, downsampling, alert notifications, and silence windows.

## Out of Scope and Core Invariants

- The basic version does not serve as a unified store for arbitrary logs and traces. Unbounded label cardinality is prohibited.
- Accepted data points must be queryable by tenant and time range. Alert-state transitions must be deduplicated and auditable.

## Non-Functional Requirements (Design Assumptions)

- Ingest 10,000,000 samples/s at peak and support hundreds of millions of active time series.
- Keep P99 below two seconds for common queries over the latest hour, and keep P99 alert-detection latency below 30 seconds.
- Target 99.99% monthly ingestion availability. Agents may buffer during brief downstream failures, and the permitted data-point loss rate must be measurable.
- Retain raw data for 15 days and downsampled data for 13 months. Limit time-series count and query cost by tenant.
- Use an independent dead-man signal or external probe to detect failure of the monitoring system itself.

## Core Topics
- Push/pull collection, timestamps, and the label model.
- Time-series partitioning, compression, retention, and downsampling.
- High-cardinality controls, query aggregation, and caching.
- Alerting rules, windows, suppression, deduplication, and notifications.

## Interview Follow-Up
- How is a failure of the monitoring system itself detected?
