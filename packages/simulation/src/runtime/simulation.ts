import { Entity, Queue as SimQueue, Simulation } from 'simscript'
import seedrandom from 'seedrandom'
import type { ComponentNode, Fault, FaultTarget, FaultType, ReasonCode, RuntimeEvent, Scenario, Workload } from '@system-design/model'
import type { CompiledConnection, CompiledScenario } from '../compiler/compiler'
import type { CompiledOperationAction, CompiledOperationPhase, CompiledOperationPlan, CompiledSchedulerWorkload } from '../compiler/operation-plan'
import { getNodeBehavior } from '../components/behavior'
import { createComponentStateRuntime, WorkflowRuntime, type ComponentDomainEvent, type ComponentStateCompletion } from '../components/data-runtime'
import { applyCapacityFaults, applyLatencyFaults, composeLossProbability, faultEndsAtMs, faultReason, faultStartsAtMs, resolveActiveFaults } from '../faults/resolver'
import { round } from '../telemetry/math'
import { RuntimeEventSink } from '../telemetry/event-sink'
import { BackpressureGate, TokenBucket } from '../policies/delivery'
import { policiesFor } from '../policies/compiler'
import { CircuitBreaker, retryDelayMs, type CircuitCompletionResult, type CircuitPermit, type CircuitTransition, type ReliabilityCall } from '../policies/reliability'
import type { LoadBalancerRuntimeState, ReliabilityCompletionContext, RequestGroup, RequestState, RuntimeNode, SchedulerRuntimeState } from './types'
import { actionAttributes, estimateDataAccessCost, sampleKey, sampleValueBytes } from '../components/operation-cost'
import { GlobalRouterState, type GlobalRouterHealthTransition } from '../components/global-router-state'

const completionEvents = (completion: ComponentStateCompletion | undefined) => completion === undefined ? [] : Array.isArray(completion) ? completion : completion.events
const completionFailure = (completion: ComponentStateCompletion | undefined) => completion !== undefined && !Array.isArray(completion) && !completion.success ? completion.reason : undefined

export class SystemDesignSimulation extends Simulation {
  readonly scenario: Scenario
  readonly random: seedrandom.PRNG
  readonly runtimes = new Map<string, RuntimeNode>()
  readonly nodes: Map<string, ComponentNode>
  readonly outgoing = new Map<string, CompiledConnection[]>()
  readonly warnings: string[]
  readonly eventSink: RuntimeEventSink
  readonly deliveryGates = new Map<string, BackpressureGate>()
  readonly loadBalancers = new Map<string, LoadBalancerRuntimeState>()
  readonly globalRouters = new Map<string, GlobalRouterState>()
  readonly circuitBreakers = new Map<string, CircuitBreaker>()
  readonly rateLimits = new Map<string, TokenBucket>()
  readonly schedulers = new Map<string, SchedulerRuntimeState>()
  readonly settledSchedulerRuns = new Set<string>()
  schedulerDecisions = 0
  generated = 0
  completed = 0
  failed = 0
  requestId = 0
  exceededHopLimit = false

  constructor(readonly compiled: CompiledScenario, warnings: string[], runId: string, onEventBatch?: (events: RuntimeEvent[]) => void, eventBatchSize?: number) {
    const scenario = compiled.scenario
    super({ name: scenario.name, timeUnit: 'ms', timeEnd: scenario.simulation.durationSeconds * 1_000, frameDelay: null, yieldInterval: Number.MAX_SAFE_INTEGER })
    this.scenario = scenario
    this.random = seedrandom(scenario.seed)
    this.warnings = warnings
    this.eventSink = new RuntimeEventSink(runId, onEventBatch, eventBatchSize, scenario.simulation.traceLimit, scenario.simulation.sampleIntervalMs)
    this.nodes = compiled.nodes
    compiled.outgoing.forEach((edges, nodeId) => this.outgoing.set(nodeId, edges))
    for (const edge of compiled.edges) {
      const circuit = policiesFor(compiled.policies, 'edge', edge.id, 'circuit-breaker')[0]
      if (circuit) this.circuitBreakers.set(edge.id, new CircuitBreaker(circuit.config))
      const backpressure = policiesFor(compiled.policies, 'edge', edge.id, 'backpressure')[0]
      if (backpressure) this.deliveryGates.set(`edge:${edge.id}`, new BackpressureGate(backpressure.config))
    }
    for (const node of this.nodes.values()) {
      const state = createComponentStateRuntime(node)
      this.runtimes.set(node.id, {
        node, resource: new SimQueue(`${node.id}:resource`, getNodeBehavior(node).capacity(node)), waiting: new SimQueue(`${node.id}:waiting`),
        admitted: 0, processed: 0, failed: 0, rejected: 0, maxWaiting: 0,
        ...(state === undefined ? {} : { state }),
      })
      if (node.type === 'load-balancer') this.loadBalancers.set(node.id, { roundRobinIndex: 0, targets: new Map() })
      if (node.type === 'global-router') this.globalRouters.set(node.id, new GlobalRouterState(node.config))
      if (node.type === 'scheduler') this.schedulers.set(node.id, {
        releaseTicks: 0, scheduledRuns: 0, releasedRuns: 0, queuedRuns: 0, skippedRuns: 0, completedRuns: 0, failedRuns: 0, catchUpRuns: 0,
        activeRuns: 0, maxActiveRuns: 0, nextRunId: 0, pending: [],
      })
      const rateLimit = policiesFor(compiled.policies, 'node', node.id, 'rate-limit')[0]
      if (rateLimit) this.rateLimits.set(node.id, new TokenBucket(rateLimit.config))
      const backpressure = policiesFor(compiled.policies, 'node', node.id, 'backpressure')[0]
      if (backpressure) this.deliveryGates.set(`node:${node.id}`, new BackpressureGate(backpressure.config))
    }
  }

  onStarting() {
    super.onStarting()
    for (const fault of this.scenario.faults) {
      if (fault.enabled) this.activate(new FaultLifecycle(fault))
    }
    const operationSources = new Set(this.compiled.operations.phases.map((phase) => phase.sourceNodeId))
    for (const workload of this.scenario.workloads) if (!operationSources.has(workload.sourceNodeId)) this.activate(new WorkloadGenerator(workload))
    for (const phase of this.compiled.operations.phases) this.activate(new OperationWorkloadGenerator(phase))
    for (const node of this.nodes.values()) if (node.type === 'scheduler') this.activate(new SchedulerGenerator(node, this.compiled.operations.schedulerWorkloads.get(node.id)))
    for (const node of this.nodes.values()) if (node.type === 'global-router' && node.config.routingPolicy === 'health-aware') this.activate(new GlobalRouterHealthProbe(node))
    this.activate(new MetricsSampler())
  }

  emitOperationEvent(request: RequestState, type: 'operation-started' | 'operation-completed', status: 'pending' | 'ok' | 'error', extra: { durationMs?: number; reason?: ReasonCode } = {}) {
    const plan = request.operationPlan
    if (!plan) return
    this.eventSink.emit({
      timestampMs: round(this.timeNow), requestId: String(request.id), traceId: request.traceId, spanId: request.spanId, nodeId: plan.sourceNodeId,
      operationId: plan.operation.operationId, type, status, bytes: request.bytes, ...extra,
      attributes: { terminal: type === 'operation-completed', interactionId: plan.interactionId, apiId: plan.operation.apiId, ...(extra.durationMs === undefined ? {} : { totalLatencyMs: extra.durationMs }) },
    })
  }

  emitRequestEvent(request: RequestState, node: ComponentNode, type: 'request-generated' | 'request-arrived' | 'request-queued' | 'request-started' | 'request-completed' | 'request-failed', status: 'pending' | 'ok' | 'error' | 'rejected', extra: { edgeId?: string; durationMs?: number; queueDurationMs?: number; reason?: ReasonCode; attributes?: Record<string, string | number | boolean> } = {}) {
    const retained = this.retainsRequest(request.id)
    const updatesAggregate = type === 'request-generated'
      || (type === 'request-completed' && extra.durationMs !== undefined)
      || type === 'request-failed'
      || extra.attributes?.terminal === true
    if (!retained && !updatesAggregate) return
    this.eventSink.emit({
      timestampMs: round(this.timeNow), requestId: String(request.id), traceId: request.traceId, spanId: request.spanId,
      ...(request.parentSpanId === undefined ? {} : { parentSpanId: request.parentSpanId }), nodeId: node.id,
      ...((extra.edgeId ?? request.incomingEdgeId) === undefined ? {} : { edgeId: extra.edgeId ?? request.incomingEdgeId }), type, status, bytes: request.bytes,
      attempt: request.reliabilityAttempt?.attempt ?? 1,
      ...extra,
    })
  }

  retainsRequest(requestId: number) {
    return this.eventSink.isRequestRetained(requestId)
  }

  activeFaults(kind: FaultTarget['kind'], targetId: string, type: FaultType) {
    return resolveActiveFaults(this.scenario.faults, kind, targetId, type, this.timeNow)
  }

  activeFault(nodeId: string, type: FaultType) {
    return this.activeFaults('node', nodeId, type)[0]
  }

  effectiveCapacity(node: ComponentNode) {
    return applyCapacityFaults(getNodeBehavior(node).capacity(node), this.activeFaults('node', node.id, 'capacity-drop'))
  }

  serviceTime(node: Exclude<ComponentNode, { type: 'traffic' }>, request: RequestState) {
    const behavior = getNodeBehavior(node)
    const jitterMs = behavior.jitterMs(node)
    let serviceTime = behavior.baseServiceTimeMs(node, request) + (this.random() * 2 - 1) * jitterMs
    serviceTime = applyLatencyFaults(serviceTime, this.activeFaults('node', node.id, 'latency-spike'))
    if (request.incomingEdgeId) {
      const edgeLatency = this.activeFaults('edge', request.incomingEdgeId, 'latency-spike')
      serviceTime = applyLatencyFaults(serviceTime, edgeLatency)
      const bandwidth = this.activeFaults('edge', request.incomingEdgeId, 'bandwidth-drop')
      if (bandwidth.length > 0) {
        const retainedBandwidth = Math.max(0.000_001, bandwidth.reduce((factor, fault) => factor * (fault.factor ?? 0.5), 1))
        const edge = this.compiled.edges.find((candidate) => candidate.id === request.incomingEdgeId)
        const source = edge ? this.nodes.get(edge.source) : undefined
        const transferTime = source?.type === 'network' ? (request.bytes * 8) / (source.config.bandwidthMbps * 1_000) : 0
        serviceTime += transferTime * (1 / retainedBandwidth - 1)
      }
    }
    return Math.max(0.001, serviceTime)
  }

  failureReason(node: ComponentNode, request: RequestState): ReasonCode | undefined {
    if (this.activeFault(node.id, 'region-outage')) return 'region_outage'
    if (this.activeFault(node.id, 'node-down')) return 'node_down'
    if (request.incomingEdgeId && this.activeFaults('edge', request.incomingEdgeId, 'region-outage').length > 0) return 'region_outage'
    return undefined
  }

  chooseEdge(edges: CompiledConnection[]) {
    if (edges.length === 1) return edges[0]!
    const totalWeight = edges.reduce((sum, edge) => sum + edge.weight, 0)
    let choice = this.random() * totalWeight
    for (const edge of edges) { choice -= edge.weight; if (choice <= 0) return edge }
    return edges[edges.length - 1]!
  }

  chooseLoadBalancerEdge(node: Extract<ComponentNode, { type: 'load-balancer' }>, edges: CompiledConnection[]) {
    const state = this.loadBalancers.get(node.id)!
    if (node.config.algorithm === 'weighted') return this.chooseEdge(edges)
    if (node.config.algorithm === 'round-robin') {
      const edge = edges[state.roundRobinIndex % edges.length]!
      state.roundRobinIndex = (state.roundRobinIndex + 1) % edges.length
      return edge
    }
    const healthy = edges.filter((edge) => (state.targets.get(edge.id)?.unhealthyUntilMs ?? 0) <= this.timeNow)
    if (healthy.length === 0) return undefined
    return this.chooseEdge(healthy)
  }

  recordLoadBalancerOutcome(nodeId: string, edgeId: string, success: boolean) {
    const node = this.nodes.get(nodeId)
    if (node?.type !== 'load-balancer' || node.config.algorithm !== 'health-aware') return
    const state = this.loadBalancers.get(nodeId)!
    const target = state.targets.get(edgeId) ?? { consecutiveFailures: 0, unhealthyUntilMs: 0 }
    if (success) { target.consecutiveFailures = 0; target.unhealthyUntilMs = 0 }
    else {
      target.consecutiveFailures += 1
      if (target.consecutiveFailures >= node.config.failureThreshold) {
        target.unhealthyUntilMs = this.timeNow + node.config.recoveryTimeMs
        target.consecutiveFailures = 0
      }
    }
    state.targets.set(edgeId, target)
  }

  chooseGlobalRouterEdge(node: Extract<ComponentNode, { type: 'global-router' }>, edges: CompiledConnection[], request: RequestState) {
    const state = this.globalRouters.get(node.id)!
    const clientKey = request.globalRouterClientKey ?? request.key ?? request.traceId
    const decision = state.select({
      clientKey, ...(request.clientRegionId === undefined ? {} : { clientRegionId: request.clientRegionId }), policy: node.config.routingPolicy, nowMs: this.timeNow, random: this.random,
      targets: edges.map((edge) => ({ edgeId: edge.id, weight: edge.weight, ...(this.compiled.nodeRegions.get(edge.target) === undefined ? {} : { regionId: this.compiled.nodeRegions.get(edge.target)! }) })),
    })
    const selectedRegionId = decision.target ? this.compiled.nodeRegions.get(edges.find((edge) => edge.id === decision.target!.edgeId)?.target ?? '') : undefined
    const attributes = { clientKey, routingPolicy: node.config.routingPolicy, cacheHit: decision.cacheHit, cacheExpired: decision.cacheExpired, geoMatched: decision.geoMatched, ...(request.clientRegionId === undefined ? {} : { clientRegionId: request.clientRegionId }), ...(selectedRegionId === undefined ? {} : { selectedRegionId }) }
    this.eventSink.emit({ timestampMs: round(this.timeNow), requestId: String(request.id), traceId: request.traceId, spanId: request.spanId, nodeId: node.id, ...(decision.target === undefined ? {} : { edgeId: decision.target.edgeId }), type: decision.cacheHit ? 'global-route-cache-hit' : decision.cacheExpired ? 'global-route-cache-expired' : 'global-route-selected', status: decision.target ? 'ok' : 'rejected', reason: decision.target ? 'none' : 'no_healthy_target', attributes })
    if (decision.failoverDelayMs !== undefined && decision.target) this.eventSink.emit({ timestampMs: round(this.timeNow), requestId: String(request.id), traceId: request.traceId, spanId: request.spanId, nodeId: node.id, edgeId: decision.target.edgeId, type: 'global-router-failover', status: 'ok', attributes: { ...attributes, previousEdgeId: decision.previousEdgeId ?? '', failoverDelayMs: round(decision.failoverDelayMs) } })
    return decision.target === undefined ? undefined : edges.find((edge) => edge.id === decision.target!.edgeId)
  }

