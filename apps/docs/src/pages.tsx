import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

export interface PageEntry {
  readonly path: string;
  readonly title: string;
  readonly section: 'Introduction' | 'Packages' | 'Guides' | 'Reference' | 'Project';
  /** One line shown under the title and in search results. */
  readonly summary: string;
  readonly component: LazyExoticComponent<ComponentType>;
  /** Markdown source whose headings are indexed for search. */
  readonly markdown?: () => Promise<string>;
}

const page = (load: () => Promise<{ default: ComponentType }>) => lazy(load);

export const PACKAGES = [
  ['core', 'Engine: data, scales, rendering, interaction, events, plugins'],
  ['react', 'React components, hooks, provider, layouts and SSR'],
  ['indicators', '44 incremental indicators and the chart manager'],
  ['drawing-tools', '35 drawing tools, selection, magnet, undo/redo'],
  ['charts', 'Heikin-Ashi, Renko, Kagi, P&F, footprint, heatmap, profiles'],
  ['datafeed', 'Datafeed contract, adapters, realtime and history paging'],
  ['persistence', 'Storage adapters, schemas, autosave, workspaces'],
  ['i18n', 'Translations, plurals, RTL and locale formatting'],
  ['ui', 'Context menus, header, sidebar, legend, settings, preferences'],
  ['trading', 'Orders, positions, alerts and markers drawn at their prices (display only)'],
  ['testing', 'Synthetic datasets and test helpers'],
] as const;

export type PackageName = (typeof PACKAGES)[number][0];

const readmes: Record<PackageName, () => Promise<string>> = {
  core: () => import('../../../packages/core/README.md?raw').then((m) => m.default),
  react: () => import('../../../packages/react/README.md?raw').then((m) => m.default),
  indicators: () => import('../../../packages/indicators/README.md?raw').then((m) => m.default),
  'drawing-tools': () =>
    import('../../../packages/drawing-tools/README.md?raw').then((m) => m.default),
  charts: () => import('../../../packages/charts/README.md?raw').then((m) => m.default),
  datafeed: () => import('../../../packages/datafeed/README.md?raw').then((m) => m.default),
  persistence: () => import('../../../packages/persistence/README.md?raw').then((m) => m.default),
  i18n: () => import('../../../packages/i18n/README.md?raw').then((m) => m.default),
  ui: () => import('../../../packages/ui/README.md?raw').then((m) => m.default),
  trading: () => import('../../../packages/trading/README.md?raw').then((m) => m.default),
  testing: () => import('../../../packages/testing/README.md?raw').then((m) => m.default),
};

export const readme = (name: PackageName) => readmes[name]();

const packagePage = lazy(() => import('./pages/PackagePage'));
const markdownPage = (load: () => Promise<string>, slice?: [string, string]) =>
  lazy(() =>
    import('./pages/MarkdownPage').then((m) => ({
      default: () => <m.MarkdownPage load={load} {...(slice ? { slice } : {})} />,
    })),
  );

const docs = {
  ssr: () => import('../../../docs/SSR.md?raw').then((m) => m.default),
  performance: () => import('../../../docs/PERFORMANCE.md?raw').then((m) => m.default),
  architecture: () => import('../../../docs/ARCHITECTURE.md?raw').then((m) => m.default),
  publishing: () => import('../../../docs/PUBLISHING.md?raw').then((m) => m.default),
  advanced: () => import('../../../docs/ADVANCED.md?raw').then((m) => m.default),
  security: () => import('../../../SECURITY.md?raw').then((m) => m.default),
  status: () => import('../../../FEATURE_MATRIX.md?raw').then((m) => m.default),
  readme: () => import('../../../README.md?raw').then((m) => m.default),
};

