# Component comparison table

Supplement it line by line during subsequent study, and do not replace the design reasons with product names.

| Capabilities | Problems solved | Key choices | Main costs | Typical cases |
|---|---|---|---|---|
| Cache | Reduce latency and backend pressure | Local/distributed, update strategy | Invalidation and consistency | Feed, Hot Data |
| CDN | Distribute static or media content nearby | Origin Fetch, Cache Key, expiration | Stale data and costs | YouTube, Map Tile |
| Replication | Availability, durability and read scaling | Synchronous/asynchronous, topology | Latency and consistency | Database, object storage |
| Sharding | Split capacity and throughput pressure | Sharding keys, routing, migration | Cross-shard operations | Feed, S3 metadata |
| Message Queue | Decoupling and buffering traffic bursts | Delivery Semantics, ordering, retries | Repeating and Backlog | Notifications, transcoding |
| Load Balancer | Distributing requests and isolating faults | L4/L7, Health Check | Status and single points of risk | All online services |
| Search Index | Supports full-text and complex retrieval | Index structure, Refresh Interval | Write Amplification and Eventual Consistency | Search, log |

## Questions to be expanded

- When should you not use this component?
- What is its failure mode?
- How does it scale, monitor and recover?
