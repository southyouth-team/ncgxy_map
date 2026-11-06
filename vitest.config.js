import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Backend tests use Jest and the NestJS dependency tree under server/.
    // Keep the root Vitest run scoped to the frontend application.
    exclude: ['**/node_modules/**', '**/dist/**', 'server/**'],
  },
})
