#Data model, primary key and Schema

This section turns the data list into a readable and writable structure. The core is not "relational or NoSQL", but:

- Which objects have independent identities and life cycles;
- Which fields must be maintained together;
- What Key to use to stably locate and constrain them;
- Whether commonly used operations can fall within the boundaries supported by the storage.

This article only designs models that are visible to the application. Locks, isolation levels, 2PC, Saga and sharding algorithms are respectively responsible for [core concept](../../02-core-concepts/).

## Learning sequence

1. [Objects, relationships and aggregation boundaries](01-objects-relationships-and-aggregation-boundaries.md)
- Entity, Value Object and Relationship;
- What data needs to be maintained together;
- Why unbounded collections should not embed single objects.
2. [Primary key, unique key and reference](02-primary-key-unique-key-and-reference.md)
- Stable ID, Business Unique Key and Composite Key;
- ID references and historical snapshots;
- How Tenant enters keys and constraints.
3. [Data Organization and Schema Contract](03-data-organization-and-schema-contract.md)
- Normalization, denormalization, embedding and referencing;
- Status, time and version fields;
- Case studies and checklists.

## Start with invariants

The model is not protecting the fields, but the Business Invariant. For example:

- The username is unique within the specified namespace;
- A user cannot follow the same person repeatedly;
- There cannot be two valid reservations for the same seat at the same event;
- An Item must belong to an explicit Tenant and Workspace;
- Operation must record the Item definition version it actually executes;
- Deleted Posts should no longer be returned by normal details queries.

Invariants determine primary keys, unique keys, object boundaries, reference versions, and which fields must be modified together. Don't draw a canonical-looking ER diagram and then expect the service code to remedy all constraints.

## What should this section produce?

Taking News Feed as an example, the minimum output is:

```text
User(user_id, username, ...)
Post(post_id, author_id, content, visibility, created_at, deleted_at)
Follow(follower_id, followee_id, created_at)
FeedItem(viewer_id, post_id, author_id, rank_key, ...)

Primary key: Post.post_id
Business Unique Key：Follow(follower_id, followee_id)
Quote: Post.author_id → User.user_id
Source/Derived: Post is Source of Truth, FeedItem is Derived View that can be Rebuild
```

This is enough to continue designing queries, indexes, and storage. There is no need to first know how index nodes are split or how database logs are replicated.

## Boundary

This section will mention "requires unique constraints", "requires atomic modification" and "allows saving of derived copies" because these are requirements of the data model; but does not explain:

- How the database implements locks and MVCC;
- Choose CP or AP when the network is partitioned;
- How to execute 2PC or Saga across services;
- How to derive a copy asynchronously and synchronously;
- How primary keys are mapped to physical shards.

These are the responsibilities of `02-Core Concepts`, `04-Infrastructure Components` and `05-Common Design Patterns`.

[Return to the table of contents of this chapter](../README.md)