  recordGlobalRouterOutcome(nodeId: string, edgeId: string, success: boolean) {
    const node = this.nodes.get(nodeId)
    if (node?.type !== 'global-router' || node.config.routingPolicy !== 'health-aware') return
    const transition = this.globalRouters.get(nodeId)!.recordOutcome(edgeId, success, this.timeNow)
    this.emitGlobalRouterHealthTransition(nodeId, transition)
  }

  emitGlobalRouterHealthTransition(nodeId: string, transition: GlobalRouterHealthTransition | undefined) {
    if (!transition) return
    const unhealthy = transition.type === 'target-unhealthy'
    this.eventSink.emit({ timestampMs: round(this.timeNow), nodeId, edgeId: transition.edgeId, type: unhealthy ? 'global-router-target-unhealthy' : 'global-router-target-recovered', status: unhealthy ? 'error' : 'ok', attributes: unhealthy ? { detectedAtMs: transition.detectedAtMs, effectiveAtMs: transition.effectiveAtMs, propagationDelayMs: transition.effectiveAtMs - transition.detectedAtMs } : { recoveredAtMs: transition.recoveredAtMs } })
  }

  emitCircuitTransition(edgeId: string, nodeId: string, transition: CircuitTransition | undefined) {
    if (!transition) return
    const type = transition === 'opened' ? 'circuit-opened' : transition === 'half-opened' ? 'circuit-half-opened' : 'circuit-closed'
    this.eventSink.emit({ timestampMs: round(this.timeNow), nodeId, edgeId, type, status: transition === 'opened' ? 'error' : 'ok' })
  }

  circuitOutcome(edgeId: string, nodeId: string, permit: CircuitPermit | undefined, success: boolean): CircuitCompletionResult | undefined {
    const circuit = this.circuitBreakers.get(edgeId)
    if (!circuit || !permit) return undefined
    const outcome = success ? circuit.succeed(permit) : circuit.fail(permit, this.timeNow)
    this.emitCircuitTransition(edgeId, nodeId, outcome.transition)
    return outcome
  }

  sampleMetrics() {
    this.captureNodeSnapshots()
  }

  offerSchedulerRun(node: Extract<ComponentNode, { type: 'scheduler' }>, scheduledAtMs: number, dueAtMs: number, operationPlan?: CompiledOperationPlan, workloadId?: string) {
    const state = this.schedulers.get(node.id)!
    if (this.generated >= this.scenario.simulation.maxRequests || this.schedulerDecisions >= this.scenario.simulation.maxRequests) {
      const warning = `Scheduler generation stopped at the maxRequests limit (${this.scenario.simulation.maxRequests}).`
      if (!this.warnings.includes(warning)) this.warnings.push(warning)
      return false
    }
    this.schedulerDecisions += 1
    state.scheduledRuns += 1
    const run = { schedulerRunId: ++state.nextRunId, scheduledAtMs, dueAtMs, ...(operationPlan === undefined ? {} : { operationPlan }), ...(workloadId === undefined ? {} : { workloadId }) }
    if (state.activeRuns < node.config.concurrencyLimit && this.generated < this.scenario.simulation.maxRequests) {
      this.releaseSchedulerRun(node, run, false)
      return true
    }
    if (node.config.missedRunPolicy === 'catch-up' && state.pending.length < node.config.maxPendingRuns) {
      state.pending.push(run)
      state.queuedRuns += 1
      this.eventSink.emit({
        timestampMs: round(this.timeNow), nodeId: node.id, type: 'scheduler-run-queued', status: 'pending',
        attributes: { schedulerRunId: run.schedulerRunId, scheduledAtMs, dueAtMs, pendingRuns: state.pending.length, activeRuns: state.activeRuns },
      })
      return true
    }
    state.skippedRuns += 1
    this.eventSink.emit({
      timestampMs: round(this.timeNow), nodeId: node.id, type: 'scheduler-run-skipped', status: 'rejected', reason: 'scheduler_missed',
      attributes: { schedulerRunId: run.schedulerRunId, scheduledAtMs, dueAtMs, activeRuns: state.activeRuns, pendingRuns: state.pending.length, missedRunPolicy: node.config.missedRunPolicy },
    })
    return true
  }

  private releaseSchedulerRun(node: Extract<ComponentNode, { type: 'scheduler' }>, run: import('./types').PendingSchedulerRun, catchUp: boolean) {
    const state = this.schedulers.get(node.id)!
    if (this.generated >= this.scenario.simulation.maxRequests) return false
    this.generated += 1
    this.requestId += 1
    state.releasedRuns += 1
    state.activeRuns += 1
    state.maxActiveRuns = Math.max(state.maxActiveRuns, state.activeRuns)
    if (catchUp) state.catchUpRuns += 1
    const traceId = `trace-${this.requestId}`
    const bytes = run.operationPlan?.requestBytes ?? node.config.requestBytes
    const clientRegionId = this.compiled.nodeRegions.get(node.id)
    const request: RequestState = {
      id: this.requestId, createdAtMs: this.timeNow, bytes, payloadBytes: bytes, hops: 0, traceId, spanId: `${traceId}:0`,
      globalRouterClientKey: run.workloadId === undefined ? `scheduler:${node.id}` : `workload:${run.workloadId}`,
      ...(clientRegionId === undefined ? {} : { clientRegionId }),
      schedulerNodeId: node.id, schedulerRunId: run.schedulerRunId, ...(run.operationPlan === undefined ? {} : { operationPlan: run.operationPlan, operationId: run.operationPlan.operation.operationId, key: sampleKey(run.operationPlan.keyDistribution, this.random, this.requestId) }),
    }
    this.eventSink.emit({
      timestampMs: round(this.timeNow), requestId: String(request.id), traceId, spanId: request.spanId, nodeId: node.id,
      type: 'scheduler-run-released', status: 'ok', bytes: request.bytes,
      attributes: { schedulerRunId: run.schedulerRunId, scheduledAtMs: run.scheduledAtMs, dueAtMs: run.dueAtMs, releaseLagMs: round(this.timeNow - run.scheduledAtMs), catchUp, activeRuns: state.activeRuns, ...(run.workloadId === undefined ? {} : { workloadId: run.workloadId }) },
    })
    if (run.operationPlan) {
      this.emitOperationEvent(request, 'operation-started', 'pending')
      this.activate(new SchedulerOperationExecution(request, run.operationPlan))
    } else this.activate(new RequestEntity(request, node.id))
    return true
  }

  settleSchedulerRun(request: RequestState, success: boolean) {
    if (!request.schedulerNodeId || request.schedulerRunId === undefined) return
    const key = `${request.schedulerNodeId}:${request.schedulerRunId}`
    if (this.settledSchedulerRuns.has(key)) return
    const node = this.nodes.get(request.schedulerNodeId)
    const state = this.schedulers.get(request.schedulerNodeId)
    if (node?.type !== 'scheduler' || !state) return
    this.settledSchedulerRuns.add(key)
    state.activeRuns = Math.max(0, state.activeRuns - 1)
    if (success) state.completedRuns += 1
    else state.failedRuns += 1
    this.eventSink.emit({
      timestampMs: round(this.timeNow), requestId: String(request.id), traceId: request.traceId, spanId: request.spanId, nodeId: node.id,
      type: 'scheduler-run-settled', status: success ? 'ok' : 'error', bytes: request.bytes,
      attributes: { schedulerRunId: request.schedulerRunId, activeRuns: state.activeRuns, pendingRuns: state.pending.length, totalLatencyMs: round(this.timeNow - request.createdAtMs) },
    })
    while (state.pending.length > 0 && state.activeRuns < node.config.concurrencyLimit && this.generated < this.scenario.simulation.maxRequests) {
      const pending = state.pending.shift()!
      this.releaseSchedulerRun(node, pending, true)
    }
  }

  captureNodeSnapshots() {
    for (const runtime of this.runtimes.values()) {
      const stateSnapshot = runtime.state?.snapshot(this.timeNow)
      for (const event of stateSnapshot?.events ?? []) {
        this.eventSink.emit({ timestampMs: round(this.timeNow), nodeId: runtime.node.id, type: event.type, status: event.status, ...(event.bytes === undefined ? {} : { bytes: event.bytes }), ...(event.attributes === undefined ? {} : { attributes: event.attributes }) })
      }
      this.eventSink.emit({
        timestampMs: round(this.timeNow), nodeId: runtime.node.id, type: 'node-snapshot', status: 'ok',
        attributes: {
          queueLength: runtime.waiting.pop, capacity: runtime.resource.capacity ?? 0, unitsInUse: runtime.resource.unitsInUse,
          utilization: round(Math.min(1, runtime.resource.utilization)), averageQueueLength: round(runtime.waiting.averageLength), maxQueueLength: runtime.maxWaiting,
          ...(stateSnapshot?.metrics ?? {}),
          ...(runtime.node.type !== 'scheduler' ? {} : (() => {
            const scheduler = this.schedulers.get(runtime.node.id)!
            return {
              releaseTicks: scheduler.releaseTicks, scheduledRuns: scheduler.scheduledRuns, releasedRuns: scheduler.releasedRuns, queuedRuns: scheduler.queuedRuns,
              skippedRuns: scheduler.skippedRuns, completedRuns: scheduler.completedRuns, failedRuns: scheduler.failedRuns, catchUpRuns: scheduler.catchUpRuns,
              activeRuns: scheduler.activeRuns, maxActiveRuns: scheduler.maxActiveRuns, pendingRuns: scheduler.pending.length,
            }
          })()),
          ...(runtime.node.type !== 'global-router' ? {} : (() => {
            const snapshot = this.globalRouters.get(runtime.node.id)!.snapshot(this.timeNow)
            return {
              globalRoutingDecisions: snapshot.decisions, globalRouterCacheHits: snapshot.cacheHits, globalRouterCacheMisses: snapshot.cacheMisses, globalRouterCacheExpirations: snapshot.cacheExpirations,
              globalRouterCacheHitRate: snapshot.cacheHitRate, globalRouterCachedDecisions: snapshot.cachedDecisions, globalRouterGeoMatches: snapshot.geoMatches, globalRouterFailedOutcomes: snapshot.failedOutcomes,
              globalRouterUnhealthyTransitions: snapshot.unhealthyTransitions, globalRouterRecoveries: snapshot.recoveries, globalRouterFailovers: snapshot.failovers, globalRouterCumulativeFailoverDelayMs: snapshot.cumulativeFailoverDelayMs,
              globalRouterMaxFailoverDelayMs: snapshot.maxFailoverDelayMs, globalRouterCurrentlyUnhealthy: snapshot.currentlyUnhealthy,
              ...Object.fromEntries(Object.entries(snapshot.selectionsByTarget).slice(0, 16).map(([edgeId, count], index) => [`globalRouterTarget${index}Selections`, count])),
            }
          })()),
        },
      })
    }
  }
}

class GlobalRouterHealthProbe extends Entity<SystemDesignSimulation> {
  constructor(private readonly node: Extract<ComponentNode, { type: 'global-router' }>) { super() }

  async script() {
    const simulation = this.simulation
    const intervalMs = this.node.config.healthCheckIntervalMs
    const durationMs = simulation.scenario.simulation.durationSeconds * 1_000
    while (simulation.timeNow + intervalMs <= durationMs) {
      await this.delay(intervalMs)
      const state = simulation.globalRouters.get(this.node.id)!
      for (const edge of simulation.outgoing.get(this.node.id) ?? []) {
        if (!state.needsRecoveryProbe(edge.id)) continue
        const target = simulation.nodes.get(edge.target)
        const healthy = target !== undefined && simulation.failureReason(target, { id: 0, createdAtMs: simulation.timeNow, bytes: 0, hops: 0, traceId: 'health-probe', spanId: 'health-probe', incomingEdgeId: edge.id }) === undefined
        const transition = state.probe(edge.id, healthy, simulation.timeNow)
        simulation.emitGlobalRouterHealthTransition(this.node.id, transition)
      }
    }
  }
}

class FaultLifecycle extends Entity<SystemDesignSimulation> {
  constructor(private readonly fault: Fault) { super() }

  async script() {
    const simulation = this.simulation
    const startsAtMs = faultStartsAtMs(this.fault)
    if (startsAtMs > simulation.timeNow) await this.delay(startsAtMs - simulation.timeNow)
    const target = this.fault.target ?? (this.fault.targetNodeId === undefined ? undefined : { kind: 'node' as const, id: this.fault.targetNodeId })
    if (!target) return
    const eventTarget = target.kind === 'node' ? { nodeId: target.id } : target.kind === 'edge' ? { edgeId: target.id } : {}
    simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), ...eventTarget, type: 'fault-activated', status: 'error', reason: faultReason(this.fault.type), attributes: { faultId: this.fault.sourceFaultId ?? this.fault.id, executionFaultId: this.fault.id, faultType: this.fault.type, targetKind: target.kind, targetId: target.id, ...(this.fault.factor === undefined ? {} : { factor: this.fault.factor }) } })
    if (target.kind === 'node' && this.fault.type === 'capacity-drop') {
      const runtime = simulation.runtimes.get(target.id)
      if (runtime) runtime.resource.capacity = simulation.effectiveCapacity(runtime.node)
    }
    const remainingMs = faultEndsAtMs(this.fault) - simulation.timeNow
    if (remainingMs > 0) await this.delay(remainingMs)
    simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), ...eventTarget, type: 'fault-recovered', status: 'ok', reason: faultReason(this.fault.type), attributes: { faultId: this.fault.sourceFaultId ?? this.fault.id, executionFaultId: this.fault.id, faultType: this.fault.type, targetKind: target.kind, targetId: target.id } })
    if (target.kind === 'node' && this.fault.type === 'capacity-drop') {
      const runtime = simulation.runtimes.get(target.id)
      if (runtime) runtime.resource.capacity = simulation.effectiveCapacity(runtime.node)
    }
  }
}

