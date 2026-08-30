import { Entity, Queue as SimQueue, Simulation } from 'simscript'
import seedrandom from 'seedrandom'
import type { ComponentNode, Fault, ReasonCode, RuntimeEvent, Scenario, Workload } from '@system-design/model'
import type { CompiledConnection, CompiledScenario } from '../compiler/compiler'
import { getNodeBehavior } from '../components/behavior'
import { applyCapacityFault, applyLatencyFault, resolveActiveFault } from '../faults/resolver'
import { round } from '../telemetry/math'
import { RuntimeEventSink } from '../telemetry/event-sink'
import type { RequestGroup, RequestState, RuntimeNode } from './types'

export class SystemDesignSimulation extends Simulation {
  readonly scenario: Scenario
  readonly random: seedrandom.PRNG
  readonly runtimes = new Map<string, RuntimeNode>()
  readonly nodes: Map<string, ComponentNode>
  readonly outgoing = new Map<string, CompiledConnection[]>()
  readonly warnings: string[]
  readonly eventSink: RuntimeEventSink
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
    this.eventSink = new RuntimeEventSink(runId, onEventBatch, eventBatchSize)
    this.nodes = compiled.nodes
    compiled.outgoing.forEach((edges, nodeId) => this.outgoing.set(nodeId, edges))
    for (const node of this.nodes.values()) {
      this.runtimes.set(node.id, {
        node, resource: new SimQueue(`${node.id}:resource`, getNodeBehavior(node).capacity(node)), waiting: new SimQueue(`${node.id}:waiting`),
        admitted: 0, processed: 0, failed: 0, rejected: 0, maxWaiting: 0,
      })
    }
  }

  onStarting() {
    super.onStarting()
    for (const fault of this.scenario.faults) {
      if (fault.type === 'capacity-drop') this.activate(new CapacityFaultController(fault))
    }
    for (const workload of this.scenario.workloads) this.activate(new WorkloadGenerator(workload))
    this.activate(new MetricsSampler())
  }

  emitRequestEvent(request: RequestState, node: ComponentNode, type: 'request-generated' | 'request-arrived' | 'request-queued' | 'request-started' | 'request-completed' | 'request-failed', status: 'pending' | 'ok' | 'error' | 'rejected', extra: { edgeId?: string; durationMs?: number; queueDurationMs?: number; reason?: ReasonCode; attributes?: Record<string, string | number | boolean> } = {}) {
    this.eventSink.emit({
      timestampMs: round(this.timeNow), requestId: String(request.id), traceId: request.traceId, spanId: request.spanId,
      ...(request.parentSpanId === undefined ? {} : { parentSpanId: request.parentSpanId }), nodeId: node.id,
      ...((extra.edgeId ?? request.incomingEdgeId) === undefined ? {} : { edgeId: extra.edgeId ?? request.incomingEdgeId }), type, status, bytes: request.bytes,
      ...extra,
    })
  }

  activeFault(nodeId: string, type: Fault['type']) {
    return resolveActiveFault(this.scenario.faults, nodeId, type, this.timeNow)
  }

  effectiveCapacity(node: ComponentNode) {
    return applyCapacityFault(getNodeBehavior(node).capacity(node), this.activeFault(node.id, 'capacity-drop'))
  }

  serviceTime(node: Exclude<ComponentNode, { type: 'traffic' }>, request: RequestState) {
    const behavior = getNodeBehavior(node)
    const serviceTime = behavior.baseServiceTimeMs(node, request) + (this.random() * 2 - 1) * behavior.jitterMs(node)
    return Math.max(0.001, applyLatencyFault(serviceTime, this.activeFault(node.id, 'latency-spike')))
  }

  chooseEdge(edges: CompiledConnection[]) {
    const totalWeight = edges.reduce((sum, edge) => sum + edge.weight, 0)
    let choice = this.random() * totalWeight
    for (const edge of edges) { choice -= edge.weight; if (choice <= 0) return edge }
    return edges[edges.length - 1]!
  }

  sampleMetrics() {
    this.captureNodeSnapshots()
  }

  captureNodeSnapshots() {
    for (const runtime of this.runtimes.values()) {
      this.eventSink.emit({
        timestampMs: round(this.timeNow), nodeId: runtime.node.id, type: 'node-snapshot', status: 'ok',
        attributes: {
          queueLength: runtime.waiting.pop, capacity: runtime.resource.capacity ?? 0, unitsInUse: runtime.resource.unitsInUse,
          utilization: round(Math.min(1, runtime.resource.utilization)), averageQueueLength: round(runtime.waiting.averageLength), maxQueueLength: runtime.maxWaiting,
        },
      })
    }
  }
}

