export type WorkflowExecutionStatus =
  | 'running'
  | 'compensating'
  | 'succeeded'
  | 'failed'
  | 'compensated'
  | 'compensation-failed'

export type WorkflowAttemptKind = 'step' | 'compensation'
export type WorkflowAttemptOutcome = 'succeeded' | 'failed' | 'timed-out'

export interface WorkflowAttemptPolicy {
  timeoutMs: number
  maxAttempts: number
  initialBackoffMs: number
  backoffMultiplier: number
  maxBackoffMs: number
  jitterRatio: number
}

export interface WorkflowStepDefinition {
  id: string
  policy: WorkflowAttemptPolicy
  compensation?: WorkflowAttemptPolicy
}

export interface WorkflowDefinition {
  id: string
  version: number
  steps: readonly WorkflowStepDefinition[]
}

export interface WorkflowStateConfig {
  maxConcurrentExecutions: number
}

export interface WorkflowAttempt {
  id: string
  executionId: string
  stepId: string
  kind: WorkflowAttemptKind
  attempt: number
  startedAtMs: number
  deadlineAtMs: number
  retryDelayMs: number
}

export interface WorkflowAttemptRecord extends WorkflowAttempt {
  completedAtMs?: number
  outcome?: WorkflowAttemptOutcome
}

export type WorkflowTransitionType =
  | 'execution-started'
  | 'idempotency-replayed'
  | 'attempt-started'
  | 'step-succeeded'
  | 'step-failed'
  | 'step-timed-out'
  | 'retry-scheduled'
  | 'compensation-started'
  | 'compensation-succeeded'
  | 'compensation-failed'
  | 'compensation-timed-out'
  | 'execution-succeeded'
  | 'execution-failed'
  | 'execution-compensated'
  | 'execution-compensation-failed'

export interface WorkflowTransition {
  type: WorkflowTransitionType
  timestampMs: number
  executionId: string
  workflowId: string
  stepId?: string
  attempt?: number
  retryAtMs?: number
}

export interface WorkflowExecutionSnapshot {
  executionId: string
  workflowId: string
  workflowVersion: number
  idempotencyKey: string
  status: WorkflowExecutionStatus
  startedAtMs: number
  completedAtMs?: number
  currentStepId?: string
  currentAttempt?: WorkflowAttempt
  retryAtMs?: number
  failureStepId?: string
  steps: Array<{
    stepId: string
    status: 'pending' | 'in-flight' | 'waiting-retry' | 'succeeded' | 'failed'
    attempts: WorkflowAttemptRecord[]
    compensation?: {
      status: 'not-started' | 'in-flight' | 'waiting-retry' | 'succeeded' | 'failed'
      attempts: WorkflowAttemptRecord[]
    }
  }>
}

export type WorkflowStartResult =
  | { accepted: true; replayed: boolean; execution: WorkflowExecutionSnapshot; transitions: WorkflowTransition[] }
  | { accepted: false; reason: 'execution-capacity' | 'idempotency-conflict'; transitions: WorkflowTransition[] }

export type WorkflowClaimResult =
  | { kind: 'attempt'; attempt: WorkflowAttempt; transitions: WorkflowTransition[] }
  | { kind: 'in-flight'; attempt: WorkflowAttempt; transitions: WorkflowTransition[] }
  | { kind: 'wait'; untilMs: number; transitions: WorkflowTransition[] }
  | { kind: 'terminal'; status: Extract<WorkflowExecutionStatus, 'succeeded' | 'failed' | 'compensated' | 'compensation-failed'>; transitions: WorkflowTransition[] }

export interface WorkflowSettlementResult {
  replayed: boolean
  outcome: WorkflowAttemptOutcome
  execution: WorkflowExecutionSnapshot
  transitions: WorkflowTransition[]
}

interface MutableStepState {
  status: WorkflowExecutionSnapshot['steps'][number]['status']
  attempts: WorkflowAttemptRecord[]
  compensation?: {
    status: NonNullable<WorkflowExecutionSnapshot['steps'][number]['compensation']>['status']
    attempts: WorkflowAttemptRecord[]
  }
}

