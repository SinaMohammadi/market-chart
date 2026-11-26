import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  // `composite` (for project references) makes tsc reject tsup's partial file list (TS6307).
  dts: { compilerOptions: { composite: false, incremental: false } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['@market-chart/core'],
  target: 'es2020',
});
