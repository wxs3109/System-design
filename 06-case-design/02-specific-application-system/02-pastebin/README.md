#designpastebin

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Read-heavy Content Store |
| Core Invariants | Content, visible scope, expiration time, and deletion status must belong to the same logical version |
| Quality attribute priority | Durability → Access Control → Abuse Prevention |
| Traffic / Data Shape | Read more and write less, small to medium text objects, content is usually written and changed rarely |
| Fail-closed policy | Fail-closed when permission cannot be confirmed for private content; bounded cache staleness is acceptable for public content |
| Security Boundary | Unlisted URL enumeration, malicious content, anonymous abuse, encrypted sharing |
| Key Patterns | Metadata / Content Separation、Object Storage、TTL、Signed Access、Lifecycle Job |

## Functional boundaries
- Create, read, share, expire and permission control.

## Acceptable NFR (Design Assumptions)

- The maximum text size of the basic version is 1 MB; larger content uses segmented direct transmission without going through the ordinary API Gateway.
- Public content reading P99 < 200 ms; Fail-closed when private content permissions cannot be confirmed.
- Confirmed content meets RPO < 1 minute, RTO < 1 hour; expires or is forcibly deleted and disappears from the read path within 5 minutes.

## Core topics
- Separation of text metadata and content storage.
- ID generation, caching, life cycle cleanup.
- Large objects, malicious content and access statistics.

## Interview questions
- How to add one-time reading, encrypted sharing and version history?