class CapacityFaultController extends Entity<SystemDesignSimulation> {
  constructor(private readonly fault: Fault) { super() }

  async script() {
    const simulation = this.simulation
    const startsAtMs = this.fault.startAtSeconds * 1_000
    if (startsAtMs > simulation.timeNow) await this.delay(startsAtMs - simulation.timeNow)
    const runtime = simulation.runtimes.get(this.fault.targetNodeId)
    if (!runtime) return
    runtime.resource.capacity = simulation.effectiveCapacity(runtime.node)
    await this.delay(this.fault.durationSeconds * 1_000)
    runtime.resource.capacity = simulation.effectiveCapacity(runtime.node)
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
    const interval = 1_000 / workload.requestsPerSecond
    while (simulation.timeNow < endsAtMs && simulation.generated < simulation.scenario.simulation.maxRequests) {
      simulation.generated += 1
      simulation.requestId += 1
      const traceId = `trace-${simulation.requestId}`
      simulation.activate(new RequestEntity({ id: simulation.requestId, createdAtMs: simulation.timeNow, bytes: workload.requestBytes, hops: 0, traceId, spanId: `${traceId}:0` }, workload.sourceNodeId))
      const delay = workload.pattern === 'constant' ? interval : -Math.log(Math.max(Number.EPSILON, 1 - simulation.random())) * interval
      await this.delay(delay)
    }
  }
}

class RequestEntity extends Entity<SystemDesignSimulation> {
  constructor(private request: RequestState, private nodeId: string, private readonly group?: RequestGroup, private readonly countsAsRequest = true) { super() }

  private returnDependency(success: boolean, node: ComponentNode, reason: ReasonCode) {
    const simulation = this.simulation
    if (!this.request.incomingEdgeId || this.request.dependencyStartedAtMs === undefined || this.request.incomingRoutingMode === 'async-publish') return
    simulation.eventSink.emit({
      timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId,
      ...(this.request.parentSpanId === undefined ? {} : { parentSpanId: this.request.parentSpanId }), nodeId: node.id, edgeId: this.request.incomingEdgeId,
      type: 'dependency-returned', status: success ? 'ok' : 'error', reason, durationMs: round(simulation.timeNow - this.request.dependencyStartedAtMs), bytes: this.request.bytes,
    })
  }

  private clearDependency() {
    const { incomingEdgeId: _incomingEdgeId, incomingRoutingMode: _incomingRoutingMode, dependencyStartedAtMs: _dependencyStartedAtMs, ...request } = this.request
    this.request = request
  }

