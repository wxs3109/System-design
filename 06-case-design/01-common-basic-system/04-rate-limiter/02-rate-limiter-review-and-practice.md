# Rate Limiter: review and practice

This article does not introduce new knowledge, but only tests whether the design can be re-derived without the document. Read [Progressive Design Mainline] (01-progressive design mainline.md) first, then close the document and complete it within 45–60 minutes.

Use the same framework for each answer:

```text
stress or malfunction
→ Why the current solution failed
→ Minimal new mechanism
→ Guarantee obtained
→ Cost and Boundary
→ a verification signal
```

Does not require a complete API, Redis Key, Lua, fixed number of Shards, product selection, or cross-Region protocol.

## 1. Fixed learning contract

Limited to 5 minutes:

1. Describe the responsibilities of Rate Limiter on the request path in one sentence.
2. Explain Rate, Burst and long-period Quota respectively; which two are solved in this main line?
3. What do `ALLOW`, `DENY`, and `ERROR` stand for respectively? Does `DENY` have a consumption limit?
4. Write three clear areas of irresponsibility and explain why Counter cannot be used as a billing ledger.

Passing standards: Make it clear that this is a single-region, one-decision-one-counter online traffic control; the key comes from a trusted identity and standardized route, and does not promise strict global quotas, financial correctness or security testing.

## 2. Rebuild a single-process minimal system

Time limit is 8 minutes, don’t write Redis, RLS or control surface yet:

1. Draw `Request → Token Bucket → Backend` in Gateway.
2. Use $r$, $B$ and `cost` to explain replenishment, release and rejection.
3. Why may Fixed Window form a short-term spurt close to $2L$ near the boundary?
4. When two requests from the same process compete for the last Token, which piece of logic must be in the same critical section?
5. What are the visible results of restarting Process and initializing it with a full bucket?

Passing criteria: Be able to explain Rate and Burst separately, know that local atomicity only protects one Process, and give at least one test to prove the semantics of buckets.

## 3. Let pressure push out the structure

Don’t draw the final drawing first. Fill in the following:

| Stress or failure | Why current solutions fail | Minimal mechanisms | New guarantees | Costs/bounds |
|---|---|---|---|---|
| Gateway expanded from 1 to $N$ | | | | |
| Two RLS consume the last Token at the same time | | | | |
| Total Decision QPS exceeds single Owner capacity | | | | |
| A strict Hot Key exclusive to a Shard | | | | |
| Shared Limiter timeout | | | | |
| Rules need to be modified dynamically | | | | |

When completed, you should naturally get:

```text
Single process Token Bucket
→ Regional Shared Counter
→ Owner inner atom Check-and-consume
→ Split by Counter Key
→ Hot Key Isolation and Local Protection
→ Declare Failure Mode in advance
→ Immutable version snapshot
```

Passing criteria: Each component can point to a stress that introduces it; "production systems generally have it" cannot be used as an excuse.

## 4. Verify the correctness of the shared count

1. Each Gateway has an independent `100 req/s, burst=200` bucket. How does Fleet's long-term rate and Burst upper bound change when the number of instances is expanded from 2 to 10?
2. Why is Limit divided by the number of instances still affected by scaling, load tilting, and failover?
3. Write an interleaved sequence in which two RLSs read first and then write, and jointly consume the last Token.
4. What state transitions must be included in an atomic operation? Why is the RLS process not locking enough?
5. What do Local Limiter and Shared Limiter protect respectively? How is the order of requests arranged?

Choose a boundary question: The Store has deducted but the response is lost. Why is it possible to consume again after retrying? Why doesn't strongly consistent storage itself provide request idempotence?

Passing criteria: There is only one authoritative atomic sequence for the same Key; Local `ALLOW` cannot bypass Shared Decision. The optional questions only identify boundaries and do not deploy the duplicate removal system.

## 5. Capacity, Sharding and Hot Key

