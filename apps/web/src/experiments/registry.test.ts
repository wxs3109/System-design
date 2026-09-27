import { describe, expect, it } from 'vitest'
import { experiments } from './registry'
import { experimentRegistry } from '../core/experiments/registry'
import { concepts, caseContexts } from '../features/learning/catalog'

describe('single experiment publication registry', () => {
  it('publishes all existing routes, case links and declared capabilities from one registration', () => {
    expect(experiments.entries).toHaveLength(24)
    expect(experiments.entries.filter(e => e.caseId)).toHaveLength(6)
    expect(new Set(experiments.entries.map(e => e.metadata.id)).size).toBe(24)
    for (const entry of experiments.entries) {
      expect(experiments.get(entry.metadata.id)).toBe(entry)
      expect(entry.definition.title).toBe(entry.metadata.title)
      if (entry.caseId) expect(caseContexts.some(c => c.id === entry.caseId)).toBe(true)
      expect(typeof entry.loadRenderer).toBe('function')
    }
    for (const concept of concepts) for (const id of concept.labIds) expect(experiments.get(id)).toBeDefined()
    expect(experiments.get('missing')).toBeUndefined()
  })
  it('rejects duplicate IDs and incomplete publication metadata before routing', () => {
    const entry = experiments.entries[0]!
    expect(() => experimentRegistry([entry, entry])).toThrow('duplicate')
    expect(() => experimentRegistry([{ ...entry, metadata: { ...entry.metadata, title: '' } }])).toThrow('Incomplete')
    expect(() => experimentRegistry([{ ...entry, caseId: 'CASE-01', scope: undefined } as never])).toThrow('scope')
  })
  it('validates model-specific runtime inputs, versions and read-only view projection', () => {
    for (const entry of experiments.entries) {
      if (entry.kind !== 'product-design') continue
      const d = entry.definition; const result = d.run(d.initialConfig, d.scenarios[0]!.script)
      const before = JSON.stringify(result); d.present(result)
      expect(JSON.stringify(result)).toBe(before)
      expect(() => d.run({ ...d.initialConfig, extra: 'invalid' }, [])).toThrow()
      expect(() => d.run(d.initialConfig, ['unknown-action'])).toThrow()
      expect(() => d.present({ ...result, modelVersion: 'another-model' })).toThrow()
      expect(() => d.scenarios[0]!.check({ ...result, modelVersion: 'another-model' })).toThrow()
    }
  })
})
