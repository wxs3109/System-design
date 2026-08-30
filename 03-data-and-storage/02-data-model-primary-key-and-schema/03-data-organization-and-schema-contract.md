# Data organization and Schema contract

After determining the object and key, you also need to decide which facts will only be stored in one copy, which fields will be copied for reading, and how to express status, time and version.

## Normalization: Reduce multiple writable facts

The application value of standardization is to allow a fact to have only one authoritative modification position:

```text
User(user_id, account_state, ...)
Post(post_id, author_id, ...)
```

Do not save an author account status that can be modified independently in each post, otherwise when the account is banned, a large number of posts will need to be modified, and only part of the changes may be successful.

Normalization is usually suitable for:

- Facts are updated frequently;
- Multiple objects share the same fact;
- Correctness is more important than reducing one read;
- The set has no reasonable embedding upper bound.

It does not guarantee that queries will be fast; reads across many tables may require joins or multiple fetches.

## Denormalization: Duplicate fields for explicit read paths

```text
FeedItem(
  viewer_id, post_id, author_id,
  author_display_name_snapshot,
  created_at, rank_key
)
```

The home page can do less remote reading, but the price is:

- Increase in writing or derivation work;
- The copy may be stale;
- Deletions and permission changes need to be propagated;
- Reconstruction sources must be preserved.

Signals suitable for denormalization:

- There are far more reads than writes;
- The reading path is fixed and high-frequency;
- The copy field is smaller;
- Businesses allow clear freshness windows;
- Can be reconstructed from authoritative facts.

Signs of unsuitability: What is copied is the fact that balances, permissions, etc. must be correct immediately, or the system does not have a repair and removal path. The asynchronous maintenance link belongs to `05-General Design Patterns`.

## Embedding or Reference

### Suitable for Embedding

- Child data only belongs to one parent object;
- There is a clear upper limit on the total size;
- Usually read together with the parent object;
- Requires atomic modification together;
- Little independent filtering, sorting and authorization.

For example, users can notify preferences in small quantities and have a fixed number of address snapshots in orders.

### Suitable for Reference

- Subdata has an independent life cycle;
- The collection may grow infinitely;
- shared by multiple parent objects;
- Requires independent paging, query or authorization;
- The update frequency is different from the parent object.

For example, User and Post, Workspace and Item, Video and playback events.

Don't just rely on "read once is faster"; also consider object size, update frequency, and concurrency contention.

## Status field expresses state machine

Multiple Boolean fields are prone to invalid combinations:

```text
is_paid = true
is_cancelled = true
is_refunded = false
```

When there are clear stages, use a single state with necessary timestamps:

```text
Reservation(
  reservation_id,
  state,                 // HELD, CONFIRMED, EXPIRED, CANCELLED
  held_at, expires_at, confirmed_at, cancelled_at,
  version
)
```

Status fields express current facts, and timestamps support auditing. Complete history can save state change events if it has business value. For state transfer, concurrency and compensation, see [State Machine, Compensation and Reconciliation](../../02-core-concepts/09-concurrency-control-and-distributed-transactions/04-state-machine-compensation-and-reconciliation.md).

## The time field must explain the semantics

| Field | Meaning |
|---|---|
| `created_at` | Authoritative record creation time |
| `occurred_at` | The actual time when the business event occurred |
| `received_at` | The time when the system received the request or event |
| `updated_at` | Authoritative record last modified time |
| `expires_at` | Business Lease or resource expiration time |
| `deleted_at` | Time to enter Soft Delete state |

Sorting also requires a unique tie-breaker:

```text
ORDER BY created_at DESC, post_id DESC
```

Clock drift and cursor paging see [Time, Sequence and Unique ID](../../02-core-concepts/10-time-ordering-and-unique-id/).

## Schema version allows old and new code to coexist

Distributed deployment will not allow all readers and writers to be upgraded at the same time:

- New fields will first allow missing or safe default values;
- The reader first understands the old and new formats;
- Start writing new fields on the writing end;
- Backfill history;
- Stop old fields after verifying coverage;
- Finally clean up old fields and read paths.

Event and Item Definitions are suitable for explicit saving versions:

```text
event_type = "PostPublished"
schema_version = 2

Item.definition_version = 17
Operation.definition_version = 16
```

Operation saves the version it actually executed to avoid being unable to interpret old results after the Item is updated. For complete migration, see [Schema Evolution and Life Cycle](../09-schema-evolution-and-data-life-cycle/).

## Case

### News Feed

- Post is an authoritative Entity and FeedItem is a reconstructable denormalized record;
- FeedItem can copy small display fields, but cannot replace permissions and delete facts;
- User does not embed Post list;
- `created_at + post_id` provides stable paging order.

### Ticket Booking

```text
SeatInventory(show_id, seat_id, state, hold_id, expires_at, version)
Reservation(reservation_id, user_id, show_id, state, expires_at)
Payment(payment_id, reservation_id, provider_payment_id, state)
```

- Seat status is expressed in authoritative inventory records;
- Reservation and Payment have independent life cycles;
- Payer ID is the business unique key;
- Reservation uses states instead of conflicting boolean fields.

### Multi-tenant platform

```text
Item(tenant_id, workspace_id, item_id, definition_version, state, ...)
Operation(tenant_id, item_id, operation_id, definition_version, state, ...)
Attempt(tenant_id, operation_id, attempt_id, lease_until, fencing_token, ...)
```

- Tenant explicitly enters the object;
- Operation saves the definition version;
- Attempt saves each execution;
- Retry without creating a second business operation.

## Common mistakes

- Use arrays to save unbounded collections;
- Multiple independent modifications to the same authoritative fact;
- Mistaking snapshots for auto-sync copies;
- Use multiple Boolean fields to create invalid status combinations;
- The time field does not describe business semantics;
- When adding required fields, it is assumed that all readers and writers will be upgraded at the same time.

## Checklist

- [ ] A mutable fact has only a clear authoritative writing location;
- [ ] Denormalization fields have authoritative source, freshness and deletion rules;
- [ ] There is an upper limit on the size of the embedded collection;
- [ ] status excludes invalid combinations;
- [ ] Time field can support auditing and stable sorting;
- [ ] Schema update considers the coexistence of old and new readers and writers.

[Return to the table of contents of this section](README.md)