export const PAGES: readonly PageEntry[] = [
  {
    path: '/',
    title: 'market-chart',
    section: 'Introduction',
    summary: 'A free, open-source financial charting library for React and TypeScript.',
    component: page(() => import('./pages/Home')),
  },
  {
    path: '/getting-started',
    title: 'Getting started',
    section: 'Introduction',
    summary: 'Install the packages and render your first chart in a few lines.',
    component: page(() => import('./pages/GettingStarted')),
  },
  {
    path: '/examples',
    title: 'Live examples',
    section: 'Introduction',
    summary: 'Every feature running in the page, with the source of each example.',
    component: page(() => import('./pages/Examples')),
  },
  {
    path: '/builder',
    title: 'Chart builder',
    section: 'Introduction',
    summary: 'Pick options and indicators; the chart and its code update as you go.',
    component: page(() => import('./pages/Builder')),
  },
  ...PACKAGES.map(([name, summary]): PageEntry => ({
    path: `/packages/${name}`,
    title: `@market-chart/${name}`,
    section: 'Packages',
    summary,
    component: packagePage as unknown as LazyExoticComponent<ComponentType>,
    markdown: readmes[name],
  })),
  {
    path: '/guides/ssr',
    title: 'Server rendering and Next.js',
    section: 'Guides',
    summary: 'Static SVG charts on the server, progressive enhancement and the App Router.',
    component: markdownPage(docs.ssr),
    markdown: docs.ssr,
  },
  {
    path: '/guides/performance',
    title: 'Performance',
    section: 'Guides',
    summary: 'Benchmarks with budgets, large datasets and memory behaviour.',
    component: markdownPage(docs.performance),
    markdown: docs.performance,
  },
  {
    path: '/guides/architecture',
    title: 'Architecture',
    section: 'Guides',
    summary: 'How the packages fit together and the technical decisions behind them.',
    component: markdownPage(docs.architecture),
    markdown: docs.architecture,
  },
  {
    path: '/guides/advanced',
    title: 'Advanced guide',
    section: 'Guides',
    summary:
      'Runtime model, plugins, custom chart types, data and state, the interface layer, trading integration, tuning and testing.',
    component: markdownPage(docs.advanced),
    markdown: docs.advanced,
  },
  {
    path: '/guides/security',
    title: 'Security',
    section: 'Guides',
    summary: 'Threat model, what the library validates, CSP, datafeeds, stored layouts and trading integrations.',
    component: markdownPage(docs.security),
    markdown: docs.security,
  },
  {
    path: '/guides/publishing',
    title: 'Deploy and publish',
    section: 'Guides',
    summary: 'GitHub, npm releases with Changesets and provenance, and hosting the documentation site.',
    component: markdownPage(docs.publishing),
    markdown: docs.publishing,
  },
  {
    path: '/reference/indicators',
    title: 'Indicators',
    section: 'Reference',
    summary: 'Every built-in indicator with its inputs and outputs, previewed live.',
    component: page(() => import('./pages/IndicatorsReference')),
  },
  {
    path: '/reference/drawing-tools',
    title: 'Drawing tools',
    section: 'Reference',
    summary: 'All drawing tools by category; try any of them on a live chart.',
    component: page(() => import('./pages/DrawingToolsReference')),
  },
  {
    path: '/reference/actions',
    title: 'Interface actions',
    section: 'Reference',
    summary: 'Built-in actions of the context menu, header and sidebar.',
    component: page(() => import('./pages/ActionsReference')),
  },
  {
    path: '/reference/trading',
    title: 'Symbols, price actions and trading objects',
    section: 'Reference',
    summary: 'Built-in price actions, order-ticket fields, order and position fields, preferences.',
    component: page(() => import('./pages/TradingReference')),
  },
  {
    path: '/reference/options',
    title: 'Chart options',
    section: 'Reference',
    summary: 'Every chart option with its default value.',
    component: page(() => import('./pages/OptionsReference')),
  },
  {
    path: '/reference/translations',
    title: 'Translations',
    section: 'Reference',
    summary: 'Every interface text in English, Persian and Arabic.',
    component: page(() => import('./pages/TranslationsReference')),
  },
  {
    path: '/status',
    title: 'Feature status',
    section: 'Project',
    summary: 'What is complete, partial or planned, and how it was verified.',
    component: markdownPage(docs.status),
    markdown: docs.status,
  },
  {
    path: '/contributing',
    title: 'Develop and publish',
    section: 'Project',
    summary: 'Run the repository locally, test, build and publish to npm.',
    component: markdownPage(docs.readme, ['## Launch locally', '## License and disclaimer']),
  },
  {
    path: '/license',
    title: 'License',
    section: 'Project',
    summary: 'MIT license and disclaimer.',
    component: page(() => import('./pages/License')),
  },
];

export const findPage = (path: string): PageEntry | undefined => PAGES.find((p) => p.path === path);
