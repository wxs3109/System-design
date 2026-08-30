/// <reference lib="webworker" />

import { runSimulation } from './engine'
import type { SimulationWorkerRequest, SimulationWorkerResponse } from './protocol'

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope
const cancelled = new Set<string>()

scope.onmessage = async (event: MessageEvent<SimulationWorkerRequest>) => {
  const message = event.data
  if (message.type === 'cancel') {
    cancelled.add(message.id)
    return
  }

  try {
    const result = await runSimulation(message.scenario, message.id)
    if (cancelled.delete(message.id)) return
    const response: SimulationWorkerResponse = { type: 'result', id: message.id, result }
    scope.postMessage(response)
  } catch (error) {
    const response: SimulationWorkerResponse = {
      type: 'error',
      id: message.id,
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : 'Unknown simulation error.',
        ...(error instanceof Error && 'problems' in error && Array.isArray(error.problems)
          ? { problems: error.problems as string[] }
          : {}),
      },
    }
    scope.postMessage(response)
  }
}
