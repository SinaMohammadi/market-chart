import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    static: 'src/static/index.ts',
  },
  format: ['esm', 'cjs'],
  // `composite` (for project references) makes tsc reject tsup's partial file list (TS6307).
  dts: { compilerOptions: { composite: false, incremental: false } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: true,
  target: 'es2020',
});
