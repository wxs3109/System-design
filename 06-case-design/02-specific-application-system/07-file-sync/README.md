# Design network disk synchronization system

## Case portrait

| Dimensions | Focus |
|---|---|
| Primary Archetype | Multi-device State Sync |
| Core invariants | Accepted file versions cannot be silently overwritten or lost; sharing permissions and deletion must have explicit propagation semantics |
| Quality attribute priority | Durability → Conflict Correctness → Privacy |
| Traffic / Data Shape | Large object chunking, incremental changes, multi-device offline writing, client intermittent connections |
| Failure strategy | Offline modifications are retained as explicit versions; conflicts cannot be silently overwritten; Fail-closed when metadata permissions are uncertain |
| Security Boundary | Private files, shared links, revocation, malicious files and cross-tenant isolation |
| Key Patterns | Content Addressing、Chunking、Change Log、Cursor、Optimistic Concurrency、Version History |

## Functional boundaries
- Upload and download, directory synchronization, sharing, versioning and offline editing.

## Acceptable NFR (Design Assumptions)

- Supports chunked and breakpoint resumable downloads of files up to 100 GB; the file version RPO has been confirmed to be close to 0.
- 99% of online devices see Metadata changes within 10 seconds; large file content is completed asynchronously based on bandwidth.
- The basic version uses file-level Optimistic Concurrency: concurrent offline modifications retain two explicit versions and do not silently perform block-level merging.
- Block new Metadata and signed URL access within 60 seconds of revocation; signed URLs must be short-lived and limited to Object Keys.

## Core topics
- File chunking, content addressing, deduplication and differential synchronization.
- Change log, client cursor and notification services.
- Conflict detection, version history and deletion semantics.
- Permission inheritance, malicious file scanning and bandwidth control.

## Interview questions
- How to handle when two offline devices modify files at the same time?