class MetricsSampler extends Entity<SystemDesignSimulation> {
  async script() {
    const simulation = this.simulation
    const intervalMs = simulation.scenario.simulation.sampleIntervalMs
    const durationMs = simulation.scenario.simulation.durationSeconds * 1_000
    while (simulation.timeNow + intervalMs <= durationMs) {
      await this.delay(intervalMs)
      simulation.sampleMetrics()
    }
  }
}

class SchedulerGenerator extends Entity<SystemDesignSimulation> {
  constructor(private readonly node: Extract<ComponentNode, { type: 'scheduler' }>, private readonly operationWorkload?: CompiledSchedulerWorkload) { super() }

  async script() {
    const simulation = this.simulation
    const node = this.node
    const durationMs = simulation.scenario.simulation.durationSeconds * 1_000
    let scheduledAtMs = node.config.startAtMs
    let previousDueAtMs = 0
    while (scheduledAtMs < durationMs && simulation.schedulerDecisions < simulation.scenario.simulation.maxRequests) {
      const jitter = node.config.jitterMs === 0 ? 0 : (simulation.random() * 2 - 1) * node.config.jitterMs
      const dueAtMs = Math.max(previousDueAtMs, scheduledAtMs + jitter, 0)
      if (dueAtMs >= durationMs) break
      if (dueAtMs > simulation.timeNow) await this.delay(dueAtMs - simulation.timeNow)
      const state = simulation.schedulers.get(node.id)!
      state.releaseTicks += 1
      simulation.eventSink.emit({
        timestampMs: round(simulation.timeNow), nodeId: node.id, type: 'scheduler-tick', status: 'ok',
        attributes: { releaseTick: state.releaseTicks, scheduledAtMs, dueAtMs: round(dueAtMs), jitterMs: round(dueAtMs - scheduledAtMs), scheduleMode: node.config.scheduleMode },
      })
      const runs = node.config.scheduleMode === 'batch' ? node.config.batchSize : 1
      for (let index = 0; index < runs; index += 1) {
        const plan = this.operationWorkload ? weightedPlan(this.operationWorkload, simulation.random) : undefined
        if (!simulation.offerSchedulerRun(node, scheduledAtMs, dueAtMs, plan, this.operationWorkload?.workloadId)) return
      }
      previousDueAtMs = dueAtMs
      scheduledAtMs += node.config.intervalMs
    }
  }
}

class WorkloadGenerator extends Entity<SystemDesignSimulation> {
  constructor(private readonly workload: Workload) { super() }

  async script() {
    const simulation = this.simulation
    const workload = this.workload
    const startsAtMs = workload.startAtSeconds * 1_000
    const endsAtMs = Math.min(simulation.scenario.simulation.durationSeconds * 1_000, (workload.startAtSeconds + workload.durationSeconds) * 1_000)
    if (startsAtMs > simulation.timeNow) await this.delay(startsAtMs - simulation.timeNow)
    while (simulation.timeNow < endsAtMs && simulation.generated < simulation.scenario.simulation.maxRequests) {
      simulation.generated += 1
      simulation.requestId += 1
      const traceId = `trace-${simulation.requestId}`
      const hotKeyFaults = simulation.activeFaults('workload', workload.id, 'hot-key')
      const hotKeyProbabilityOverride = hotKeyFaults.length === 0 ? undefined : 1 - hotKeyFaults.reduce((remaining, fault) => remaining * (1 - (fault.factor ?? 0.8)), 1)
      const clientRegionId = simulation.compiled.nodeRegions.get(workload.sourceNodeId)
      simulation.activate(new RequestEntity({ id: simulation.requestId, createdAtMs: simulation.timeNow, bytes: workload.requestBytes, hops: 0, traceId, spanId: `${traceId}:0`, globalRouterClientKey: `workload:${workload.id}`, ...(clientRegionId === undefined ? {} : { clientRegionId }), ...(hotKeyProbabilityOverride === undefined ? {} : { hotKeyProbabilityOverride }) }, workload.sourceNodeId))
      const trafficMultiplier = simulation.activeFaults('workload', workload.id, 'traffic-spike').reduce((value, fault) => value * (fault.factor ?? 3), 1)
      const interval = 1_000 / (workload.requestsPerSecond * trafficMultiplier)
      const delay = workload.pattern === 'constant' ? interval : -Math.log(Math.max(Number.EPSILON, 1 - simulation.random())) * interval
      await this.delay(delay)
    }
  }
}

const weightedPlan = (source: Pick<CompiledOperationPhase, 'plans'> | CompiledSchedulerWorkload, random: () => number) => {
  const total = source.plans.reduce((sum, entry) => sum + entry.weight, 0)
  let choice = random() * total
  for (const entry of source.plans) { choice -= entry.weight; if (choice <= 0) return entry.plan }
  return source.plans.at(-1)!.plan
}

class OperationWorkloadGenerator extends Entity<SystemDesignSimulation> {
  constructor(private readonly phase: CompiledOperationPhase) { super() }

  async script() {
    const simulation = this.simulation
    const phase = this.phase
    const startsAtMs = phase.startAtSeconds * 1_000
    const endsAtMs = Math.min(simulation.scenario.simulation.durationSeconds * 1_000, (phase.startAtSeconds + phase.durationSeconds) * 1_000)
    if (startsAtMs > simulation.timeNow) await this.delay(startsAtMs - simulation.timeNow)
    while (simulation.timeNow < endsAtMs && simulation.generated < simulation.scenario.simulation.maxRequests) {
      simulation.generated += 1
      simulation.requestId += 1
      const plan = weightedPlan(phase, simulation.random)
      const traceId = `trace-${simulation.requestId}`
      const bytes = plan.requestBytes
      const hotKeyFaults = simulation.activeFaults('workload', phase.workloadId, 'hot-key')
      const hotKeyDistribution = hotKeyFaults.length === 0 ? plan.keyDistribution : {
        kind: 'hotspot' as const, keySpaceSize: plan.keyDistribution?.keySpaceSize ?? 1_000_000, hotKeyCount: 1,
        hotTrafficFraction: 1 - hotKeyFaults.reduce((remaining, fault) => remaining * (1 - (fault.factor ?? 0.8)), 1),
      }
      const request: RequestState = {
        id: simulation.requestId, createdAtMs: simulation.timeNow, bytes, payloadBytes: bytes, hops: 0, traceId, spanId: `${traceId}:operation`,
        operationPlan: plan, operationId: plan.operation.operationId, key: sampleKey(hotKeyDistribution, simulation.random, simulation.requestId),
        globalRouterClientKey: `workload:${phase.workloadId}`, ...(simulation.compiled.nodeRegions.get(phase.sourceNodeId) === undefined ? {} : { clientRegionId: simulation.compiled.nodeRegions.get(phase.sourceNodeId)! }),
      }
      simulation.emitOperationEvent(request, 'operation-started', 'pending')
      simulation.activate(new OperationExecution(request, plan))
      const trafficMultiplier = simulation.activeFaults('workload', phase.workloadId, 'traffic-spike').reduce((value, fault) => value * (fault.factor ?? 3), 1)
      const interval = 1_000 / (phase.requestsPerSecond * trafficMultiplier)
      const delay = phase.pattern === 'constant' ? interval : -Math.log(Math.max(Number.EPSILON, 1 - simulation.random())) * interval
      await this.delay(delay)
    }
  }
}

type ActionOutcome = 'success' | 'failure' | 'cache-hit' | 'cache-miss' | 'skipped'
type ActionNodeResult = { success: true; duration: number } | { success: false; reason: ReasonCode }
type ActionRouteSelection = { nodeId: string; edgeId: string }

class OperationExecution extends Entity<SystemDesignSimulation> {
  success = false

  constructor(private readonly request: RequestState, private readonly plan: CompiledOperationPlan) { super() }

  async script() {
    const simulation = this.simulation
    const outcomes = new Map<string, ActionOutcome>()
    const failureReasons = new Map<string, ReasonCode>()
    const recoveredFailures = new Set<string>()
    for (const action of this.plan.actions) {
      const dependenciesSucceeded = action.dependsOn.every((dependency) => {
        const outcome = outcomes.get(dependency)
        if (action.condition?.actionId === dependency) return outcome !== undefined && outcome !== 'skipped'
        return outcome !== undefined && outcome !== 'failure' && outcome !== 'skipped'
      })
      const conditionSatisfied = !action.condition || outcomes.get(action.condition.actionId) === action.condition.outcome
      if (!dependenciesSucceeded || !conditionSatisfied) {
        simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: `${this.request.traceId}:action:${action.id}`, parentSpanId: this.request.spanId, nodeId: action.nodeId, operationId: this.plan.operation.operationId, actionId: action.id, type: 'action-skipped', status: 'cancelled', attributes: actionAttributes(action) })
        outcomes.set(action.id, 'skipped')
        continue
      }
      const execution = new OperationActionExecution(this.request, this.plan, action)
      await simulation.activate(execution)
      outcomes.set(action.id, execution.outcome)
      if (execution.outcome === 'failure') {
        failureReasons.set(action.id, execution.reason)
      } else if (action.condition?.outcome === 'failure') {
        recoveredFailures.add(action.condition.actionId)
      }
    }
    const unresolvedFailure = [...failureReasons].find(([actionId]) => !recoveredFailures.has(actionId))
    if (unresolvedFailure) {
      simulation.failed += 1
      simulation.emitOperationEvent(this.request, 'operation-completed', 'error', { durationMs: round(simulation.timeNow - this.request.createdAtMs), reason: unresolvedFailure[1] })
      return
    }
    simulation.completed += 1
    this.success = true
    simulation.emitOperationEvent(this.request, 'operation-completed', 'ok', { durationMs: round(simulation.timeNow - this.request.createdAtMs) })
  }
}

class SchedulerOperationExecution extends Entity<SystemDesignSimulation> {
  constructor(private readonly request: RequestState, private readonly plan: CompiledOperationPlan) { super() }

  async script() {
    const execution = new OperationExecution(this.request, this.plan)
    await this.simulation.activate(execution)
    this.simulation.settleSchedulerRun(this.request, execution.success)
  }
}

class OperationActionExecution extends Entity<SystemDesignSimulation> {
  outcome: ActionOutcome = 'failure'
  reason: ReasonCode = 'intrinsic_error'
  private executionNodeId: string
  private readonly routeSelections: ActionRouteSelection[] = []
  private routeOutcomesRecorded = false

  constructor(private readonly root: RequestState, private readonly plan: CompiledOperationPlan, private readonly action: CompiledOperationAction) {
    super()
    this.executionNodeId = action.nodeId
  }

