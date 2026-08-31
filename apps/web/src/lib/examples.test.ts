import { describe, expect, it } from 'vitest'
import { projectFileV3Schema } from '@system-design/model'
import { runSimulation } from '@system-design/simulation'
import { createCloudDriveDeliveryExample, createCollaborativeEditingExample, createGlobalStorefrontExample, createIncidentFanOutExample, createJobSchedulerExample, createLogSearchExample, createMultiRegionFailoverExample, createOrderEventFanOutExample, createOrderFulfillmentWorkflowExample, createPaymentCheckoutWorkflowExample, createProductSearchExample, createRealtimeChatExample, createVideoDeliveryExample } from './examples'

describe('Job Scheduler example', () => {
  it('provides an executable one-time scheduling architecture with explicit reliability contracts', async () => {
    const project = createJobSchedulerExample()
    expect(projectFileV3Schema.safeParse(project).success).toBe(true)
    expect(project.modelingMode).toBe('business-aware')
    expect(project.topology.nodes.filter((node) => node.type === 'scheduler')).toHaveLength(2)
    expect(project.topology.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'job-store', type: 'database' }),
      expect.objectContaining({ id: 'execution-queue', type: 'queue' }),
      expect.objectContaining({ id: 'job-workers', type: 'service' }),
    ]))
    expect(project.definitions.dataModels[0]).toMatchObject({
      kind: 'relational',
      tables: expect.arrayContaining([
        expect.objectContaining({ id: 'jobs' }),
        expect.objectContaining({ id: 'executions', indexes: expect.arrayContaining([expect.objectContaining({ id: 'ix-due-executions' })]) }),
        expect.objectContaining({ id: 'attempts', indexes: expect.arrayContaining([expect.objectContaining({ id: 'ix-expired-leases' })]) }),
        expect.objectContaining({ id: 'outbox', indexes: expect.arrayContaining([expect.objectContaining({ id: 'ix-pending-outbox' })]) }),
      ]),
    })
    expect(project.definitions.events).toEqual([expect.objectContaining({ id: 'execution-ready', delivery: 'at-least-once' })])
    expect(project.experiments[0]?.operationWorkloads.map((workload) => workload.sourceNodeId)).toEqual([
      'job-clients', 'due-scan-scheduler', 'lease-reaper-scheduler',
    ])

    const result = await runSimulation(project, 'job-scheduler-example')
    expect(result.nodes.find((node) => node.nodeId === 'job-service')?.processedRequests).toBeGreaterThan(0)
    expect(Number(result.nodes.find((node) => node.nodeId === 'due-scan-scheduler')?.details?.releasedRuns)).toBeGreaterThan(0)
    expect(Number(result.nodes.find((node) => node.nodeId === 'lease-reaper-scheduler')?.details?.releasedRuns)).toBeGreaterThan(0)
    expect(result.nodes.find((node) => node.nodeId === 'execution-queue')?.processedRequests).toBeGreaterThan(0)
    expect(result.nodes.find((node) => node.nodeId === 'job-workers')?.processedRequests).toBeGreaterThan(0)
    expect(result.events.some((event) => event.type === 'operation-completed' && event.operationId === 'create-job')).toBe(true)
    expect(result.events.some((event) => event.type === 'operation-completed' && event.operationId === 'dispatch-due-executions')).toBe(true)
    expect(result.events.some((event) => event.type === 'operation-completed' && event.operationId === 'reap-expired-leases')).toBe(true)
  })
})

describe('CDN examples', () => {
  it.each([
    ['video delivery', createVideoDeliveryExample, 'video-cdn', 'video-origin'],
    ['cloud drive delivery', createCloudDriveDeliveryExample, 'download-cdn', 'drive-origin'],
  ] as const)('provides a valid, executable %s project', async (_name, createExample, cdnId, originId) => {
    const project = createExample()
    expect(projectFileV3Schema.safeParse(project).success).toBe(true)
    const cdn = project.topology.nodes.find((node) => node.id === cdnId)
    expect(cdn?.type).toBe('cdn')
    expect(project.topology.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: cdnId, sourcePort: 'hit' }),
      expect.objectContaining({ source: cdnId, sourcePort: 'miss', target: originId }),
    ]))

    const result = await runSimulation(project, `${project.id}-example`)
    const details = result.nodes.find((node) => node.nodeId === cdnId)?.details
    expect(Number(details?.cdnOriginFetches)).toBeGreaterThan(0)
    expect(Number(details?.cdnHitRate)).toBeGreaterThan(0)
    expect(Number(details?.cdnBytesServed)).toBeGreaterThan(0)
  })

  it('uses different delivery shapes instead of relabeling one topology', () => {
    const video = createVideoDeliveryExample().topology.nodes.find((node) => node.type === 'cdn')
    const drive = createCloudDriveDeliveryExample().topology.nodes.find((node) => node.type === 'cdn')
    if (video?.type !== 'cdn' || drive?.type !== 'cdn') throw new Error('Expected both examples to contain a CDN.')
    expect({ selection: drive.config.popSelection, pops: drive.config.popCount, bytes: drive.config.defaultObjectSizeBytes }).not.toEqual({
      selection: video.config.popSelection, pops: video.config.popCount, bytes: video.config.defaultObjectSizeBytes,
    })
  })
})

