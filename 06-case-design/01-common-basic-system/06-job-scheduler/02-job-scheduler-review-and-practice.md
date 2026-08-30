# Job Scheduler: review and practice

This article does not introduce new knowledge, but only tests whether it is possible to leave the document and re-derive the design from stress and faults. Read [Progressive Design Mainline](../01-load-balancer/01-load-balancer-progressive-design-mainline.md) first, then close the document and complete it within 45–60 minutes.

Try to use:

```text
stress or malfunction
→ Why the current solution failed
→ Minimal new mechanism
→ Guarantee obtained
→ Cost and Boundary
```

No full API, DDL, fixed number of shards, cron expressions, or cloud product selection required.

## 1. Fixed contract

Limited to 5 minutes:

1. Describe the core scene in one sentence.
2. Write out the semantics of a core reliability promise and an explicit non-commitment.
3. Distinguish between Job, Execution, Attempt and Lease.
4. Write two Out of scopes and explain why adding them would change the dominant puzzle.

Passing criteria: It is clear that this is soft real-time, At-least-once scheduling for one-time jobs; it does not generally promise end-to-end Exactly-once, nor does it expand into a Workflow or resource orchestration platform.

## 2. Rebuild the minimal system

Time limit is 10 minutes. Only use Client, Job Service, Store, Coordinator, MQ and Worker:

1. Draw the minimum normal path.
2. Which component holds authoritative state?
3. How does the Coordinator discover the expired Execution? Why is the scan result only Candidate?
4. Does the MQ message express "execution right" or "can try to claim"?
5. Can I still make a smaller system by temporarily deleting MQ? What's the pressure to retain MQ?

Passing criteria: Each component can be associated with a responsibility or pressure; database condition writes determine the fact that neither scans nor MQ messages can individually grant execution rights.

## 3. Let the failure force out the mechanism

Do not write the schema name first, fill in the form in order:

| Stress or failure | Why current solutions fail | Minimal mechanisms | New guarantees | Costs/bounds |
|---|---|---|---|---|
| Creation submitted, but response lost | | | | |
| DB updated, process crashed before sending MQ | | | | |
| MQ re-investment, multiple Workers receive the same Execution | | | | |
| Worker lost contact after preemption | | | | |
| The new Attempt has started and the old Worker is reporting late | | | | |

Check for natural derivation when complete: Create Idempotency Key, Transactional Outbox, Conditional Preemption and Attempt, Lease/Heartbeat/Reaper, Bounded Retry, Fencing and Downstream Business Idempotent.

Passing criteria: Able to distinguish the following boundaries:

- Create idempotence to prevent two jobs; business idempotence absorbs repeated side effects of the same Execution.
- Outbox prevents silent misses but allows duplicate releases.
- Lease allows takeover, but cannot prove that the old Worker has stopped.
- Scheduler Fencing protects its own state and cannot undo external side effects.

## 4. Pass through the crash window

Answers to each question: What is the authoritative state, who retries, is it possible to repeat or is it possible to lose, which condition is written to prevent incorrect results.

1. `SCHEDULED → QUEUED` and Outbox have been submitted, and Publisher crashes before publishing.
2. MQ has confirmed, Outbox has not marked `SENT`, and Publisher crashes.
3. The Worker has submitted a preemption transaction, but MQ crashes before ACK.
4. After the Reaper reads that the Lease expires, the Worker happens to Heartbeat successfully.
5. Worker A's Lease has expired, and Worker B has obtained a new Attempt; A subsequently submitted a successful result.

Passing criteria: The first two questions were "delayed but not missed" and "possibly repeated" respectively; the third question cannot obtain execution rights again after resubmission; the fourth and fifth questions rely on re-verification status, Attempt and Lease when writing.

## 5. State machine and invariants

Draw without looking at the main line:

```text
SCHEDULED → QUEUED → RUNNING → SUCCEEDED
                         ├──→ RETRY_WAIT → QUEUED
                         └──→ FAILED
```

Mark each transition:

- Executor;
- Write preconditions;
- Same transaction side effects;
- Is it possible to trigger repeatedly.