  async script() {
    const simulation = this.simulation
    const spanId = `${this.root.traceId}:action:${this.action.id}`
    let runtime = simulation.runtimes.get(this.action.nodeId)
    const startedAtMs = simulation.timeNow
    const attributes = actionAttributes(this.action)
    simulation.eventSink.emit({ timestampMs: round(startedAtMs), requestId: String(this.root.id), traceId: this.root.traceId, spanId, parentSpanId: this.root.spanId, nodeId: this.action.nodeId, operationId: this.plan.operation.operationId, actionId: this.action.id, type: 'action-started', status: 'pending', attributes })
    if (!runtime) { this.finish(false, 'missing_node', startedAtMs, attributes); return }
    if (this.action.workflow) {
      await this.executeWorkflow(runtime, startedAtMs, attributes)
      return
    }
    let request: RequestState = {
      ...this.root, spanId, parentSpanId: this.root.spanId, operationAction: this.action, actionId: this.action.id,
      bytes: this.action.event?.estimatedPayloadBytes ?? this.action.cache?.estimatedValueBytes ?? this.action.requestBytes ?? this.root.bytes,
      ...(this.action.event?.estimatedPayloadBytes ?? this.action.cache?.estimatedValueBytes ?? this.root.payloadBytes) === undefined ? {} : { payloadBytes: this.action.event?.estimatedPayloadBytes ?? this.action.cache?.estimatedValueBytes ?? this.root.payloadBytes },
      ...(this.action.data === undefined ? {} : { entityId: this.action.data.objectId, queryShape: this.action.data.operation, operation: ['insert', 'update', 'delete'].includes(this.action.data.operation) ? 'write' as const : 'read' as const }),
      ...(this.action.event === undefined ? {} : { eventId: this.action.event.eventId }),
    }
    if (this.action.realtime) {
      const key = request.key ?? `key:${request.id}`
      const renderPattern = (pattern: string) => pattern.replaceAll('{request}', String(request.id)).replaceAll('{key}', key)
      request = {
        ...request, key, realtimeConnectionId: renderPattern(this.action.realtime.connectionPattern),
        realtimeChannelId: renderPattern(this.action.realtime.channelPattern),
      }
    }
    const route = this.action.edgeIds.map((edgeId) => simulation.compiled.edges.find((candidate) => candidate.id === edgeId))
    if (route.some((edge) => edge === undefined)) { this.finish(false, 'missing_node', startedAtMs, attributes); return }
    const resolvedRoute = route as CompiledConnection[]
    let terminalEdge: CompiledConnection | undefined
    for (let index = 0; index < resolvedRoute.length; index += 1) {
      const selected = this.selectRouteEdge(resolvedRoute, index, request)
      if (!selected) { this.finish(false, 'no_healthy_target', startedAtMs, attributes); return }
      const { edge, replacement, substituteTarget } = selected
      if (replacement) resolvedRoute.splice(index, resolvedRoute.length - index, edge, ...replacement)
      else resolvedRoute[index] = edge
      if (substituteTarget) this.executionNodeId = edge.target
      const finalHop = index === resolvedRoute.length - 1
      if (finalHop) {
        terminalEdge = edge
        break
      }
      const transit = await this.executeHop(edge, request, attributes, edge.target, false)
      if (!transit.success) { this.finish(false, transit.reason, startedAtMs, attributes); return }
      request = { ...request, incomingEdgeId: edge.id, hops: request.hops + 1 }
    }
    runtime = simulation.runtimes.get(this.executionNodeId)
    if (!runtime) { this.finish(false, 'missing_node', startedAtMs, attributes); return }
    let topicDelivery: { runtime: RuntimeNode; request: RequestState } | undefined
    if (this.action.event?.operation === 'consume' && this.action.sourceNodeId) {
      const broker = simulation.runtimes.get(this.action.sourceNodeId)
      if (broker?.node.type === 'topic' && broker.state?.prepareDelivery) {
        const firstEdgeId = resolvedRoute[0]?.id
        const subscriptionEdges = (simulation.outgoing.get(broker.node.id) ?? []).filter((edge) => edge.routingMode === 'async-publish')
        const subscriptionIndex = subscriptionEdges.findIndex((edge) => edge.id === firstEdgeId)
        if (subscriptionIndex < 0 || subscriptionIndex >= broker.node.config.subscriptionCount) { this.finish(false, 'missing_node', startedAtMs, attributes); return }
        const delivery = broker.state.prepareDelivery(request, `subscription:${subscriptionIndex}`, simulation.timeNow)
        for (const event of delivery.events ?? []) simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId, parentSpanId: this.root.spanId, nodeId: broker.node.id, operationId: this.plan.operation.operationId, actionId: this.action.id, type: event.type, status: event.status, ...(event.bytes === undefined ? {} : { bytes: event.bytes }), ...(event.attributes === undefined ? {} : { attributes: { ...attributes, ...event.attributes } }) })
        if (!delivery.deliver) { this.outcome = 'success'; this.reason = 'none'; this.finish(true, 'none', startedAtMs, { ...attributes, deliveredMessages: 0 }); return }
        request = { ...request, ...(delivery.patch ?? {}) }
        topicDelivery = { runtime: broker, request }
        if (broker.node.config.deliveryTimeMs > 0) await this.delay(broker.node.config.deliveryTimeMs)
      }
    }
    const sampledValueBytes = topicDelivery ? request.bytes : sampleValueBytes(this.plan.valueSizeDistribution, request.bytes, simulation.random)
    if (this.action.data || this.action.cache || this.action.event) request.bytes = sampledValueBytes
    const payloadCostMs = (this.action.data || this.action.cache || this.action.event) ? sampledValueBytes / 262_144 : 0
    const domainDecision = runtime.state?.begin(request, simulation.timeNow, simulation.random)
    const domainRequest = domainDecision?.patch ? { ...request, ...domainDecision.patch } : request
    for (const event of domainDecision?.events ?? []) simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId, parentSpanId: this.root.spanId, nodeId: runtime.node.id, operationId: this.plan.operation.operationId, actionId: this.action.id, type: event.type, status: event.status, ...(event.bytes === undefined ? {} : { bytes: event.bytes }), ...(event.attributes === undefined ? {} : { attributes: { ...attributes, ...event.attributes } }) })
    const final = await this.executeHop(terminalEdge, domainRequest, attributes, runtime.node.id, true)
    if (!final.success) {
      const domainCompletion = runtime.state?.complete(domainRequest, false, simulation.timeNow)
      for (const event of completionEvents(domainCompletion)) simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId, parentSpanId: this.root.spanId, nodeId: runtime.node.id, operationId: this.plan.operation.operationId, actionId: this.action.id, type: event.type, status: event.status, ...(event.bytes === undefined ? {} : { bytes: event.bytes }), ...(event.attributes === undefined ? {} : { attributes: { ...attributes, ...event.attributes } }) })
      runtime.state?.outcome?.(domainRequest)
      if (topicDelivery?.runtime.state?.dependencyComplete) {
        const events = topicDelivery.runtime.state.dependencyComplete(topicDelivery.request, false, simulation.timeNow)
        for (const event of events) simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId, parentSpanId: this.root.spanId, nodeId: topicDelivery.runtime.node.id, operationId: this.plan.operation.operationId, actionId: this.action.id, type: event.type, status: event.status, ...(event.bytes === undefined ? {} : { bytes: event.bytes }), ...(event.attributes === undefined ? {} : { attributes: { ...attributes, ...event.attributes } }) })
      }
      this.finish(false, final.reason, startedAtMs, attributes); return
    }
    if (payloadCostMs > 0) await this.delay(payloadCostMs)
    let dataCost: ReturnType<typeof estimateDataAccessCost> | undefined
    let searchCost: { recordsExamined: number; bytesProcessed: number; explanation: string; fanOut: number; candidates: number; resultCount: number; stale: boolean; visibilityLagMs: number } | undefined
    if (this.action.data && runtime.node.type === 'database') {
      dataCost = estimateDataAccessCost(this.action.data, runtime.node.config.queryTimeMs)
    }
    if (this.action.data && runtime.node.type === 'search-index') {
      const isWrite = ['insert', 'update', 'delete'].includes(this.action.data.operation)
      const fanOut = domainRequest.searchFanOut ?? (isWrite ? 1 : runtime.node.config.shardCount)
      const candidates = domainRequest.searchCandidateCount ?? 0
      const resultCount = domainRequest.searchResultCount ?? 0
      const recordsExamined = isWrite ? Math.max(1, Math.min(this.action.data.cardinality, this.action.data.estimatedRows)) : candidates
      searchCost = {
        recordsExamined, bytesProcessed: Math.max(this.action.data.recordBytes, recordsExamined * this.action.data.recordBytes), fanOut, candidates, resultCount,
        stale: domainRequest.searchStale ?? false, visibilityLagMs: domainRequest.searchVisibilityLagMs ?? 0,
        explanation: isWrite
          ? `Index mutation is acknowledged before refresh visibility on ${runtime.node.config.shardCount} primary shards.`
          : `Search fans out to ${fanOut} shards and merges ${candidates} candidates into ${resultCount} results.`,
      }
    }
    const domainCompletion = runtime.state?.complete(domainRequest, true, simulation.timeNow)
    const domainEvents = completionEvents(domainCompletion)
    for (const event of this.action.data && runtime.node.type === 'database' ? domainEvents.filter((candidate) => candidate.type !== 'database-read' && candidate.type !== 'database-written') : domainEvents) simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId, parentSpanId: this.root.spanId, nodeId: runtime.node.id, operationId: this.plan.operation.operationId, actionId: this.action.id, type: event.type, status: event.status, ...(event.bytes === undefined ? {} : { bytes: event.bytes }), ...(event.attributes === undefined ? {} : { attributes: { ...attributes, ...event.attributes } }) })
    const domainFailure = completionFailure(domainCompletion)
    if (domainFailure) {
      this.finish(false, domainFailure, startedAtMs, {
        ...attributes,
        ...(this.action.realtime ? { realtimeFanOut: domainRequest.realtimeFanOut ?? 0, realtimeChannelId: domainRequest.realtimeChannelId ?? '' } : {}),
      })
      return
    }
    if (this.action.data && runtime.node.type === 'database') {
      const type = ['insert', 'update', 'delete'].includes(this.action.data.operation) ? 'database-written' as const : 'database-read' as const
      const routeEvent = domainEvents.find((event) => event.type === type)
      simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId, parentSpanId: this.root.spanId, nodeId: runtime.node.id, operationId: this.plan.operation.operationId, actionId: this.action.id, type, status: 'ok', ...(dataCost?.bytesProcessed === undefined ? {} : { bytes: dataCost.bytesProcessed }), attributes: { ...attributes, ...(routeEvent?.attributes ?? {}), recordsExamined: dataCost?.recordsExamined ?? 0, bytesProcessed: dataCost?.bytesProcessed ?? 0, explanation: dataCost?.explanation ?? '' } })
    }
    if (this.action.event) simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId, parentSpanId: this.root.spanId, nodeId: runtime.node.id, operationId: this.plan.operation.operationId, actionId: this.action.id, type: this.action.event.operation === 'publish' ? 'message-published' : 'message-consumed', status: 'ok', bytes: this.action.event.estimatedPayloadBytes, attributes })
    if (topicDelivery?.runtime.state?.dependencyComplete) {
      const events = topicDelivery.runtime.state.dependencyComplete(topicDelivery.request, true, simulation.timeNow)
      for (const event of events) simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId, parentSpanId: this.root.spanId, nodeId: topicDelivery.runtime.node.id, operationId: this.plan.operation.operationId, actionId: this.action.id, type: event.type, status: event.status, ...(event.bytes === undefined ? {} : { bytes: event.bytes }), ...(event.attributes === undefined ? {} : { attributes: { ...attributes, ...event.attributes } }) })
    }
    const cacheOutcome = runtime.state?.outcome?.(domainRequest)
    if (this.action.responseBytes !== undefined) await this.delay(this.action.responseBytes / 262_144)
    this.outcome = cacheOutcome === 'hit' ? 'cache-hit' : cacheOutcome === 'miss' ? 'cache-miss' : 'success'
    this.reason = 'none'
    this.finish(true, 'none', startedAtMs, {
      ...attributes,
      ...(this.action.realtime ? { realtimeFanOut: domainRequest.realtimeFanOut ?? 0, realtimeChannelId: domainRequest.realtimeChannelId ?? '', explanation: this.action.realtime.operation === 'broadcast' ? `Broadcast targets ${domainRequest.realtimeFanOut ?? 0} active connection(s) in ${domainRequest.realtimeChannelId ?? 'the selected channel'}.` : `${this.action.realtime.operation} updates long-lived connection membership.` } : {}),
      ...(dataCost ? { recordsExamined: dataCost.recordsExamined, bytesProcessed: dataCost.bytesProcessed, explanation: dataCost.explanation } : {}),
      ...(searchCost ? { recordsExamined: searchCost.recordsExamined, bytesProcessed: searchCost.bytesProcessed, explanation: searchCost.explanation, searchFanOut: searchCost.fanOut, searchCandidates: searchCost.candidates, searchResultCount: searchCost.resultCount, searchStale: searchCost.stale, searchVisibilityLagMs: searchCost.visibilityLagMs } : {}),
    })
  }

  private selectRouteEdge(route: CompiledConnection[], index: number, request: RequestState): { edge: CompiledConnection; replacement?: CompiledConnection[]; substituteTarget?: boolean } | undefined {
    const simulation = this.simulation
    const planned = route[index]!
    const node = simulation.nodes.get(planned.source)
    if (node?.type !== 'load-balancer' && node?.type !== 'global-router') return { edge: planned }
    const outgoing = (simulation.outgoing.get(node.id) ?? []).filter((edge) => edge.routingMode !== 'async-publish')
    const choices = outgoing.flatMap((edge) => {
      const continuation = this.findRoute(edge.target, this.action.nodeId, planned.routingMode)
      if (continuation !== undefined) return [{ edge, continuation, substituteTarget: false }]
      if (index === route.length - 1 && this.compatibleExecutionTarget(edge.target, this.action.nodeId)) {
        return [{ edge, continuation: [] as CompiledConnection[], substituteTarget: true }]
      }
      return []
    })
    if (choices.length === 0) return undefined
    const candidates = choices.map((choice) => choice.edge)
    const selected = node.type === 'load-balancer'
      ? simulation.chooseLoadBalancerEdge(node, candidates)
      : simulation.chooseGlobalRouterEdge(node, candidates, request)
    if (!selected) return undefined
    const choice = choices.find((candidate) => candidate.edge.id === selected.id)!
    this.routeSelections.push({ nodeId: node.id, edgeId: selected.id })
    return { edge: selected, replacement: choice.continuation, ...(choice.substituteTarget ? { substituteTarget: true } : {}) }
  }

  private findRoute(sourceNodeId: string, targetNodeId: string, routingMode: CompiledConnection['routingMode']): CompiledConnection[] | undefined {
    if (sourceNodeId === targetNodeId) return []
    const asynchronous = routingMode === 'async-publish'
    const queue = [sourceNodeId]
    const visited = new Set(queue)
    const previous = new Map<string, { nodeId: string; edge: CompiledConnection }>()
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const edge of this.simulation.outgoing.get(current) ?? []) {
        if ((edge.routingMode === 'async-publish') !== asynchronous || visited.has(edge.target)) continue
        visited.add(edge.target)
        previous.set(edge.target, { nodeId: current, edge })
        if (edge.target === targetNodeId) {
          const path: CompiledConnection[] = []
          let cursor = targetNodeId
          while (cursor !== sourceNodeId) {
            const step = previous.get(cursor)!
            path.unshift(step.edge)
            cursor = step.nodeId
          }
          return path
        }
        queue.push(edge.target)
      }
    }
    return undefined
  }

  private compatibleExecutionTarget(candidateNodeId: string, declaredNodeId: string) {
    const candidate = this.simulation.nodes.get(candidateNodeId)
    const declared = this.simulation.nodes.get(declaredNodeId)
    return candidate !== undefined && declared !== undefined
      && candidate.type === declared.type && candidate.componentVersion === declared.componentVersion
  }

  private async executeWorkflow(runtime: RuntimeNode, startedAtMs: number, attributes: Record<string, string | number | boolean>) {
    const simulation = this.simulation
    const workflow = this.action.workflow!
    const state = runtime.state
    if (!(state instanceof WorkflowRuntime) || runtime.node.type !== 'workflow') { this.finish(false, 'missing_node', startedAtMs, attributes); return }
    const key = this.root.key ?? `key:${this.root.id}`
    const idempotencyKey = workflow.idempotencyKeyPattern.replaceAll('{request}', String(this.root.id)).replaceAll('{key}', key)
    const completionSignal = (executionId: string) => `workflow:${runtime.node.id}:${executionId}:completed`
    const terminalTransition = (type: string) => type === 'workflow-instance-completed' || type === 'workflow-instance-failed'
    const emit = (events: readonly ComponentDomainEvent[]) => {
      for (const event of events) simulation.eventSink.emit({
        timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId: `${this.root.traceId}:action:${this.action.id}`,
        parentSpanId: this.root.spanId, nodeId: runtime.node.id, operationId: this.plan.operation.operationId, actionId: this.action.id, type: event.type, status: event.status,
        ...(event.attributes === undefined ? {} : { attributes: { ...attributes, ...event.attributes } }),
      })
      for (const event of events) {
        if (terminalTransition(event.type) && typeof event.attributes?.executionId === 'string') this.sendSignal(completionSignal(event.attributes.executionId))
      }
    }
    const started = state.start(workflow, idempotencyKey, simulation.timeNow)
    emit(state.transitionEvents(started.transitions))
    if (!started.accepted) { this.finish(false, started.reason === 'execution-capacity' ? 'workflow_capacity' : 'idempotency_conflict', startedAtMs, attributes); return }
    if (started.replayed) {
      let execution = started.execution
      if (execution.status === 'running' || execution.status === 'compensating') {
        await this.waitSignal(completionSignal(execution.executionId))
        execution = state.workflow.execution(execution.executionId)
      }
      const successful = execution.status === 'succeeded'
      this.finish(successful, successful ? 'none' : execution.status === 'compensation-failed' ? 'compensation_failed' : 'intrinsic_error', startedAtMs, { ...attributes, workflowIdempotencyReplay: true, workflowStatus: execution.status })
      return
    }
    const executionId = started.execution.executionId
    while (true) {
      const claimed = state.claim(executionId, simulation.timeNow, simulation.random)
      emit(state.transitionEvents(claimed.transitions))
      if (claimed.kind === 'terminal') {
        const successful = claimed.status === 'succeeded'
        this.finish(successful, successful ? 'none' : claimed.status === 'compensation-failed' ? 'compensation_failed' : 'intrinsic_error', startedAtMs, { ...attributes, workflowStatus: claimed.status })
        return
      }
      if (claimed.kind === 'wait') { await this.delay(Math.max(0, claimed.untilMs - simulation.timeNow)); continue }
      if (claimed.kind === 'in-flight') { this.finish(false, 'idempotency_conflict', startedAtMs, attributes); return }
      const step = workflow.steps.find((candidate) => candidate.id === claimed.attempt.stepId)!
      const activity = claimed.attempt.kind === 'compensation' ? step.compensation : step
      if (!activity) { state.settle(claimed.attempt.id, false, simulation.timeNow); continue }
      const outcome = await this.executeWorkflowActivity(runtime, activity, claimed.attempt.deadlineAtMs, attributes, claimed.attempt.attempt, claimed.attempt.kind)
      const settled = state.settle(claimed.attempt.id, outcome.success, simulation.timeNow)
      emit(state.transitionEvents(settled.transitions))
    }
  }

  private async executeWorkflowActivity(workflowRuntime: RuntimeNode, activity: NonNullable<CompiledOperationAction['workflow']>['steps'][number] | NonNullable<NonNullable<CompiledOperationAction['workflow']>['steps'][number]['compensation']>, deadlineAtMs: number, attributes: Record<string, string | number | boolean>, attempt: number, kind: 'step' | 'compensation'): Promise<{ success: boolean; reason: ReasonCode }> {
    const simulation = this.simulation
    const payloadBytes = activity.requestBytes ?? this.root.bytes
    for (const edgeId of activity.edgeIds) {
      const edge = simulation.compiled.edges.find((candidate) => candidate.id === edgeId)
      if (!edge) return { success: false, reason: 'missing_node' }
      if (simulation.activeFaults('edge', edgeId, 'region-outage').length > 0) return { success: false, reason: 'region_outage' }
      const packetLoss = composeLossProbability(simulation.activeFaults('edge', edgeId, 'packet-loss'))
      if (packetLoss > 0 && simulation.random() < packetLoss) return { success: false, reason: 'packet_loss' }
    }
    const target = simulation.runtimes.get(activity.targetNodeId)
    if (!target || target.node.type !== 'service') return { success: false, reason: 'missing_node' }
    const incomingEdgeId = activity.edgeIds.at(-1)
    const fault = simulation.failureReason(target.node, { ...this.root, ...(incomingEdgeId === undefined ? {} : { incomingEdgeId }) })
    if (fault) { target.failed += 1; return { success: false, reason: fault } }
    const effectiveCapacity = simulation.effectiveCapacity(target.node)
    target.resource.capacity = effectiveCapacity
    if (target.resource.unitsInUse >= effectiveCapacity && target.waiting.pop >= getNodeBehavior(target.node).maximumWaiting(target.node)) { target.failed += 1; target.rejected += 1; return { success: false, reason: 'queue_full' } }
    const queuedAt = simulation.timeNow
    if (target.resource.unitsInUse >= effectiveCapacity) { this.enterQueueImmediately(target.waiting); target.maxWaiting = Math.max(target.maxWaiting, target.waiting.pop) }
    await this.enterQueue(target.resource)
    if (target.waiting.items.has(this)) this.leaveQueue(target.waiting)
    target.admitted += 1
    const requestTransferMs = payloadBytes / 262_144
    const responseTransferMs = (activity.responseBytes ?? 0) / 262_144
    const rawDuration = Math.max(0.001, activity.serviceTimeMs + activity.handlerTimeMs + requestTransferMs + responseTransferMs + (simulation.random() * 2 - 1) * activity.jitterMs)
    const remaining = Math.max(0, deadlineAtMs - simulation.timeNow)
    await this.delay(Math.min(rawDuration, remaining))
    this.leaveQueue(target.resource)
    target.processed += 1
    const timedOut = rawDuration > remaining
    const failed = !timedOut && simulation.random() < activity.errorRate
    const status = timedOut || failed ? 'error' : 'ok'
    simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId: `${this.root.traceId}:action:${this.action.id}:${kind}:${activity.targetNodeId}:${attempt}`, parentSpanId: `${this.root.traceId}:action:${this.action.id}`, nodeId: activity.targetNodeId, operationId: this.plan.operation.operationId, actionId: this.action.id, attempt, type: timedOut ? 'workflow-step-timed-out' : failed ? 'workflow-step-failed' : kind === 'compensation' ? 'workflow-compensation-completed' : 'workflow-step-checkpointed', status, reason: timedOut ? 'timeout' : failed ? 'intrinsic_error' : 'none', durationMs: round(simulation.timeNow - queuedAt), bytes: payloadBytes, attributes: { ...attributes, workflowActivity: kind, workflowTargetNodeId: activity.targetNodeId, ...(activity.operationId === undefined ? {} : { workflowOperationId: activity.operationId }) } })
    if (timedOut || failed) target.failed += 1
    if (workflowRuntime.node.type === 'workflow' && workflowRuntime.node.config.persistenceTimeMs > 0) await this.delay(workflowRuntime.node.config.persistenceTimeMs)
    return { success: !timedOut && !failed, reason: timedOut ? 'timeout' : failed ? 'intrinsic_error' : 'none' }
  }

  private async executeHop(edge: CompiledConnection | undefined, request: RequestState, attributes: Record<string, string | number | boolean>, targetNodeId: string, finalNode: boolean): Promise<ActionNodeResult> {
    const simulation = this.simulation
    if (!edge) {
      const result = await this.processNode(targetNodeId, request, attributes, finalNode)
      void simulation.activate(new OperationContinuation())
      return result
    }
    const actionSpanId = `${this.root.traceId}:action:${this.action.id}`
    const gateKeys = edge.routingMode === 'async-publish'
      ? [`edge:${edge.id}`, `node:${edge.target}`].filter((key) => simulation.deliveryGates.has(key))
      : []
    const admittedGateKeys: string[] = []
    for (const key of gateKeys) {
      const decision = simulation.deliveryGates.get(key)!.admit()
      if (!decision.accepted) {
        for (const admitted of admittedGateKeys) simulation.deliveryGates.get(admitted)!.acknowledge()
        simulation.eventSink.emit({
          timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId: actionSpanId, parentSpanId: this.root.spanId,
          nodeId: edge.source, edgeId: edge.id, operationId: this.plan.operation.operationId, actionId: this.action.id,
          type: decision.deadLettered ? 'message-dead-lettered' : 'request-failed', status: decision.status, reason: decision.reason, bytes: request.bytes,
          attributes: { ...attributes, terminal: false, routingMode: edge.routingMode },
        })
        void simulation.activate(new OperationContinuation())
        return { success: false, reason: decision.reason }
      }
      admittedGateKeys.push(key)
    }
    simulation.eventSink.emit({
      timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId: actionSpanId, parentSpanId: this.root.spanId,
      nodeId: edge.source, edgeId: edge.id, operationId: this.plan.operation.operationId, actionId: this.action.id,
      type: 'dependency-started', status: 'pending', bytes: request.bytes, attributes: { ...attributes, routingMode: edge.routingMode },
    })
    const timeout = policiesFor(simulation.compiled.policies, 'edge', edge.id, 'timeout')[0]
    const retry = policiesFor(simulation.compiled.policies, 'edge', edge.id, 'retry')[0]
    const circuitPolicy = policiesFor(simulation.compiled.policies, 'edge', edge.id, 'circuit-breaker')[0]
    const protectedHop = timeout !== undefined || retry !== undefined || circuitPolicy !== undefined
    const maxAttempts = retry?.config.maxAttempts ?? 1
    let result: ActionNodeResult = { success: false, reason: 'intrinsic_error' }
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const attemptStartedAtMs = simulation.timeNow
        const attemptSpanId = protectedHop ? `${actionSpanId}:attempt:${edge.id}:${attempt}` : actionSpanId
        const circuit = simulation.circuitBreakers.get(edge.id)
        const acquired = circuit?.acquire(simulation.timeNow)
        simulation.emitCircuitTransition(edge.id, edge.source, acquired?.transition)
        if (protectedHop) {
          simulation.eventSink.emit({
            timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId: attemptSpanId, parentSpanId: actionSpanId,
            nodeId: edge.target, edgeId: edge.id, operationId: this.plan.operation.operationId, actionId: this.action.id, attempt,
            type: 'attempt-started', status: acquired && !acquired.allowed ? 'rejected' : 'pending', reason: acquired && !acquired.allowed ? 'circuit_open' : 'none', bytes: request.bytes,
            ...(acquired === undefined ? {} : { attributes: { circuitState: acquired.state } }),
          })
        }
        if (acquired && !acquired.allowed) {
          result = { success: false, reason: 'circuit_open' }
        } else {
          const edgeFailure = simulation.activeFaults('edge', edge.id, 'region-outage').length > 0 ? 'region_outage' as const
            : (() => { const probability = composeLossProbability(simulation.activeFaults('edge', edge.id, 'packet-loss')); return probability > 0 && simulation.random() < probability ? 'packet_loss' as const : undefined })()
          if (edgeFailure) result = { success: false, reason: edgeFailure }
          else {
            const edgeLatency = applyLatencyFaults(0, simulation.activeFaults('edge', edge.id, 'latency-spike'))
            if (edgeLatency > 0) await this.delay(edgeLatency)
            result = await this.processNode(targetNodeId, { ...request, incomingEdgeId: edge.id, incomingRoutingMode: edge.routingMode, hops: request.hops + 1, spanId: attemptSpanId, parentSpanId: actionSpanId }, attributes, finalNode)
          }
          simulation.circuitOutcome(edge.id, edge.source, acquired?.permit, result.success)
        }
        if (!result.success && result.reason === 'timeout') {
          simulation.eventSink.emit({
            timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId: attemptSpanId, parentSpanId: actionSpanId,
            nodeId: edge.target, edgeId: edge.id, operationId: this.plan.operation.operationId, actionId: this.action.id, attempt,
            type: 'timeout-fired', status: 'error', reason: 'timeout', durationMs: round(simulation.timeNow - attemptStartedAtMs), bytes: request.bytes,
          })
        }
        simulation.eventSink.emit({
          timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId: attemptSpanId,
          ...(protectedHop ? { parentSpanId: actionSpanId } : { parentSpanId: this.root.spanId }), nodeId: edge.target, edgeId: edge.id,
          operationId: this.plan.operation.operationId, actionId: this.action.id, attempt, type: 'dependency-returned', status: result.success ? 'ok' : 'error',
          reason: result.success ? 'none' : result.reason, durationMs: round(simulation.timeNow - attemptStartedAtMs), bytes: request.bytes, attributes,
        })
        if (result.success || attempt >= maxAttempts) {
          void simulation.activate(new OperationContinuation())
          return result
        }
        const nextAttempt = attempt + 1
        const delayMs = retry ? retryDelayMs(retry.config, nextAttempt, simulation.random) : 0
        simulation.eventSink.emit({
          timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId: attemptSpanId, parentSpanId: actionSpanId,
          nodeId: edge.source, edgeId: edge.id, operationId: this.plan.operation.operationId, actionId: this.action.id, attempt: nextAttempt,
          type: 'retry-scheduled', status: 'pending', reason: result.reason, attributes: { backoffMs: round(delayMs) },
        })
        if (delayMs > 0) await this.delay(delayMs)
      }
      return result
    } finally {
      for (const key of admittedGateKeys) simulation.deliveryGates.get(key)!.acknowledge()
      if (admittedGateKeys.length > 0) {
        simulation.eventSink.emit({
          timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId: actionSpanId, parentSpanId: this.root.spanId,
          nodeId: edge.target, edgeId: edge.id, operationId: this.plan.operation.operationId, actionId: this.action.id,
          type: 'message-acknowledged', status: 'ok', bytes: request.bytes, attributes: { ...attributes, routingMode: edge.routingMode },
        })
      }
    }
  }

  private async processNode(nodeId: string, request: RequestState, attributes: Record<string, string | number | boolean>, finalNode: boolean): Promise<ActionNodeResult> {
    const simulation = this.simulation
    const runtime = simulation.runtimes.get(nodeId)
    if (!runtime || runtime.node.type === 'traffic') return runtime ? { success: true, duration: 0 } : { success: false, reason: 'missing_node' }
    const rateLimit = simulation.rateLimits.get(nodeId)
    if (rateLimit) {
      const accepted = rateLimit.admit(simulation.timeNow)
      simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId: request.spanId, ...(request.parentSpanId === undefined ? {} : { parentSpanId: request.parentSpanId }), nodeId, operationId: this.plan.operation.operationId, actionId: this.action.id, type: accepted ? 'rate-limit-accepted' : 'rate-limit-rejected', status: accepted ? 'ok' : 'rejected', reason: accepted ? 'none' : 'rate_limited', attributes: { ...attributes, tokensRemaining: rateLimit.available } })
      if (!accepted) { runtime.failed += 1; runtime.rejected += 1; return { success: false, reason: 'rate_limited' } }
    }
    const fault = simulation.failureReason(runtime.node, request)
    if (fault) { runtime.failed += 1; return { success: false, reason: fault } }
    const effectiveCapacity = simulation.effectiveCapacity(runtime.node)
    runtime.resource.capacity = effectiveCapacity
    if (runtime.resource.unitsInUse >= effectiveCapacity && runtime.waiting.pop >= getNodeBehavior(runtime.node).maximumWaiting(runtime.node)) {
      runtime.failed += 1; runtime.rejected += 1; return { success: false, reason: 'queue_full' }
    }
    if (runtime.resource.unitsInUse >= effectiveCapacity) {
      this.enterQueueImmediately(runtime.waiting); runtime.maxWaiting = Math.max(runtime.maxWaiting, runtime.waiting.pop)
      simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId: request.spanId, ...(request.parentSpanId === undefined ? {} : { parentSpanId: request.parentSpanId }), nodeId, operationId: this.plan.operation.operationId, actionId: this.action.id, type: 'request-queued', status: 'pending', attributes: { ...attributes, queueLength: runtime.waiting.pop } })
    }
    await this.enterQueue(runtime.resource)
    if (runtime.waiting.items.has(this)) this.leaveQueue(runtime.waiting)
    runtime.admitted += 1
    const rawDuration = finalNode && this.action.data && runtime.node.type === 'database'
      ? estimateDataAccessCost(this.action.data, runtime.node.config.queryTimeMs).serviceTimeMs
      : simulation.serviceTime(runtime.node as Exclude<ComponentNode, { type: 'traffic' }>, request)
    const incomingEdgeId = request.incomingEdgeId
    const timeout = incomingEdgeId ? policiesFor(simulation.compiled.policies, 'edge', incomingEdgeId, 'timeout')[0] : undefined
    const duration = timeout ? Math.min(rawDuration, timeout.config.timeoutMs) : rawDuration
    await this.delay(duration)
    this.leaveQueue(runtime.resource)
    runtime.processed += 1
    if (timeout && rawDuration > timeout.config.timeoutMs) { runtime.failed += 1; return { success: false, reason: 'timeout' } }
    const failure = simulation.failureReason(runtime.node, request) ?? (simulation.random() < getNodeBehavior(runtime.node).intrinsicErrorRate(runtime.node) ? 'intrinsic_error' as const : undefined)
    if (failure) { runtime.failed += 1; return { success: false, reason: failure } }
    return { success: true, duration }
  }

  private finish(success: boolean, reason: ReasonCode, startedAtMs: number, attributes: Record<string, string | number | boolean>) {
    const simulation = this.simulation
    if (!this.routeOutcomesRecorded) {
      for (const selection of this.routeSelections) {
        simulation.recordLoadBalancerOutcome(selection.nodeId, selection.edgeId, success)
        simulation.recordGlobalRouterOutcome(selection.nodeId, selection.edgeId, success)
      }
      this.routeOutcomesRecorded = true
    }
    this.outcome = success ? this.outcome : 'failure'
    this.reason = reason
    simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.root.id), traceId: this.root.traceId, spanId: `${this.root.traceId}:action:${this.action.id}`, parentSpanId: this.root.spanId, nodeId: this.executionNodeId, operationId: this.plan.operation.operationId, actionId: this.action.id, type: 'action-completed', status: success ? 'ok' : 'error', durationMs: round(simulation.timeNow - startedAtMs), reason, attributes: { ...attributes, ...(this.executionNodeId === this.action.nodeId ? {} : { declaredNodeId: this.action.nodeId, selectedNodeId: this.executionNodeId }) } })
  }
}