describe('Search Index examples', () => {
  it.each([
    ['product search', createProductSearchExample, 'product-search-index'],
    ['log search', createLogSearchExample, 'log-search-index'],
  ] as const)('provides a valid, executable %s project', async (_name, createExample, searchId) => {
    const project = createExample()
    expect(projectFileV3Schema.safeParse(project).success).toBe(true)
    const search = project.topology.nodes.find((node) => node.id === searchId)
    expect(search?.type).toBe('search-index')
    expect(project.definitions.dataModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerNodeId: searchId, kind: 'document' }),
    ]))

    const result = await runSimulation(project, `${project.id}-example`)
    const details = result.nodes.find((node) => node.nodeId === searchId)?.details
    expect(Number(details?.searchQueries)).toBeGreaterThan(0)
    expect(Number(details?.searchIndexWrites)).toBeGreaterThan(0)
    expect(Number(details?.searchShardSearches)).toBeGreaterThan(Number(details?.searchQueries))
    expect(Number(details?.searchCandidatesMerged)).toBeGreaterThan(0)
    expect(result.events.some((event) => event.type === 'search-query-fan-out' && event.nodeId === searchId)).toBe(true)
    expect(result.events.some((event) => event.type === 'search-index-write-accepted' && event.nodeId === searchId)).toBe(true)
  })

  it('uses different product-query and streaming-log system shapes', () => {
    const product = createProductSearchExample()
    const logs = createLogSearchExample()
    const productIndex = product.topology.nodes.find((node) => node.type === 'search-index')
    const logIndex = logs.topology.nodes.find((node) => node.type === 'search-index')
    if (productIndex?.type !== 'search-index' || logIndex?.type !== 'search-index') throw new Error('Expected both examples to contain a Search Index.')
    expect(product.topology.nodes.some((node) => node.type === 'stream')).toBe(false)
    expect(logs.topology.nodes.some((node) => node.type === 'stream')).toBe(true)
    expect({ shards: productIndex.config.shardCount, replicas: productIndex.config.replicasPerShard, writes: productIndex.config.writeRatio }).not.toEqual({
      shards: logIndex.config.shardCount, replicas: logIndex.config.replicasPerShard, writes: logIndex.config.writeRatio,
    })
  })
})

