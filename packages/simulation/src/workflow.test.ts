import { describe, expect, it } from 'vitest'
import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, projectFileV3Schema, type ProjectFile, type WorkflowActivity, type WorkflowStep } from '@system-design/model'
import { runSimulation } from './engine'

const connection = (id: string, source: string, target: string) => ({
  id, source, target, sourcePort: 'out', targetPort: 'in', weight: 1,
  sourceSemantic: 'request' as const, targetSemantic: 'request' as const, routingMode: 'weighted-one' as const,
})

const retry = (maxAttempts = 1, baseDelayMs = 0) => ({ maxAttempts, backoff: 'fixed' as const, baseDelayMs, maxDelayMs: baseDelayMs, jitterRatio: 0 })
const activity = (targetNodeId: string, timeoutMs = 100, maxAttempts = 1): WorkflowActivity => ({ targetNodeId, timeoutMs, retry: retry(maxAttempts, 5) })

const workflowProject = (id: string, options: {
  steps?: WorkflowStep[]
  requestsPerSecond?: number
  durationSeconds?: number
  keySpaceSize?: number
  traceLimit?: number
  persistenceTimeMs?: number
  maxConcurrentInstances?: number
  serviceTimes?: Record<string, number>
  serviceErrors?: Record<string, number>
} = {}): ProjectFile => {
  const project = createEmptyProject(id)
  project.name = id
  project.modelingMode = 'business-aware'
  const clients = createRegisteredNode('traffic', 'clients', { x: 0, y: 0 }, 'compatibility-load')
  const api = createRegisteredNode('service', 'api', { x: 180, y: 0 })
  const workflow = createRegisteredNode('workflow', 'workflow', { x: 360, y: 0 })
  const reserve = createRegisteredNode('service', 'reserve', { x: 560, y: -100 })
  const charge = createRegisteredNode('service', 'charge', { x: 560, y: 0 })
  const confirm = createRegisteredNode('service', 'confirm', { x: 560, y: 100 })
  for (const node of [api, reserve, charge, confirm]) if (node.type === 'service') node.config = {
    ...node.config, replicas: 10, concurrencyPerReplica: 100, serviceTimeMs: options.serviceTimes?.[node.id] ?? 1, jitterMs: 0, errorRate: options.serviceErrors?.[node.id] ?? 0, maxQueueSize: 10_000,
  }
  if (workflow.type !== 'workflow') throw new Error('Expected Workflow node')
  workflow.config = {
    ...workflow.config, maxConcurrentInstances: options.maxConcurrentInstances ?? 1_000, maxQueueSize: 10_000,
    persistenceTimeMs: options.persistenceTimeMs ?? 1, defaultStepTimeMs: 5, jitterMs: 0, errorRate: 0,
  }
  project.topology.nodes = [clients, api, workflow, reserve, charge, confirm]
  project.topology.edges = [
    connection('clients-api', 'clients', 'api'), connection('api-workflow', 'api', 'workflow'),
    connection('workflow-reserve', 'workflow', 'reserve'), connection('workflow-charge', 'workflow', 'charge'), connection('workflow-confirm', 'workflow', 'confirm'),
  ]
  project.definitions = {
    schemaVersion: 1, jsonSchemas: [], dataModels: [], events: [], cacheKeys: [],
    apis: [{ id: 'checkout-api', version: 1, name: 'Checkout API', ownerNodeId: 'api', operations: [{ id: 'checkout', name: 'Checkout', method: 'POST', path: '/checkout', responses: [{ statusCode: '202' }], handlerTimeMs: 1 }] }],
    workflows: [{ id: 'checkout-workflow', version: 1, name: 'Checkout workflow', ownerNodeId: 'workflow', steps: options.steps ?? [
      { id: 'reserve', ...activity('reserve'), compensation: activity('reserve') },
      { id: 'charge', ...activity('charge'), compensation: activity('charge', 1) },
      { id: 'confirm', ...activity('confirm') },
    ] }],
    interactions: [{ id: 'checkout-flow', version: 1, name: 'Checkout flow', entryOperation: { apiId: 'checkout-api', apiVersion: 1, operationId: 'checkout' }, actions: [
      { id: 'accept', kind: 'api-call', dependsOn: [], sourceNodeId: 'clients', targetNodeId: 'api', operation: { apiId: 'checkout-api', apiVersion: 1, operationId: 'checkout' } },
      { id: 'run-workflow', kind: 'workflow', dependsOn: ['accept'], nodeId: 'workflow', workflow: { workflowId: 'checkout-workflow', workflowVersion: 1 }, idempotencyKeyPattern: 'checkout:{key}' },
    ] }],
  }
  const experiment = project.experiments[0]!
  experiment.seed = `${id}-seed`
  experiment.workloads = [{ id: 'compatibility-load', name: 'Compatibility', sourceNodeId: 'clients', requestsPerSecond: 1, startAtSeconds: 5, durationSeconds: 1, pattern: 'constant', requestBytes: 128 }]
  experiment.operationWorkloads = [{ id: 'checkout-load', name: 'Checkouts', sourceNodeId: 'clients', phases: [{ id: 'load', startAtSeconds: 0, durationSeconds: options.durationSeconds ?? 1, requestsPerSecond: options.requestsPerSecond ?? 5, pattern: 'constant' }], operationMix: [{ operation: { apiId: 'checkout-api', apiVersion: 1, operationId: 'checkout' }, interaction: { interactionId: 'checkout-flow', interactionVersion: 1 }, weight: 1, requestBytes: 256, keyDistribution: { kind: 'uniform', keySpaceSize: options.keySpaceSize ?? 1_000 } }] }]
  experiment.simulation = { durationSeconds: 3, sampleIntervalMs: 100, maxRequests: 1_000, traceLimit: options.traceLimit ?? 100, maxHops: 20 }
  return projectFileV3Schema.parse(project)
}

