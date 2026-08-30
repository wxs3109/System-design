# Objects, relationships and aggregation boundaries

The first step in the model is to determine which data have independent identities, which are just attached values, and which relationships themselves carry business status.

## Entity: has an independent identity

If an object needs to be individually referenced, updated, audited, or deleted, it should generally have a stable ID:

```text
Post(post_id, author_id, content, state, created_at)
Video(video_id, owner_id, state, source_object_key)
Reservation(reservation_id, user_id, show_id, state, expires_at)
```

Names and titles change and are not a substitute for stable IDs.

## Value Object: attached to other objects

It is not necessary for Value to have a global identity, for example:

```text
Money(amount, currency)
ImageVariant(width, height, object_key)
Address(city, region, postal_code, ...)
```

An Image Variant may also evolve into an Entity if it later requires independent retries, audits, authorizations, and lifecycles. Boundaries depend on business operations, not type names.

## The relationship itself may also be a model

The following relationship is more than just two IDs:

```text
Follow(follower_id, followee_id, created_at)
```

If the product supports pending, blocked, source, or notification settings, this relationship will have additional fields and states. At this point it should be built into a clear model, rather than a string of IDs hidden in User.

## Aggregate Boundary: What changes are needed as a whole

The "aggregation" here is not the `SUM` of the analysis query, but a set of data that needs to jointly maintain business invariants.

Take Order as an example:

```text
Order
├── order_id
├── customer_id
├── state
├── total_amount
└── OrderLine[]
```

If "the order total is equal to the sum of the amounts of all order lines" needs to be true in one modification, Order and OrderLine usually belong to the same transaction boundary.

Customer should therefore not be embedded in every Order:

- Customer has an independent life cycle;
- A Customer is referenced by many Orders;
- Modifying customer information should not overwrite all historical orders.

Orders can still save a snapshot of the address and display name when the order was placed, because historical transactions need to reproduce the facts at that time. This is intentionally redundant.

## Do not increase the aggregation infinitely

Embedding all of a user's posts, followers, and notifications into a User will result in:

- Objects grow infinitely over time;
- Small modifications require updating large objects;
- Multiple requests compete for the same record;
- Unable to independently paging and retaining;
- Single-object atomic capability becomes a throughput bottleneck.

"Often read together" is not a sufficient condition. Also ask whether they need to jointly maintain invariants, and whether there is a clear upper bound on the set size.

## Three cases

### News Feed

- User and Post have independent life cycles and are referenced by ID;
- Follow itself expresses the current relationship and start time;
- User does not embed the Post list because the list is unbounded and requires paging;
- FeedItem is a read view and does not share the authoritative life cycle with Post.

### Ticket Booking

- Seat is a stable position within a session;
- Reservation is a user's reservation, with independent status and expiration time;
- Payment has an external payer identifier and an independent life cycle;
- All fields of Payment should not be stuffed directly into Seat.

### Multi-tenant data platform

- Item is an object saved by the user; Operation is a business run;
- Attempt is an actual execution of Operation;
- Retry can create a new Attempt, but cannot create multiple business operations;
- After the Item is updated, the old Operation must still be able to indicate the definition version it executes.

## Checklist

- [ ] Each Entity has a stable ID and a clear life cycle;
- [ ] The business fields carried by the relationship are not hidden in the objects at both ends;
- [ ] Invariants that must be maintained together fall within the boundaries of supportable atoms;
- [ ] Unbounded collections do not embed a single parent object;
- [ ] Historical snapshots have been distinguished from current authoritative facts.

[Return to the table of contents of this section](README.md)
