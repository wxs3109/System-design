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
