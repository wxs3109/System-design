# DP-05: Queue and Worker planning

> Status: not started. Depends on DP-04. Completes M2.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Distinguish broker delivery capacity from Worker processing capacity, then demonstrate backlog growth and recovery. Use Queue and the existing Worker behavior of Service. Stream and Topic group/subscription semantics belong to DP-12.

Messages are bounded in-run records and consumers are virtual scheduled activities. Producing, consuming, and acknowledging change simulated state; no real broker, messaging protocol, external producer/consumer process, or business handler implementation is required. Preserve enough state to explain backlog, backpressure, and recovery under the declared policy.

## Input and output contract

Inputs identify the producing action, queue node, Worker target, messages per successful producer action, delivery slot holding time, Worker work per message, queue bounds, and explicit acknowledgement/admission semantics. Reuse executable event contracts; assumptions fill only missing semantics.

Output rows separate offered messages, queue admissions/rejections, pending deliveries, in-flight deliveries, acknowledged messages, Worker completions, retries/dead letters where supported, and retained unfinished work. Every message has one logical identity; attempts have separate identities.

| Resource | Configured knob | Meaning |
|---|---|---|
| Queue delivery slots | consumers | Simultaneous deliveries under the selected acknowledgement boundary |
| Queue waiting storage | maxDepth | Pending message bound, with in-flight work reported separately |
| Worker request slots | Service replicas/concurrency | Executed processing capacity |

## Execution and sizing rules

- First audit the Queue variant's actual resource release boundary. A delivery slot held through Worker acknowledgement uses that full holding time; a slot released after broker delivery uses broker time alone. Do not count the same Worker processing time twice.
- If the current variant cannot independently retain and drain acknowledged work, introduce a versioned Queue behavior with an autonomous deterministic delivery pump. Wake on enqueue, downstream capacity release, acknowledgement, retry eligibility, and fault recovery; no unrelated publication is required to resume draining.
- The new behavior declares whether producer completion means queue admission or completed processing. Legacy operation actions retain their current awaited semantics unless explicitly upgraded; migration must not silently change completion boundaries.
- In the independent-delivery fixture, delivery ceiling is `consumers / meanDeliverySeconds`, and Worker ceiling is `replicas * concurrency / meanProcessingSeconds`. Sustainable processing is bounded by both and by the declared in-flight limit.
- Recommend consumers from delivery demand and Service replicas from Worker work. Do not increase consumers as a substitute for unavailable Worker capacity. Size queue depth for the selected burst only, with its own lock and bound.
- Fluid estimate: `Q_next = max(0, Q + (arrivalRate - completionRate) * dt)`. It is an estimate, not the discrete queue observation. With continued arrivals below service capacity, drain time is `Q / (mu - lambda_after)`; if `mu <= lambda_after`, finite drain time is unavailable. With arrivals stopped, use `Q / mu`.
- Preserve admitted work through a capacity-drop fault; node-down outcomes follow the declared variant policy. Report discarded/dead-lettered work explicitly rather than allowing it to disappear from accounting.

## Acceptance cases

1. Independent broker delivery can handle 500/s; Worker processing handles 100/s; arrivals are 120/s. Fluid backlog grows 20/s. Increasing broker consumers alone does not stabilize Worker processing.
2. After Worker capacity reaches 150/s, a backlog of 600 messages drains in an estimated 20 seconds while 120/s arrivals continue, or four seconds after arrivals stop. Discrete results reconcile within recorded boundary effects.
3. A finite pending bound rejects or backpressures according to policy and reports the first overflow. The rejected count does not count as Worker completion.
4. Pending acknowledged work resumes after Worker recovery without a fresh publish. Cancellation and run end retain pending/in-flight counts.
5. Producer fan-out of two messages and two delivery attempts produces two logical messages and four attempts, not four retained logical messages.
6. Browser comparison identifies Queue versus Worker pressure and applying either recommendation changes the corresponding resource. Locked Worker capacity remains an unmet constraint.

## Completion evidence

- [ ] Queue lifecycle, autonomous draining where introduced, acknowledgement boundaries, and conservation pass.
- [ ] Formula-versus-runtime backlog and browser bottleneck transitions pass.
- [ ] Legacy variants remain reproducible; focused checks and `pnpm check` pass; results and commit are logged here.
