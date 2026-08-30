# Primary Key, Unique Key and Reference

Primary Key solves "how to position objects stably", Business Unique Key solves "what cannot be repeated", and Reference solves "how to maintain relationships between objects". The three cannot be confused.

## Primary Key: Stable positioning record

The primary key should be at least:

- Unique within the namespace;
- Remain stable after creation;
- Does not rely on easily changing business meaning;
- Can be reliably referenced by APIs, events and other records.

### Natural Key

The natural key comes from the business, such as the ISO country code. The advantage is that it has direct meaning, but the risk is that the business rules may change.

Email, username, and mobile phone number are generally not suitable as User primary keys because they will change, be reused, or require privacy processing.

### Surrogate Key

Surrogate keys do not carry business meaning:

| Selection | Common properties | Things to note |
|---|---|---|
| Database auto-increment ID | Compact and simple to generate for a single database | Coordination across independent writing points is inconvenient and may also expose quantity trends |
| Random UUID | Multiple nodes can be generated independently | Larger, random writes are detrimental to locality of some indexes |
| Time-ordered IDs | Distributedly generated and roughly ordered | Need to understand clocks, collision boundaries, and information exposure |

Here only the external properties need to be grasped. See [Time, Sequence and Unique ID](../../02-core-concepts/10-time-ordering-and-unique-id/) for generation and sorting semantics.

### Composite Primary Key

Relationships and scoped objects often use composite keys:

```text
Follow PRIMARY KEY (follower_id, followee_id)
WorkspaceItem PRIMARY KEY (tenant_id, workspace_id, item_id)
```

Composite keys can express uniqueness and positioning prefixes, but too many fields will expand references and secondary indexes. It is necessary to distinguish whether the logical scope field and the physical primary key must contain it.

## Primary Key does not replace Business Unique Key

```sql
CREATE TABLE posts (
    post_id          BIGINT PRIMARY KEY,
    author_id        BIGINT NOT NULL,
    idempotency_key  VARCHAR(64) NOT NULL,
    content          TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL,
    UNIQUE (author_id, idempotency_key)
);
```

`post_id` is used for citations; `(author_id, idempotency_key)` prevents repeated creation of Posts by the same request by the same author.

| Stable ID | Business Unique Key | Meaning |
|---|---|---|
| `user_id` | Normalized `username` | Username cannot be repeated |
| `payment_id` | `(provider, provider_payment_id)` | The same external payment can only correspond to one record |
| `item_id` | `(tenant_id, workspace_id, normalized_name)` | Unique name within Workspace |
| `reservation_id` | Valid status constraints for events and seats | Preventing overbooking of seats |

A final example might require a conditional unique constraint or a conditional update of an authoritative inventory record. For specific concurrency protection, see [Concurrency Control and Distributed Transactions](../../02-core-concepts/09-concurrency-control-and-distributed-transactions/).

## Reference use ID

```text
Post.author_id → User.user_id
Operation.item_id → Item.item_id
```

Don't use display name references because renaming forces a lot of cascading modifications.

However, the following information can be intentionally saved as a snapshot:

- The product name and price when the order is saved and completed;
- The legal address at which the invoice is saved;
- Operation saves the actual executed `definition_version`;
- FeedItem saves the author name for fast rendering, while retaining `author_id`.

The snapshot should state whether it is historical fact or read-optimized, whether it follows authoritative object updates, and whether staleness affects permissions or funding.

## How to enter Key for Tenant

Tenant should not only exist in login token. It usually goes into:

- Record scope;
- unique constraint;
- Query conditions;
- Audit and delete tasks;
- Object key or mapping relationship.

For example, Item names are usually not globally unique:

```text
UNIQUE (tenant_id, workspace_id, normalized_item_name)
```

Background tasks and events should also carry verifiable Tenant context to avoid cross-tenant operations based on just one Item ID. See [Multi-tenant data layout](../08-multi-tenant-data-layout/) for the complete layout.

## Case Check

### News Feed

```text
Post: PRIMARY KEY (post_id)
Post: UNIQUE (author_id, idempotency_key)
Follow: PRIMARY KEY (follower_id, followee_id)
```

One button locates the Post, one button prevents repeated posting, and one button prevents repeated following.

### Payment

```text
Payment: PRIMARY KEY (payment_id)
Payment: UNIQUE (provider, provider_payment_id)
```

Creating a new internal ID with each retry does not prevent the same external payment from being processed twice.

### Multi-tenant platform

```text
Item(tenant_id, workspace_id, item_id, ...)
Operation(tenant_id, item_id, operation_id, definition_version, ...)
```

Names can change; references only use stable IDs. Tenant enters queries and constraints, and definition versions enter historical running records.

## Checklist

- [ ] The primary key is stable after creation;
- [ ] Business uniqueness is not masked by surrogate keys;
- [ ] references use IDs, not variable names;
- [ ] Necessary historical information is saved as a snapshot and marked with semantics;
- [ ] Tenant enters unique constraints and access paths;
- [ ] ID selection illustrates application visibility trade-offs and does not expand the generation algorithm.

[Return to the table of contents of this section](README.md)
