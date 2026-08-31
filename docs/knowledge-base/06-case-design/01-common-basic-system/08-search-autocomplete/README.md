# Design Search Autocomplete

## Functional Scope
- Return top-$K$ suggestions based on a prefix, language, and region.
- Support full offline builds, incremental trending-query updates, and removal of sensitive suggestions.

## Out of Scope and Core Invariants

- The basic version does not implement full-document search, complex semantic retrieval, or per-user model training.
- The same index version and request context must produce a stable, explainable candidate set.

## Non-Functional Requirements (Design Assumptions)

- Handle 1,000,000 queries/s at peak, return at most 10 suggestions, and keep query P99 below 50 ms.
- Target 99.99% monthly availability; return an older validated version when the current index fails.
- Include normal trends in results within five minutes; apply sensitive-term or mandatory removals across every serving path within 60 seconds.
- A single hot prefix must not overwhelm one node. Logs must be de-identified and have a limited retention period.

## Core Topics
- Tries, prefix indexes, and top-$K$ aggregation.
- Offline builds, incremental updates, caching, and regional trends.
- Spelling correction, personalization, sensitive terms, and privacy.

## Interview Follow-Up
- How can a sudden trend take effect within minutes?
