# DP-16: Realtime capacity

> Status: not started. Depends on DP-08. Extension milestone: M5.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Size active connections, message-processing slots, and aggregate outbound bandwidth for Realtime Gateway. Distinguish per-client slowness from gateway-wide egress. Reuse session demand and rate pools without converting all sessions into ordinary request payloads.

## Input and output contract

Inputs are connection/session lifecycle, connect/disconnect rates, explicit channel membership or a scoped membership assumption, broadcast rate, message size, sender-inclusion policy, slow-client distribution, and current connection/message/buffer limits.

Outputs include active connections, connection admissions/rejections, logical broadcasts, delivered recipient copies, outbound offered/served/dropped bytes, per-client backlog, gateway egress utilization, and supported recommendations. Server count is estimated-only until a Realtime-specific placement binding exists; Service server support from DP-11 is not inherited automatically.

## Execution and sizing rules

- Concurrent connections come from DP-08 lifecycle state or explicit Realtime actions, never API response time. Declare which source owns lifecycle to avoid opening the same connections through both paths.
- Broadcast copies derive from eligible membership and sender policy. A user-supplied fan-out factor cannot also multiply already enumerated recipients.
- Every recipient copy consumes aggregate gateway egress and its client-specific delivery constraint. Use one ownership ledger; copying bytes into per-client buffers does not itself mean they were transmitted.
- If the existing gateway model lacks the shared pool, introduce a versioned binding to DP-06 and retire conflicting per-message throughput shortcuts for that version.
- Slow-client policy explicitly buffers, drops, or disconnects at declared limits. Ended connections cancel or discard remaining bytes according to policy, retaining counters.
- Recommend connection limit, processing concurrency, and aggregate bandwidth separately. Raising message slots cannot fix exhausted connection capacity or a slow client's own bandwidth.

## Acceptance cases

1. Ten 1,000-byte broadcasts/s to 100 eligible recipients produce 1,000 recipient copies/s and 8,000,000 outbound bits/s before overhead.
2. Excluding a sender who belongs to the channel reduces the recipient count by one exactly once. Explicit recipients plus a manual fan-out multiplier are rejected as duplicate ownership.
3. One slow client accumulates its own backlog while eligible fast clients continue under available aggregate capacity. Increasing gateway bandwidth does not change that client's fixed receive limit.
4. A saturated shared gateway pool limits total served bytes regardless of message concurrency. Raising its bandwidth changes the observed aggregate bottleneck.
5. Connection limits, disconnect cleanup, buffer overflow, and run cancellation preserve connection and byte accounting.

## Completion evidence

- [ ] Lifecycle, membership, dual capacity constraints, slow-client policy, and conservation pass.
- [ ] Gateway connection/bandwidth controls and bottleneck comparison pass in the browser.
- [ ] Focused checks and `pnpm check` pass; support boundaries and commit are logged here.
