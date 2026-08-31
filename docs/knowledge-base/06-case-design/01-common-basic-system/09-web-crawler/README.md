# Design a Web Crawler

## Functional Scope
- Discover and canonicalize URLs, schedule fetches, store responses and metadata, parse links, and perform incremental recrawls.
- Respect `robots.txt`, per-host crawl rates, and content-size limits.

## Out of Scope and Core Invariants

- The basic version does not build a complete search index, rank results, or bypass browser-level anti-automation controls.
- Scheduling state for each canonical URL must be recoverable. No site may bypass politeness policies or trap the entire frontier.

## Non-Functional Requirements (Design Assumptions)

- Fetch 100,000 pages/s at peak and support billions of pending URLs in the frontier.
- Ensure that at least 99.9% of accepted URLs are not silently lost because of node failures; retry failures according to policy.
- Apply `robots.txt` and host-policy updates within 10 minutes, with hard per-host concurrency and rate limits.
- Recrawl important pages hourly and ordinary pages daily; target a duplicate-content rate below 1%.
- Isolate DNS failures, oversized responses, crawler traps, and slow hosts, and enforce deadlines.

## Core Topics
- The URL frontier, priorities, and host-level politeness policies.
- URL and content deduplication, canonicalization, and `robots.txt`.
- Distributed crawling, failure retries, trap detection, and rate limiting.
- Content storage, change detection, and recrawl policies.

## Interview Follow-Up
- How do you prevent one site from slowing down or trapping the entire crawler?
