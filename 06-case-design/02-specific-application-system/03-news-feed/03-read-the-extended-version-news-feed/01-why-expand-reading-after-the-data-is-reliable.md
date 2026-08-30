# Why expand reading after the data is reliable?

## Observed stress from the first version

The second version has protected the factual data, and the next main pressure is to focus on the homepage reading:

- The number of feed reads is usually much higher than the number of posts.
- Home page query needs to check Follow and Post, CPU and disk reading increase with the amount of data.
- The main database is responsible for both write transactions and complex read queries. Slow queries will affect posts and attention.
- The first page of the home page is opened repeatedly and has a certain cache value.

## Why not go to the message queue immediately?

The problem at this time is that the Primary reading resources are insufficient, and "Feed must be pre-generated" cannot be directly launched. Adding independent Read Replica and cache changes are smaller:

- Fact table and SQL semantics remain unchanged;
- The write path does not introduce asynchronous consistency;
- No FeedItem cleanup, retry and Reconciliation issues;
- The team can start by establishing replica latency, cache hit rate, and slow query monitoring.

## Goals of this version

| Goals | Judgment methods |
|---|---|
| Writing is not hindered by slow queries on the homepage | Main library CPU, number of connections and writing P99 stable |
| Home page capacity can be increased horizontally | Throughput increases after adding API instances and read replicas |
| Cache failure can be tolerated | Limit Origin QPS when Redis fails to prevent traffic from overwhelming the database |
| Pagination remains stable | Using `(created_at, post_id)` cursor |

## Keeping restrictions

The first page is still calculated at request time. Adding copies can only increase resources, but cannot eliminate the workload of each JOIN.

[Return to the third edition directory](README.md)