  private finishBranch(success: boolean, node: ComponentNode, reason: 'none' | 'queue_full' | 'node_down' | 'packet_loss' | 'intrinsic_error' | 'hop_limit' | 'missing_node' = 'none') {
    const simulation = this.simulation
    this.returnDependency(success, node, reason)
    if (!this.group) {
      if (this.countsAsRequest) {
        if (success) simulation.completed += 1
        else simulation.failed += 1
      }
      const totalLatencyMs = round(simulation.timeNow - this.request.createdAtMs)
      simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, ...(this.request.parentSpanId === undefined ? {} : { parentSpanId: this.request.parentSpanId }), nodeId: node.id, type: success ? 'request-completed' : 'request-failed', status: success ? 'ok' : 'error', reason, bytes: this.request.bytes, attributes: { terminal: this.countsAsRequest, totalLatencyMs, ...(this.request.branchPath === undefined ? {} : { branchPath: this.request.branchPath }) } })
      return
    }
    this.group.failed ||= !success
    if (!success && reason !== 'none') this.group.failureReason ??= reason
    this.group.remaining -= 1
    if (this.group.remaining > 0) return
    if (this.group.failed) simulation.failed += 1
    else simulation.completed += 1
    const totalLatencyMs = round(simulation.timeNow - this.group.rootRequest.createdAtMs)
    simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.group.rootRequest.id), traceId: this.group.rootRequest.traceId, spanId: this.group.rootRequest.spanId, nodeId: node.id, type: this.group.failed ? 'request-failed' : 'request-completed', status: this.group.failed ? 'error' : 'ok', reason: this.group.failed ? this.group.failureReason ?? 'intrinsic_error' : 'none', bytes: this.group.rootRequest.bytes, attributes: { terminal: true, totalLatencyMs, routingMode: 'fan-out' } })
  }

  private failAfterService(node: ComponentNode, reason: 'node_down' | 'packet_loss' | 'intrinsic_error') {
    const simulation = this.simulation
    const durationMs = round(simulation.timeNow - (this.request.startedAtMs ?? simulation.timeNow))
    simulation.emitRequestEvent(this.request, node, 'request-failed', 'error', { durationMs, reason, attributes: { terminal: false, ...(this.request.branchPath === undefined ? {} : { branchPath: this.request.branchPath }) } })
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
      simulation.emitRequestEvent(this.request, node, 'request-arrived', 'pending')
      if (this.request.incomingRoutingMode === 'async-publish' && this.request.incomingEdgeId) {
        simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, ...(this.request.parentSpanId === undefined ? {} : { parentSpanId: this.request.parentSpanId }), nodeId: node.id, edgeId: this.request.incomingEdgeId, type: 'message-consumed', status: 'pending', bytes: this.request.bytes })
      }
      if (node.type === 'traffic') {
        simulation.emitRequestEvent(this.request, node, 'request-generated', 'ok')
        simulation.emitRequestEvent(this.request, node, 'request-started', 'pending', { queueDurationMs: 0 })
        simulation.emitRequestEvent(this.request, node, 'request-completed', 'ok', { durationMs: 0, queueDurationMs: 0 })
      } else {
        if (simulation.activeFault(node.id, 'node-down')) { runtime.failed += 1; simulation.emitRequestEvent(this.request, node, 'request-failed', 'error', { reason: 'node_down', attributes: { terminal: false } }); this.finishBranch(false, node, 'node_down'); return }
        const effectiveCapacity = simulation.effectiveCapacity(node)
        runtime.resource.capacity = effectiveCapacity
        const inUse = runtime.resource.unitsInUse
        const waitingCount = runtime.waiting.pop
        if (inUse >= effectiveCapacity && waitingCount >= getNodeBehavior(node).maximumWaiting(node)) {
          runtime.failed += 1; runtime.rejected += 1; simulation.emitRequestEvent(this.request, node, 'request-failed', 'rejected', { reason: 'queue_full', attributes: { terminal: false } }); this.finishBranch(false, node, 'queue_full'); return
        }
        if (inUse >= effectiveCapacity) {
          this.enterQueueImmediately(runtime.waiting)
          runtime.maxWaiting = Math.max(runtime.maxWaiting, runtime.waiting.pop)
          this.request = { ...this.request, queuedAtMs: simulation.timeNow }
          simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, ...(this.request.parentSpanId === undefined ? {} : { parentSpanId: this.request.parentSpanId }), nodeId: node.id, type: 'request-queued', status: 'pending', bytes: this.request.bytes, attributes: { queueLength: runtime.waiting.pop } })
        }
        await this.enterQueue(runtime.resource)
        if (runtime.waiting.items.has(this)) this.leaveQueue(runtime.waiting)
        runtime.admitted += 1
        this.request = { ...this.request, startedAtMs: simulation.timeNow }
        simulation.emitRequestEvent(this.request, node, 'request-started', 'pending', { queueDurationMs: this.request.queuedAtMs === undefined ? 0 : round(simulation.timeNow - this.request.queuedAtMs) })
        await this.delay(simulation.serviceTime(node, this.request))
        this.leaveQueue(runtime.resource)
        runtime.processed += 1
        if (simulation.activeFault(node.id, 'node-down') || simulation.random() < getNodeBehavior(node).intrinsicErrorRate(node)) {
          const nodeDown = Boolean(simulation.activeFault(node.id, 'node-down'))
          runtime.failed += 1
          this.failAfterService(node, nodeDown ? 'node_down' : node.type === 'network' ? 'packet_loss' : 'intrinsic_error')
          return
        }
        simulation.emitRequestEvent(this.request, node, 'request-completed', 'ok', { durationMs: round(simulation.timeNow - (this.request.startedAtMs ?? simulation.timeNow)), queueDurationMs: this.request.queuedAtMs === undefined ? 0 : round((this.request.startedAtMs ?? simulation.timeNow) - this.request.queuedAtMs) })
        this.returnDependency(true, node, 'none')
        this.clearDependency()
      }

      const edges = simulation.outgoing.get(node.id) ?? []
      if (edges.length === 0) {
        this.finishBranch(true, node)
        return
      }
      if (this.request.hops >= simulation.scenario.simulation.maxHops) {
        simulation.exceededHopLimit = true; runtime.failed += 1; simulation.emitRequestEvent(this.request, node, 'request-failed', 'error', { reason: 'hop_limit', attributes: { terminal: false } }); this.finishBranch(false, node, 'hop_limit'); return
      }
      const asyncEdges = edges.filter((edge) => edge.routingMode === 'async-publish')
      for (const [index, publishEdge] of asyncEdges.entries()) {
        const branchPath = `${this.request.branchPath ?? 'root'}.async.${index}`
        simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, nodeId: node.id, edgeId: publishEdge.id, type: 'message-published', status: 'ok', bytes: this.request.bytes, attributes: { routingMode: 'async-publish', branchPath } })
        simulation.activate(new RequestEntity({ ...this.request, hops: this.request.hops + 1, parentSpanId: this.request.spanId, spanId: `${this.request.traceId}:${this.request.hops + 1}:${branchPath}`, incomingEdgeId: publishEdge.id, incomingRoutingMode: 'async-publish', dependencyStartedAtMs: simulation.timeNow, branchPath }, publishEdge.target, undefined, false))
      }
      const synchronousEdges = edges.filter((edge) => edge.routingMode !== 'async-publish')
      if (synchronousEdges.length === 0) {
        simulation.completed += 1
        const totalLatencyMs = round(simulation.timeNow - this.request.createdAtMs)
        simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, nodeId: node.id, type: 'request-completed', status: 'ok', bytes: this.request.bytes, attributes: { terminal: true, totalLatencyMs, asyncAccepted: true } })
        return
      }
      const mode = synchronousEdges[0]?.routingMode ?? 'weighted-one'
      if (mode === 'fan-out' && synchronousEdges.length > 1) {
        const group: RequestGroup = { remaining: synchronousEdges.length, failed: false, rootRequest: this.request }
        for (const [index, branchEdge] of synchronousEdges.entries()) {
          const branchPath = `${this.request.branchPath ?? 'root'}.${index}`
          const branchSpanId = `${this.request.traceId}:${this.request.hops + 1}:${branchPath}`
          simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, nodeId: node.id, edgeId: branchEdge.id, type: 'dependency-started', status: 'pending', bytes: this.request.bytes, attributes: { routingMode: mode, branchPath } })
          simulation.activate(new RequestEntity({ ...this.request, hops: this.request.hops + 1, parentSpanId: this.request.spanId, spanId: branchSpanId, incomingEdgeId: branchEdge.id, incomingRoutingMode: mode, dependencyStartedAtMs: simulation.timeNow, branchPath }, branchEdge.target, group, false))
        }
        return
      }
      const edge = simulation.chooseEdge(synchronousEdges)
      simulation.eventSink.emit({ timestampMs: round(simulation.timeNow), requestId: String(this.request.id), traceId: this.request.traceId, spanId: this.request.spanId, nodeId: node.id, edgeId: edge.id, type: 'dependency-started', status: 'pending', bytes: this.request.bytes })
      this.nodeId = edge.target
      const parentSpanId = this.request.spanId
      const { queuedAtMs: _queuedAtMs, startedAtMs: _startedAtMs, ...request } = this.request
      this.request = { ...request, hops: request.hops + 1, parentSpanId, spanId: `${request.traceId}:${request.hops + 1}`, incomingEdgeId: edge.id, incomingRoutingMode: edge.routingMode, dependencyStartedAtMs: simulation.timeNow }
    }
  }
}

export const executeSimulation = (simulation: SystemDesignSimulation) => new Promise<SystemDesignSimulation>((resolve) => {
  simulation.finished.addEventListener(() => { simulation.captureNodeSnapshots(); resolve(simulation) })
  void simulation.start(true)
})
