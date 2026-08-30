# Distributed unique ID

## 1. What does ID need to meet?

Different systems have different requirements for IDs:

- Is it unique globally or unique within the Tenant;
- Whether it is roughly in order according to time;
- Can it be generated offline;
- Whether it can be guessed and enumerated by users;
- Length and indexing costs;
- Whether time, machine or business size is exposed;
- Whether it is uniform when used as a sharding key.

No one ID is best in all dimensions at the same time.

## 2. Common solutions

| Solution | Advantages | Disadvantages | Suitability |
|---|---|---|---|
| Database auto-increment | Simple, compact, orderly | Single point allocation, enumerable, cross-sharding trouble | Single database internal primary key |
| Range Allocation | Reduce center calls | Node collapse leaves holes | Write more nodes but allow discontinuity |
| UUID v4 | Locally generated, evenly distributed, hard to guess | 16-byte, randomly indexed Write Amplification | Public Resource ID |
| UUID v7 / ULID | Roughly ordered by time, locally generated | The same millisecond order requires additional processing, including time information | Logs, events, general objects |
| Snowflake class 64-bit | Compact, increasing trend, high throughput | Relies on clock and Worker ID management | Internal high QPS ID |
| Hash / content addressing | The same content and the same ID, easy to remove duplicates | The content changes and the ID changes, not suitable for variable objects | Blob, Definition Version |

## 3. Snowflake class structure

Conceptual structure:

```text
timestamp bits | worker bits | per-millisecond sequence bits
```

Advantages: No need to access the central database every time, 64-bit index is compact, sorted roughly by generation time.

Must deal with:

- Worker ID cannot be repeated;
- Pause, use logical time or switch Epoch when clock is set back;
- Wait for the next millisecond when the single millisecond Sequence is exhausted;
- ID exposure creation time and traffic trends;
- Trending increasing ID as shard key may make Range Shard hot-tailed.

"Generating uniqueness" and "distributing evenly" are two issues. You can use ID as a stable identity and then perform Hash routing on the ID.

## 4. Public ID and internal ID

Public APIs should not expose continuously increasing IDs:

- Easily enumerate other people’s resources;
-Leaking business volume;
- It is easy for crawlers to scan the entire table.

You can use random Public IDs while retaining compact Internal IDs. But random IDs are not an authorization mechanism; services must still verify tenants and permissions.

## 5. ID is not equal to idempotent key

```text
resource_id: the identity of the resource being created
idempotency_key: The identity of the caller for a business intent
event_id: The identity of a change of fact or event
operation_id: the identity of a logical operation
attempt_id: The identity of an execution attempt
```

They can sometimes be related, but have different semantics. For example, an Operation can generate multiple Attempts; retrying the same creation request should reuse the Idempotency Key and return the same Resource ID.

## 6. Case: short link

Refer to [Short Link System](../../06-case-design/02-specific-application-system/01-url-shortener/README.md). Short code requirements:

- short enough;
- Collision controllable;
- High concurrent generation;
- Not easy to enumerate;
- Can be routed evenly.

Common choices:

- Auto-increment ID + Base62: short and collision-free, but predictable, requiring center or number segment;
- Random Base62: can be generated in a distributed manner, but collisions must be checked. When the capacity approaches the upper limit of space, collisions will increase;
- Hash long URL: The same URL can be deduplicated, but truncation will cause collision, and the product may allow multiple short links to be built with the same URL.

## 7. Case: Platform Operation

In [From Item to Operation](../../06-case-design/03-platform-system/01-multi-tenant-data-platform/01-system-design-mainline/08-from-item-to-operation-define-how-to-become-a-run.md):

- `operation_id` stable means a logical operation;
- `attempt_id` changes with each Worker retry;
- `idempotency_key` allows repeated triggering to return the same Operation;
- Definition uses the content Hash to identify the immutable version;
- All IDs along with `tenant_id` go into storage keys, messages and traces.

## 8. Checklist

- What are the range and probability requirements for uniqueness?
- Does it need to be roughly ordered, or strictly ordered?
- What should I do if there is a conflict between clock rollback and Worker ID?
- Will ID cause sharding hotspots or B-Tree random writes?
- Will external exposure reveal information or facilitate enumeration?
- Are different identities used for a business intent, resource, event, and execution attempt?
