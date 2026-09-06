# DP-17: Workflow and Scheduler capacity

> Status: not started. Depends on DP-05. Extension milestone: M5.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Plan long-running instance occupancy and scheduled bursts using existing Workflow and Scheduler contracts. Add their adapters as separately verified increments. This does not change an Interaction into a parallel execution graph or invent business compensation/retry policies.

## Input and output contract

Workflow inputs identify definition version, start phases, executed steps, retry/backoff/compensation rules, duration assumptions, and current instance/pending limits. Scheduler inputs identify schedule mode, interval, batch size, initial offset, jitter, missed-run policy, run duration, and pending/concurrent limits.

Outputs separate starts, active instances/runs, pending work, missed/skipped releases, completed/failed/unfinished outcomes, and per-step downstream demand. Recommended knobs are supported concurrent instance/run counts and pending depths; arbitrary server capacity remains estimated-only without a behavior-specific binding.

## Workflow rules

- Active Workflow occupancy uses the full period during which the workflow instance resource is held, including awaited activities and backoff where the runtime retains the instance. Downstream Service slots use only their own holding boundaries.
- With a known mean instance holding time W and starts lambda, estimate active instances as `lambda * W`; use time-dependent cohorts for bursts where steady state is invalid.
- Expected retries may use declared independent intrinsic failure probabilities and bounded attempts. Dynamic overload/retry storms remain incomplete before compatible evidence exists.
- Compensation is executed only under the definition's failure conditions. Count its work separately from forward steps; do not charge it on every successful start.
- Long-running work beyond the observation end remains unfinished. A lack of completions does not imply zero capacity usage or a successful latency result.

## Scheduler rules

- Compile schedule releases from the actual schedule model. Do not also execute planning-generated arrival phases on the same Scheduler; this source selects schedule ownership explicitly.
- A periodic/batch schedule defines burst times and counts. Rate summaries are derived from those releases, not used to smooth the executable burst.
- Concurrency tracks the actual root run until its terminal outcome. Apply skip or catch-up exactly as configured. Pending depth is burst accommodation, not additional execution throughput.
- Nominal release opportunities, skipped releases, admitted runs, and pending runs are separate accounting populations. Budget exhaustion is not a configured skip decision.
- Recommend run concurrency from release/holding overlap and pending depth from the declared burst and missed-run policy. Changing policy is a separate user edit, not a solver shortcut.

## Acceptance cases

1. Two Workflow starts/s with five-second fixed holding time require ten active instance slots before utilization reserve; a one-second downstream Service step occupies a separate two slots on average.
2. A configured retry backoff increases Workflow holding time if the instance remains held, while not holding a released downstream Service slot.
3. A batch of 20 one-second jobs every ten seconds on five concurrent run slots processes in four waves. Its two jobs/s average does not hide initial pending work.
4. At a full Scheduler, skip and catch-up produce different missed/pending counters according to policy. Increasing pending depth does not raise run concurrency.
5. A scheduled workload cannot generate both schedule releases and an additional arrival-phase stream. Long unfinished workflows and generation truncation remain visible to DP-04 verdicts.

## Completion evidence

- [ ] Workflow duration, retry, compensation, and downstream attribution cases pass.
- [ ] Scheduler release, overlap, policy, and accounting cases pass.
- [ ] Browser controls, focused checks, and `pnpm check` pass; support boundaries and commit are logged here.
