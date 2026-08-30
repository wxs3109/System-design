# Architecture and Evolution

## Basic implementation diagram

- [Editable Draw.io source file](assets/news-feed-architecture.drawio)

The first version can start with the following components:

- The client calls the News Feed API.
- Stateless API instances handle post, follow, and homepage requests.
- Relational database holds User, Post and Follow.
- A single relational database simultaneously holds facts and performs homepage queries.

## Why was the first version designed like this?

- The relationship between functions and data is clear.
- Single database transactions are easily guaranteed to be correct.
- Short write path, no message queue and no derived feed.
- At around hundreds of peak QPS, there is no need to introduce complex distributed components from the beginning.

## First version bottleneck

The homepage must connect Follow and Post every time. As the number of user followers and posts grows:

- A single query needs to process more authors and posts.
- Popular users will amplify the reading pressure.
- After Post is sharded, it is difficult to continue executing cross-shard JOIN.
- Celebrity Account makes the candidate set of Fan-out on Read too large.

## The next step is to solve the problem of data reliability.

Don’t jump directly from a single repository to cached or asynchronous feeds. The next version will keep the data model, write path and JOIN when reading unchanged, and only add:

1. Synchronize Standby and Primary Failover;
2. WAL archiving, backup and point-in-time recovery;
3. RPO, RTO and recovery drills;
4. Idempotent retry when the submission result is uncertain.

After data security standards were met, Read Replica and Redis were added in the third version; asynchronous indexing, FeedItem, hybrid distribution, sharding and recovery platforms were added step by step.

[Enter 02 data reliable version](../02-data-reliable-version-news-feed/README.md)

[View the complete evolution route](../README.md)

[Return to the first version directory](README.md)