interface MutableExecution {
  executionId: string
  definition: WorkflowDefinition
  definitionSignature: string
  idempotencyKey: string
  status: WorkflowExecutionStatus
  startedAtMs: number
  completedAtMs?: number
  nextStepIndex: number
  compensationStepIndexes: number[]
  compensationCursor: number
  compensationHadFailure: boolean
  retryAtMs?: number
  failureStepId?: string
  currentAttempt?: WorkflowAttemptRecord
  steps: MutableStepState[]
}

const terminalStatuses = new Set<WorkflowExecutionStatus>(['succeeded', 'failed', 'compensated', 'compensation-failed'])

const validateIdentifier = (value: string, label: string) => {
  if (value.trim().length === 0) throw new Error(`${label} must not be empty.`)
}

const validatePolicy = (policy: WorkflowAttemptPolicy, label: string) => {
  if (!Number.isFinite(policy.timeoutMs) || policy.timeoutMs <= 0) throw new Error(`${label}.timeoutMs must be positive.`)
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) throw new Error(`${label}.maxAttempts must be a positive integer.`)
  if (!Number.isFinite(policy.initialBackoffMs) || policy.initialBackoffMs < 0) throw new Error(`${label}.initialBackoffMs must be non-negative.`)
  if (!Number.isFinite(policy.backoffMultiplier) || policy.backoffMultiplier < 1) throw new Error(`${label}.backoffMultiplier must be at least 1.`)
  if (!Number.isFinite(policy.maxBackoffMs) || policy.maxBackoffMs < 0) throw new Error(`${label}.maxBackoffMs must be non-negative.`)
  if (policy.maxBackoffMs < policy.initialBackoffMs) throw new Error(`${label}.maxBackoffMs must be at least initialBackoffMs.`)
  if (!Number.isFinite(policy.jitterRatio) || policy.jitterRatio < 0 || policy.jitterRatio > 1) throw new Error(`${label}.jitterRatio must be between 0 and 1.`)
}

const normalizedPolicy = (policy: WorkflowAttemptPolicy) => ({
  timeoutMs: policy.timeoutMs, maxAttempts: policy.maxAttempts, initialBackoffMs: policy.initialBackoffMs,
  backoffMultiplier: policy.backoffMultiplier, maxBackoffMs: policy.maxBackoffMs, jitterRatio: policy.jitterRatio,
})

const definitionSignature = (definition: WorkflowDefinition) => JSON.stringify({
  id: definition.id,
  version: definition.version,
  steps: definition.steps.map((step) => ({ id: step.id, policy: normalizedPolicy(step.policy), compensation: step.compensation ? normalizedPolicy(step.compensation) : null })),
})

const clonePolicy = (policy: WorkflowAttemptPolicy): WorkflowAttemptPolicy => normalizedPolicy(policy)
const cloneDefinition = (definition: WorkflowDefinition): WorkflowDefinition => ({
  id: definition.id,
  version: definition.version,
  steps: definition.steps.map((step) => ({
    id: step.id,
    policy: clonePolicy(step.policy),
    ...(step.compensation === undefined ? {} : { compensation: clonePolicy(step.compensation) }),
  })),
})

/**
 * Deterministic durable workflow state. Callers execute the claimed work and
 * explicitly settle it; this class owns idempotency, deadlines, retry clocks,
 * step history, and reverse-order compensation.
 */
export class WorkflowState {
  private readonly executions = new Map<string, MutableExecution>()
  private readonly executionByIdempotencyScope = new Map<string, string>()
  private readonly settledAttempts = new Map<string, WorkflowAttemptOutcome>()
  private readonly executionByAttempt = new Map<string, string>()
  private lastTimeMs = 0
  private nextExecutionId = 0
  private peakActiveExecutions = 0
  private startedExecutions = 0
  private rejectedExecutions = 0
  private idempotencyReplays = 0
  private idempotencyConflicts = 0
  private stepAttempts = 0
  private stepSucceeded = 0
  private stepFailed = 0
  private stepTimedOut = 0
  private retriesScheduled = 0
  private compensationAttempts = 0
  private compensationSucceeded = 0
  private compensationFailed = 0
  private compensationTimedOut = 0

