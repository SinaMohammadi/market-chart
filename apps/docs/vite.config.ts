import { fileURLToPath } from 'node:url';

const pkg = (path: string) => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url));

/**
 * The docs consume the packages from source (no build needed) and read the Markdown files of the repository
 * with `?raw` imports, so package pages always show the current READMEs. JSX is compiled by esbuild; no Vite
 * plugin is needed. `base: './'` lets the built site be hosted from any folder (e.g. GitHub Pages).
 */
export default {
  base: './',
  esbuild: { jsx: 'automatic' },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: /^@market-chart\/core\/static$/, replacement: pkg('core/src/static/index.ts') },
      { find: /^@market-chart\/core$/, replacement: pkg('core/src/index.ts') },
      { find: /^@market-chart\/react\/ssr$/, replacement: pkg('react/src/ssr/index.ts') },
      { find: /^@market-chart\/react$/, replacement: pkg('react/src/index.ts') },
      { find: /^@market-chart\/testing$/, replacement: pkg('testing/src/index.ts') },
      { find: /^@market-chart\/charts$/, replacement: pkg('charts/src/index.ts') },
      {
        find: /^@market-chart\/indicators\/react$/,
        replacement: pkg('indicators/src/react/index.ts'),
      },
      { find: /^@market-chart\/indicators$/, replacement: pkg('indicators/src/index.ts') },
      {
        find: /^@market-chart\/drawing-tools\/react$/,
        replacement: pkg('drawing-tools/src/react/index.ts'),
      },
      { find: /^@market-chart\/drawing-tools$/, replacement: pkg('drawing-tools/src/index.ts') },
      { find: /^@market-chart\/datafeed\/react$/, replacement: pkg('datafeed/src/react/index.ts') },
      { find: /^@market-chart\/datafeed$/, replacement: pkg('datafeed/src/index.ts') },
      {
        find: /^@market-chart\/persistence\/react$/,
        replacement: pkg('persistence/src/react/index.ts'),
      },
      { find: /^@market-chart\/persistence$/, replacement: pkg('persistence/src/index.ts') },
      { find: /^@market-chart\/i18n$/, replacement: pkg('i18n/src/index.ts') },
      { find: /^@market-chart\/ui\/react$/, replacement: pkg('ui/src/react/index.ts') },
      { find: /^@market-chart\/ui$/, replacement: pkg('ui/src/index.ts') },
      {
        find: /^@market-chart\/trading\/react$/,
        replacement: pkg('trading/src/react/index.ts'),
      },
      { find: /^@market-chart\/trading$/, replacement: pkg('trading/src/index.ts') },
    ],
  },
  server: { fs: { allow: ['../..'] } },
};