describe('Topic examples', () => {
  it.each([
    ['order event fan-out', createOrderEventFanOutExample, 'order-events-topic', 2],
    ['incident fan-out', createIncidentFanOutExample, 'incident-topic', 3],
  ] as const)('provides a valid, executable %s project', async (_name, createExample, topicId, subscriptions) => {
    const project = createExample()
    expect(projectFileV3Schema.safeParse(project).success).toBe(true)
    expect(project.modelingMode).toBe('business-aware')
    expect(project.definitions.events).toHaveLength(1)
    expect(project.definitions.interactions[0]?.actions.filter((action) => action.kind === 'event-consume')).toHaveLength(subscriptions)
    expect(project.experiments[0]?.operationWorkloads).toHaveLength(1)
    const topic = project.topology.nodes.find((node) => node.id === topicId)
    expect(topic?.type).toBe('topic')
    if (topic?.type !== 'topic') throw new Error('Expected the example to contain a Topic.')
    expect(topic.config.subscriptionCount).toBe(subscriptions)
    expect(project.topology.edges.filter((edge) => edge.source === topicId)).toHaveLength(subscriptions)
    expect(project.topology.edges.filter((edge) => edge.source === topicId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePort: 'publish', targetPort: 'consume', routingMode: 'async-publish' }),
    ]))

    const result = await runSimulation(project, `${project.id}-example`)
    const details = result.nodes.find((node) => node.nodeId === topicId)?.details
    const published = Number(details?.topicPublished)
    const fanOut = Number(details?.topicFanOutCopies)
    expect(published).toBeGreaterThan(0)
    expect(fanOut).toBe(published * subscriptions)
    expect(Number(details?.topicDelivered)).toBeGreaterThan(0)
    expect(result.events.some((event) => event.type === 'topic-message-published' && event.nodeId === topicId)).toBe(true)
    expect(result.events.some((event) => event.type === 'topic-message-delivered' && event.nodeId === topicId)).toBe(true)
  })

  it('acknowledges both healthy order subscriptions independently', async () => {
    const result = await runSimulation(createOrderEventFanOutExample(), 'order-topic-acknowledgement')
    const details = result.nodes.find((node) => node.nodeId === 'order-events-topic')?.details
    expect(Number(details?.topicAcknowledged)).toBe(Number(details?.topicFanOutCopies))
    expect(Number(details?.topicSubscriptionBacklog)).toBe(0)
    expect(Number(details?.topicExpiredDeliveries)).toBe(0)
    const subscriptions = new Set(result.events.filter((event) => event.type === 'topic-message-acknowledged').map((event) => event.attributes?.subscriptionId))
    expect(subscriptions).toEqual(new Set(['subscription:0', 'subscription:1']))
  })

  it('retains and expires only the unavailable incident subscription', async () => {
    const result = await runSimulation(createIncidentFanOutExample(), 'incident-topic-retention')
    const details = result.nodes.find((node) => node.nodeId === 'incident-topic')?.details
    const fanOut = Number(details?.topicFanOutCopies)
    const acknowledged = Number(details?.topicAcknowledged)
    const expired = Number(details?.topicExpiredDeliveries)
    expect(acknowledged).toBeGreaterThan(0)
    expect(acknowledged).toBeLessThan(fanOut)
    expect(expired).toBeGreaterThan(0)
    expect(acknowledged + expired).toBe(fanOut)
    expect(Number(details?.topicSubscriptionBacklog)).toBe(0)
    expect(result.events.filter((event) => event.type === 'topic-message-expired').every((event) => event.attributes?.subscriptionId === 'subscription:2')).toBe(true)
  })

  it('uses different subscriber and retention shapes rather than relabeling one topology', () => {
    const orders = createOrderEventFanOutExample().topology.nodes.find((node) => node.type === 'topic')
    const incidents = createIncidentFanOutExample().topology.nodes.find((node) => node.type === 'topic')
    if (orders?.type !== 'topic' || incidents?.type !== 'topic') throw new Error('Expected both examples to contain a Topic.')
    expect({ subscriptions: orders.config.subscriptionCount, retention: orders.config.retentionMs }).not.toEqual({
      subscriptions: incidents.config.subscriptionCount, retention: incidents.config.retentionMs,
    })
  })
})

