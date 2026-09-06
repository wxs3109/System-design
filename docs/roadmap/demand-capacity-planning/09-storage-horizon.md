# DP-09: Logical storage horizon

> Status: not started. Depends on DP-04. First part of M4.

[Roadmap and part index](./README.md) · [Shared contracts](./shared-contracts.md)

## Outcome and scope

Answer how much logical data remains at a selected future date, including existing data and expiry. Forecast calculations remain estimated even when a run supplies successful-write rates. Physical pools and capacity application belong to DP-10.

## Input and output contract

`PersistenceProjectionV1` identifies a data object or Object Storage namespace, source action/capacity workload, forecast start date, horizon days, initial cohorts, successful mutation rates, size assumptions, retention/deletion policies, and growth source. Each initial cohort has bytes or count and item size, creation/expiry age information, and provenance.

Mutations distinguish insert, overwrite/update, and delete. New records, successful attempts, logical identities, and retry attempts are separate counters. A projection binds either to declared future successful mutations or an explicitly selected compatible run observation; it does not count both. Existing model cardinality may supply initial occupancy but not an extra stream of daily writes.

Outputs for each end-of-day t are created/updated/deleted/expired logical bytes, remaining initial bytes, remaining new bytes, total retained bytes, and unresolved assumptions. The chart exposes formula/cohort contributions and separate forecast horizon and retention controls.

## Time and retention rules

- Forecast day 0 is the initial snapshot. New cohorts are created at the end of day d for d >= 1. A cohort with retention D is included at end of day t exactly when `0 <= t - d < D`, unless explicitly deleted earlier.
- Apply scheduled expiry and explicit deletes, then successful updates/inserts at the day's boundary. Record this ordering; intra-day storage peaks are outside this day-based forecast.
- For constant item size and immutable new cohorts: `S(t) = initialSurviving(t) + sum(d=1..t, createdCount(d) * itemBytes(d) * survival(d,t))`. Survival contains retention and explicit deletion effects once.
- Annual demand growth r, when selected, scales the baseline new-write rate by `(1+r)^(d/365)` for day d; the year length is a declared 365-day model convention. A source rate already projected to day d is not grown again.
- Overwrites contribute size deltas to the same logical identity/cohort according to the selected TTL-reset rule; an equal-size overwrite creates zero net logical growth. Unknown update/delete targeting leaves the affected projection incomplete.
- Initial cohorts with unknown age cannot assume either immediate expiry or a fresh full retention period. Let the user supply age bounds or a clearly labeled scenario; return a range or unknown until resolved.
- Successful retry attempts do not imply distinct stored objects. Where the runtime has no logical write identity or idempotency guarantee, future unique writes require an explicit assumption.

## Acceptance cases

1. Start with a 100-byte cohort created at day 0; add 100 bytes at each day's end; D=2. Totals are 100 at day 0 and 200 at days 1, 2, and 3. The original cohort expires at day 2.
2. With no retention expiry, the same fixture has 400 bytes at day 3. Extending horizon does not change the selected retention period.
3. A successful overwrite of 100 bytes with 150 bytes adds 50 bytes; an equal-size overwrite adds zero. A failed insert adds no successful logical data.
4. Initial schema cardinality and an explicit initial cohort referring to the same data cannot both be applied. Duplicate projection ownership is rejected.
5. A repeated attempt on one logical write is counted according to its declared identity semantics; without that information unique-byte growth remains unknown.
6. Unknown age with active TTL produces unresolved/range output rather than a fabricated exact expiry date. Day-zero and retention boundaries survive JSON round trip.
7. The UI independently changes horizon and retention and explains the corresponding retained cohorts without rerunning online simulation.

## Completion evidence

- [ ] Cohort, date-boundary, growth, mutation, provenance, and double-counting cases pass.
- [ ] Horizon chart and formula inspection pass; forecast outputs consistently say estimated.
- [ ] Focused checks and `pnpm check` pass; assumptions and commit are logged here.