  constructor(readonly config: WorkflowStateConfig) {
    if (!Number.isInteger(config.maxConcurrentExecutions) || config.maxConcurrentExecutions < 1) {
      throw new Error('maxConcurrentExecutions must be a positive integer.')
    }
  }

  start(definition: WorkflowDefinition, idempotencyKey: string, nowMs: number): WorkflowStartResult {
    this.validateDefinition(definition)
    validateIdentifier(idempotencyKey, 'Idempotency key')
    const transitions = this.advanceTo(nowMs)
    const scope = `${definition.id}\0${idempotencyKey}`
    const existingId = this.executionByIdempotencyScope.get(scope)
    if (existingId) {
      const existing = this.requireExecution(existingId)
      if (existing.definitionSignature !== definitionSignature(definition)) {
        this.idempotencyConflicts += 1
        return { accepted: false, reason: 'idempotency-conflict', transitions }
      }
      this.idempotencyReplays += 1
      transitions.push(this.transition(existing, 'idempotency-replayed', nowMs))
      return { accepted: true, replayed: true, execution: this.executionSnapshot(existing), transitions }
    }
    if (this.activeExecutionCount() >= this.config.maxConcurrentExecutions) {
      this.rejectedExecutions += 1
      return { accepted: false, reason: 'execution-capacity', transitions }
    }

    const storedDefinition = cloneDefinition(definition)
    const executionId = `${storedDefinition.id}:${this.nextExecutionId++}`
    const execution: MutableExecution = {
      executionId, definition: storedDefinition, definitionSignature: definitionSignature(storedDefinition), idempotencyKey, status: 'running',
      startedAtMs: nowMs, nextStepIndex: 0, compensationStepIndexes: [], compensationCursor: 0, compensationHadFailure: false,
      steps: storedDefinition.steps.map((step) => ({
        status: 'pending', attempts: [],
        ...(step.compensation === undefined ? {} : { compensation: { status: 'not-started' as const, attempts: [] } }),
      })),
    }
    this.executions.set(executionId, execution)
    this.executionByIdempotencyScope.set(scope, executionId)
    this.startedExecutions += 1
    this.peakActiveExecutions = Math.max(this.peakActiveExecutions, this.activeExecutionCount())
    transitions.push(this.transition(execution, 'execution-started', nowMs))
    return { accepted: true, replayed: false, execution: this.executionSnapshot(execution), transitions }
  }

  claim(executionId: string, nowMs: number, random: () => number = () => 0.5): WorkflowClaimResult {
    const transitions = this.advanceTo(nowMs)
    const execution = this.requireExecution(executionId)
    if (terminalStatuses.has(execution.status)) {
      return { kind: 'terminal', status: execution.status as Extract<WorkflowExecutionStatus, 'succeeded' | 'failed' | 'compensated' | 'compensation-failed'>, transitions }
    }
    if (execution.currentAttempt) return { kind: 'in-flight', attempt: this.publicAttempt(execution.currentAttempt), transitions }
    if (execution.retryAtMs !== undefined && execution.retryAtMs > nowMs) return { kind: 'wait', untilMs: execution.retryAtMs, transitions }

    delete execution.retryAtMs
    const stepIndex = execution.status === 'compensating'
      ? execution.compensationStepIndexes[execution.compensationCursor]
      : execution.nextStepIndex
    if (stepIndex === undefined || !execution.definition.steps[stepIndex]) {
      throw new Error(`Execution ${executionId} has no claimable step.`)
    }
    const definition = execution.definition.steps[stepIndex]!
    const state = execution.steps[stepIndex]!
    const kind: WorkflowAttemptKind = execution.status === 'compensating' ? 'compensation' : 'step'
    const policy = kind === 'step' ? definition.policy : definition.compensation!
    const attempts = kind === 'step' ? state.attempts : state.compensation!.attempts
    const attemptNumber = attempts.length + 1
    const retryDelayMs = attemptNumber < policy.maxAttempts ? this.retryDelay(policy, attemptNumber, random()) : 0
    const attempt: WorkflowAttemptRecord = {
      id: `${execution.executionId}:${kind}:${definition.id}:${attemptNumber}`, executionId: execution.executionId, stepId: definition.id, kind, attempt: attemptNumber,
      startedAtMs: nowMs, deadlineAtMs: nowMs + policy.timeoutMs, retryDelayMs,
    }
    attempts.push(attempt)
    this.executionByAttempt.set(attempt.id, execution.executionId)
    execution.currentAttempt = attempt
    if (kind === 'step') { state.status = 'in-flight'; this.stepAttempts += 1 }
    else { state.compensation!.status = 'in-flight'; this.compensationAttempts += 1 }
    transitions.push(this.transition(execution, 'attempt-started', nowMs, definition.id, attemptNumber))
    return { kind: 'attempt', attempt: this.publicAttempt(attempt), transitions }
  }

