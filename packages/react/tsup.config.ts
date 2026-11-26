import { defineConfig } from 'tsup';

const shared = {
  format: ['esm', 'cjs'] as const,
  // `composite` (for project references) makes tsc reject tsup's partial file list (TS6307).
  dts: { compilerOptions: { composite: false, incremental: false } },
  sourcemap: true,
  target: 'es2020',
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@market-chart/core',
    '@market-chart/core/static',
    '@market-chart/i18n',
  ],
};

export default defineConfig([
  {
    // Interactive entry: marked as a client module for React Server Components / Next.js App Router.
    ...shared,
    format: [...shared.format],
    entry: { index: 'src/index.ts' },
    clean: true,
    banner: { js: '"use client";' },
  },
  {
    // Server-safe entry: no "use client", imports only @market-chart/core/static.
    ...shared,
    format: [...shared.format],
    entry: { ssr: 'src/ssr/index.ts' },
    clean: false,
  },
]);