// Keep the FEC at the current virtual time until the caller of a nested async hop resumes.
class OperationContinuation extends Entity<SystemDesignSimulation> {
  async script() { await this.delay(0) }
}

class AttemptTimeout extends Entity<SystemDesignSimulation> {
  private finished = false
  private target?: RequestEntity

  constructor(private readonly request: RequestState, private readonly targetNodeId: string, private readonly timeoutMs: number, readonly completionContext: ReliabilityCompletionContext) { super() }

  cancel() { this.finished = true }

  watch(target: RequestEntity) { this.target = target }

  async script() {
    await this.delay(this.timeoutMs)
    if (this.finished) return
    const simulation = this.simulation
    const attempt = this.request.reliabilityAttempt
    if (!attempt) return
    this.finished = true
    this.target?.cancelForTimeout()
    simulation.eventSink.emit({
      timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: attempt.spanId, parentSpanId: attempt.parentSpanId,
      nodeId: this.targetNodeId, edgeId: attempt.edgeId, attempt: attempt.attempt, type: 'timeout-fired', status: 'error', durationMs: round(simulation.timeNow - attempt.startedAtMs), reason: 'timeout', bytes: this.request.bytes,
    })
    simulation.eventSink.emit({
      timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: attempt.spanId, parentSpanId: attempt.parentSpanId,
      nodeId: this.targetNodeId, edgeId: attempt.edgeId, attempt: attempt.attempt, type: 'request-failed', status: 'error', durationMs: round(simulation.timeNow - attempt.startedAtMs),
      reason: 'timeout', bytes: this.request.bytes, attributes: { terminal: false },
    })
    simulation.activate(new AttemptResult(this.request, this.targetNodeId, false, 'timeout', this.completionContext))
  }
}

