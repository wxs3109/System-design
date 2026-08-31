# 01 Basic: News Feed

> The smallest implementable version for about 100,000 DAU. Use a relational database to connect Follow and Post when reading the homepage, without pre-generating feeds.

## Reading order

1. [Scope and Scale](01-scope-and-scale.md)
2. [Data Model and Table Structure](02-data-model-and-table-structure.md)
3. [Write operation and SQL](03-write-operations-and-sql.md)
4. [Home page reading and paging](04-home-page-reading-and-paging.md)
5. [Interface and Exception](05-interfaces-and-exceptions.md)
6. [Architecture and Evolution](06-architecture-and-evolution.md)

## One sentence design

Posting and following are written directly into the relational database; when reading the homepage, Post is connected according to the current user's Follow relationship, deleted posts and posts posted before following are filtered, and then paging in reverse order according to `(created_at, post_id)`.

This version strives for simplicity and achievability. The next step is to solve the single master database failure and confirmed write loss first, and then consider performance expansion.

[Enter 02 data reliable version](../02-data-reliable-version-news-feed/README.md)

[View News Feed evolution path](../README.md)
