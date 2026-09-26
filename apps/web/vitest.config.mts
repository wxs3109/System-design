import { defineConfig } from 'vitest/config'
import { availableParallelism } from 'node:os'

export default defineConfig({
  test: {
    // Replaying large Lab histories is CPU-heavy; avoid worker contention without relaxing time budgets.
    maxWorkers: Math.min(4, availableParallelism()),
    exclude: ['tests/**', 'node_modules/**', '.next/**'],
    passWithNoTests: true,
  },
})