  settle(attemptId: string, success: boolean, nowMs: number): WorkflowSettlementResult {
    const transitions = this.advanceTo(nowMs)
    const replayedOutcome = this.settledAttempts.get(attemptId)
    const executionId = this.executionIdFromAttempt(attemptId)
    const execution = this.requireExecution(executionId)
    if (replayedOutcome) {
      return { replayed: true, outcome: replayedOutcome, execution: this.executionSnapshot(execution), transitions }
    }
    const attempt = execution.currentAttempt
    if (!attempt || attempt.id !== attemptId) throw new Error(`Attempt ${attemptId} is not in flight.`)
    const outcome: WorkflowAttemptOutcome = success ? 'succeeded' : 'failed'
    transitions.push(...this.settleAttempt(execution, attempt, outcome, nowMs))
    return { replayed: false, outcome, execution: this.executionSnapshot(execution), transitions }
  }

  advanceTo(nowMs: number): WorkflowTransition[] {
    this.validateTime(nowMs)
    const transitions: WorkflowTransition[] = []
    const due = [...this.executions.values()]
      .filter((execution) => execution.currentAttempt && execution.currentAttempt.deadlineAtMs <= nowMs)
      .sort((left, right) => left.currentAttempt!.deadlineAtMs - right.currentAttempt!.deadlineAtMs || left.executionId.localeCompare(right.executionId))
    for (const execution of due) {
      const attempt = execution.currentAttempt
      if (attempt && attempt.deadlineAtMs <= nowMs) transitions.push(...this.settleAttempt(execution, attempt, 'timed-out', attempt.deadlineAtMs))
    }
    this.lastTimeMs = nowMs
    return transitions
  }

  execution(executionId: string): WorkflowExecutionSnapshot {
    return this.executionSnapshot(this.requireExecution(executionId))
  }

  snapshot(nowMs: number) {
    const transitions = this.advanceTo(nowMs)
    const executions = [...this.executions.values()].sort((left, right) => left.executionId.localeCompare(right.executionId)).map((execution) => this.executionSnapshot(execution))
    const count = (status: WorkflowExecutionStatus) => executions.filter((execution) => execution.status === status).length
    return {
      activeExecutions: executions.filter((execution) => !terminalStatuses.has(execution.status)).length, peakActiveExecutions: this.peakActiveExecutions,
      startedExecutions: this.startedExecutions, rejectedExecutions: this.rejectedExecutions, idempotencyReplays: this.idempotencyReplays, idempotencyConflicts: this.idempotencyConflicts,
      succeededExecutions: count('succeeded'), failedExecutions: count('failed'), compensatedExecutions: count('compensated'), compensationFailedExecutions: count('compensation-failed'),
      stepAttempts: this.stepAttempts, stepSucceeded: this.stepSucceeded, stepFailed: this.stepFailed, stepTimedOut: this.stepTimedOut, retriesScheduled: this.retriesScheduled,
      compensationAttempts: this.compensationAttempts, compensationSucceeded: this.compensationSucceeded, compensationFailed: this.compensationFailed, compensationTimedOut: this.compensationTimedOut,
      inFlightAttempts: executions.filter((execution) => execution.currentAttempt !== undefined).length,
      pendingRetries: executions.filter((execution) => execution.retryAtMs !== undefined && execution.retryAtMs > nowMs).length,
      executions, transitions,
    }
  }

