import { describe, expect, it } from 'vitest'
import { WorkflowState, type WorkflowAttemptPolicy, type WorkflowDefinition } from './workflow-state'

const policy = (overrides: Partial<WorkflowAttemptPolicy> = {}): WorkflowAttemptPolicy => ({
  timeoutMs: 10, maxAttempts: 2, initialBackoffMs: 5, backoffMultiplier: 2, maxBackoffMs: 20, jitterRatio: 0, ...overrides,
})

const definition = (steps: WorkflowDefinition['steps'] = [
  { id: 'reserve', policy: policy(), compensation: policy() },
  { id: 'charge', policy: policy(), compensation: policy() },
  { id: 'confirm', policy: policy() },
]): WorkflowDefinition => ({ id: 'checkout', version: 1, steps })

const start = (state: WorkflowState, workflow = definition(), key = 'order-1', nowMs = 0) => {
  const result = state.start(workflow, key, nowMs)
  if (!result.accepted) throw new Error(result.reason)
  return result.execution.executionId
}

const claimAttempt = (state: WorkflowState, executionId: string, nowMs: number) => {
  const result = state.claim(executionId, nowMs)
  if (result.kind !== 'attempt') throw new Error(`Expected attempt, received ${result.kind}`)
  return result.attempt
}

describe('WorkflowState', () => {
  it('durably records successful steps and a terminal execution', () => {
    const state = new WorkflowState({ maxConcurrentExecutions: 2 })
    const executionId = start(state, definition([{ id: 'one', policy: policy() }, { id: 'two', policy: policy() }]))

    const first = claimAttempt(state, executionId, 0)
    expect(state.execution(executionId)).toMatchObject({ status: 'running', currentStepId: 'one', steps: [{ stepId: 'one', status: 'in-flight' }, { stepId: 'two', status: 'pending' }] })
    state.settle(first.id, true, 2)
    expect(state.execution(executionId).steps[0]).toMatchObject({ stepId: 'one', status: 'succeeded', attempts: [{ outcome: 'succeeded' }] })

    const second = claimAttempt(state, executionId, 2)
    expect(state.settle(second.id, true, 4).execution).toMatchObject({ status: 'succeeded', completedAtMs: 4 })
    expect(state.snapshot(4)).toMatchObject({ activeExecutions: 0, succeededExecutions: 1, stepAttempts: 2, stepSucceeded: 2 })
  })

  it('replays an idempotency key without starting or executing duplicate work', () => {
    const state = new WorkflowState({ maxConcurrentExecutions: 1 })
    const workflow = definition([{ id: 'one', policy: policy() }])
    const executionId = start(state, workflow)
    const attempt = claimAttempt(state, executionId, 0)
    state.settle(attempt.id, true, 1)

    const replay = state.start(workflow, 'order-1', 2)
    expect(replay).toMatchObject({ accepted: true, replayed: true, execution: { executionId, status: 'succeeded' } })
    expect(replay.transitions.at(-1)).toMatchObject({ type: 'idempotency-replayed', executionId })
    expect(state.snapshot(2)).toMatchObject({ startedExecutions: 1, idempotencyReplays: 1, stepAttempts: 1 })

    expect(state.start({ ...workflow, version: 2 }, 'order-1', 3)).toEqual(expect.objectContaining({ accepted: false, reason: 'idempotency-conflict' }))
  })

  it('times out, waits for bounded backoff, and succeeds on retry', () => {
    const state = new WorkflowState({ maxConcurrentExecutions: 1 })
    const executionId = start(state, definition([{ id: 'slow', policy: policy({ maxAttempts: 3 }) }]))
    const first = claimAttempt(state, executionId, 0)

    expect(state.advanceTo(10)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'step-timed-out', stepId: 'slow', attempt: 1, timestampMs: 10 }),
      expect.objectContaining({ type: 'retry-scheduled', retryAtMs: 15 }),
    ]))
    expect(state.settle(first.id, true, 11)).toMatchObject({ replayed: true, outcome: 'timed-out' })
    expect(state.claim(executionId, 14)).toEqual(expect.objectContaining({ kind: 'wait', untilMs: 15 }))

    const retry = claimAttempt(state, executionId, 15)
    expect(retry).toMatchObject({ stepId: 'slow', attempt: 2, deadlineAtMs: 25 })
    state.settle(retry.id, true, 16)
    expect(state.snapshot(16)).toMatchObject({ succeededExecutions: 1, stepAttempts: 2, stepTimedOut: 1, retriesScheduled: 1, pendingRetries: 0 })
  })

  it('samples retry jitter once and persists the resulting retry clock', () => {
    const run = (sample: number) => {
      const state = new WorkflowState({ maxConcurrentExecutions: 1 })
      const executionId = start(state, definition([{ id: 'retry', policy: policy({ initialBackoffMs: 10, jitterRatio: 0.5 }) }]))
      const attempt = state.claim(executionId, 0, () => sample)
      if (attempt.kind !== 'attempt') throw new Error('Expected attempt')
      return state.settle(attempt.attempt.id, false, 1).execution.retryAtMs
    }
    expect(run(0)).toBe(6)
    expect(run(0.5)).toBe(11)
    expect(run(1)).toBe(16)
    expect(run(0.25)).toBe(run(0.25))
  })

  it('exhausts forward retries and compensates completed steps in reverse order', () => {
    const state = new WorkflowState({ maxConcurrentExecutions: 1 })
    const executionId = start(state)
    for (const now of [0, 1]) {
      const attempt = claimAttempt(state, executionId, now)
      state.settle(attempt.id, true, now + 1)
    }

    const confirm1 = claimAttempt(state, executionId, 2)
    state.settle(confirm1.id, false, 3)
    expect(state.claim(executionId, 7)).toMatchObject({ kind: 'wait', untilMs: 8 })
    const confirm2 = claimAttempt(state, executionId, 8)
    expect(state.settle(confirm2.id, false, 9).transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'compensation-started', stepId: 'charge' }),
    ]))

    const compensationOrder: string[] = []
    for (const now of [9, 10]) {
      const attempt = claimAttempt(state, executionId, now)
      compensationOrder.push(attempt.stepId)
      state.settle(attempt.id, true, now + 1)
    }
    expect(compensationOrder).toEqual(['charge', 'reserve'])
    expect(state.execution(executionId)).toMatchObject({
      status: 'compensated', failureStepId: 'confirm',
      steps: [
        { stepId: 'reserve', compensation: { status: 'succeeded' } },
        { stepId: 'charge', compensation: { status: 'succeeded' } },
        { stepId: 'confirm', status: 'failed' },
      ],
    })
    expect(state.snapshot(11)).toMatchObject({ compensatedExecutions: 1, compensationAttempts: 2, compensationSucceeded: 2, stepFailed: 2, retriesScheduled: 1 })
  })

  it('continues best-effort rollback after a compensation exhausts its retries', () => {
    const state = new WorkflowState({ maxConcurrentExecutions: 1 })
    const workflow = definition([
      { id: 'first', policy: policy({ maxAttempts: 1 }), compensation: policy({ maxAttempts: 1 }) },
      { id: 'second', policy: policy({ maxAttempts: 1 }), compensation: policy({ maxAttempts: 2 }) },
      { id: 'fail', policy: policy({ maxAttempts: 1 }) },
    ])
    const executionId = start(state, workflow)
    for (const now of [0, 1]) {
      const attempt = claimAttempt(state, executionId, now)
      state.settle(attempt.id, true, now + 1)
    }
    state.settle(claimAttempt(state, executionId, 2).id, false, 3)

    state.settle(claimAttempt(state, executionId, 3).id, false, 4)
    const retry = claimAttempt(state, executionId, 9)
    expect(retry).toMatchObject({ kind: 'compensation', stepId: 'second', attempt: 2 })
    state.settle(retry.id, false, 10)
    const remaining = claimAttempt(state, executionId, 10)
    expect(remaining.stepId).toBe('first')
    state.settle(remaining.id, true, 11)

    const execution = state.execution(executionId)
    expect(execution.status).toBe('compensation-failed')
    expect(execution.steps[0]).toMatchObject({ stepId: 'first', compensation: { status: 'succeeded' } })
    expect(execution.steps[1]).toMatchObject({ stepId: 'second', compensation: { status: 'failed' } })
    expect(state.snapshot(11)).toMatchObject({ compensationFailedExecutions: 1, compensationAttempts: 3, compensationFailed: 2, compensationSucceeded: 1 })
  })

  it('produces an identical durable history for the same ordered decisions', () => {
    const run = () => {
      const state = new WorkflowState({ maxConcurrentExecutions: 1 })
      const executionId = start(state, definition([{ id: 'one', policy: policy({ maxAttempts: 2 }) }]))
      state.settle(claimAttempt(state, executionId, 0).id, false, 1)
      state.settle(claimAttempt(state, executionId, 6).id, true, 7)
      state.start(definition([{ id: 'one', policy: policy({ maxAttempts: 2 }) }]), 'order-1', 8)
      return state.snapshot(8)
    }
    expect(run()).toEqual(run())
  })

  it('enforces active execution capacity and releases it at a terminal state', () => {
    const state = new WorkflowState({ maxConcurrentExecutions: 1 })
    const workflow = definition([{ id: 'one', policy: policy({ maxAttempts: 1 }) }])
    const first = start(state, workflow, 'one')
    expect(state.start(workflow, 'two', 0)).toEqual(expect.objectContaining({ accepted: false, reason: 'execution-capacity' }))
    state.settle(claimAttempt(state, first, 0).id, true, 1)
    expect(state.start(workflow, 'two', 1)).toMatchObject({ accepted: true, replayed: false })
    expect(state.snapshot(1)).toMatchObject({ peakActiveExecutions: 1, rejectedExecutions: 1, activeExecutions: 1 })
  })

  it('rejects invalid definitions and non-monotonic time', () => {
    expect(() => new WorkflowState({ maxConcurrentExecutions: 0 })).toThrow('maxConcurrentExecutions')
    const state = new WorkflowState({ maxConcurrentExecutions: 1 })
    expect(() => state.start(definition([]), 'key', 0)).toThrow('at least one step')
    expect(() => state.start(definition([{ id: 'x', policy: policy() }, { id: 'x', policy: policy() }]), 'key', 0)).toThrow('Duplicate')
    expect(() => state.start(definition([{ id: 'x', policy: policy({ timeoutMs: 0 }) }]), 'key', 0)).toThrow('timeoutMs')
    start(state, definition([{ id: 'x', policy: policy() }]), 'valid', 2)
    expect(() => state.snapshot(1)).toThrow('monotonic')
  })
})
