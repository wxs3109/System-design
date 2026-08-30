import { Entity, Queue as SimQueue, Simulation } from 'simscript'
import seedrandom from 'seedrandom'
import type { ComponentNode, Fault, FaultTarget, FaultType, ReasonCode, RuntimeEvent, Scenario, Workload } from '@system-design/model'
import type { CompiledConnection, CompiledScenario } from '../compiler/compiler'
import { getNodeBehavior } from '../components/behavior'
import { createComponentStateRuntime, type ComponentDomainEvent } from '../components/data-runtime'
import { applyCapacityFaults, applyLatencyFaults, composeLossProbability, faultEndsAtMs, faultReason, faultStartsAtMs, resolveActiveFaults } from '../faults/resolver'
import { round } from '../telemetry/math'
import { RuntimeEventSink } from '../telemetry/event-sink'
import { BackpressureGate, TokenBucket } from '../policies/delivery'
import { policiesFor } from '../policies/compiler'
import { CircuitBreaker, retryDelayMs, type CircuitCompletionResult, type CircuitPermit, type CircuitTransition, type ReliabilityCall } from '../policies/reliability'
import type { LoadBalancerRuntimeState, ReliabilityCompletionContext, RequestGroup, RequestState, RuntimeNode } from './types'

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
  readonly circuitBreakers = new Map<string, CircuitBreaker>()
  readonly rateLimits = new Map<string, TokenBucket>()
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
    for (const workload of this.scenario.workloads) this.activate(new WorkloadGenerator(workload))
    this.activate(new MetricsSampler())
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
        },
      })
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
      simulation.activate(new RequestEntity({ id: simulation.requestId, createdAtMs: simulation.timeNow, bytes: workload.requestBytes, hops: 0, traceId, spanId: `${traceId}:0`, ...(hotKeyProbabilityOverride === undefined ? {} : { hotKeyProbabilityOverride }) }, workload.sourceNodeId))
      const trafficMultiplier = simulation.activeFaults('workload', workload.id, 'traffic-spike').reduce((value, fault) => value * (fault.factor ?? 3), 1)
      const interval = 1_000 / (workload.requestsPerSecond * trafficMultiplier)
      const delay = workload.pattern === 'constant' ? interval : -Math.log(Math.max(Number.EPSILON, 1 - simulation.random())) * interval
      await this.delay(delay)
    }
  }
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
    if (this.success || call.attempt >= call.maxAttempts) {
      const { reliabilityCall: _call, reliabilityAttempt: _attempt, ...settled } = this.request
      const {
        incomingEdgeId: _settledIncomingEdgeId, incomingRoutingMode: _settledIncomingRoutingMode,
        dependencyStartedAtMs: _settledDependencyStartedAtMs, loadBalancerNodeId: _settledLoadBalancerNodeId,
        ...withoutCurrentDependency
      } = settled
      const resumed: RequestState = {
        ...withoutCurrentDependency, spanId: call.callerRequest.spanId, hops: call.callerRequest.hops,
        ...(call.callerRequest.parentSpanId === undefined ? {} : { parentSpanId: call.callerRequest.parentSpanId }),
        ...(call.callerRequest.incomingEdgeId === undefined ? {} : { incomingEdgeId: call.callerRequest.incomingEdgeId }),
        ...(call.callerRequest.incomingRoutingMode === undefined ? {} : { incomingRoutingMode: call.callerRequest.incomingRoutingMode }),
        ...(call.callerRequest.dependencyStartedAtMs === undefined ? {} : { dependencyStartedAtMs: call.callerRequest.dependencyStartedAtMs }),
        ...(call.callerRequest.loadBalancerNodeId === undefined ? {} : { loadBalancerNodeId: call.callerRequest.loadBalancerNodeId }),
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
    const { incomingEdgeId: _incomingEdgeId, incomingRoutingMode: _incomingRoutingMode, dependencyStartedAtMs: _dependencyStartedAtMs, loadBalancerNodeId: _loadBalancerNodeId, ...request } = this.request
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

  private completeDomain(runtime: RuntimeNode, success: boolean) {
    if (!this.domainStarted || this.domainCompleted || !runtime.state) return
    this.emitDomainEvents(runtime.node, runtime.state.complete(this.request, success, this.simulation.timeNow))
    this.domainCompleted = true
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
      if (node.type === 'traffic') {
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
        this.completeDomain(runtime, true)
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
      for (const [index, publishEdge] of asyncEdges.entries()) {
        const branchPath = `${this.request.branchPath ?? 'root'}.async.${index}`
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
        simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, nodeId: node.id, edgeId: publishEdge.id, type: 'message-published', status: 'ok', bytes: this.request.bytes, attributes: { routingMode: 'async-publish', branchPath } })
        simulation.activate(new RequestEntity({ ...this.request, hops: this.request.hops + 1, parentSpanId: this.request.spanId, spanId: `${this.request.traceId}:${this.request.hops + 1}:${branchPath}`, incomingEdgeId: publishEdge.id, incomingRoutingMode: 'async-publish', dependencyStartedAtMs: simulation.timeNow, branchPath, ...(admitted.length === 0 ? {} : { deliveryGateKeys: admitted }) }, publishEdge.target, undefined, false))
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
      const edge = node.type === 'load-balancer' ? simulation.chooseLoadBalancerEdge(node, synchronousEdges) : simulation.chooseEdge(synchronousEdges)
      if (!edge) {
        runtime.failed += 1
        simulation.emitRequestEvent(this.request, node, 'request-failed', 'rejected', { reason: 'no_healthy_target', attributes: { terminal: false, routingAlgorithm: node.type === 'load-balancer' ? node.config.algorithm : 'weighted' } })
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
            ...(request.resumeNodeId === undefined ? {} : { resumeNodeId: request.resumeNodeId }),
            ...(request.resumeOutgoingPort === undefined ? {} : { resumeOutgoingPort: request.resumeOutgoingPort }),
            ...(request.resumeRequestSpanId === undefined ? {} : { resumeRequestSpanId: request.resumeRequestSpanId }),
          }, edgeId: edge.id, attempt: 1, maxAttempts: retry?.config.maxAttempts ?? 1,
          ...(retry === undefined ? {} : { retry: retry.config }), ...(timeout === undefined ? {} : { timeout: timeout.config }),
        }
        simulation.activate(new ReliabilityAttemptEntity(
          { ...request, hops: request.hops + 1, parentSpanId, spanId: `${request.traceId}:${request.hops + 1}`, incomingEdgeId: edge.id, incomingRoutingMode: edge.routingMode, dependencyStartedAtMs: simulation.timeNow, reliabilityCall: call, ...(node.type === 'load-balancer' ? { loadBalancerNodeId: node.id } : {}), ...(runtime.state?.dependencyComplete ? { resumeNodeId: node.id, resumeOutgoingPort: selectedOutgoingPort, resumeRequestSpanId: parentSpanId } : {}) },
          edge.target, { countsAsRequest: this.countsAsRequest, ...(this.group === undefined ? {} : { group: this.group }) },
        ))
        return
      }
      this.nodeId = edge.target
      this.request = { ...request, hops: request.hops + 1, parentSpanId, spanId: `${request.traceId}:${request.hops + 1}`, incomingEdgeId: edge.id, incomingRoutingMode: edge.routingMode, dependencyStartedAtMs: simulation.timeNow, ...(node.type === 'load-balancer' ? { loadBalancerNodeId: node.id } : {}), ...(runtime.state?.dependencyComplete ? { resumeNodeId: node.id, resumeOutgoingPort: selectedOutgoingPort, resumeRequestSpanId: parentSpanId } : {}) }
    }
  }
}

export const executeSimulation = (simulation: SystemDesignSimulation) => new Promise<SystemDesignSimulation>((resolve) => {
  simulation.finished.addEventListener(() => { simulation.captureNodeSnapshots(); resolve(simulation) })
  void simulation.start(true)
})
