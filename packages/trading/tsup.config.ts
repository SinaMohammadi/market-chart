import { defineConfig } from 'tsup';

// `@market-chart/ui` and `@market-chart/i18n` are only imported as types, so they stay optional peers.
const external = [
  '@market-chart/core',
  '@market-chart/i18n',
  '@market-chart/ui',
  '@market-chart/react',
  'react',
  'react/jsx-runtime',
];

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    // `composite` (for project references) makes tsc reject tsup's partial file list (TS6307).
    // Both entries' declarations in one pass: shared classes are declared once, in a shared chunk.
    dts: {
      entry: { index: 'src/index.ts', react: 'src/react/index.ts' },
      compilerOptions: { composite: false, incremental: false },
    },
    sourcemap: true,
    clean: true,
    treeshake: true,
    external,
    target: 'es2020',
  },
  {
    // React bindings are a separate, client-only entry so the overlay stays framework-free.
    entry: { react: 'src/react/index.ts' },
    format: ['esm', 'cjs'],
    // `composite` (for project references) makes tsc reject tsup's partial file list (TS6307).
    // Declarations come from the first build (shared with the main entry).
    dts: false,
    sourcemap: true,
    clean: false,
    external,
    target: 'es2020',
    banner: { js: '"use client";' },
  },
]);
