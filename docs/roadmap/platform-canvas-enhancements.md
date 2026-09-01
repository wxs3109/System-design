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
