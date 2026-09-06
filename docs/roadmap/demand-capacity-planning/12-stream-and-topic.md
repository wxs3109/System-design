# DP-12: Stream and Topic planning

> Status: not started. Depends on DP-05 and DP-10. Extension milestone: M5.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Size broker publish and delivery resources without conflating logical publications, consumer groups, subscriptions, attempts, and retention. Implement Stream and Topic as separately verifiable adapter additions within this part; neither is complete merely because the other passes.

## Input and output contract

Inputs reference executable event definitions, message sizes, publication phases, partition/key distribution, consumer groups or subscriptions, acknowledgement policy, per-consumer service work, and retained-message/byte limits. Missing group behavior or partition skew remains unknown.

Output is scoped to node, partition, consumer group, or subscription: publications/s, delivery attempts/s, pending/in-flight/acknowledged copies, oldest pending age, retained logical/physical bytes, and candidate knobs. Stream knobs include partitions, consumers per group, and publish capacity; Topic knobs include publish capacity and supported per-subscription admission/backlog controls.

## Stream rules

- One publication appends one logical record to its selected partition. Each consumer group reads the record once logically; retries are attempts. Retained log bytes are not multiplied by consumer-group count.
- Derive each group's service ceiling from partition assignment and consumer behavior. Under a variant allowing at most one consumer per partition per group, active consumers are bounded by partitions and the hottest partition can limit progress.
- Recommend partitions and consumers using explicit bounded candidate enumeration and a deterministic policy minimizing partitions first, then consumers, within the declared throughput/skew model. Do not infer new partition capacity by assuming a hotspot redistributes when the key contract keeps it on one partition.
- Retention expiry can remove data before a lagging group consumes it; expose that outcome separately from successful consumption.

## Topic rules

- One publication creates one logical delivery copy per eligible subscription; filter probability must be executable or an explicit assumption. A slow subscription retains its own backlog and does not silently reduce other copies' metrics.
- Attribute physical message storage according to the actual variant: shared payload plus per-copy metadata, or independent payload copies. Do not multiply payload bytes by subscriptions if the declared store shares them.
- The existing delivery-opportunity behavior must not claim continuous draining. Introduce a versioned autonomous pump, using DP-05 wakeup/conservation rules, before recommending continuous subscription drain capacity. Preserve legacy behavior until explicit upgrade.
- Publication admission, copy admission, acknowledgement, retry, expiry, and dead-letter transitions have separate counters. Root success follows the selected publication acknowledgement boundary.

## Acceptance cases

1. A 100/s Stream with two consumer groups delivers 100 logical records/s to each group. Its retained payload rate remains 100 messages/s before durability amplification.
2. Four partitions with one active consumer each cap a group's useful parallelism at four under that variant. Adding a fifth consumer alone does not raise capacity.
3. A hot key that keeps 80% of messages on one partition remains a bottleneck after adding cold partitions; a changed key distribution must be explicit.
4. A Topic with three unfiltered subscriptions at 100 publishes/s creates 300 logical copies/s. One slow subscription grows backlog while the other two continue.
5. Backlog drains after downstream recovery without a new publication on the upgraded Topic variant. Legacy snapshots retain their previous delivery-opportunity semantics.
6. Retention expiry, retry attempts, and per-subscription metadata conserve logical records/copies and physical bytes with no duplicated amplification.

## Completion evidence

- [ ] Stream assignment, group, skew, retention, and adapter cases pass.
- [ ] Topic copy ownership, independent backlog, autonomous delivery, and adapter cases pass.
- [ ] Browser comparisons, focused checks, and `pnpm check` pass; version boundaries and commit are logged here.
