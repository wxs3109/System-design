# Design a Notification System

## Functional Scope
- Send templated email, SMS, push, and in-app notifications; schedule and cancel deliveries; and query delivery status.
- Apply user preferences, opt-outs, channel selection, priorities, and deduplication.

## Out of Scope and Core Invariants

- The system cannot guarantee that an external provider delivers to the end device. It guarantees only traceable attempts and a recorded final status.
- Ordinary retries must not bypass opt-out or authorization rules, and internal retries must not generate unlimited duplicates of one business notification.

## Non-Functional Requirements (Design Assumptions)

- Accept 500,000 notifications/s at peak while isolating transactional, security, and marketing traffic.
- Submit 99% of security notifications to an available provider within 10 seconds; marketing notifications may queue for minutes.
- Persist a message after the API accepts it. When a provider fails, fail over by channel, back off, or send the message to a dead-letter queue (DLQ).
- Apply preference and opt-out changes to unsent notifications within 60 seconds.
- Enforce quotas, cost budgets, and backpressure by tenant, channel, and provider.

## Core Topics
- Event ingestion, templates, user preferences, and channel selection.
- Priority queues, scheduling, rate limiting, retries, and deduplication.
- Provider failover, delivery receipts, opt-outs, and failure archiving.

## Interview Follow-Up
- How do you prevent marketing traffic from crowding out urgent notifications?
