import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Type-aware ESLint of the server project follows the MCP SDK import and
    // can exceed Vitest's 5s default while the suite runs in parallel.
    testTimeout: 20000,
  },
});