Then write down at least five invariants. The answer must include Outbox transactions, atomic preemption, current Lease, post-scan secondary verification, and business idempotent boundaries.

## 6. Capacity and expansion

Assuming $R=100{,}000/s$, an Execution will generate $C=5$ persistent writes, and an average of $H=3$ Heartbeats:

1. Use $W approx R(C+H)$ to estimate the write magnitude. What does it prove and what does it not prove?
2. Why can’t Job, Execution, Attempt/Lease and Outbox have independent Hash?
3. There is no `jobId` when it is created. How can retries with the same Idempotency Key stabilize routing?
4. After sharding, how to ensure that the due tasks of each Shard will eventually be scanned?
5. Why is it safe to allow overlapping scans?
6. Why can’t adding MQ Consumer replace atomic preemption on authoritative Shard?
7. When Schedule Delay, Outbox Age, MQ Lag, and Worker Claim Latency increase respectively, which period of backlog usually points to it?
8. Can Hot Tenant be solved by just adding ordinary Shards?

Passing criteria: The write volume is about $8 imes10^5/s$, but the exact number of databases or Shards is not guessed based on this; sharding first keeps transactions co-located; Coordinator Ownership only allocates scan work and does not grant execution rights to Workers.

## 7. Boundary judgment

Each question only answers: which kernel mechanism is reused, which contract is changed, whether it is optional, Parking Lot or an independent case.

1. Run every weekday at 09:00 according to user time zone, and define DST and Misfire.
2. The Worker performs deductions and requires "absolutely only one deduction".
3. Ten thousand untrusted Tenants share the cluster, requiring quota, fairness, auditing and regional disaster recovery.
4. After one task is completed, multiple downstream tasks are triggered and wait for all to be completed.
5. The trigger volume remains the same, but the long task makes Heartbeat the dominant write.

Determine anchor point:

- Cron adds occurrence semantics, but reuses the Execution → Attempt → Lease kernel.
- Deductions Exactly-once require downstream idempotence, ledger constraints or fencing, which cannot be unilaterally promised by the Scheduler.
- Multi-tenant governance and multi-region will only be reopened after real requirements arise.
- DAG, Fan-out/Fan-in and failure propagation belong to Workflow Engine.
- Investigate downscaling, batching, or splitting the Lease Store only after Heartbeat is measured as the dominant bottleneck.

## 8. Ten minutes final dictation

1. 1 min: Scenarios, Boundaries, and Core Assurances.
2. 2 minutes: Minimal system and normal flow.
3. 3 minutes: Use faults to derive Outbox, Attempt/Lease, and Fencing in sequence.
4. 2 min: Explain sharding using write amplification and why it is co-located on transaction boundaries.
5. 2 minutes: three trade-offs, one rejected proposal and stopping point.

Any mechanism where the reviewer asks "what happens if I delete this?" should be able to point to the specific failure window.

## 9. Complete judgment

This case ends only when all are satisfied:

- Able to gradually derive mechanisms from the smallest system instead of directly drawing the final architecture.
- Able to map at least five invariants to state transitions or transaction boundaries.
- Ability to analyze at least three crash windows, distinguishing between late, duplicate, missed and old writes.
- Ability to estimate magnitudes and point out dominant bottlenecks without creating false accuracy.
- Can explain which correctness conclusions cannot be changed after expansion.
- Able to keep Cron, Workflow and complete production management outside the main line.

Gap-oriented review:

| Gap | Where to go back |
|---|---|
| The core concept is unclear | [README](README.md) |
| Outbox, Preemption, Lease or Old Worker | [Progressive Mainline Section 3–7](../01-load-balancer/01-load-balancer-progressive-design-mainline.md) |
| Sharding, scanning, or asynchronous link expansion | [Progressive Mainline Section 8](../01-load-balancer/01-load-balancer-progressive-design-mainline.md) |
| Continuously adding new product capabilities | [Parking Lot](PARKING-LOT.md) |

Stop after final dictation; no more Scheduler details are added without new real requirements, measurement bottlenecks, or different failure contracts.
