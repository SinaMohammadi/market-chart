import { builtInIndicators } from '@market-chart/indicators';
import { builtInTools } from '@market-chart/drawing-tools';
import { builtInLocales } from '@market-chart/i18n';
import { builtInActions } from '@market-chart/ui';
import { Code } from '../components/Code';
import { Example } from '../components/Example';
import FullInterface from '../demos/FullInterface';
import fullInterfaceSource from '../demos/FullInterface.tsx?raw';
import hookSource from '../demos/useTradingChart.ts?raw';
import { PACKAGES } from '../pages';
import { Link } from '../site';

/** Numbers read from the packages themselves, so they stay right as the library grows. */
const STATS = [
  [String(builtInIndicators.length), 'indicators', '/reference/indicators'],
  [String(builtInTools.length), 'drawing tools', '/reference/drawing-tools'],
  [String(builtInActions().length), 'interface actions', '/reference/actions'],
  [String(builtInLocales.length), 'languages built in', '/reference/translations'],
  [String(PACKAGES.length), 'packages', '/packages/core'],
] as const;

const FEATURES = [
  [
    'Fast engine',
    'Canvas 2D and typed-array columns: in our benchmark 1M candles load in about 0.1 s and a frame takes about a millisecond of engine time (results vary by device).',
    '/guides/performance',
  ],
  [
    'React first',
    'Declarative series and hooks; realtime updates never re-render React.',
    '/packages/react',
  ],
  [
    'Complete interface',
    'Header, drawing sidebar, legend, context menus, settings — all optional.',
    '/packages/ui',
  ],
  [
    'Indicators',
    'Incremental calculation, own panes, levels and fills, realtime updates.',
    '/reference/indicators',
  ],
  [
    'Drawing tools',
    'Lines, channels, Fibonacci, Gann, pitchforks, positions, text, with undo/redo.',
    '/reference/drawing-tools',
  ],
  [
    'Datafeeds',
    'History, realtime and paging from REST, WebSocket, SSE or your own source.',
    '/packages/datafeed',
  ],
  [
    'Persistence',
    'Autosaved layouts and workspaces in localStorage, IndexedDB or your server.',
    '/packages/persistence',
  ],
  [
    'Languages and RTL',
    'English, Persian and Arabic built in, mirrored interface, local digits.',
    '/packages/i18n',
  ],
  [
    'Server rendering',
    'Every entry is SSR-safe; static SVG charts; Next.js App Router example.',
    '/guides/ssr',
  ],
] as const;

export default function Home() {
  return (
    <div className="home">
      <section className="hero">
        <p className="eyebrow">Free and open source · MIT</p>
        <h1 className="hero-title">Professional financial charts for React and TypeScript</h1>
        <p className="hero-lead">
          Candlesticks, indicators, drawing tools, realtime datafeeds, saved layouts and a complete,
          translatable chart interface. No application, no licence key, no fees: install it and
          build.
        </p>
        <div className="hero-actions">
          <Link to="/getting-started" className="button primary">
            Get started
          </Link>
          <Link to="/examples" className="button">
            Live examples
          </Link>
          <Link to="/builder" className="button">
            Chart builder
          </Link>
        </div>
        <Code
          language="sh"
          title="install"
          code="npm install @market-chart/react @market-chart/ui"
        />
      </section>

      <Example
        title="Try it"
        description="Everything below is live: change the symbol or timeframe, add indicators, draw, right-click, open Settings. Data is synthetic."
        sources={[
          { file: 'FullInterface.tsx', code: fullInterfaceSource },
          { file: 'useTradingChart.ts', code: hookSource },
        ]}
      >
        <FullInterface height={600} />
      </Example>

      <section className="stats" aria-label="In numbers">
        {STATS.map(([value, label, to]) => (
          <Link key={label} to={to} className="stat">
            <span className="stat-value">{value}</span>
            <span className="stat-label">{label}</span>
          </Link>
        ))}
      </section>

      <h2 id="features">What is included</h2>
      <div className="cards">
        {FEATURES.map(([title, text, to]) => (
          <Link key={title} to={to} className="card">
            <h3>{title}</h3>
            <p>{text}</p>
          </Link>
        ))}
      </div>

      <h2 id="packages">Packages</h2>
      <p>
        Install only what you use. Every package is tree-shakable, ships ESM and CJS, and has types.
      </p>
      <div className="cards packages">
        {PACKAGES.map(([name, summary]) => (
          <Link key={name} to={`/packages/${name}`} className="card">
            <h3>
              <code>@market-chart/{name}</code>
            </h3>
            <p>{summary}</p>
          </Link>
        ))}
      </div>

      <h2 id="honest-data">Honest data</h2>
      <p>
        market-chart draws the data you give it. It does not provide market data, and every example
        on this site uses synthetic prices generated in your browser. Nothing here is financial
        advice.
      </p>
    </div>
  );
}
