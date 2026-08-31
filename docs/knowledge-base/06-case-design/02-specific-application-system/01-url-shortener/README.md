# Design short link system

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Read-heavy Lookup |
| Core invariants | A valid shortcode can only parse to one target in the same version; disabling or force deletion must stop jumping within a specific time |
| Quality attribute priority | Availability → Latency → Abuse Prevention |
| Traffic / Data Shape | Extreme reading and writing, small objects, popular short links to form Hot Key |
| Failure strategy | Redirect can use bounded stale cache; creation failure should be returned explicitly and conflict mappings cannot be generated |
| Security Boundary | Phishing, malicious redirects, link enumeration, anonymous creation and abuse |
| Key Patterns | ID Generation, Cache-Aside, Negative Cache, Rate Limiting, Asynchronous Statistics |

## Functional boundaries
- Create short links, jumps, custom aliases, expiration and deletion.

## Acceptable NFR (Design Assumptions)

- Peak jump 1,000,000 QPS, creation 10,000 QPS; jump P99 < 100 ms, monthly availability 99.99%.
- Redirect reads normal stale cache for no more than 5 minutes; disabling, malicious links, and force deletion stops all redirects within 60 seconds.
- Mapping cannot conflict after successful creation; permanent links do not change targets due to ordinary data migration.

## Core topics
- Short code generation and conflict handling.
- Read more and write less, cache and database sharding.
- Popular links, statistical asynchronousization and abuse protection.

## Interview questions
- How to support global low latency, permanent links and forced deletion?
