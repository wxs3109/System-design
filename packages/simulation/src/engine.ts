import { validateScenarioForSimulation, SimulationValidationError } from './compiler/validation'
import { executeSimulation, SystemDesignSimulation } from './runtime/simulation'
import { buildSimulationResult } from './telemetry/result'
import type { RuntimeEvent, SimulationProgress, SimulationResult } from '@system-design/model'

const seedToInteger = (seed: string) => {
  let hash = 2_166_136_261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

export interface RunSimulationOptions {
  onProgress?: (progress: SimulationProgress) => void
  eventBatchSize?: number
}

export const runSimulation = async (input: unknown, runId: string = crypto.randomUUID(), options: RunSimulationOptions = {}): Promise<SimulationResult> => {
  const startedAt = performance.now()
  const validation = validateScenarioForSimulation(input)
  if (!validation.scenario || !validation.compiled || validation.errors.length > 0) throw new SimulationValidationError(validation.errors)
  const scenario = validation.scenario
  let simulation!: SystemDesignSimulation
  const onBatch = options.onProgress ? (events: RuntimeEvent[]) => options.onProgress?.({
    runId, simulatedTimeMs: events.at(-1)?.timestampMs ?? 0, simulatedDurationMs: scenario.simulation.durationSeconds * 1_000,
    generatedRequests: simulation.generated, completedRequests: simulation.completed, failedRequests: simulation.failed, events,
  }) : undefined
  simulation = new SystemDesignSimulation(
    validation.compiled,
    [...validation.warnings],
    runId,
    onBatch,
    ...(options.eventBatchSize === undefined ? [] : [options.eventBatchSize]),
  )
  await executeSimulation(simulation)
  simulation.eventSink.flush()
  return buildSimulationResult(simulation, scenario, runId, performance.now() - startedAt)
}

export const simulationEngineInfo = { scheduler: 'SimScript', version: 1, seedHash: seedToInteger } as const
export { SimulationValidationError, validateScenarioForSimulation } from './compiler/validation'
