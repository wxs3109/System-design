import { validateScenarioForSimulation, SimulationValidationError } from './compiler/validation'
import { executeSimulation, SystemDesignSimulation } from './runtime/simulation'
import { buildSimulationResult } from './telemetry/result'
import type { SimulationResult } from '@system-design/model'

const seedToInteger = (seed: string) => {
  let hash = 2_166_136_261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

export const runSimulation = async (input: unknown, runId: string = crypto.randomUUID()): Promise<SimulationResult> => {
  const startedAt = performance.now()
  const validation = validateScenarioForSimulation(input)
  if (!validation.scenario || validation.errors.length > 0) throw new SimulationValidationError(validation.errors)
  const scenario = validation.scenario
  const simulation = await executeSimulation(new SystemDesignSimulation(scenario, [...validation.warnings]))
  return buildSimulationResult(simulation, scenario, runId, performance.now() - startedAt)
}

export const simulationEngineInfo = { scheduler: 'SimScript', version: 1, seedHash: seedToInteger } as const
export { SimulationValidationError, validateScenarioForSimulation } from './compiler/validation'
