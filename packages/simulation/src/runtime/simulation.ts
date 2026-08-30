import { Entity, Queue as SimQueue, Simulation } from 'simscript'
import seedrandom from 'seedrandom'
import type { ComponentNode, Connection, Fault, Scenario, TimeSeriesPoint, TraceStep, Workload } from '@system-design/model'
import { compileScenario } from '../compiler/compiler'
import { getNodeBehavior } from '../components/behavior'
import { applyCapacityFault, applyLatencyFault, resolveActiveFault } from '../faults/resolver'
import { percentile, round } from '../telemetry/math'
import type { RequestState, RuntimeNode } from './types'

export class SystemDesignSimulation extends Simulation {
  readonly scenario: Scenario
  readonly random: seedrandom.PRNG
  readonly runtimes = new Map<string, RuntimeNode>()
  readonly nodes: Map<string, ComponentNode>
  readonly outgoing = new Map<string, Connection[]>()
  readonly successfulLatencies: number[] = []
  readonly traces: TraceStep[] = []
  readonly timeSeries: TimeSeriesPoint[] = []
  readonly warnings: string[]
  generated = 0
  completed = 0
  failed = 0
  requestId = 0
  exceededHopLimit = false
  private lastSampleCompleted = 0
  private lastSampleLatencyIndex = 0

  constructor(scenario: Scenario, warnings: string[]) {
    super({ name: scenario.name, timeUnit: 'ms', timeEnd: scenario.simulation.durationSeconds * 1_000, frameDelay: null, yieldInterval: Number.MAX_SAFE_INTEGER })
    this.scenario = scenario
    this.random = seedrandom(scenario.seed)
    this.warnings = warnings
    const compiled = compileScenario(scenario)
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

  trace(request: RequestState, node: ComponentNode, event: TraceStep['event']) {
    if (request.id > this.scenario.simulation.traceLimit) return
    this.traces.push({ requestId: request.id, nodeId: node.id, nodeName: node.name, event, timeMs: round(this.timeNow) })
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

  chooseEdge(edges: Connection[]) {
    const totalWeight = edges.reduce((sum, edge) => sum + edge.weight, 0)
    let choice = this.random() * totalWeight
    for (const edge of edges) { choice -= edge.weight; if (choice <= 0) return edge }
    return edges[edges.length - 1]!
  }

  sampleMetrics() {
    const intervalSeconds = this.scenario.simulation.sampleIntervalMs / 1_000
    const windowLatencies = this.successfulLatencies.slice(this.lastSampleLatencyIndex).sort((left, right) => left - right)
    this.timeSeries.push({
      timeSeconds: round(this.timeNow / 1_000), completedRequests: this.completed, failedRequests: this.failed,
      throughputPerSecond: round((this.completed - this.lastSampleCompleted) / intervalSeconds), latencyP95Ms: round(percentile(windowLatencies, 0.95)),
      queuedRequests: [...this.runtimes.values()].reduce((sum, runtime) => sum + runtime.waiting.pop, 0),
    })
    this.lastSampleCompleted = this.completed
    this.lastSampleLatencyIndex = this.successfulLatencies.length
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
      simulation.activate(new RequestEntity({ id: simulation.requestId, createdAtMs: simulation.timeNow, bytes: workload.requestBytes, hops: 0 }, workload.sourceNodeId))
      const delay = workload.pattern === 'constant' ? interval : -Math.log(Math.max(Number.EPSILON, 1 - simulation.random())) * interval
      await this.delay(delay)
    }
  }
}

class RequestEntity extends Entity<SystemDesignSimulation> {
  constructor(private request: RequestState, private nodeId: string) { super() }

  async script() {
    const simulation = this.simulation
    while (true) {
      const runtime = simulation.runtimes.get(this.nodeId)
      if (!runtime) { simulation.failed += 1; return }
      const node = runtime.node
      if (node.type === 'traffic') {
        simulation.trace(this.request, node, 'generated')
      } else {
        if (simulation.activeFault(node.id, 'node-down')) { simulation.failed += 1; runtime.failed += 1; simulation.trace(this.request, node, 'failed'); return }
        const effectiveCapacity = simulation.effectiveCapacity(node)
        runtime.resource.capacity = effectiveCapacity
        const inUse = runtime.resource.unitsInUse
        const waitingCount = runtime.waiting.pop
        if (inUse >= effectiveCapacity && waitingCount >= getNodeBehavior(node).maximumWaiting(node)) {
          simulation.failed += 1; runtime.failed += 1; runtime.rejected += 1; simulation.trace(this.request, node, 'failed'); return
        }
        if (inUse >= effectiveCapacity) {
          this.enterQueueImmediately(runtime.waiting)
          runtime.maxWaiting = Math.max(runtime.maxWaiting, runtime.waiting.pop)
          simulation.trace(this.request, node, 'queued')
        }
        await this.enterQueue(runtime.resource)
        if (runtime.waiting.items.has(this)) this.leaveQueue(runtime.waiting)
        runtime.admitted += 1
        simulation.trace(this.request, node, 'started')
        await this.delay(simulation.serviceTime(node, this.request))
        this.leaveQueue(runtime.resource)
        runtime.processed += 1
        if (simulation.activeFault(node.id, 'node-down') || simulation.random() < getNodeBehavior(node).intrinsicErrorRate(node)) {
          simulation.failed += 1; runtime.failed += 1; simulation.trace(this.request, node, 'failed'); return
        }
        simulation.trace(this.request, node, 'completed')
      }

      const edges = simulation.outgoing.get(node.id) ?? []
      if (edges.length === 0) {
        simulation.completed += 1
        simulation.successfulLatencies.push(simulation.timeNow - this.request.createdAtMs)
        return
      }
      if (this.request.hops >= simulation.scenario.simulation.maxHops) {
        simulation.exceededHopLimit = true; simulation.failed += 1; runtime.failed += 1; simulation.trace(this.request, node, 'failed'); return
      }
      this.nodeId = simulation.chooseEdge(edges).target
      this.request = { ...this.request, hops: this.request.hops + 1 }
    }
  }
}

export const executeSimulation = (simulation: SystemDesignSimulation) => new Promise<SystemDesignSimulation>((resolve) => {
  simulation.finished.addEventListener(() => resolve(simulation))
  void simulation.start(true)
})