  private settleAttempt(execution: MutableExecution, attempt: WorkflowAttemptRecord, outcome: WorkflowAttemptOutcome, completedAtMs: number): WorkflowTransition[] {
    attempt.completedAtMs = completedAtMs
    attempt.outcome = outcome
    delete execution.currentAttempt
    this.settledAttempts.set(attempt.id, outcome)
    const stepIndex = execution.definition.steps.findIndex((step) => step.id === attempt.stepId)
    const definition = execution.definition.steps[stepIndex]!
    const state = execution.steps[stepIndex]!
    const transitions: WorkflowTransition[] = []

    if (attempt.kind === 'step') {
      if (outcome === 'succeeded') {
        state.status = 'succeeded'
        this.stepSucceeded += 1
        execution.nextStepIndex = stepIndex + 1
        transitions.push(this.transition(execution, 'step-succeeded', completedAtMs, definition.id, attempt.attempt))
        if (execution.nextStepIndex >= execution.definition.steps.length) this.finishExecution(execution, 'succeeded', completedAtMs, transitions)
        return transitions
      }
      if (outcome === 'timed-out') this.stepTimedOut += 1
      else this.stepFailed += 1
      transitions.push(this.transition(execution, outcome === 'timed-out' ? 'step-timed-out' : 'step-failed', completedAtMs, definition.id, attempt.attempt))
      if (attempt.attempt < definition.policy.maxAttempts) {
        state.status = 'waiting-retry'
        execution.retryAtMs = completedAtMs + attempt.retryDelayMs
        this.retriesScheduled += 1
        transitions.push(this.transition(execution, 'retry-scheduled', completedAtMs, definition.id, attempt.attempt, execution.retryAtMs))
        return transitions
      }
      state.status = 'failed'
      execution.failureStepId = definition.id
      execution.compensationStepIndexes = execution.steps
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate, index }) => index < stepIndex && candidate.status === 'succeeded' && execution.definition.steps[index]!.compensation !== undefined)
        .map(({ index }) => index)
        .reverse()
      execution.compensationCursor = 0
      if (execution.compensationStepIndexes.length === 0) {
        this.finishExecution(execution, 'failed', completedAtMs, transitions)
      } else {
        execution.status = 'compensating'
        transitions.push(this.transition(execution, 'compensation-started', completedAtMs, execution.definition.steps[execution.compensationStepIndexes[0]!]!.id))
      }
      return transitions
    }

    const compensation = state.compensation!
    if (outcome === 'succeeded') {
      compensation.status = 'succeeded'
      this.compensationSucceeded += 1
      transitions.push(this.transition(execution, 'compensation-succeeded', completedAtMs, definition.id, attempt.attempt))
      execution.compensationCursor += 1
      this.finishCompensationIfComplete(execution, completedAtMs, transitions)
      return transitions
    }
    if (outcome === 'timed-out') this.compensationTimedOut += 1
    else this.compensationFailed += 1
    transitions.push(this.transition(execution, outcome === 'timed-out' ? 'compensation-timed-out' : 'compensation-failed', completedAtMs, definition.id, attempt.attempt))
    if (attempt.attempt < definition.compensation!.maxAttempts) {
      compensation.status = 'waiting-retry'
      execution.retryAtMs = completedAtMs + attempt.retryDelayMs
      this.retriesScheduled += 1
      transitions.push(this.transition(execution, 'retry-scheduled', completedAtMs, definition.id, attempt.attempt, execution.retryAtMs))
      return transitions
    }
    compensation.status = 'failed'
    execution.compensationHadFailure = true
    execution.compensationCursor += 1
    this.finishCompensationIfComplete(execution, completedAtMs, transitions)
    return transitions
  }

  private finishCompensationIfComplete(execution: MutableExecution, completedAtMs: number, transitions: WorkflowTransition[]) {
    if (execution.compensationCursor < execution.compensationStepIndexes.length) return
    this.finishExecution(execution, execution.compensationHadFailure ? 'compensation-failed' : 'compensated', completedAtMs, transitions)
  }

  private finishExecution(execution: MutableExecution, status: Extract<WorkflowExecutionStatus, 'succeeded' | 'failed' | 'compensated' | 'compensation-failed'>, completedAtMs: number, transitions: WorkflowTransition[]) {
    execution.status = status
    execution.completedAtMs = completedAtMs
    const type: WorkflowTransitionType = status === 'succeeded' ? 'execution-succeeded'
      : status === 'failed' ? 'execution-failed'
        : status === 'compensated' ? 'execution-compensated' : 'execution-compensation-failed'
    transitions.push(this.transition(execution, type, completedAtMs, execution.failureStepId))
  }

  private retryDelay(policy: WorkflowAttemptPolicy, failedAttempt: number, randomSample: number) {
    if (!Number.isFinite(randomSample) || randomSample < 0 || randomSample > 1) throw new Error('Workflow retry random sample must be between 0 and 1.')
    const base = Math.min(policy.maxBackoffMs, policy.initialBackoffMs * policy.backoffMultiplier ** Math.max(0, failedAttempt - 1))
    const jittered = base * (1 + (randomSample * 2 - 1) * policy.jitterRatio)
    return Math.min(policy.maxBackoffMs, Math.max(0, jittered))
  }

  private transition(execution: MutableExecution, type: WorkflowTransitionType, timestampMs: number, stepId?: string, attempt?: number, retryAtMs?: number): WorkflowTransition {
    return {
      type, timestampMs, executionId: execution.executionId, workflowId: execution.definition.id,
      ...(stepId === undefined ? {} : { stepId }), ...(attempt === undefined ? {} : { attempt }), ...(retryAtMs === undefined ? {} : { retryAtMs }),
    }
  }

  private executionSnapshot(execution: MutableExecution): WorkflowExecutionSnapshot {
    return {
      executionId: execution.executionId, workflowId: execution.definition.id, workflowVersion: execution.definition.version, idempotencyKey: execution.idempotencyKey, status: execution.status,
      startedAtMs: execution.startedAtMs, ...(execution.completedAtMs === undefined ? {} : { completedAtMs: execution.completedAtMs }),
      ...(execution.currentAttempt === undefined ? {} : { currentStepId: execution.currentAttempt.stepId, currentAttempt: this.publicAttempt(execution.currentAttempt) }),
      ...(execution.retryAtMs === undefined ? {} : { retryAtMs: execution.retryAtMs }), ...(execution.failureStepId === undefined ? {} : { failureStepId: execution.failureStepId }),
      steps: execution.definition.steps.map((definition, index) => {
        const state = execution.steps[index]!
        return {
          stepId: definition.id, status: state.status, attempts: state.attempts.map((attempt) => ({ ...attempt })),
          ...(state.compensation === undefined ? {} : { compensation: { status: state.compensation.status, attempts: state.compensation.attempts.map((attempt) => ({ ...attempt })) } }),
        }
      }),
    }
  }

  private publicAttempt(attempt: WorkflowAttemptRecord): WorkflowAttempt {
    const { completedAtMs: _completedAtMs, outcome: _outcome, ...value } = attempt
    return { ...value }
  }

  private activeExecutionCount() {
    return [...this.executions.values()].filter((execution) => !terminalStatuses.has(execution.status)).length
  }

  private requireExecution(executionId: string) {
    const execution = this.executions.get(executionId)
    if (!execution) throw new Error(`Unknown workflow execution ${executionId}.`)
    return execution
  }

  private executionIdFromAttempt(attemptId: string) {
    const executionId = this.executionByAttempt.get(attemptId)
    if (!executionId) throw new Error(`Unknown workflow attempt ${attemptId}.`)
    return executionId
  }

  private validateDefinition(definition: WorkflowDefinition) {
    validateIdentifier(definition.id, 'Workflow ID')
    if (!Number.isInteger(definition.version) || definition.version < 1) throw new Error('Workflow version must be a positive integer.')
    if (definition.steps.length < 1) throw new Error('A workflow must define at least one step.')
    const ids = new Set<string>()
    for (const [index, step] of definition.steps.entries()) {
      validateIdentifier(step.id, `Step ${index} ID`)
      if (ids.has(step.id)) throw new Error(`Duplicate workflow step ID: ${step.id}.`)
      ids.add(step.id)
      validatePolicy(step.policy, `Step ${step.id} policy`)
      if (step.compensation) validatePolicy(step.compensation, `Step ${step.id} compensation`)
    }
  }

  private validateTime(nowMs: number) {
    if (!Number.isFinite(nowMs) || nowMs < this.lastTimeMs) throw new Error('Virtual time must be finite and monotonic.')
  }
}
