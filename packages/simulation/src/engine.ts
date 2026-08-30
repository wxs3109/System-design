import { Entity, Queue as SimQueue, Simulation } from 'simscript'
import seedrandom from 'seedrandom'
import { quantileSorted } from 'simple-statistics'
import {
  scenarioSchema,
  type ComponentNode,
  type Connection,
  type Fault,
  type NodeMetrics,
  type Scenario,
  type SimulationResult,
  type TimeSeriesPoint,
  type TraceStep,
  type Workload,
} from '@system-design/model'

interface RequestState {
  id: number
  createdAtMs: number
  bytes: number
  hops: number
}

interface RuntimeNode {
  node: ComponentNode
  resource: SimQueue
  waiting: SimQueue
  admitted: number
  processed: number
  failed: number
  rejected: number
  maxWaiting: number
}

export class SimulationValidationError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(problems.join(' '))
    this.name = 'SimulationValidationError'
    this.problems = problems
  }
}

export const validateScenarioForSimulation = (input: unknown): { scenario?: Scenario; errors: string[]; warnings: string[] } => {
  const parsed = scenarioSchema.safeParse(input)
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'scenario'}: ${issue.message}`), warnings: [] }
  }

  const scenario = parsed.data
  const errors: string[] = []
  const warnings: string[] = []
  const enabledNodes = new Map(scenario.nodes.filter((node) => !node.disabled).map((node) => [node.id, node]))
  const outgoing = new Map<string, Connection[]>()
  for (const edge of scenario.edges) {
    if (!enabledNodes.has(edge.source) || !enabledNodes.has(edge.target)) continue
    const list = outgoing.get(edge.source) ?? []
    list.push(edge)
    outgoing.set(edge.source, list)
  }

  if (enabledNodes.size === 0) errors.push('Add at least one enabled component before running.')
  if (scenario.workloads.length === 0) errors.push('Add a Traffic Generator with a workload before running.')
  for (const workload of scenario.workloads) {
    if (!enabledNodes.has(workload.sourceNodeId)) errors.push(`Workload ${workload.name} points to a disabled or missing source.`)
    else if ((outgoing.get(workload.sourceNodeId)?.length ?? 0) === 0) errors.push(`Traffic Generator ${enabledNodes.get(workload.sourceNodeId)?.name ?? workload.sourceNodeId} is not connected.`)
  }

  const reachable = new Set<string>()
  const visit = (nodeId: string) => {
    if (reachable.has(nodeId)) return
    reachable.add(nodeId)
    for (const edge of outgoing.get(nodeId) ?? []) visit(edge.target)
  }
  for (const workload of scenario.workloads) visit(workload.sourceNodeId)
  for (const node of enabledNodes.values()) if (!reachable.has(node.id)) warnings.push(`${node.name} is not reachable from any workload.`)
  return { scenario, errors, warnings }
}

const percentile = (values: number[], probability: number) => values.length === 0 ? 0 : quantileSorted(values, probability)
const round = (value: number, digits = 3) => { const scale = 10 ** digits; return Math.round(value * scale) / scale }

const seedToInteger = (seed: string) => {
  let hash = 2_166_136_261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

const capacity = (node: ComponentNode) => {
  switch (node.type) {
    case 'traffic': return Number.MAX_SAFE_INTEGER
    case 'network': return node.config.parallelism
    case 'service': return node.config.replicas * node.config.concurrencyPerReplica
    case 'queue': return node.config.consumers
    case 'database': return node.config.maxConnections
  }
}

const maximumWaiting = (node: ComponentNode) => {
  switch (node.type) {
    case 'traffic': return 0
    case 'network': return node.config.maxQueueSize
    case 'service': return node.config.maxQueueSize
    case 'queue': return node.config.maxDepth
    case 'database': return node.config.maxQueueSize
  }
}

const intrinsicErrorRate = (node: Exclude<ComponentNode, { type: 'traffic' }>) => {
  switch (node.type) {
    case 'network': return node.config.packetLossRate
    case 'service': return node.config.errorRate
    case 'queue': return node.config.errorRate
    case 'database': return node.config.errorRate
  }
}

class SystemDesignSimulation extends Simulation {
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
    this.nodes = new Map(scenario.nodes.filter((node) => !node.disabled).map((node) => [node.id, node]))
    for (const edge of scenario.edges) {
      if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) continue
      const list = this.outgoing.get(edge.source) ?? []
      list.push(edge)
      this.outgoing.set(edge.source, list)
    }
    for (const node of this.nodes.values()) {
      this.runtimes.set(node.id, {
        node,
        resource: new SimQueue(`${node.id}:resource`, capacity(node)),
        waiting: new SimQueue(`${node.id}:waiting`),
        admitted: 0, processed: 0, failed: 0, rejected: 0, maxWaiting: 0,
      })
    }
  }

  onStarting() {
    super.onStarting()
    for (const workload of this.scenario.workloads) this.activate(new WorkloadGenerator(workload))
    this.activate(new MetricsSampler())
  }

  trace(request: RequestState, node: ComponentNode, event: TraceStep['event']) {
    if (request.id > this.scenario.simulation.traceLimit) return
    this.traces.push({ requestId: request.id, nodeId: node.id, nodeName: node.name, event, timeMs: round(this.timeNow) })
  }

  activeFault(nodeId: string, type: Fault['type']) {
    return this.scenario.faults.find((fault) => {
      const start = fault.startAtSeconds * 1_000
      return fault.targetNodeId === nodeId && fault.type === type && this.timeNow >= start && this.timeNow < start + fault.durationSeconds * 1_000
    })
  }

  effectiveCapacity(node: ComponentNode) {
    const fault = this.activeFault(node.id, 'capacity-drop')
    return Math.max(1, Math.floor(capacity(node) * Math.min(1, fault?.factor ?? 0.5)))
  }

  serviceTime(node: Exclude<ComponentNode, { type: 'traffic' }>, request: RequestState) {
    let base = 0
    let jitter = 0
    switch (node.type) {
      case 'network': base = node.config.latencyMs + (request.bytes * 8) / (node.config.bandwidthMbps * 1_000); jitter = node.config.jitterMs; break
      case 'service': base = node.config.serviceTimeMs; jitter = node.config.jitterMs; break
      case 'queue': base = node.config.deliveryTimeMs; jitter = node.config.jitterMs; break
      case 'database': base = node.config.queryTimeMs; jitter = node.config.jitterMs; break
    }
    const latencyFault = this.activeFault(node.id, 'latency-spike')
    return Math.max(0.001, (base + (this.random() * 2 - 1) * jitter) * (latencyFault ? latencyFault.factor ?? 3 : 1))
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
      timeSeconds: round(this.timeNow / 1_000),
      completedRequests: this.completed,
      failedRequests: this.failed,
      throughputPerSecond: round((this.completed - this.lastSampleCompleted) / intervalSeconds),
      latencyP95Ms: round(percentile(windowLatencies, 0.95)),
      queuedRequests: [...this.runtimes.values()].reduce((sum, runtime) => sum + runtime.waiting.pop, 0),
    })
    this.lastSampleCompleted = this.completed
    this.lastSampleLatencyIndex = this.successfulLatencies.length
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
        const inUse = runtime.resource.unitsInUse
        const waitingCount = runtime.waiting.pop
        if (inUse >= effectiveCapacity && waitingCount >= maximumWaiting(node)) {
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
        if (simulation.activeFault(node.id, 'node-down') || simulation.random() < intrinsicErrorRate(node)) {
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

const waitForFinished = (simulation: SystemDesignSimulation) => new Promise<void>((resolve) => {
  simulation.finished.addEventListener(() => resolve())
  void simulation.start(true)
})

export const runSimulation = async (input: unknown): Promise<SimulationResult> => {
  const startedAt = performance.now()
  const validation = validateScenarioForSimulation(input)
  if (!validation.scenario || validation.errors.length > 0) throw new SimulationValidationError(validation.errors)
  const scenario = validation.scenario
  const simulation = new SystemDesignSimulation(scenario, [...validation.warnings])
  await waitForFinished(simulation)
  const durationMs = scenario.simulation.durationSeconds * 1_000
  const sortedLatencies = simulation.successfulLatencies.slice().sort((left, right) => left - right)
  const nodes: NodeMetrics[] = [...simulation.runtimes.values()].filter((runtime) => runtime.node.type !== 'traffic').map((runtime) => ({
    nodeId: runtime.node.id, nodeName: runtime.node.name, nodeType: runtime.node.type, processedRequests: runtime.processed, failedRequests: runtime.failed,
    utilization: round(Math.min(1, runtime.resource.utilization)),
    averageQueueLength: round(runtime.waiting.averageLength),
    maxQueueLength: runtime.maxWaiting,
  }))
  if (simulation.generated >= scenario.simulation.maxRequests) simulation.warnings.push(`Generation stopped at the maxRequests limit (${scenario.simulation.maxRequests}).`)
  if (simulation.exceededHopLimit) simulation.warnings.push(`At least one request exceeded the max hop limit (${scenario.simulation.maxHops}).`)
  const unfinished = simulation.generated - simulation.completed - simulation.failed
  if (unfinished > 0) simulation.warnings.push(`${unfinished} request(s) were still in flight when virtual time ended.`)
  return {
    scenarioId: scenario.id, seed: scenario.seed, simulatedDurationMs: durationMs, wallClockDurationMs: round(performance.now() - startedAt),
    summary: {
      generatedRequests: simulation.generated, completedRequests: simulation.completed, failedRequests: simulation.failed,
      throughputPerSecond: round(simulation.completed / scenario.simulation.durationSeconds),
      errorRate: round(simulation.generated === 0 ? 0 : simulation.failed / simulation.generated),
      latencyP50Ms: round(percentile(sortedLatencies, 0.5)), latencyP95Ms: round(percentile(sortedLatencies, 0.95)), latencyP99Ms: round(percentile(sortedLatencies, 0.99)),
    },
    nodes, timeSeries: simulation.timeSeries, traces: simulation.traces, warnings: simulation.warnings,
  }
}

export const simulationEngineInfo = { scheduler: 'SimScript', version: 1, seedHash: seedToInteger } as const
