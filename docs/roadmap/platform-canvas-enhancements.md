# Canvas and Analysis Enhancement Log

This log records each independently shipped enhancement, its verification evidence, and its explicit product boundary.

## Stage 1 - Connection labels and business-flow focus

Status: complete (2026-08-31)

Delivered:

- optional, persisted connection names editable from the connection properties panel;
- always-visible connection semantics (`sync`, `async`, `fan-out`, `hit`, or `miss`) plus attached policy names;
- exact topology-path projection for selected Interaction and Operation Workload definitions;
- ordered action labels on projected edges and visual de-emphasis of unrelated nodes and edges;
- backward-compatible ProjectFile v3 parsing; connection names are removed from the legacy executable Scenario projection.

Verification:

- `pnpm --filter @system-design/model test -- src/project.test.ts` - 14 tests passed;
- `pnpm --filter @system-design/web test -- src/components/definition-editor-model.test.ts src/lib/store.test.ts` - 19 tests passed;
- `pnpm --filter @system-design/web test:e2e -- tests/workbench.spec.ts -g "labels connections and focuses"` - 1 test passed;
- `pnpm --filter @system-design/web typecheck` - passed;
- `pnpm --filter @system-design/web lint` - passed.

Boundaries:

- a connection name is design metadata and does not change routing or simulation behavior;
- exact ordered paths are projected only for Interaction and Operation Workload resources; other definitions continue to highlight their directly bound nodes;
- projection follows the current shortest valid synchronous or asynchronous topology path and does not expose alternate failover routes;
- action labels describe compiled intent, not runtime success. Runtime outcomes remain in simulation results and traces.

## Stage 2 - Visible topology groups and automatic layout

Status: complete (2026-08-31)

Delivered:

- visible Canvas boundaries for existing group, Region, and Zone membership;
- overlapping Region/Zone membership without changing the topology ownership model;
- deterministic left-to-right layered layout through ELK.js;
- an explicit Auto layout Canvas command that persists positions as one undoable project edit;
- responsive group bounds that follow member nodes after manual movement or automatic layout.

Verification:

- `pnpm --filter @system-design/web test -- src/lib/canvas-layout.test.ts src/lib/topology-group-layout.test.ts src/lib/store.test.ts` - 17 tests passed;
- `pnpm --filter @system-design/web test:e2e -- tests/workbench.spec.ts -g "shows region and zone boundaries"` - 1 test passed;
- `pnpm --filter @system-design/web typecheck` - passed;
- `pnpm --filter @system-design/web lint` - passed;
- `pnpm --filter @system-design/web build` - passed; production bundle includes the lazy-loaded ELK adapter.

Boundaries:

- automatic layout runs only when explicitly requested and replaces all node positions; undo restores the previous manual layout;
- ELK lays out topology nodes and edges, but does not treat overlapping Region/Zone membership as compound-graph ownership;
- group boundaries are derived from member bounding boxes and are not independently draggable or resizable;
- group visibility has no simulation effect; Region and Zone runtime behavior continues to use the existing membership data;
- the layout uses a single left-to-right strategy in this stage and does not expose direction or spacing controls.

## Stage 3 - Simulation metrics on the Canvas

Status: complete (2026-08-31)

Delivered:

- post-run node badges for utilization, processed requests, maximum queue, and failures;
- node emphasis for idle, healthy, warning, and critical states;
- active and failed connection emphasis derived from retained dependency events;
- compact observed-call, observed-failure, and observed-byte labels on connections;
- a Canvas metrics toggle; metrics are hidden in Definitions view so business-flow focus remains unambiguous.

Verification:

- `pnpm --filter @system-design/web test -- src/lib/canvas-metrics.test.ts` - 2 tests passed;
- `pnpm --filter @system-design/web test:e2e -- tests/workbench.spec.ts -g "projects simulation metrics onto"` - 1 test passed;
- `pnpm --filter @system-design/web typecheck` - passed;
- `pnpm --filter @system-design/web lint` - passed;
- `pnpm --filter @system-design/web build` - passed.

Boundaries:

- node badges use authoritative aggregate NodeMetrics from the completed SimulationResult;
- connection values are explicitly labeled `observed` because the current result contract has no aggregate edge metrics and request events are trace-retention limited;
- connection observations must not be interpreted as total throughput, total bytes, or a latency percentile;
- warning means any failure, at least 70% utilization, or a non-zero maximum queue; critical means at least 5% failures or at least 90% utilization; these are presentation thresholds, not architectural findings;
- overlays represent the latest loaded or completed run and are not persisted into ProjectFile.
