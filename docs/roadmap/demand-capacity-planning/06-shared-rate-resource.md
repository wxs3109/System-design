# DP-06: Shared rate resource

> Status: not started. Depends on DP-04. First part of M3.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Add one reusable aggregate work resource to the existing virtual-time runtime. It will support byte transfers and later explicit throughput envelopes. This part owns scheduling, conservation, and counters; component bindings and user-visible network behavior arrive in DP-07.

## Input and output contract

`RateResourceV1` has a stable pool ID, work unit, nonnegative time-varying capacity in units/s, maximum admitted outstanding work, maximum active jobs, and overflow policy. Zero effective capacity is valid during faults. Base configured capacity is positive. Jobs have ID, owner/trace references, offered time, finite nonnegative work, optional deadline, and cancellation state.

The API admits or rejects work, advances accounted work to the current virtual time, changes capacity, cancels jobs, and reports completion callbacks. Fixed-rate producers can add work over bounded intervals without one event per byte. Scheduling uses the existing SimScript clock; no wall-clock timers drive modeled progress.

Full-run counters include offered, rejected, served, cancelled-remaining, and outstanding work; active/waiting jobs; time-integrated available and busy capacity; outstanding-work area/max; and admission wait versus total completion time. All counters are independent of trace retention.

## Scheduling semantics

1. Among active finite jobs, share capacity equally using deterministic processor sharing. Excess jobs wait FIFO by arrival time and stable sequence ID. Record this discipline and resource version in the run.
2. Advance all active residual work before any arrival, completion, cancellation, or capacity change. Recompute the next completion using the new active set; invalidate obsolete scheduled wakeups by generation ID.
3. At the same timestamp, account elapsed service first, settle completed jobs, apply capacity/fault transitions, then admit new jobs by stable sequence. Zero-size work completes without consuming capacity or creating an infinite wakeup loop.
4. Overflow checks total outstanding admitted work, including active residual work. A rejected job is rejected in full. Cancelling an admitted job preserves already served work and records only its residual as cancelled.
5. Capacity zero makes no progress; recovery resumes admitted jobs. Deadlines cancel only remaining work according to the consuming component's policy.
6. Fixed-rate demand integrates offered work exactly between its change points. The resource reports achieved rate and residual backlog; consumer-specific degradation or dropping is defined by DP-08, not guessed here.
7. Invariant: `offered = rejected + served + cancelledRemaining + outstanding`, including initial outstanding work as initial offered work. Served work never exceeds integrated available capacity. Resource exhaustion must yield a structured budget result, not an unbounded event loop.

## Acceptance cases

1. Two 100-byte jobs arrive at t=0 at a 100-byte/s pool with two active slots. Both complete at t=2; total service is 200 bytes. One job alone completes at t=1.
2. With one active slot, the same jobs complete at t=1 and t=2; the second has one second admission wait. Total capacity is unchanged.
3. At t=0.5, cancel one of the two sharing jobs. Each has received 25 bytes; the survivor has 75 bytes left and completes at t=1.25. Cancelled remaining work is 75 bytes.
4. Drop capacity to zero for one second, restore it, and verify no work is served during the outage and no admitted work disappears.
5. A 150-byte outstanding limit accepts one 100-byte job and rejects the next simultaneous 100-byte job. Zero-byte jobs and same-time completions conserve work.
6. A 120-byte/s producer against 100-byte/s service accumulates 200 bytes over ten seconds with sufficient bounds. Changing trace limits leaves this unchanged.

## Completion evidence

- [ ] Deterministic ordering, sharing, cancellation, faults, bounds, and conservation cases pass.
- [ ] Scheduler integration reuses the current virtual clock and obeys run cancellation/budgets.
- [ ] Focused checks and `pnpm check` pass; resource semantics and commit are logged here.
