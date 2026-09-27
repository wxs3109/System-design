import { describe, expect, it } from 'vitest'
import { practiceCatalog } from '../practice/catalog'
import { caseContexts, conceptGroups, concepts, conceptsForLab, filterConcepts, learningPaths, plannedLabs } from './catalog'
import { conceptBodies, readingSources } from './content'

describe('learning publication contracts', () => {
  it('publishes complete article bodies for unique concepts in every knowledge group', () => {
    expect(new Set(concepts.map((item) => item.id)).size).toBe(concepts.length)
    expect(new Set(conceptGroups.map((item) => item.id)).size).toBe(conceptGroups.length)
    expect(Object.keys(conceptBodies).sort()).toEqual(concepts.map((item) => item.id).sort())
    for (const group of conceptGroups) expect(concepts.some((item) => item.groupId === group.id)).toBe(true)
    for (const concept of concepts) {
      expect(conceptGroups.some((group) => group.id === concept.groupId)).toBe(true)
      const body = conceptBodies[concept.id]!
      for (const field of [concept.title, concept.question, concept.summary, body.problem, body.counterexample, body.check.question, body.check.answer, ...body.example, ...body.mechanism, ...body.conditions]) expect(field.trim().length).toBeGreaterThan(0)
      expect(body.example.length).toBeGreaterThan(0)
      expect(body.mechanism.length).toBeGreaterThan(0)
      expect(body.conditions.length).toBeGreaterThan(0)
      for (const id of body.sourceIds) { expect(readingSources[id]).toBeDefined(); expect(new URL(readingSources[id]!.url).protocol).toBe('https:') }
      for (const guide of body.decisionGuide ?? []) for (const text of [guide.when, guide.consider, guide.tradeoff]) expect(text.trim().length).toBeGreaterThan(0)
    }
  })
  it('has valid, acyclic prerequisite references without gating access', () => {
    const completed = new Set<string>()
    function visit(id: string, stack: Set<string>) {
      expect(stack.has(id), `Prerequisite cycle at ${id}`).toBe(false)
      const concept = concepts.find((item) => item.id === id)
      expect(concept, `Missing concept ${id}`).toBeDefined()
      if (completed.has(id)) return
      const next = new Set([...stack, id])
      concept!.prerequisiteIds.forEach((prerequisite) => visit(prerequisite, next))
      completed.add(id)
    }
    concepts.forEach((concept) => visit(concept.id, new Set()))
  })
  it('keeps actual Lab links reciprocal and separates candidate Labs from runnable entries', () => {
    for (const concept of concepts) for (const id of concept.labIds) {
      const lab = practiceCatalog.find((entry) => entry.id === id)
      expect(lab, `Missing runnable Lab ${id}`).toBeDefined()
      expect(lab!.conceptIds).toContain(concept.id)
    }
    for (const lab of practiceCatalog) {
      expect(lab.conceptIds.length).toBeGreaterThan(0)
      expect(conceptsForLab(lab.id).map((item) => item.id)).toEqual(lab.conceptIds)
    }
    for (const lab of plannedLabs) {
      expect(practiceCatalog.some((entry) => entry.id === lab.id)).toBe(false)
      expect('href' in lab).toBe(false)
      lab.conceptIds.forEach((id) => expect(concepts.some((item) => item.id === id)).toBe(true))
    }
  })
  it('uses existing concepts for learning paths and explicit case contexts', () => {
    expect(new Set(learningPaths.map((path) => path.id)).size).toBe(learningPaths.length)
    for (const path of learningPaths) for (const step of path.steps) for (const id of step.conceptIds) expect(concepts.some((concept) => concept.id === id)).toBe(true)
    for (const concept of concepts) for (const id of concept.caseIds) expect(caseContexts.some((item) => item.id === id)).toBe(true)
  })
  it('searches common English/Chinese terms and combines group/path constraints', () => {
    expect(filterConcepts('IDEMPOTENCY').map((item) => item.id)).toContain('idempotency')
    expect(filterConcepts('心跳').map((item) => item.id)).toContain('heartbeat')
    expect(filterConcepts('ACID').map((item) => item.id)).toEqual(['transactions'])
    expect(filterConcepts('数据库选型').map(item => item.id)).toEqual(['storage-access-patterns'])
    expect(filterConcepts('Stateless').map(item => item.id)).toEqual(['state-and-scaling'])
    expect(filterConcepts('Availability').map(item => item.id)).toContain('quality-goals')
    expect(filterConcepts('Outbox', 'capacity')).toEqual([])
    expect(filterConcepts('', '', 'capacity-distribution').every((item) => ['capacity-and-queues', 'caching', 'consistent-hashing', 'hot-keys', 'overload-control'].includes(item.id))).toBe(true)
    expect(filterConcepts('  ')).toHaveLength(concepts.length)
    expect(filterConcepts('a-term-that-does-not-exist')).toEqual([])
  })
})