class AttemptResult extends Entity<SystemDesignSimulation> {
  constructor(
    private readonly request: RequestState, private readonly nodeId: string, private readonly success: boolean, private readonly reason: ReasonCode,
    private readonly completion: ReliabilityCompletionContext,
  ) { super() }

  async script() {
    const simulation = this.simulation
    const call = this.request.reliabilityCall
    const attempt = this.request.reliabilityAttempt
    if (!call || !attempt) return
    simulation.circuitOutcome(attempt.edgeId, call.callerNodeId, attempt.circuitPermit, this.success)
    if ((this.success || call.attempt >= call.maxAttempts) && this.request.loadBalancerNodeId) {
      simulation.recordLoadBalancerOutcome(this.request.loadBalancerNodeId, attempt.edgeId, this.success)
    }
    if ((this.success || call.attempt >= call.maxAttempts) && this.request.globalRouterNodeId) {
      simulation.recordGlobalRouterOutcome(this.request.globalRouterNodeId, attempt.edgeId, this.success)
    }
    if (this.success || call.attempt >= call.maxAttempts) {
      const { reliabilityCall: _call, reliabilityAttempt: _attempt, ...settled } = this.request
      const {
        incomingEdgeId: _settledIncomingEdgeId, incomingRoutingMode: _settledIncomingRoutingMode,
        dependencyStartedAtMs: _settledDependencyStartedAtMs, loadBalancerNodeId: _settledLoadBalancerNodeId, globalRouterNodeId: _settledGlobalRouterNodeId,
        ...withoutCurrentDependency
      } = settled
      const resumed: RequestState = {
        ...withoutCurrentDependency, spanId: call.callerRequest.spanId, hops: call.callerRequest.hops,
        ...(call.callerRequest.parentSpanId === undefined ? {} : { parentSpanId: call.callerRequest.parentSpanId }),
        ...(call.callerRequest.incomingEdgeId === undefined ? {} : { incomingEdgeId: call.callerRequest.incomingEdgeId }),
        ...(call.callerRequest.incomingRoutingMode === undefined ? {} : { incomingRoutingMode: call.callerRequest.incomingRoutingMode }),
        ...(call.callerRequest.dependencyStartedAtMs === undefined ? {} : { dependencyStartedAtMs: call.callerRequest.dependencyStartedAtMs }),
        ...(call.callerRequest.loadBalancerNodeId === undefined ? {} : { loadBalancerNodeId: call.callerRequest.loadBalancerNodeId }),
        ...(call.callerRequest.globalRouterNodeId === undefined ? {} : { globalRouterNodeId: call.callerRequest.globalRouterNodeId }),
        ...(call.callerRequest.globalRouterClientKey === undefined ? {} : { globalRouterClientKey: call.callerRequest.globalRouterClientKey }),
        ...(call.callerRequest.clientRegionId === undefined ? {} : { clientRegionId: call.callerRequest.clientRegionId }),
        ...(call.callerRequest.resumeNodeId === undefined ? {} : { resumeNodeId: call.callerRequest.resumeNodeId }),
        ...(call.callerRequest.resumeOutgoingPort === undefined ? {} : { resumeOutgoingPort: call.callerRequest.resumeOutgoingPort }),
        ...(call.callerRequest.resumeRequestSpanId === undefined ? {} : { resumeRequestSpanId: call.callerRequest.resumeRequestSpanId }),
      }
      if (this.success) {
        simulation.activate(new RequestEntity({ ...withoutCurrentDependency, spanId: attempt.spanId, parentSpanId: attempt.parentSpanId }, this.nodeId, this.completion.group, this.completion.countsAsRequest, undefined, undefined, true))
      } else simulation.activate(new RequestEntity({ ...resumed, spanId: attempt.spanId, parentSpanId: attempt.parentSpanId }, call.callerNodeId, this.completion.group, this.completion.countsAsRequest, undefined, this.reason))
      return
    }
    const nextAttempt = call.attempt + 1
    const delayMs = call.retry ? retryDelayMs(call.retry, nextAttempt, simulation.random) : 0
    simulation.eventSink.emit({
      timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: attempt.spanId, parentSpanId: attempt.parentSpanId,
      nodeId: call.callerNodeId, edgeId: call.edgeId, attempt: nextAttempt, type: 'retry-scheduled', status: 'pending', reason: this.reason, attributes: { backoffMs: round(delayMs) },
    })
    if (delayMs > 0) await this.delay(delayMs)
    const { reliabilityAttempt: _attempt, ...pending } = this.request
    simulation.activate(new ReliabilityAttemptEntity({ ...pending, reliabilityCall: { ...call, attempt: nextAttempt } }, this.nodeId, this.completion))
  }
}

class ReliabilityAttemptEntity extends Entity<SystemDesignSimulation> {
  constructor(private readonly request: RequestState, private readonly targetNodeId: string, private readonly completion: ReliabilityCompletionContext) { super() }

  async script() {
    const simulation = this.simulation
    const call = this.request.reliabilityCall
    if (!call) return
    const circuit = simulation.circuitBreakers.get(call.edgeId)
    const acquired = circuit?.acquire(simulation.timeNow)
    simulation.emitCircuitTransition(call.edgeId, call.callerNodeId, acquired?.transition)
    const spanId = `${this.request.traceId}:${this.request.hops}:attempt:${call.edgeId}:${call.attempt}`
    if (acquired && !acquired.allowed) {
      simulation.eventSink.emit({
        timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId, parentSpanId: call.callerSpanId, nodeId: this.targetNodeId, edgeId: call.edgeId,
        attempt: call.attempt, type: 'attempt-started', status: 'rejected', reason: 'circuit_open', bytes: this.request.bytes, attributes: { circuitState: acquired.state },
      })
      simulation.eventSink.emit({
        timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId, parentSpanId: call.callerSpanId, nodeId: this.targetNodeId, edgeId: call.edgeId,
        attempt: call.attempt, type: 'request-failed', status: 'rejected', durationMs: 0, queueDurationMs: 0, reason: 'circuit_open', bytes: this.request.bytes, attributes: { terminal: false },
      })
      simulation.activate(new AttemptResult({ ...this.request, spanId, parentSpanId: call.callerSpanId, reliabilityAttempt: { attempt: call.attempt, spanId, parentSpanId: call.callerSpanId, edgeId: call.edgeId, startedAtMs: simulation.timeNow } }, this.targetNodeId, false, 'circuit_open', this.completion))
      return
    }
    const attempt = {
      attempt: call.attempt, spanId, parentSpanId: call.callerSpanId, edgeId: call.edgeId, startedAtMs: simulation.timeNow,
      ...(call.timeout === undefined ? {} : { deadlineMs: simulation.timeNow + call.timeout.timeoutMs }),
      ...(acquired?.permit === undefined ? {} : { circuitPermit: acquired.permit }),
    }
    const attemptRequest: RequestState = { ...this.request, spanId, parentSpanId: call.callerSpanId, reliabilityAttempt: attempt }
    simulation.eventSink.emit({
      timestampMs: round(simulation.timeNow), requestId: String(attemptRequest.id), traceId: attemptRequest.traceId, spanId, parentSpanId: call.callerSpanId, nodeId: this.targetNodeId, edgeId: call.edgeId,
      attempt: call.attempt, type: 'attempt-started', status: 'pending', bytes: attemptRequest.bytes,
    })
    const timeout = call.timeout ? new AttemptTimeout(attemptRequest, this.targetNodeId, call.timeout.timeoutMs, this.completion) : undefined
    if (timeout) simulation.activate(timeout)
    const target = new RequestEntity(attemptRequest, this.targetNodeId, undefined, false, timeout)
    timeout?.watch(target)
    simulation.activate(target)
  }
}

class RequestEntity extends Entity<SystemDesignSimulation> {
  private cancelledByTimeout = false
  private heldResource: SimQueue | null = null
  private domainStarted = false
  private domainCompleted = false
  private activeNodeId?: string

  constructor(
    private request: RequestState, private nodeId: string, private readonly group?: RequestGroup, private readonly countsAsRequest = true,
    private readonly timeout?: AttemptTimeout, private readonly terminalFailureReason?: ReasonCode, private resumeAfterProcessing = false,
  ) { super() }

