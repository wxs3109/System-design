# First define the object and scope of Consistency

## Consistency is not a global switch

The statement "data must be consistent" cannot directly guide design because it does not clarify which data it is, who is reading it, and when. To rewrite this into an implementable and testable constraint:

> For object or Invariant $X$, what states must be seen by observer $Z$ within the time window $T$ after operation $Y$ returns success; if the system cannot guarantee these states, how should this operation fail or degrade.

Four dimensions are indispensable:

| Dimensions | Questions to ask | Examples |
|---|---|---|
| Object | Which record, which Aggregate, or is it a cross-object relationship? | The relationship between a certain seat, account balance, Post and author |
| Invariant | Which state is never allowed? | The same seat for the same event cannot be sold to two people at the same time |
| Observers and Order | Who must see in what order? | The author must be able to read what he has just written |
| Time and Failure | How old can data be at most? What to do when a node loses contact? | Feed allowed 5 seconds old; returns `PROCESSING` when payment status is unknown |

## Step 1: Distinguish between Source of Truth and Derived Data

In case design, this is the most valuable classification - first classify each piece of data into one of these two categories, so that the subsequent intensity selection can be based on it.

### Source of Truth

Source of Truth determines business facts. Once lost or contradictory, the consequences are unacceptable. For example:

- Debit and credit entries in the payment ledger;
- The order's ownership of a certain inventory or seat;
- The binding relationship between users and permissions;
- Post text and deletion status.

This type of data usually requires Unique Constraint, Conditional Write, Transaction, or a single ordered write point. The meaning of "returning successful" must be hard-coded, such as "persistent to the Quorum of the ledger" rather than "already placed in the memory of a process".

### Derived Data

Derived Data can be recalculated from the Source of Truth, for example:

- Search Index；
- Feed Inbox；
- Like count, popular list;
- Cache, Materialized View, analysis reports.

This type of data is suitable for Asynchronous Update and Eventual Consistency. But "rebuildable" cannot be just a slogan: you must really retain the Source Event or have the ability to scan the Source Table, record the Consumer Offset, and prepare the Backfill and Validation processes.

### The same object may also have two semantics at the same time

Take likes as an example:

- `Like(user_id, post_id)` is the fact of likes. Use Unique Key to prevent repeated likes from the same user - belongs to Source of Truth;
- `Post.like_count` is a derived count, allowing delays and transient deviations - belongs to Derived Data;
- The user has just finished liking, and the button status needs to be Read-Your-Writes;
- The total number of seconds seen by other users. Eventual Consistency is enough.

Therefore, we cannot generally say "Use final consistency for likes", but we must separately explain how the facts, counting, and conversation experience are guaranteed.

## Step 2: Use business consequences to determine intensity

The judgment is based on "what will be the cost of violating this Invariant".

| Consequences after breach | Typical data | Tendencies | What to do when guarantees cannot be guaranteed |
|---|---|---|---|
| Loss of funds, oversold, override | Ledger, inventory ownership, ACL | Strong Consistency, or single point of authority serialization | Reject, queue, return `PROCESSING` |
| User confusion, but can be automatically recovered | Profile, Post visibility | Session Guarantee or Bounded Staleness | Read Primary, or wait for Replica to catch up with the required Version |
| Numbers temporarily mismatched | Views, total number of likes | Eventual Consistency | Delayed aggregation, background repair |
| Just cache misses the latest value | CDN, Query Cache | Can accept older values ​​| Invalidation, TTL, Origin Fetch |

Strong Consistency has latency, availability, and cross-region costs and cannot be used everywhere just because it “sounds more secure.” Eventual Consistency doesn't scale out for free either: it shifts complexity to conflict handling, user experience, observability, and remediation tools.

## Step 3: Write Invariant into an executable sentence

A good Invariant should map directly to the data model and writing protocol:

- Booking: For `(show_id, seat_id)`, there is at most one valid `CONFIRMED` owner at any time.
- Payment: The total debit amount of each accounting transaction is equal to the total credit amount; the same Idempotency Key cannot correspond to two requests with different contents.
- Quota: The sum of the tenant's reserved resources and used resources cannot exceed the Hard Quota.
- Username: The normalized username is unique within the namespace.

After writing this, I’ll ask another question: What is the scope of this Invariant? Single row, single shard, single tenant, or global across regions? The greater the scope, the generally higher the coordination costs. If you can put related writes into the same Partition through data modeling, don't use Distributed Transaction right from the start.

## Example: Hierarchical promises for News Feed

When user A posts, it can be defined like this:

1. Success is returned only after `Post` and the event to be delivered are submitted in the same Transaction;
2. After A reads his personal homepage, he must be able to see this Post;
3. The fan’s Inbox receives `FeedItem` within the 5-second target window;
4. The distribution delay does not affect whether the Post exists, and the lost Inbox can be made up by Event Log replay;
5. Delete the authoritative Tombstone first, filter when reading, and then clean up the Cache and Inbox asynchronously.

Compared with the sentence "Feed will eventually be consistent", this set of promises makes it clearer: the semantics of success, the experience of the current session, the target time for convergence, the source of recovered data, and the security of deletion. Compare the cases [Cache, Replica and Consistency](../../06-case-design/02-specific-application-system/03-news-feed/03-read-the-extended-version-news-feed/03-caching-replicas-and-consistency.md) and [Outbox Events and Derived Index](../../06-case-design/02-specific-application-system/03-news-feed/04-asynchronous-index-version-news-feed/02-outbox-events-and-derived-indexes.md) in the case.

## Fill this table first when designing

| Data/Operation | Source of Truth or Derived | Invariant | How long does it last under normal circumstances | Behavior during Network Partition | Recovery method |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

If any box cannot be filled in, it usually means that the consistency selection is still at the level of technical terms and has not completed a complete design.