Assume that the peak value of a single Region is $Q=2{,}000{,}000$ Decision/s, and each Decision in the core contract updates a Counter.

1. Use $Q_{store}\approx Q$ to estimate Store operation volume. If each request in the future performs $k$ decisions independently, why will it be scaled up to about $kQ$?
2. Why fragment by Counter Key instead of randomly scattering requests for the same Key?
3. Ordinary Shard can expand the total throughput, why can't it be split into a strict Hot Key?
4. For Hot Key, what changes do isolation, Local Protection and Token Lease respectively? Which one would change the accuracy contract?
5. Why should the number of nodes not be hard-coded when there is no state size, key distribution and stress test data?

Passing criteria: Able to distinguish between "parallel with different keys" and "authoritative sequence with the same key", and point out that the uniform load test cannot replace the hot key test. Token Lease remains in the Parking Lot.

## 6. Failure and configuration

When the Shared Limiter times out, select `Fail-open`, `Fail-closed` or `Local fallback` for the following scenarios respectively, and write out the user results and lost guarantees:

1. Backend has its own normal read API with overload protection.
2. The call will trigger expensive and unaffordable excess external resources.
3. Ordinary multi-tenants write APIs, hoping to continue limited services when dependencies fail.

Then answer:

4. Why do calls also require short timeouts, bounded retries, and bounded concurrency?
5. Why must `DENY`, `ERROR` and downgrade release be observed separately?
6. What to do when the data plane receives half a snapshot, the old version is late, or the Control Plane is unavailable?
7. Why does a rollback still release a later version? Normal Policy Version Why shouldn't Counter be automatically reset?

Passing Criteria: Failure strategy is determined by business risk; configuration switches with full, immutable, monotonic versions, and Last Known Good is retained. Don’t move on to designing a complete publishing platform.

## 7. Boundary judgment

Each question only answers: which core conclusions are reused, which contract is changed, and whether it should be entered into `optional/`, Parking Lot or an independent case.

1. Requires precise daily API Quota, but accepts window bounds semantics.
2. Multiple rules must be All-or-nothing deducted.
3. The global quota of the three Regions is never allowed to be exceeded.
4. Counter will be directly used as the basis for customer billing.
5. Bots, attack payloads and account takeovers need to be identified.
6. The measured Hot Key exceeds the capability of a single owner, and the business allows a clear maximum over-issuance.

Judgment anchor points: Long-period Quota changes algorithm semantics; cross-Key transactions and global strict quotas change the consistency range; billing requires reconciliation of ledgers; Bot/WAF are adjacent systems; Token Lease is triggered only when bounded over-issuance is allowed.

## 8. Ten minutes of oral presentation and completion of judgment

1. 1 minute: Scenes, Boundaries, and Rate/Burst.
2. 3 minutes: Derivation of Shared Counter and atomic Owner from a single process.
3. 2 minutes: Explain the different upper limits for sharding and strict hot keys.
4. 2 minutes: Compare the three Failure Modes.
5. 1 minute: Explain Rule Snapshot and Last Known Good.
6. 1 minute: Give three trade-offs, a rejected option, and stopping points.

Any mechanism where the reviewer asks "what happens if I delete this?" should be able to point out the specific error result and provide a verification indicator or fault injection method.

After everything is satisfied, this case ends:

- Ability to gradually push out components from pressure rather than memorizing final drawings.
- Can explain what Token Bucket, shared atomic state and single Region quota guarantee respectively.
- Able to construct concurrent over-sending cases and distinguish between total throughput expansion and Hot Key upper limit.
- Ability to select downgrade strategies for specific services and account for lost guarantees during outages.
- Can explain why version snapshots do not rely on online control planes.
- It can be clarified that global quotas, cross-key transactions, billing and security detection are not within the current scope.

Press the gap to return to the corresponding stage of [main line] (01-progressive design main line.md). Stop after final dictation; no more Rate Limiter product details are added without new real contracts or measurement bottlenecks.
