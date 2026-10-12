import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 5000,
    // Lets memory tests call global.gc() before measuring the heap.
    execArgv: ['--expose-gc'],
  },
});
