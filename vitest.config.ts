import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/tests/setup/isolatedDatabase.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    restoreMocks: true,
    clearMocks: true,
  },
})
