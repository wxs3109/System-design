import { describe, expect, it } from 'vitest'
import { projectFileV3Schema } from '@system-design/model'
import { runSimulation } from '@system-design/simulation'
import { exercises, databaseBottleneckExercise, serviceQueueExercise } from './exercises'
import { checkExerciseConstraints, exerciseProjectFingerprint, readExerciseParameter, withExerciseParameter } from './exercise-project'

describe('definition-driven exercise controls', () => {
  it('keeps each declared control and result display valid without knowing its component type', async () => {
    expect(new Set(exercises.map((exercise) => exercise.id)).size).toBe(exercises.length)
    for (const exercise of exercises) {
      const project = exercise.createProject()
      expect(exercise.parameters.length).toBeGreaterThan(0)
      expect(new Set(exercise.parameters.map((parameter) => parameter.id)).size).toBe(exercise.parameters.length)
      expect(exercise.resultMetrics.length).toBeGreaterThan(0)
      expect(project.topology.nodes.some((node) => node.id === exercise.focusNodeId)).toBe(true)
      const result = await runSimulation(project, `metadata:${exercise.id}`)
      const evaluated = exercise.evaluate(project, result)
      expect(evaluated.checks.find((check) => check.id === 'evidence')?.status).toBe('pass')
      for (const display of [...exercise.resultMetrics, exercise.attemptMetric]) expect(Number.isFinite(evaluated.metrics[display.key])).toBe(true)
      for (const parameter of exercise.parameters) {
        expect(new Set(parameter.choices.map((choice) => choice.value)).size).toBe(parameter.choices.length)
        for (const choice of parameter.choices) {
          const edited = withExerciseParameter(project, parameter, choice.value)
          expect(projectFileV3Schema.safeParse(edited).success).toBe(true)
          expect(readExerciseParameter(edited, parameter)).toBe(choice.value)
          expect(checkExerciseConstraints(edited, project, exercise.parameters).status).toBe('pass')
        }
      }
    }
  })

  it('updates a database field independently from service replicas without mutating the source', () => {
    const original = databaseBottleneckExercise.createProject()
    const snapshot = structuredClone(original)
    const [service, database] = databaseBottleneckExercise.parameters
    const first = withExerciseParameter(original, service!, 4)
    const second = withExerciseParameter(first, database!, 12)
    expect(readExerciseParameter(second, service!)).toBe(4)
    expect(readExerciseParameter(second, database!)).toBe(12)
    expect(readExerciseParameter(first, database!)).toBe(4)
    expect(original).toEqual(snapshot)
  })

  it('rejects undeclared values and fields instead of editing an arbitrary config property', () => {
    const exercise = serviceQueueExercise
    const project = exercise.createProject()
    const parameter = exercise.parameters[0]!
    for (const value of [0, 5, 1.5, Number.NaN]) expect(() => withExerciseParameter(project, parameter, value)).toThrow()
    expect(() => withExerciseParameter(project, { ...parameter, nodeId: 'missing' }, 3)).toThrow()
    expect(() => withExerciseParameter(project, { ...parameter, field: '__proto__' }, 3)).toThrow()
    expect(readExerciseParameter(project, parameter)).toBe(1)
  })

  it('preserves evidence through visual edits but invalidates changes to execution or ordering', () => {
    const exercise = databaseBottleneckExercise
    const original = exercise.createProject()
    const visual = structuredClone(original)
    visual.name = 'My study notes'
    visual.topology.nodes[0]!.name = 'Incoming requests'
    visual.topology.nodes[0]!.position = { x: 900, y: 700 }
    visual.topology.edges[0]!.name = 'API call'
    expect(exerciseProjectFingerprint(visual)).toBe(exerciseProjectFingerprint(original))
    expect(checkExerciseConstraints(visual, original, exercise.parameters).status).toBe('pass')

    const execution = structuredClone(visual)
    execution.experiments[0]!.workloads[0]!.requestsPerSecond = 1
    expect(exerciseProjectFingerprint(execution)).not.toBe(exerciseProjectFingerprint(original))
    expect(checkExerciseConstraints(execution, original, exercise.parameters).status).toBe('fail')
    const reordered = structuredClone(original)
    reordered.topology.nodes.reverse()
    expect(exerciseProjectFingerprint(reordered)).not.toBe(exerciseProjectFingerprint(original))
  })
})
