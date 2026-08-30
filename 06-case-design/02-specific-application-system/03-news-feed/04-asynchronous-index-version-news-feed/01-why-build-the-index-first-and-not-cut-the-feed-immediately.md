# Why build the index first and not cut the feed immediately?

## Third edition restrictions

Read Replica and Redis alleviate the pressure on the main library, but cache misses still require on-site execution of Follow JOIN Post. The next step involves organizing the data in advance.

## Why can’t I switch in one step?

At least two access directions are required before adding a FeedItem:

- `Following(Bob)`: Who Bob is currently following;
- `Followers(Alice)`: Who Alice needs to distribute to when posting.

Author Timeline is also required as a derived index for accessing Posts by author. If the indexes themselves lose data or are in the wrong order, FeedItem will only amplify the error.

Isolation strategy for ## 04

```text
Online GET /feed ─────────→ Read Replica JOIN of 03

Post / Follow + Outbox
       ↓
Events → Workers → Timeline / Following / Followers
                         ↓
Only do Shadow Validation (bypass verification)
```

Derived indexes have not yet entered the user critical path and can be safely replayed, flushed, rebuilt, and compared.

[Return to the fourth edition directory](README.md)