const details = (result: Awaited<ReturnType<typeof runSimulation>>) => result.nodes.find((node) => node.nodeId === 'workflow')!.details

describe('P2.6f executable Workflow behavior', () => {
  it('persists every successful step checkpoint and completes instances', async () => {
    const result = await runSimulation(workflowProject('workflow-success'), 'workflow-success-run')
    expect(Number(details(result).workflowCompletedInstances)).toBe(5)
    expect(Number(details(result).workflowStepCheckpoints)).toBe(15)
    expect(result.actions.find((action) => action.actionId === 'run-workflow')).toMatchObject({ actionKind: 'workflow', completed: 5, failed: 0 })
  })

  it('deduplicates identical keys without rerunning checkpointed work', async () => {
    const result = await runSimulation(workflowProject('workflow-dedup', { keySpaceSize: 1, requestsPerSecond: 10 }), 'workflow-dedup-run')
    expect(Number(details(result).workflowStartedInstances)).toBe(1)
    expect(Number(details(result).workflowIdempotencyReplays)).toBe(9)
    expect(Number(details(result).workflowStepAttempts)).toBe(3)
  })

  it('joins an in-flight execution for the same key instead of failing or duplicating work', async () => {
    const result = await runSimulation(workflowProject('workflow-in-flight-dedup', {
      keySpaceSize: 1, requestsPerSecond: 10, serviceTimes: { reserve: 200, charge: 200, confirm: 200 },
      steps: [
        { id: 'reserve', ...activity('reserve', 1_000), compensation: activity('reserve', 1_000) },
        { id: 'charge', ...activity('charge', 1_000), compensation: activity('charge', 1_000) },
        { id: 'confirm', ...activity('confirm', 1_000) },
      ],
    }), 'workflow-in-flight-dedup-run')
    expect(Number(details(result).workflowStartedInstances)).toBe(1)
    expect(Number(details(result).workflowIdempotencyReplays)).toBe(9)
    expect(Number(details(result).workflowStepAttempts)).toBe(3)
    expect(result.actions.find((action) => action.actionId === 'run-workflow')).toMatchObject({ completed: 10, failed: 0 })
  })

  it('changes measured outcomes when persistence or execution capacity changes', async () => {
    const fast = await runSimulation(workflowProject('workflow-fast-persistence', { requestsPerSecond: 1, persistenceTimeMs: 0 }), 'workflow-fast-persistence-run')
    const durable = await runSimulation(workflowProject('workflow-durable-persistence', { requestsPerSecond: 1, persistenceTimeMs: 50 }), 'workflow-durable-persistence-run')
    const fastAction = fast.actions.find((action) => action.actionId === 'run-workflow')!
    const durableAction = durable.actions.find((action) => action.actionId === 'run-workflow')!
    expect(durableAction.averageDurationMs).toBeGreaterThan(fastAction.averageDurationMs + 40)

    const constrained = await runSimulation(workflowProject('workflow-constrained', {
      requestsPerSecond: 10, maxConcurrentInstances: 1, serviceTimes: { reserve: 200, charge: 200, confirm: 200 },
      steps: [
        { id: 'reserve', ...activity('reserve', 1_000) },
        { id: 'charge', ...activity('charge', 1_000) },
        { id: 'confirm', ...activity('confirm', 1_000) },
      ],
    }), 'workflow-constrained-run')
    expect(Number(details(constrained).workflowRejectedInstances)).toBeGreaterThan(0)
    expect(constrained.actions.find((action) => action.actionId === 'run-workflow')?.failed).toBeGreaterThan(0)
  })

  it('times out, retries with backoff, then compensates in reverse order when exhausted', async () => {
    const steps: WorkflowStep[] = [
      { id: 'reserve', ...activity('reserve'), compensation: activity('reserve') },
      { id: 'charge', ...activity('charge'), compensation: activity('charge') },
      { id: 'confirm', ...activity('confirm', 2, 2) },
    ]
    const result = await runSimulation(workflowProject('workflow-timeout', { steps, requestsPerSecond: 1, serviceTimes: { confirm: 10 } }), 'workflow-timeout-run')
    expect(Number(details(result).workflowStepTimeouts)).toBe(2)
    expect(Number(details(result).workflowRetries)).toBe(1)
    expect(Number(details(result).workflowCompensatedInstances)).toBe(1)
    const compensations = result.events.filter((event) => event.type === 'workflow-compensation-completed' && event.status === 'ok' && event.attributes.workflowActivity === 'compensation')
    expect(compensations.map((event) => event.attributes.workflowTargetNodeId)).toEqual(['charge', 'reserve'])
  })

  it('continues earlier compensation after a compensation failure', async () => {
    const steps: WorkflowStep[] = [
      { id: 'reserve', ...activity('reserve'), compensation: activity('reserve') },
      { id: 'charge', ...activity('charge'), compensation: activity('charge', 1) },
      { id: 'confirm', ...activity('confirm') },
    ]
    const result = await runSimulation(workflowProject('workflow-compensation-failure', { steps, requestsPerSecond: 1, serviceTimes: { charge: 3 }, serviceErrors: { confirm: 1 } }), 'workflow-compensation-failure-run')
    expect(Number(details(result).workflowCompensationFailedInstances)).toBe(1)
    expect(Number(details(result).workflowCompensationFailures)).toBeGreaterThan(0)
    expect(result.events.some((event) => event.type === 'workflow-compensation-completed' && event.attributes.workflowTargetNodeId === 'reserve' && event.status === 'ok')).toBe(true)
  })

  it('retains workflow and action aggregates when traceLimit is zero', async () => {
    const result = await runSimulation(workflowProject('workflow-no-traces', { traceLimit: 0 }), 'workflow-no-traces-run')
    expect(result.events.some((event) => event.requestId)).toBe(false)
    expect(Number(details(result).workflowCompletedInstances)).toBe(5)
    expect(result.actions.find((action) => action.actionId === 'run-workflow')).toMatchObject({
      completed: 5, failed: 0,
      details: { workflowDefinitionId: 'checkout-workflow@1', workflowStatus: 'succeeded' },
    })
  })

  it('replays the complete runtime deterministically for the same project and seed', async () => {
    const retryWithJitter = { maxAttempts: 2, backoff: 'exponential' as const, baseDelayMs: 10, maxDelayMs: 20, jitterRatio: 0.5 }
    const project = workflowProject('workflow-deterministic', {
      requestsPerSecond: 2, serviceErrors: { confirm: 1 },
      steps: [
        { id: 'reserve', ...activity('reserve'), compensation: activity('reserve') },
        { id: 'charge', ...activity('charge'), compensation: activity('charge') },
        { id: 'confirm', targetNodeId: 'confirm', timeoutMs: 100, retry: retryWithJitter },
      ],
    })
    const first = await runSimulation(project, 'workflow-deterministic-run')
    const second = await runSimulation(structuredClone(project), 'workflow-deterministic-run')
    expect(second.events).toEqual(first.events)
    expect(second.nodes).toEqual(first.nodes)
    expect(second.actions).toEqual(first.actions)
  })

  it('executes capacity-only Workflow nodes as a synthetic durable step', async () => {
    const project = createEmptyProject('workflow-capacity-only')
    const traffic = createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }, 'load')
    const workflow = createRegisteredNode('workflow', 'workflow', { x: 200, y: 0 })
    project.topology.nodes = [traffic, workflow]
    project.topology.edges = [connection('traffic-workflow', 'traffic', 'workflow')]
    project.experiments[0]!.workloads = [{ id: 'load', name: 'Work', sourceNodeId: 'traffic', requestsPerSecond: 4, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 128 }]
    project.experiments[0]!.simulation = { durationSeconds: 2, sampleIntervalMs: 100, maxRequests: 100, traceLimit: 20, maxHops: 10 }
    const result = await runSimulation(project, 'workflow-capacity-run')
    expect(Number(details(result).workflowCompletedInstances)).toBe(4)
    expect(Number(details(result).workflowStepCheckpoints)).toBe(4)
  })
})
