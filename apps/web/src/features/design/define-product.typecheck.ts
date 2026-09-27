import { defineProductDesign } from './define-product'
import { choice, type DesignConfig } from './product-types'

const fixture = {
  id: 'type-fixture', kind: 'product-design', category: 'test', difficulty: 'test', estimatedMinutes: 1,
  title: 'type fixture', summary: 'compile-time contracts', pains: [], requirements: [], contracts: [], decisions: [], boundary: [], relatedLabs: [],
  versions: { model: 'type-fixture-v1', definition: 1, assessment: 1 },
  fields: [{ id: 'policy', label: 'Policy', options: [choice('allowed', 'Allowed')] }],
  initialConfig: { policy: 'allowed' }, actions: { execute: 'Execute' }, alternatives: [],
  scenarios: [{ id: 'case', title: 'Case', goal: 'Goal', script: ['execute'], check: () => [] }],
  metricLabels: [{ key: 'count', label: 'Count' }], architecture: () => [],
  run: (_config: DesignConfig, commands: readonly string[]) => ({ modelVersion: 'type-fixture-v1' as const, events: [], metrics: { count: commands.length }, state: {} }),
  present: () => ({ tables: [], events: [] }),
} as const

/** These calls are never executed; tsc must reject the invalid authoring contracts. */
export function checkAuthoringTypes() {
  defineProductDesign(fixture)
  // @ts-expect-error Configuration values are constrained to declared choices.
  defineProductDesign({ ...fixture, initialConfig: { policy: 'typo' } })
  // @ts-expect-error Unknown configuration fields cannot be registered.
  defineProductDesign({ ...fixture, initialConfig: { policy: 'allowed', extra: 'value' } })
  // @ts-expect-error Scenario commands must exist in the action vocabulary.
  defineProductDesign({ ...fixture, scenarios: [{ ...fixture.scenarios[0], script: ['missing'] }] })
  // @ts-expect-error Metric identifiers come from the model's actual result type.
  defineProductDesign({ ...fixture, metricLabels: [{ key: 'missing', label: 'Missing' }] })
  // @ts-expect-error Registered model versions must match the runner's literal version.
  defineProductDesign({ ...fixture, versions: { ...fixture.versions, model: 'another-model' } })
}
