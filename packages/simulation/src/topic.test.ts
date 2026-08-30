import { describe, expect, it } from 'vitest'
import { createRegisteredNode } from '@system-design/components'
import { createEmptyProject, type ProjectFile, type RoutingMode } from '@system-design/model'
import { createOrderSystemContractFixture } from '@system-design/model'
import { runSimulation } from './engine'
import { compileSimulationInput } from './compiler/compiler'
import { validateScenarioForSimulation } from './compiler/validation'

const edge = (id: string, source: string, target: string, sourcePort = 'out', targetPort = 'in', routingMode: RoutingMode = 'weighted-one') => ({
  id, source, target, sourcePort, targetPort, weight: 1, routingMode,
  sourceSemantic: sourcePort === 'publish' ? 'publish' as const : 'request' as const,
  targetSemantic: targetPort === 'consume' ? 'consume' as const : 'request' as const,
})

const topicProject = (id: string, consumers = 2): ProjectFile => {
  const project = createEmptyProject(id)
  const experiment = project.experiments[0]!
  experiment.seed = `${id}-seed`
  experiment.simulation = { durationSeconds: 2, sampleIntervalMs: 100, maxRequests: 1_000, traceLimit: 100, maxHops: 20 }
  experiment.workloads = [{ id: 'load', name: 'Load', sourceNodeId: 'traffic', requestsPerSecond: 5, startAtSeconds: 0, durationSeconds: 1, pattern: 'constant', requestBytes: 256 }]
  const traffic = createRegisteredNode('traffic', 'traffic', { x: 0, y: 0 }, 'load')
  const producer = createRegisteredNode('service', 'producer', { x: 100, y: 0 })
  const topic = createRegisteredNode('topic', 'topic', { x: 200, y: 0 })
  topic.config = { ...topic.config, subscriptionCount: 2, maxRetainedMessages: 1_000, retentionMs: 10_000, batchSize: 1, acknowledgement: 'explicit', publishCapacity: 100, publishTimeMs: 1, deliveryTimeMs: 1, jitterMs: 0, maxQueueSize: 1_000, errorRate: 0 }
  project.topology.nodes = [traffic, producer, topic]
  project.topology.edges = [edge('entry', 'traffic', 'producer'), edge('publish', 'producer', 'topic', 'publish', 'consume', 'async-publish')]
  for (let index = 0; index < consumers; index += 1) {
    const consumer = createRegisteredNode('service', `consumer-${index}`, { x: 300, y: index * 100 })
    consumer.config = { ...consumer.config, serviceTimeMs: 1, jitterMs: 0, errorRate: 0 }
    project.topology.nodes.push(consumer)
    project.topology.edges.push(edge(`subscription-${index}`, 'topic', consumer.id, 'publish', 'consume', 'async-publish'))
  }
  return project
}

