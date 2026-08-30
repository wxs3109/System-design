import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The performance budget measures simulator wall time and must not compete
    // with other test workers for the same CPU during the measurement.
    fileParallelism: false,
  },
})