describe('Realtime Gateway examples', () => {
  it.each([
    ['realtime chat', createRealtimeChatExample, 'chat-realtime-gateway', 'drop-message'],
    ['collaborative editing', createCollaborativeEditingExample, 'editing-realtime-gateway', 'disconnect'],
  ] as const)('provides a valid, executable business-aware %s project', async (_name, createExample, gatewayId, overflowPolicy) => {
    const project = createExample()
    expect(projectFileV3Schema.safeParse(project).success).toBe(true)
    expect(project.modelingMode).toBe('business-aware')
    expect(project.experiments[0]?.operationWorkloads).toHaveLength(1)
    const gateway = project.topology.nodes.find((node) => node.id === gatewayId)
    expect(gateway?.type).toBe('realtime-gateway')
    if (gateway?.type !== 'realtime-gateway') throw new Error('Expected the example to contain a Realtime Gateway.')
    expect(gateway.config.overflowPolicy).toBe(overflowPolicy)
    const actions = project.definitions.interactions[0]?.actions.filter((action) => action.kind === 'realtime') ?? []
    expect(actions.map((action) => action.operation)).toEqual(['connect', 'broadcast'])
    expect(actions[0]?.channelPattern).toBe(actions[1]?.channelPattern)
    expect(project.topology.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: project.definitions.apis[0]?.ownerNodeId, target: gatewayId, routingMode: 'weighted-one' }),
    ]))

    const result = await runSimulation(project, `${project.id}-example`)
    const details = result.nodes.find((node) => node.nodeId === gatewayId)?.details
    expect(Number(details?.realtimeAcceptedConnections)).toBeGreaterThan(0)
    expect(Number(details?.realtimeActiveChannels)).toBeGreaterThan(0)
    expect(Number(details?.realtimeBroadcasts)).toBeGreaterThan(0)
    expect(Number(details?.realtimeFanOutCopies)).toBeGreaterThan(Number(details?.realtimeBroadcasts))
    expect(Number(details?.realtimeDeliveredCopies) + Number(details?.realtimePendingMessages) + Number(details?.realtimeDroppedCopies)).toBeGreaterThan(0)
    expect(result.events.some((event) => event.type === 'realtime-connection-opened' && event.nodeId === gatewayId)).toBe(true)
    expect(result.events.some((event) => event.type === 'realtime-broadcast' && event.nodeId === gatewayId)).toBe(true)
  })

  it('uses different room traffic and connection-backpressure policies rather than relabeling one topology', () => {
    const chat = createRealtimeChatExample().topology.nodes.find((node) => node.type === 'realtime-gateway')
    const editing = createCollaborativeEditingExample().topology.nodes.find((node) => node.type === 'realtime-gateway')
    if (chat?.type !== 'realtime-gateway' || editing?.type !== 'realtime-gateway') throw new Error('Expected both examples to contain a Realtime Gateway.')
    expect({ channels: chat.config.defaultChannelCount, slowFraction: chat.config.slowConnectionFraction, overflow: chat.config.overflowPolicy }).not.toEqual({
      channels: editing.config.defaultChannelCount, slowFraction: editing.config.slowConnectionFraction, overflow: editing.config.overflowPolicy,
    })
    expect(createRealtimeChatExample().definitions.interactions[0]?.actions.find((action) => action.kind === 'realtime')?.channelPattern).toBe('room:shared')
    expect(createCollaborativeEditingExample().definitions.interactions[0]?.actions.find((action) => action.kind === 'realtime')?.channelPattern).toBe('document:shared')
  })

  it('exercises both message-drop and slow-client-disconnect overflow behavior', async () => {
    const chat = await runSimulation(createRealtimeChatExample(), 'realtime-chat-overflow')
    const chatDetails = chat.nodes.find((node) => node.nodeId === 'chat-realtime-gateway')?.details
    expect(Number(chatDetails?.realtimeDroppedCopies)).toBeGreaterThan(0)
    expect(Number(chatDetails?.realtimeOverflowDisconnects)).toBe(0)

    const editing = await runSimulation(createCollaborativeEditingExample(), 'collaborative-editing-overflow')
    const editingDetails = editing.nodes.find((node) => node.nodeId === 'editing-realtime-gateway')?.details
    expect(Number(editingDetails?.realtimeDroppedCopies)).toBeGreaterThan(0)
    expect(Number(editingDetails?.realtimeOverflowDisconnects)).toBeGreaterThan(0)
  })
})

describe('Workflow examples', () => {
  it.each([
    ['payment checkout', createPaymentCheckoutWorkflowExample, 'checkout-coordinator', 3, 'checkout:{key}', false],
    ['order fulfillment', createOrderFulfillmentWorkflowExample, 'fulfillment-coordinator', 4, 'fulfillment:{key}', true],
  ] as const)('provides a valid, executable %s project', async (_name, createExample, coordinatorId, stepCount, keyPattern, shouldCompensate) => {
    const project = createExample()
    expect(projectFileV3Schema.safeParse(project).success).toBe(true)
    expect(project.modelingMode).toBe('business-aware')
    expect(project.definitions.workflows).toHaveLength(1)
    const workflow = project.topology.nodes.find((node) => node.type === 'workflow')
    expect(workflow?.id).toBe(coordinatorId)
    expect(project.definitions.workflows[0]?.steps).toHaveLength(stepCount)
    expect(project.definitions.interactions[0]?.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'workflow', nodeId: coordinatorId, idempotencyKeyPattern: keyPattern }),
    ]))

    const result = await runSimulation(project, `${project.id}-example`)
    const details = result.nodes.find((node) => node.nodeId === coordinatorId)?.details
    expect(Number(details?.workflowStartedInstances)).toBeGreaterThan(0)
    expect(Number(details?.workflowStepCheckpoints)).toBeGreaterThan(0)
    expect(Number(details?.workflowCompensatedInstances) > 0).toBe(shouldCompensate)
    expect(result.events.some((event) => event.type === 'workflow-instance-started' && event.nodeId === coordinatorId)).toBe(true)
  })

  it('uses distinct payment and fulfillment system shapes instead of relabeling one project', () => {
    const checkout = createPaymentCheckoutWorkflowExample()
    const fulfillment = createOrderFulfillmentWorkflowExample()
    const checkoutTerminal = checkout.topology.nodes.find((node) => node.id === 'confirmation-service')
    const fulfillmentTerminal = fulfillment.topology.nodes.find((node) => node.id === 'notification-service')
    if (checkoutTerminal?.type !== 'service' || fulfillmentTerminal?.type !== 'service') throw new Error('Expected terminal Service nodes.')
    expect(checkoutTerminal.config.errorRate).toBe(0)
    expect(fulfillmentTerminal.config.errorRate).toBe(1)
    expect(checkout.topology.nodes).toHaveLength(6)
    expect(fulfillment.topology.nodes).toHaveLength(7)
    expect(checkout.definitions.workflows[0]?.steps).toHaveLength(3)
    expect(fulfillment.definitions.workflows[0]?.steps).toHaveLength(4)
  })
})