  cancelForTimeout() {
    this.cancelledByTimeout = true
    const runtime = this.simulation.runtimes.get(this.nodeId)
    if (runtime) this.completeDomain(runtime, false)
    if (this.heldResource?.items.has(this)) {
      this.leaveQueue(this.heldResource)
      this.heldResource = null
    }
    for (const queue of this._queues.keys()) {
      if (queue.items.has(this)) this.leaveQueue(queue)
    }
    this.sendSignal(this.timeout, 1)
  }

  private returnDependency(success: boolean, node: ComponentNode, reason: ReasonCode) {
    const simulation = this.simulation
    if (!this.request.incomingEdgeId || this.request.dependencyStartedAtMs === undefined || this.request.incomingRoutingMode === 'async-publish') return
    if (this.request.loadBalancerNodeId) simulation.recordLoadBalancerOutcome(this.request.loadBalancerNodeId, this.request.incomingEdgeId, success)
    if (this.request.globalRouterNodeId) simulation.recordGlobalRouterOutcome(this.request.globalRouterNodeId, this.request.incomingEdgeId, success)
    simulation.eventSink.emit({
      timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId,
      ...(this.request.parentSpanId === undefined ? {} : { parentSpanId: this.request.parentSpanId }), nodeId: node.id, edgeId: this.request.incomingEdgeId,
      type: 'dependency-returned', status: success ? 'ok' : 'error', reason, durationMs: round(simulation.timeNow - this.request.dependencyStartedAtMs), bytes: this.request.bytes,
    })
  }

  private settleAttempt(success: boolean, node: ComponentNode, reason: ReasonCode): boolean {
    const attempt = this.request.reliabilityAttempt
    if (!attempt || this.cancelledByTimeout) return false
    this.timeout?.cancel()
    const simulation = this.simulation
    simulation.eventSink.emit({
      timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: attempt.spanId, parentSpanId: attempt.parentSpanId, nodeId: node.id, edgeId: attempt.edgeId,
      attempt: attempt.attempt, type: 'dependency-returned', status: success ? 'ok' : 'error', durationMs: round(simulation.timeNow - attempt.startedAtMs), reason, bytes: this.request.bytes,
    })
    const completion = this.timeout?.completionContext ?? { countsAsRequest: this.countsAsRequest, ...(this.group === undefined ? {} : { group: this.group }) }
    simulation.activate(new AttemptResult(this.request, node.id, success, reason, completion))
    return true
  }

  private clearDependency() {
    const { incomingEdgeId: _incomingEdgeId, incomingRoutingMode: _incomingRoutingMode, dependencyStartedAtMs: _dependencyStartedAtMs, loadBalancerNodeId: _loadBalancerNodeId, globalRouterNodeId: _globalRouterNodeId, ...request } = this.request
    this.request = request
  }

  private completeCallerDependency(success: boolean) {
    const callerNodeId = this.request.resumeNodeId
    if (!callerNodeId) return
    const runtime = this.simulation.runtimes.get(callerNodeId)
    if (runtime?.state?.dependencyComplete) this.emitDomainEvents(runtime.node, runtime.state.dependencyComplete({ ...this.request, spanId: this.request.resumeRequestSpanId ?? this.request.spanId, ...(this.request.resumeOutgoingPort === undefined ? {} : { outgoingPort: this.request.resumeOutgoingPort }) }, success, this.simulation.timeNow))
    const { resumeNodeId: _resumeNodeId, resumeOutgoingPort: _resumeOutgoingPort, resumeRequestSpanId: _resumeRequestSpanId, ...request } = this.request
    this.request = request
  }

  private completeLocalDependency(success: boolean, runtime: RuntimeNode) {
    if (!runtime.state?.dependencyComplete) return
    this.emitDomainEvents(runtime.node, runtime.state.dependencyComplete(this.request, success, this.simulation.timeNow))
  }

