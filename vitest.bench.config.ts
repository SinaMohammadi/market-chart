import { defineConfig } from 'vitest/config';
import { alias } from './vitest.aliases';

/**
 * Performance and memory benchmarks (`pnpm bench`). Kept out of `pnpm test` because they take tens of
 * seconds and allocate hundreds of megabytes. `--expose-gc` lets memory measurements force a collection.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    name: 'benchmarks',
    root: './benchmarks',
    include: ['**/*.perf.ts'],
    environment: 'jsdom',
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true, execArgv: ['--expose-gc', '--max-old-space-size=4096'] },
    },
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
