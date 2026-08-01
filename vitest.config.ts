import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Resolve the `@/…` path alias (see tsconfig.json) for tests.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL('./src/', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
})