describe('Global Router examples', () => {
  it.each([
    ['global storefront', createGlobalStorefrontExample, 'storefront-global-router', 'geo'],
    ['multi-region failover', createMultiRegionFailoverExample, 'failover-global-router', 'health-aware'],
  ] as const)('provides a valid, executable %s project', async (_name, createExample, routerId, policy) => {
    const project = createExample()
    expect(projectFileV3Schema.safeParse(project).success).toBe(true)
    const router = project.topology.nodes.find((node) => node.id === routerId)
    expect(router?.type).toBe('global-router')
    if (router?.type !== 'global-router') throw new Error('Expected the example to contain a Global Router.')
    expect(router.config.routingPolicy).toBe(policy)
    expect(project.topology.groups.filter((group) => group.kind === 'region')).toHaveLength(2)
    expect(project.topology.edges.filter((edge) => edge.source === routerId)).toHaveLength(2)

    const result = await runSimulation(project, `${project.id}-example`)
    const details = result.nodes.find((node) => node.nodeId === routerId)?.details
    expect(Number(details?.globalRoutingDecisions)).toBeGreaterThan(0)
    expect(Number(details?.globalRouterCacheHits)).toBeGreaterThan(0)
    expect(result.events.some((event) => event.type === 'global-route-selected' && event.nodeId === routerId)).toBe(true)
  })

  it('routes storefront cohorts to their matching regions and reuses cached decisions', async () => {
    const result = await runSimulation(createGlobalStorefrontExample(), 'global-storefront-regions')
    const routeEvents = result.events.filter((event) => ['global-route-selected', 'global-route-cache-hit', 'global-route-cache-expired'].includes(event.type))
    expect(routeEvents).not.toHaveLength(0)
    expect(routeEvents.every((event) => event.attributes.clientRegionId === event.attributes.selectedRegionId)).toBe(true)
    expect(new Set(routeEvents.map((event) => event.attributes.selectedRegionId))).toEqual(new Set(['region-north-america', 'region-europe']))
  })

  it('keeps stale primary routes before exposing a delayed standby failover', async () => {
    const result = await runSimulation(createMultiRegionFailoverExample(), 'multi-region-failover-evidence')
    const details = result.nodes.find((node) => node.nodeId === 'failover-global-router')?.details
    expect(Number(details?.globalRouterUnhealthyTransitions)).toBeGreaterThan(0)
    expect(Number(details?.globalRouterFailovers)).toBeGreaterThan(0)
    expect(Number(details?.globalRouterMaxFailoverDelayMs)).toBeGreaterThanOrEqual(300)
    expect(result.nodes.find((node) => node.nodeId === 'standby-api')?.processedRequests).toBeGreaterThan(0)
    expect(result.events.some((event) => event.type === 'global-router-failover' && Number(event.attributes.failoverDelayMs) >= 300)).toBe(true)
  })

  it('uses distinct geo storefront and health-failover system shapes', () => {
    const storefront = createGlobalStorefrontExample()
    const failover = createMultiRegionFailoverExample()
    const storefrontRouter = storefront.topology.nodes.find((node) => node.type === 'global-router')
    const failoverRouter = failover.topology.nodes.find((node) => node.type === 'global-router')
    if (storefrontRouter?.type !== 'global-router' || failoverRouter?.type !== 'global-router') throw new Error('Expected both examples to contain a Global Router.')
    expect(storefrontRouter.config.routingPolicy).toBe('geo')
    expect(failoverRouter.config.routingPolicy).toBe('health-aware')
    expect(storefront.topology.nodes.filter((node) => node.type === 'traffic')).toHaveLength(2)
    expect(failover.topology.nodes.filter((node) => node.type === 'traffic')).toHaveLength(1)
    expect(storefront.experiments[0]?.faults).toHaveLength(0)
    expect(failover.experiments[0]?.faults).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'region-outage' })]))
  })
})
