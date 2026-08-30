# Why sharding now?

Premature sharding immediately introduces routing, cross-shard transactions, migration, and failure recovery issues. 01–06 First determine the access mode, now you know:

- Post is mainly accessed by post_id and author_id;
- Follow facts are mainly updated by follower_id;
- Followers need to be scanned by followee_id;
- FeedItem must be read by user_id;
- Author Timeline must be read by author_id.

Only after the access pattern is stable can you choose a partition key that will not be overturned frequently.

## Target

- Data capacity can be expanded by adding shards;
- A single shard failure only affects some users;
- The WRITE path of `GET /feed` usually only accesses the current user shard;
- fan-out writes are batched by target shards;
- Migrate the virtual bucket when expanding the capacity, but do not move the entire logical library.

## Invariants

Sharding only changes internal placement, not Post ordering, follow_id, WRITE/READ mode, and API semantics.

[Return to the seventh edition directory](README.md)