  private acknowledgeDeliveries(node: ComponentNode) {
    const keys = this.request.deliveryGateKeys
    if (!keys) return
    for (const key of keys) {
      const gate = this.simulation.deliveryGates.get(key)
      if (gate?.active) gate.acknowledge()
    }
    if (this.request.incomingEdgeId) {
      this.simulation.eventSink.emit({ timestampMs: round(this.simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, ...(this.request.parentSpanId === undefined ? {} : { parentSpanId: this.request.parentSpanId }), nodeId: node.id, edgeId: this.request.incomingEdgeId, type: 'message-acknowledged', status: 'ok', bytes: this.request.bytes })
    }
    const { deliveryGateKeys: _deliveryGateKeys, ...request } = this.request
    this.request = request
  }

  private emitDomainEvents(node: ComponentNode, events: ComponentDomainEvent[]) {
    for (const event of events) {
      this.simulation.eventSink.emit({
        timestampMs: round(this.simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId,
        ...(this.request.parentSpanId === undefined ? {} : { parentSpanId: this.request.parentSpanId }), nodeId: node.id,
        ...(this.request.incomingEdgeId === undefined ? {} : { edgeId: this.request.incomingEdgeId }),
        type: event.type, status: event.status, bytes: event.bytes ?? this.request.bytes, ...(event.attributes === undefined ? {} : { attributes: event.attributes }),
      })
    }
  }

  private beginDomain(runtime: RuntimeNode) {
    if (this.domainStarted || !runtime.state) return
    const decision = runtime.state.begin(this.request, this.simulation.timeNow, this.simulation.random)
    if (decision.patch) this.request = { ...this.request, ...decision.patch }
    this.emitDomainEvents(runtime.node, decision.events ?? [])
    this.domainStarted = true
  }

  private completeDomain(runtime: RuntimeNode, success: boolean): ReasonCode | undefined {
    if (!this.domainStarted || this.domainCompleted || !runtime.state) return undefined
    const completion = runtime.state.complete(this.request, success, this.simulation.timeNow)
    this.emitDomainEvents(runtime.node, completionEvents(completion))
    this.domainCompleted = true
    return completionFailure(completion)
  }

  private finishBranch(success: boolean, node: ComponentNode, reason: ReasonCode = 'none', terminalAttributes: Record<string, string | number | boolean> = {}) {
    const simulation = this.simulation
    if (this.settleAttempt(success, node, reason)) return
    if (this.cancelledByTimeout) return
    this.completeCallerDependency(success)
    this.acknowledgeDeliveries(node)
    this.returnDependency(success, node, reason)
    if (!this.group) {
      if (this.countsAsRequest) {
        if (success) simulation.completed += 1
        else simulation.failed += 1
      }
      const totalLatencyMs = round(simulation.timeNow - this.request.createdAtMs)
      simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, ...(this.request.parentSpanId === undefined ? {} : { parentSpanId: this.request.parentSpanId }), nodeId: node.id, type: success ? 'request-completed' : 'request-failed', status: success ? 'ok' : 'error', reason, bytes: this.request.bytes, attributes: { terminal: this.countsAsRequest, totalLatencyMs, ...terminalAttributes, ...(this.request.branchPath === undefined ? {} : { branchPath: this.request.branchPath }) } })
      if (this.countsAsRequest) simulation.settleSchedulerRun(this.request, success)
      return
    }
    this.group.failed ||= !success
    if (!success && reason !== 'none') this.group.failureReason ??= reason
    this.group.remaining -= 1
    if (this.group.remaining > 0) return
    if (this.group.failed) simulation.failed += 1
    else simulation.completed += 1
    const totalLatencyMs = round(simulation.timeNow - this.group.rootRequest.createdAtMs)
    simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.group.rootRequest.id), traceId: this.group.rootRequest.traceId, spanId: this.group.rootRequest.spanId, nodeId: node.id, type: this.group.failed ? 'request-failed' : 'request-completed', status: this.group.failed ? 'error' : 'ok', reason: this.group.failed ? this.group.failureReason ?? 'intrinsic_error' : 'none', bytes: this.group.rootRequest.bytes, attributes: { terminal: true, totalLatencyMs, routingMode: 'fan-out', ...terminalAttributes } })
    simulation.settleSchedulerRun(this.group.rootRequest, !this.group.failed)
  }

  private failAfterService(node: ComponentNode, reason: ReasonCode) {
    const simulation = this.simulation
    const durationMs = round(simulation.timeNow - (this.request.startedAtMs ?? simulation.timeNow))
    simulation.emitRequestEvent(this.request, node, 'request-failed', 'error', { durationMs, reason, attributes: { terminal: false, ...(this.request.branchPath === undefined ? {} : { branchPath: this.request.branchPath }) } })
    if (this.settleAttempt(false, node, reason)) return
    if (this.cancelledByTimeout) return
    this.completeCallerDependency(false)
    this.acknowledgeDeliveries(node)
    this.returnDependency(false, node, reason)
    this.clearDependency()
    this.finishBranch(false, node, reason)
  }

  async script() {
    const simulation = this.simulation
    if (this.request.asyncDeliveryDelayMs !== undefined) {
      const { asyncDeliveryDelayMs, ...request } = this.request
      this.request = request
      if (asyncDeliveryDelayMs > 0) await this.delay(asyncDeliveryDelayMs)
    }
    while (true) {
      const runtime = simulation.runtimes.get(this.nodeId)
      if (!runtime) {
        const fallbackNode = { id: this.nodeId, name: this.nodeId, type: 'traffic', position: { x: 0, y: 0 }, config: { workloadId: 'missing' } } as const
        this.finishBranch(false, fallbackNode, 'missing_node')
        return
      }
      const node = runtime.node
      if (this.activeNodeId !== node.id) {
        if (!this.resumeAfterProcessing && !this.request.resumeNodeId) {
          const { outgoingPort: _outgoingPort, ...request } = this.request
          this.request = request
        }
        this.activeNodeId = node.id
        this.domainStarted = false
        this.domainCompleted = false
      }
      if (this.terminalFailureReason) {
        this.finishBranch(false, node, this.terminalFailureReason)
        return
      }
      if (!this.resumeAfterProcessing) {
      simulation.emitRequestEvent(this.request, node, 'request-arrived', 'pending')
      if (this.request.incomingRoutingMode === 'async-publish' && this.request.incomingEdgeId) {
        simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, ...(this.request.parentSpanId === undefined ? {} : { parentSpanId: this.request.parentSpanId }), nodeId: node.id, edgeId: this.request.incomingEdgeId, type: 'message-consumed', status: 'pending', bytes: this.request.bytes })
      }
      if (node.type === 'traffic' || node.type === 'scheduler') {
        simulation.emitRequestEvent(this.request, node, 'request-generated', 'ok')
        simulation.emitRequestEvent(this.request, node, 'request-started', 'pending', { queueDurationMs: 0 })
        simulation.emitRequestEvent(this.request, node, 'request-completed', 'ok', { durationMs: 0, queueDurationMs: 0 })
      } else {
        const rateLimit = simulation.rateLimits.get(node.id)
        if (rateLimit) {
          const accepted = rateLimit.admit(simulation.timeNow)
          simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, ...(this.request.parentSpanId === undefined ? {} : { parentSpanId: this.request.parentSpanId }), nodeId: node.id, type: accepted ? 'rate-limit-accepted' : 'rate-limit-rejected', status: accepted ? 'ok' : 'rejected', reason: accepted ? 'none' : 'rate_limited', attributes: { tokensRemaining: rateLimit.available } })
          if (!accepted) { runtime.failed += 1; runtime.rejected += 1; this.completeDomain(runtime, false); simulation.emitRequestEvent(this.request, node, 'request-failed', 'rejected', { reason: 'rate_limited', attributes: { terminal: false } }); this.finishBranch(false, node, 'rate_limited'); return }
        }
        const arrivalFault = simulation.activeFault(node.id, 'region-outage') ? 'region_outage' as const
          : simulation.activeFault(node.id, 'node-down') ? 'node_down' as const
            : this.request.incomingEdgeId && simulation.activeFaults('edge', this.request.incomingEdgeId, 'region-outage').length > 0 ? 'region_outage' as const
              : this.request.incomingEdgeId && (() => { const probability = composeLossProbability(simulation.activeFaults('edge', this.request.incomingEdgeId!, 'packet-loss')); return probability > 0 && simulation.random() < probability })() ? 'packet_loss' as const
                : undefined
        if (arrivalFault) { runtime.failed += 1; this.completeDomain(runtime, false); simulation.emitRequestEvent(this.request, node, 'request-failed', 'error', { reason: arrivalFault, attributes: { terminal: false } }); this.finishBranch(false, node, arrivalFault); return }
        const effectiveCapacity = simulation.effectiveCapacity(node)
        runtime.resource.capacity = effectiveCapacity
        const inUse = runtime.resource.unitsInUse
        const waitingCount = runtime.waiting.pop
        if (inUse >= effectiveCapacity && waitingCount >= getNodeBehavior(node).maximumWaiting(node)) {
          runtime.failed += 1; runtime.rejected += 1; this.completeDomain(runtime, false); simulation.emitRequestEvent(this.request, node, 'request-failed', 'rejected', { reason: 'queue_full', attributes: { terminal: false } }); this.finishBranch(false, node, 'queue_full'); return
        }
        if (inUse >= effectiveCapacity) {
          this.enterQueueImmediately(runtime.waiting)
          runtime.maxWaiting = Math.max(runtime.maxWaiting, runtime.waiting.pop)
          this.request = { ...this.request, queuedAtMs: simulation.timeNow }
          simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, ...(this.request.parentSpanId === undefined ? {} : { parentSpanId: this.request.parentSpanId }), nodeId: node.id, type: 'request-queued', status: 'pending', bytes: this.request.bytes, attributes: { queueLength: runtime.waiting.pop } })
        }
        await this.enterQueue(runtime.resource)
        if (this.cancelledByTimeout) { if (runtime.resource.items.has(this)) this.leaveQueue(runtime.resource); return }
        this.heldResource = runtime.resource
        if (runtime.waiting.items.has(this)) this.leaveQueue(runtime.waiting)
        runtime.admitted += 1
        this.beginDomain(runtime)
        this.request = { ...this.request, startedAtMs: simulation.timeNow }
        simulation.emitRequestEvent(this.request, node, 'request-started', 'pending', { queueDurationMs: this.request.queuedAtMs === undefined ? 0 : round(simulation.timeNow - this.request.queuedAtMs) })
        await this.delay(simulation.serviceTime(node, this.request), undefined, this.timeout)
        if (this.cancelledByTimeout) return
        this.leaveQueue(runtime.resource)
        this.heldResource = null
        runtime.processed += 1
        const faultFailureReason = simulation.failureReason(node, this.request)
        const failureReason = faultFailureReason ?? (simulation.random() < getNodeBehavior(node).intrinsicErrorRate(node) ? (node.type === 'network' ? 'packet_loss' as const : 'intrinsic_error' as const) : undefined)
        if (failureReason) {
          runtime.failed += 1
          this.completeDomain(runtime, false)
          this.failAfterService(node, failureReason)
          return
        }
        const domainFailure = this.completeDomain(runtime, true)
        if (domainFailure) {
          runtime.failed += 1
          runtime.rejected += 1
          this.failAfterService(node, domainFailure)
          return
        }
        simulation.emitRequestEvent(this.request, node, 'request-completed', 'ok', { durationMs: round(simulation.timeNow - (this.request.startedAtMs ?? simulation.timeNow)), queueDurationMs: this.request.queuedAtMs === undefined ? 0 : round((this.request.startedAtMs ?? simulation.timeNow) - this.request.queuedAtMs) })
        if (this.settleAttempt(true, node, 'none')) return
        this.acknowledgeDeliveries(node)
        this.returnDependency(true, node, 'none')
        this.clearDependency()
      }
      } else this.resumeAfterProcessing = false

      const edges = (simulation.outgoing.get(node.id) ?? []).filter((edge) => this.request.outgoingPort === undefined || edge.sourcePort === this.request.outgoingPort)
      if (edges.length === 0) {
        this.completeLocalDependency(true, runtime)
        this.finishBranch(true, node)
        return
      }
      if (this.request.hops >= simulation.scenario.simulation.maxHops) {
        simulation.exceededHopLimit = true; runtime.failed += 1; simulation.emitRequestEvent(this.request, node, 'request-failed', 'error', { reason: 'hop_limit', attributes: { terminal: false } }); this.finishBranch(false, node, 'hop_limit'); return
      }
      const asyncEdges = edges.filter((edge) => edge.routingMode === 'async-publish')
      const publishEdges = node.type === 'topic' ? asyncEdges.slice(0, node.config.subscriptionCount) : asyncEdges
      for (const [index, publishEdge] of publishEdges.entries()) {
        const branchPath = `${this.request.branchPath ?? 'root'}.async.${index}`
        const topicSubscriptionId = node.type === 'topic' ? `subscription:${index}` : undefined
        const gateKeys = [`edge:${publishEdge.id}`, `node:${publishEdge.target}`].filter((key) => simulation.deliveryGates.has(key))
        const admitted: string[] = []
        let rejected: ReturnType<BackpressureGate['admit']> | undefined
        for (const key of gateKeys) {
          const decision = simulation.deliveryGates.get(key)!.admit()
          if (!decision.accepted) { rejected = decision; break }
          admitted.push(key)
        }
        if (rejected) {
          for (const key of admitted) simulation.deliveryGates.get(key)!.acknowledge()
          simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, nodeId: node.id, edgeId: publishEdge.id, type: rejected.deadLettered ? 'message-dead-lettered' : 'request-failed', status: rejected.status, reason: rejected.reason, bytes: this.request.bytes, attributes: { terminal: false, routingMode: 'async-publish', branchPath } })
          continue
        }
        const delivery = topicSubscriptionId === undefined ? undefined : runtime.state?.prepareDelivery?.(this.request, topicSubscriptionId, simulation.timeNow)
        if (delivery) {
          this.emitDomainEvents(node, delivery.events ?? [])
          if (!delivery.deliver) {
            for (const key of admitted) simulation.deliveryGates.get(key)!.acknowledge()
            continue
          }
        }
        simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, nodeId: node.id, edgeId: publishEdge.id, type: 'message-published', status: 'ok', bytes: this.request.bytes, attributes: { routingMode: 'async-publish', branchPath } })
        simulation.activate(new RequestEntity({
          ...this.request, ...(delivery?.patch ?? {}), hops: this.request.hops + 1, parentSpanId: this.request.spanId, spanId: `${this.request.traceId}:${this.request.hops + 1}:${branchPath}`,
          incomingEdgeId: publishEdge.id, incomingRoutingMode: 'async-publish', dependencyStartedAtMs: simulation.timeNow, branchPath,
          ...(node.type === 'topic' ? { asyncDeliveryDelayMs: node.config.deliveryTimeMs } : {}),
          ...(admitted.length === 0 ? {} : { deliveryGateKeys: admitted }),
          ...(topicSubscriptionId === undefined || !runtime.state?.dependencyComplete ? {} : { topicSubscriptionId, resumeNodeId: node.id, resumeRequestSpanId: this.request.spanId }),
        }, publishEdge.target, undefined, false))
      }
      const synchronousEdges = edges.filter((edge) => edge.routingMode !== 'async-publish')
      if (synchronousEdges.length === 0) {
        this.completeLocalDependency(true, runtime)
        this.finishBranch(true, node, 'none', this.countsAsRequest ? { asyncAccepted: true } : {})
        return
      }
      const mode = synchronousEdges[0]?.routingMode ?? 'weighted-one'
      if (mode === 'fan-out' && synchronousEdges.length > 1) {
        const group: RequestGroup = { remaining: synchronousEdges.length, failed: false, rootRequest: this.request }
        const { queuedAtMs: _queuedAtMs, startedAtMs: _startedAtMs, outgoingPort: _outgoingPort, ...request } = this.request
        for (const [index, branchEdge] of synchronousEdges.entries()) {
          const branchPath = `${this.request.branchPath ?? 'root'}.${index}`
          const branchSpanId = `${this.request.traceId}:${this.request.hops + 1}:${branchPath}`
          simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, nodeId: node.id, edgeId: branchEdge.id, type: 'dependency-started', status: 'pending', bytes: this.request.bytes, attributes: { routingMode: mode, branchPath } })
          const branchRequest: RequestState = {
            ...request, hops: request.hops + 1, parentSpanId: request.spanId, spanId: branchSpanId, incomingEdgeId: branchEdge.id,
            incomingRoutingMode: mode, dependencyStartedAtMs: simulation.timeNow, branchPath,
            ...(node.type === 'load-balancer' ? { loadBalancerNodeId: node.id } : {}),
            ...(runtime.state?.dependencyComplete ? { resumeNodeId: node.id, resumeOutgoingPort: this.request.outgoingPort, resumeRequestSpanId: this.request.spanId } : {}),
          }
          const timeout = policiesFor(simulation.compiled.policies, 'edge', branchEdge.id, 'timeout')[0]
          const retry = policiesFor(simulation.compiled.policies, 'edge', branchEdge.id, 'retry')[0]
          const circuit = policiesFor(simulation.compiled.policies, 'edge', branchEdge.id, 'circuit-breaker')[0]
          if (timeout || retry || circuit) {
            const call: ReliabilityCall = {
              callerNodeId: node.id, callerSpanId: request.spanId, callerRequest: {
                hops: request.hops, spanId: request.spanId,
                ...(request.parentSpanId === undefined ? {} : { parentSpanId: request.parentSpanId }),
                ...(request.incomingEdgeId === undefined ? {} : { incomingEdgeId: request.incomingEdgeId }),
                ...(request.incomingRoutingMode === undefined ? {} : { incomingRoutingMode: request.incomingRoutingMode }),
                ...(request.dependencyStartedAtMs === undefined ? {} : { dependencyStartedAtMs: request.dependencyStartedAtMs }),
                ...(request.loadBalancerNodeId === undefined ? {} : { loadBalancerNodeId: request.loadBalancerNodeId }),
                ...(request.globalRouterNodeId === undefined ? {} : { globalRouterNodeId: request.globalRouterNodeId }),
                ...(request.globalRouterClientKey === undefined ? {} : { globalRouterClientKey: request.globalRouterClientKey }),
                ...(request.clientRegionId === undefined ? {} : { clientRegionId: request.clientRegionId }),
                ...(request.resumeNodeId === undefined ? {} : { resumeNodeId: request.resumeNodeId }),
                ...(request.resumeOutgoingPort === undefined ? {} : { resumeOutgoingPort: request.resumeOutgoingPort }),
                ...(request.resumeRequestSpanId === undefined ? {} : { resumeRequestSpanId: request.resumeRequestSpanId }),
              }, edgeId: branchEdge.id, attempt: 1, maxAttempts: retry?.config.maxAttempts ?? 1,
              ...(retry === undefined ? {} : { retry: retry.config }), ...(timeout === undefined ? {} : { timeout: timeout.config }),
            }
            simulation.activate(new ReliabilityAttemptEntity({ ...branchRequest, reliabilityCall: call }, branchEdge.target, { group, countsAsRequest: false }))
          } else simulation.activate(new RequestEntity(branchRequest, branchEdge.target, group, false))
        }
        return
      }
      const edge = node.type === 'load-balancer' ? simulation.chooseLoadBalancerEdge(node, synchronousEdges)
        : node.type === 'global-router' ? simulation.chooseGlobalRouterEdge(node, synchronousEdges, this.request)
          : simulation.chooseEdge(synchronousEdges)
      if (!edge) {
        runtime.failed += 1
        simulation.emitRequestEvent(this.request, node, 'request-failed', 'rejected', { reason: 'no_healthy_target', attributes: { terminal: false, routingAlgorithm: node.type === 'load-balancer' ? node.config.algorithm : node.type === 'global-router' ? node.config.routingPolicy : 'weighted' } })
        this.finishBranch(false, node, 'no_healthy_target')
        return
      }
      if (simulation.retainsRequest(this.request.id)) simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, nodeId: node.id, edgeId: edge.id, type: 'dependency-started', status: 'pending', bytes: this.request.bytes })
      const parentSpanId = this.request.spanId
      const { queuedAtMs: _queuedAtMs, startedAtMs: _startedAtMs, outgoingPort: selectedOutgoingPort, ...request } = this.request
      const timeout = policiesFor(simulation.compiled.policies, 'edge', edge.id, 'timeout')[0]
      const retry = policiesFor(simulation.compiled.policies, 'edge', edge.id, 'retry')[0]
      const circuit = policiesFor(simulation.compiled.policies, 'edge', edge.id, 'circuit-breaker')[0]
      if (timeout || retry || circuit) {
        const call: ReliabilityCall = {
          callerNodeId: node.id, callerSpanId: parentSpanId, callerRequest: {
            hops: request.hops, spanId: parentSpanId,
            ...(request.parentSpanId === undefined ? {} : { parentSpanId: request.parentSpanId }),
            ...(request.incomingEdgeId === undefined ? {} : { incomingEdgeId: request.incomingEdgeId }),
            ...(request.incomingRoutingMode === undefined ? {} : { incomingRoutingMode: request.incomingRoutingMode }),
            ...(request.dependencyStartedAtMs === undefined ? {} : { dependencyStartedAtMs: request.dependencyStartedAtMs }),
            ...(request.loadBalancerNodeId === undefined ? {} : { loadBalancerNodeId: request.loadBalancerNodeId }),
            ...(request.globalRouterNodeId === undefined ? {} : { globalRouterNodeId: request.globalRouterNodeId }),
            ...(request.globalRouterClientKey === undefined ? {} : { globalRouterClientKey: request.globalRouterClientKey }),
            ...(request.clientRegionId === undefined ? {} : { clientRegionId: request.clientRegionId }),
            ...(request.resumeNodeId === undefined ? {} : { resumeNodeId: request.resumeNodeId }),
            ...(request.resumeOutgoingPort === undefined ? {} : { resumeOutgoingPort: request.resumeOutgoingPort }),
            ...(request.resumeRequestSpanId === undefined ? {} : { resumeRequestSpanId: request.resumeRequestSpanId }),
          }, edgeId: edge.id, attempt: 1, maxAttempts: retry?.config.maxAttempts ?? 1,
          ...(retry === undefined ? {} : { retry: retry.config }), ...(timeout === undefined ? {} : { timeout: timeout.config }),
        }
        simulation.activate(new ReliabilityAttemptEntity(
          { ...request, hops: request.hops + 1, parentSpanId, spanId: `${request.traceId}:${request.hops + 1}`, incomingEdgeId: edge.id, incomingRoutingMode: edge.routingMode, dependencyStartedAtMs: simulation.timeNow, reliabilityCall: call, ...(node.type === 'load-balancer' ? { loadBalancerNodeId: node.id } : {}), ...(node.type === 'global-router' ? { globalRouterNodeId: node.id } : {}), ...(runtime.state?.dependencyComplete ? { resumeNodeId: node.id, resumeOutgoingPort: selectedOutgoingPort, resumeRequestSpanId: parentSpanId } : {}) },
          edge.target, { countsAsRequest: this.countsAsRequest, ...(this.group === undefined ? {} : { group: this.group }) },
        ))
        return
      }
      this.nodeId = edge.target
      this.request = { ...request, hops: request.hops + 1, parentSpanId, spanId: `${request.traceId}:${request.hops + 1}`, incomingEdgeId: edge.id, incomingRoutingMode: edge.routingMode, dependencyStartedAtMs: simulation.timeNow, ...(node.type === 'load-balancer' ? { loadBalancerNodeId: node.id } : {}), ...(node.type === 'global-router' ? { globalRouterNodeId: node.id } : {}), ...(runtime.state?.dependencyComplete ? { resumeNodeId: node.id, resumeOutgoingPort: selectedOutgoingPort, resumeRequestSpanId: parentSpanId } : {}) }
    }
  }
}

export const executeSimulation = (simulation: SystemDesignSimulation) => new Promise<SystemDesignSimulation>((resolve) => {
  simulation.finished.addEventListener(() => { simulation.captureNodeSnapshots(); resolve(simulation) })
  void simulation.start(true)
})
