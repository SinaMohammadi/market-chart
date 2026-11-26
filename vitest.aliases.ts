import { fileURLToPath } from 'node:url';

const src = (path: string): string => fileURLToPath(new URL(`./packages/${path}`, import.meta.url));

/**
 * Tests run against the sources, so `pnpm test` works without building first. More specific entries
 * (`/react`, `/static`) come before the package roots.
 */
export const alias = [
  { find: '@market-chart/core/static', replacement: src('core/src/static/index.ts') },
  { find: '@market-chart/react/ssr', replacement: src('react/src/ssr/index.ts') },
  { find: '@market-chart/indicators/react', replacement: src('indicators/src/react/index.ts') },
  {
    find: '@market-chart/drawing-tools/react',
    replacement: src('drawing-tools/src/react/index.ts'),
  },
  { find: '@market-chart/datafeed/react', replacement: src('datafeed/src/react/index.ts') },
  { find: '@market-chart/persistence/react', replacement: src('persistence/src/react/index.ts') },
  { find: '@market-chart/ui/react', replacement: src('ui/src/react/index.ts') },
  { find: '@market-chart/trading/react', replacement: src('trading/src/react/index.ts') },
  ...[
    'core',
    'testing',
    'react',
    'indicators',
    'drawing-tools',
    'charts',
    'datafeed',
    'persistence',
    'i18n',
    'ui',
    'trading',
  ].map((name) => ({
    find: new RegExp(`^@market-chart/${name}$`),
    replacement: src(`${name}/src/index.ts`),
  })),
];
