#Bottlenecks and upgrade signals

## What is solved in this version?

- Reading the first page becomes reading in the local order of `user_id`.
- Feed latency no longer increases linearly with the number of Bob's followers.
- Post requests do not wait for fan distribution to complete.
- Outbox and idempotent writing cover the most basic asynchronous reliability.

## New problems brought by Celebrity Account

The average author has 500 followers, and one Post generates about 500 FeedItems. Celebrity Account has 100 million followers, and one Post generates about 100 million writes.

This results in:

- Queue backlog and visible latency increased sharply;
- A large number of writes concentrated on the FeedItem shard;
- Many inactive fans will never read these copies;
- A Celebrity Account consumes most of the distribution resources of the entire system.

## Signal to enter the sixth edition

- Fan-out Latency P99 is dominated by a handful of Celebrity Accounts.
- The number or cost of distribution batches for a single Post exceeds the budget.
- The hot author's Followers partition has difficulty hosting scans.
- A few Celebrity Accounts' single Post distribution costs exceeded budget.

In the next version, all authors will no longer have a unified WRITE: ordinary authors will continue to Fan-out on Write, and Celebrity Account will be pulled from the Author Timeline when the homepage is read.

[Enter 06 Mixed Distribution](../06-hybrid-distribution-news-feed/README.md)

[Return to the fifth edition directory](README.md)
