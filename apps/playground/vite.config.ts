import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pkg = (path: string) => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url));

// Packages are consumed from source, so the playground needs no prior build.
export default defineConfig({
  plugins: [react()],
  resolve: {
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
});
