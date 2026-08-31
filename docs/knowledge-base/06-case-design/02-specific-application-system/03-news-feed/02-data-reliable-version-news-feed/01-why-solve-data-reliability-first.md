# Why solve data reliability first?

## 01 The risk is not just performance

Even if the first version only has a few hundred QPS, more serious problems may occur:

- The Primary disk is damaged and the confirmed Post or Follow is lost;
- The database host is down and all reading and writing are unavailable;
- Operation and maintenance accidentally deleted data, and there is no recoverable backup;
- The backup exists but has never been verified to be recoverable;
- The application receives a timeout and does not know whether the transaction was committed or rolled back.

These issues have nothing to do with user size. Protect business facts first, and then discuss using caching to improve throughput.

## Success semantics at this level

`POST /posts` returns successfully:

1. Post has been written to Primary’s persistent WAL;
2. Meet the configuration copy confirmation requirements;
3. Even if the current Primary goes down later, the Post should not be lost due to a normal single machine failure.

Follow, Unfollow, and Delete use the same confirmation boundary.

## Target

| Target | Recommended Value |
|---|---|
| Single node failure RPO | 0 |
| Single node failure RTO | < 5 minutes |
| Region-level backup RPO | ≤ 5 minutes |
| Accidentally deleted recovery RTO | < 1 hour |
| Recovery drills | At least quarterly |

The specific number can be adjusted, but you cannot just write "high availability" without a verifiable goal.

[Return to the second version directory](README.md)