describe('P2.6d executable Topic behavior', () => {
  it('fans each publication into independent acknowledged subscriptions', async () => {
    const project = topicProject('topic-fan-out')
    const result = await runSimulation(project, 'topic-fan-out-run')
    const details = result.nodes.find((node) => node.nodeId === 'topic')!.details
    const published = Number(details.topicPublished)
    expect(published).toBe(result.summary.generatedRequests)
    expect(Number(details.topicFanOutCopies)).toBe(published * 2)
    expect(Number(details.topicAcknowledged)).toBe(published * 2)
    expect(Number(details.subscriptionBacklog0)).toBe(0)
    expect(Number(details.subscriptionBacklog1)).toBe(0)
    expect(result.events.filter((event) => event.type === 'topic-message-delivered')).toHaveLength(published * 2)
    expect(new Set(result.events.filter((event) => event.type === 'topic-message-acknowledged').map((event) => event.attributes.subscriptionId))).toEqual(new Set(['subscription:0', 'subscription:1']))
  })

  it('keeps an unbound subscription backlog independent from a successful subscriber', async () => {
    const project = topicProject('topic-independent', 1)
    expect(validateScenarioForSimulation(project).warnings).toContain('Topic Topic has 1 offline subscription slot(s); their retained backlog can grow until retention expires.')
    const result = await runSimulation(project, 'topic-independent-run')
    const details = result.nodes.find((node) => node.nodeId === 'topic')!.details
    expect(Number(details.subscriptionBacklog0)).toBe(0)
    expect(Number(details.subscriptionBacklog1)).toBe(Number(details.topicPublished))
    expect(Number(details.topicAcknowledged)).toBe(Number(details.topicPublished))
  })

  it('expires slow in-flight subscriptions at the configured virtual retention boundary', async () => {
    const project = topicProject('topic-retention')
    const topic = project.topology.nodes.find((node) => node.id === 'topic')
    const secondConsumer = project.topology.nodes.find((node) => node.id === 'consumer-1')
    if (topic?.type !== 'topic' || secondConsumer?.type !== 'service') throw new Error('Expected Topic fixture nodes')
    topic.config.retentionMs = 50
    secondConsumer.config.serviceTimeMs = 500

    const result = await runSimulation(project, 'topic-retention-run')
    const details = result.nodes.find((node) => node.nodeId === 'topic')!.details
    expect(Number(details.topicTimeExpiredMessages)).toBeGreaterThan(0)
    expect(result.events.some((event) => event.type === 'topic-message-expired' && event.attributes.subscriptionId === 'subscription:1' && event.attributes.wasInFlight === true)).toBe(true)
  })

  it('retains deterministic topic domain events for the same run identity', async () => {
    const project = topicProject('topic-replay')
    const first = await runSimulation(project, 'topic-replay-run')
    const second = await runSimulation(structuredClone(project), 'topic-replay-run')
    expect(second.events).toEqual(first.events)
  })

  it('does not acknowledge a subscription whose consumer fails', async () => {
    const project = topicProject('topic-consumer-failure')
    const failedConsumer = project.topology.nodes.find((node) => node.id === 'consumer-1')
    if (failedConsumer?.type !== 'service') throw new Error('Expected Topic consumer')
    failedConsumer.config.errorRate = 1
    const result = await runSimulation(project, 'topic-consumer-failure-run')
    const details = result.nodes.find((node) => node.nodeId === 'topic')!.details
    expect(Number(details.subscriptionBacklog0)).toBe(0)
    expect(Number(details.subscriptionBacklog1)).toBe(Number(details.topicPublished))
    expect(Number(details.topicAcknowledged)).toBe(Number(details.topicPublished))
    expect(result.events.some((event) => event.type === 'topic-message-acknowledged' && event.attributes.subscriptionId === 'subscription:1')).toBe(false)
  })

  it('redelivers a released batch on a later publication trigger', async () => {
    const project = topicProject('topic-redelivery', 1)
    const consumer = project.topology.nodes.find((node) => node.id === 'consumer-0')
    if (consumer?.type !== 'service') throw new Error('Expected Topic consumer')
    consumer.config.errorRate = 0.5
    project.experiments[0]!.workloads[0]!.requestsPerSecond = 20
    const result = await runSimulation(project, 'topic-redelivery-run')
    expect(result.events.some((event) => event.type === 'topic-message-delivered' && Number(event.attributes.attempt) > 1)).toBe(true)
  })

  it('rejects more subscription edges than the configured Topic slots', () => {
    const project = topicProject('topic-too-many-edges')
    const extra = createRegisteredNode('service', 'consumer-extra', { x: 300, y: 300 })
    project.topology.nodes.push(extra)
    project.topology.edges.push(edge('subscription-extra', 'topic', extra.id, 'publish', 'consume', 'async-publish'))
    expect(() => compileSimulationInput(project)).toThrow('3 subscription edges')
  })

  it('rejects two v3 consumer actions mapped to the same Topic subscription edge', () => {
    const project = createOrderSystemContractFixture()
    const stream = project.topology.nodes.find((node) => node.id === 'orders-stream')!
    const topic = createRegisteredNode('topic', 'orders-topic', stream.position)
    topic.config.subscriptionCount = 1
    project.topology.nodes = project.topology.nodes.filter((node) => node.id !== stream.id).concat(topic)
    project.topology.edges = project.topology.edges.map((candidate) => candidate.target === stream.id ? { ...candidate, target: topic.id } : candidate.source === stream.id ? { ...candidate, source: topic.id } : candidate)
    const interaction = project.definitions.interactions[0]!
    for (const action of interaction.actions) if (action.kind === 'event-publish' || action.kind === 'event-consume') action.brokerNodeId = topic.id
    const consume = interaction.actions.find((action) => action.kind === 'event-consume')!
    interaction.actions.push({ ...consume, id: 'consume-order-duplicate' })
    expect(() => compileSimulationInput(project)).toThrow('same subscription edge')
  })

  it('makes configured delivery time delay downstream consumption without delaying publication acceptance', async () => {
    const fast = topicProject('topic-delivery-fast', 1)
    const slow = structuredClone(fast)
    slow.id = 'topic-delivery-slow'
    const fastTopic = fast.topology.nodes.find((node) => node.id === 'topic')
    const slowTopic = slow.topology.nodes.find((node) => node.id === 'topic')
    if (fastTopic?.type !== 'topic' || slowTopic?.type !== 'topic') throw new Error('Expected Topic nodes')
    fastTopic.config.deliveryTimeMs = 1
    slowTopic.config.deliveryTimeMs = 250
    const [fastResult, slowResult] = await Promise.all([runSimulation(fast, 'topic-delivery-fast-run'), runSimulation(slow, 'topic-delivery-slow-run')])
    const firstPublished = (result: typeof fastResult) => result.events.find((event) => event.type === 'topic-message-published')!.timestampMs
    const firstConsumed = (result: typeof fastResult) => result.events.find((event) => event.type === 'message-consumed' && event.edgeId === 'subscription-0')!.timestampMs
    expect(firstConsumed(slowResult) - firstPublished(slowResult)).toBeGreaterThan(firstConsumed(fastResult) - firstPublished(fastResult))
  })

  it('executes Topic state through normal v3 event publish and consume actions', async () => {
    const project = createOrderSystemContractFixture()
    const oldStream = project.topology.nodes.find((node) => node.id === 'orders-stream')!
    const topic = createRegisteredNode('topic', 'orders-topic', oldStream.position)
    topic.config = { ...topic.config, subscriptionCount: 1, batchSize: 10, acknowledgement: 'explicit', publishTimeMs: 1, deliveryTimeMs: 1, jitterMs: 0, errorRate: 0 }
    project.topology.nodes = project.topology.nodes.filter((node) => node.id !== oldStream.id).concat(topic)
    project.topology.edges = project.topology.edges.map((candidate) => candidate.target === oldStream.id ? { ...candidate, target: topic.id } : candidate.source === oldStream.id ? { ...candidate, source: topic.id } : candidate)
    for (const action of project.definitions.interactions[0]!.actions) if (action.kind === 'event-publish' || action.kind === 'event-consume') action.brokerNodeId = topic.id
    project.experiments[0]!.operationWorkloads[0]!.phases = [{ id: 'test', startAtSeconds: 0, durationSeconds: 0.1, requestsPerSecond: 10, pattern: 'constant' }]
    project.experiments[0]!.operationWorkloads[0]!.operationMix = [project.experiments[0]!.operationWorkloads[0]!.operationMix[0]!]
    project.experiments[0]!.simulation = { durationSeconds: 2, sampleIntervalMs: 100, maxRequests: 10, traceLimit: 10, maxHops: 64 }
    const result = await runSimulation(project, 'topic-v3-contract-run')
    const details = result.nodes.find((node) => node.nodeId === topic.id)!.details
    expect(details).toMatchObject({ topicPublished: 1, topicFanOutCopies: 1, topicDelivered: 1, topicAcknowledged: 1, topicSubscriptionBacklog: 0 })
    expect(result.events.find((event) => event.type === 'topic-message-published')).toMatchObject({ actionId: 'publish-order' })
    expect(result.events.find((event) => event.type === 'topic-message-acknowledged')).toMatchObject({ actionId: 'consume-order', attributes: { subscriptionId: 'subscription:0' } })
  })

  it('uses batch size to acknowledge multiple retained messages in one subscriber delivery', async () => {
    const project = topicProject('topic-batch', 0)
    const topic = project.topology.nodes.find((node) => node.id === 'topic')
    if (topic?.type !== 'topic') throw new Error('Expected Topic')
    topic.config.batchSize = 3
    project.experiments[0]!.workloads[0]!.requestsPerSecond = 4
    project.experiments[0]!.workloads[0]!.durationSeconds = 1
    project.experiments[0]!.simulation.durationSeconds = 2
    const consumer = createRegisteredNode('service', 'late-consumer', { x: 300, y: 0 })
    consumer.config = { ...consumer.config, serviceTimeMs: 1, jitterMs: 0, errorRate: 0 }
    project.topology.nodes.push(consumer)
    project.topology.edges.push(edge('late-subscription', topic.id, consumer.id, 'publish', 'consume', 'async-publish'))
    const result = await runSimulation(project, 'topic-batch-run')
    expect(result.events.filter((event) => event.type === 'topic-message-acknowledged' && event.attributes.subscriptionId === 'subscription:0').length).toBe(result.summary.generatedRequests)
    expect(Number(result.nodes.find((node) => node.nodeId === topic.id)!.details.subscriptionBacklog0)).toBe(0)
  })

  it('auto-acknowledges at dispatch even when the subscriber later fails', async () => {
    const project = topicProject('topic-auto-ack', 1)
    const topic = project.topology.nodes.find((node) => node.id === 'topic')
    const consumer = project.topology.nodes.find((node) => node.id === 'consumer-0')
    if (topic?.type !== 'topic' || consumer?.type !== 'service') throw new Error('Expected Topic fixture nodes')
    topic.config.acknowledgement = 'auto'
    consumer.config.errorRate = 1
    const result = await runSimulation(project, 'topic-auto-ack-run')
    const details = result.nodes.find((node) => node.nodeId === topic.id)!.details
    expect(Number(details.topicAcknowledged)).toBe(Number(details.topicPublished))
    expect(Number(details.subscriptionBacklog0)).toBe(0)
  })
})
