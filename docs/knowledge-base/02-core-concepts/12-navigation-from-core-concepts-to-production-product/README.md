# Navigation from core concepts to Production Product

This catalog is no longer responsible for product tutorials. It only answers: What type of product capabilities is a core concept usually implemented in reality, and where should you go to learn the detailed content.

The product interior can be considered a black box, but the black box contract must be known: guaranteed objects and scope of operations, configuration conditions, failure semantics, and responsibilities that the application still needs to bear.

## This directory is responsible for

- Teach how to read the product warranty instead of just memorizing the product name;
- Establish navigation between concepts, product capabilities and target chapters;
- Distinguish between the mechanisms that have been solved by the product and the responsibilities that cannot be outsourced by the application;
- Provide a unified product contract record template.

## This directory is not responsible for

- Compare database products: belong to [Data & Storage](../../03-data-and-storage/);
- Talk about Kafka, Queue, Redis, CDN, and Workflow: belong to [Infrastructure Component](../../04-Infrastructure-Components/);
- Talk about Outbox, Cache-Aside, Saga and other combined links: belong to [General Design Pattern](../../05-general-design-patterns/);
- Select a complete technology stack for News Feed, Booking, etc.: Return to [Case Design](../../06-case-design/);
- Re-talk about CAP, asynchronous, idempotent and disaster recovery principles: return to [core concept](../).

## Navigation table

| Core issues | Realistic ability categories | Detailed attribution |
|---|---|---|
| Transactions, constraints, conditional writing, read replicas | Relational database, distributed SQL, Key-Value/Document Store | 03-Data and storage |
| Point query, range query, full-text search, analysis scan | Database, search, Warehouse/Lake | 03-Data and storage |
| Asynchronous tasks, broadcast, event replay | Queue, Pub/Sub, Event Stream | 04-Infrastructure components |
| Low latency hotspot reading | Redis, Memcached, CDN | 04-Infrastructure components |
| Long process, Timer, activity retry | Workflow Engine | 04-Infrastructure components |
| Lease, Watch, service discovery | etcd, ZooKeeper, Consul and other coordination components | 04-Infrastructure components |
| Reliable connection between database and events | Outbox/CDC + Broker + Consumer | 05-General Design Patterns |
| Cache cooperates with Source-of-Truth Database | Cache-Aside and other read links | 05-General Design Patterns |
| The final technology stack for specific business | Multiple storage, component and mode combinations | 06-Case design |

## Keep documentation

- [How to correctly understand "the product has been made"](01-correctly-understand-the-product-has-been-made.md)
- [Product capabilities and application responsibility boundaries](05-product-capability-and-application-responsibility.md)

Other detailed product pages have been moved out of the course planning of this catalog; they will be absorbed as needed when the corresponding chapters are expanded, instead of maintaining a second set of content here.

## Master the depth

| Depth | Requirements |
|---|---|
| Using Contracts | Must Master: Guarantees, Scope, Configuration and Failure Semantics |
| Design and Recovery | Must Master: Partition Key, Idempotency, Hotspot, Backlog, Replay and Reconciliation |
| Internal mechanisms | Just understand the intuition that affects external behavior |
| Implementation source code | Application-level System Design is usually not required |

The learning criterion is not whether you can implement Kafka or a database, but whether you can explain why you chose it, what guarantees it relies on, where the guarantees end, and how the system fills in the remaining responsibilities.

[Return to core concept](../)
