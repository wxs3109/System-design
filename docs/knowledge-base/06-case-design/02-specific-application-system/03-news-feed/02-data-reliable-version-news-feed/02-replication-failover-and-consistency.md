# Replication, Failover and Consistency

## Topology

```text
News Feed API → DB Proxy / Stable Endpoint → Primary
                                             ├─ synchronous Standby
                                             └─ asynchronous DR replica
```

Synchronous Standby protects against single node failures; asynchronous DR replica and WAL Archive protect against larger-scale failures.

## Write confirmation

Primary writes the transaction to WAL and waits for confirmation from local persistence and synchronization replicas before committing. The trade-off is:

- Waiting for replicas: higher latency, but single-node RPO can be 0;
- Only wait for Primary: lower latency, but confirmed writes may be lost if Primary becomes corrupted before replication.

This version chooses the former because Post and Follow are non-reconstructible facts.

## Failover

1. Health Monitor determines that Primary is unavailable.
2. Fencing prevents the old Primary from continuing to accept writes to avoid split brain.
3. Select the Standby that has been caught up to the target WAL position and promote it to the new Primary.
4. The Stable Endpoint points to the new Primary.
5. The application re-establishes the connection and retries the idempotent request.

You can’t just “point DNS there”. Without fencing, both Primarys may receive attention and delete posts.

## Uncertain result

The client received a timeout during commit and the transaction may have succeeded. The solution is not to blindly retry:

- Post using `Idempotency-Key`;
- Pay attention to using unique keys;
- Offset and soft delete themselves are idempotent state changes;
- The same business result is returned before and after retrying.

## Why Standby is not responsible for reading

If Read Routing is introduced at the same time in this version, the two issues of "data not lost" and "read expansion" will be mixed together. Standby was first specifically used for Failover; in the third edition, independent Read Replica was added.

[Return to the second version directory](README.md)
