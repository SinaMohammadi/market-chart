import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { AdvancedExample } from './examples/Advanced';
import { BasicExample } from './examples/Basic';
import { ChartTypesExample } from './examples/ChartTypes';
import { DatafeedExample } from './examples/Datafeed';
import { I18nExample } from './examples/I18n';
import {
  ContextMenuExample,
  RtlExample,
  ToolbarsExample,
  UiSettingsExample,
} from './examples/UiDemos';
import { UiIntegratedExample } from './examples/UiIntegrated';
import { DrawingsExample } from './examples/Drawings';
import { LayoutsExample } from './examples/Layouts';
import { OrderFlowExample } from './examples/OrderFlow';
import { PersistenceExample } from './examples/Persistence';
import { IndicatorsExample } from './examples/Indicators';
import { LargeDataExample } from './examples/LargeData';
import { PluginExample } from './examples/Plugin';
import { ProEngineExample } from './examples/ProEngine';
import { RealtimeExample } from './examples/Realtime';
import { SeriesTypesExample } from './examples/SeriesTypes';
import { StaticExample } from './examples/Static';
import { ThemesExample } from './examples/Themes';
import { TradingExample } from './examples/Trading';

interface Example {
  id: string;
  title: string;
  description: string;
  component: ComponentType;
}

const examples: Example[] = [
  {
    id: 'basic',
    title: 'Basic candlestick',
    description:
      'A candlestick series with a DOM legend fed by the crosshair. Drag to pan, wheel to zoom.',
    component: BasicExample,
  },
  {
    id: 'advanced',
    title: 'Advanced chart',
    description:
      'Candles, volume on an overlay scale, two moving averages and an RSI pane, all indicators computed by @market-chart/indicators.',
    component: AdvancedExample,
  },
  {
    id: 'ui-integrated',
    title: 'Complete interface',
    description:
      'Header, sidebar, context menus, settings, language and a datafeed together; indicators, drawings and interface preferences are saved with the layout (reload to see them restored).',
    component: UiIntegratedExample,
  },
  {
    id: 'trading',
    title: 'Symbols, price actions & orders (simulated)',
    description:
      'SIMULATED: symbol search (dropdown + dialog over 5,000 generated symbols), price actions (right-click, the + by the price label, Alt+B/Alt+S/Alt+A), the order ticket, and orders, a position with TP/SL, an alert and a marker drawn by @market-chart/trading. Drag, cancel, right-click. Add 1,000 orders to check panning.',
    component: TradingExample,
  },
  {
    id: 'i18n',
    title: 'Languages & formatting',
    description:
      'Typed translations with plurals and interpolation, English fallback, a custom language, switching without reload, and locale digits/dates on the chart axes.',
    component: I18nExample,
  },
  {
    id: 'rtl',
    title: 'Persian RTL chart',
    description:
      'The complete interface in Persian: mirrored header, sidebar, menus and dialogs; Persian digits on the axes.',
    component: RtlExample,
  },
  {
    id: 'context-menu',
    title: 'Context menus',
    description:
      'Target-specific actions for the chart, candles, indicators, drawings, handles, panes and axes; custom and plugin actions; a custom renderer on the headless hook.',
    component: ContextMenuExample,
  },
  {
    id: 'toolbars',
    title: 'Header & sidebar',
    description:
      'Configurable header sections with a custom component and action, responsive overflow, and the sidebar in expanded, collapsed, floating or hidden mode at either side.',
    component: ToolbarsExample,
  },
  {
    id: 'ui-settings',
    title: 'Settings & action management',
    description:
      'Show, hide, reorder and move actions, choose language, density and shortcuts; saved to localStorage with export/import.',
    component: UiSettingsExample,
  },
  {
    id: 'datafeed',
    title: 'Datafeeds',
    description:
      'A synthetic datafeed behind the Datafeed contract (simulated latency, deterministic unlimited history, realtime updates): switch symbols and intervals, scroll left to page in older history, or import your own CSV/JSON file.',
    component: DatafeedExample,
  },
  {
    id: 'persistence',
    title: 'Persistence',
    description:
      'Indicators, drawings, theme and visible range autosaved (debounced) to localStorage, sessionStorage, IndexedDB or memory, with save status, JSON export/import, named workspaces and cross-tab sync (open a second tab).',
    component: PersistenceExample,
  },
  {
    id: 'layouts',
    title: 'Multi-chart layouts',
    description:
      'ChartLayout presets from 1 to 12 charts with synchronised crosshair and time range (by time, so different symbols stay aligned), linked intervals and optionally linked symbols.',
    component: LayoutsExample,
  },
  {
    id: 'chart-types',
    title: 'Advanced chart types',
    description:
      'Heikin-Ashi, Renko, Line Break, Kagi, Point & Figure, range bars, hollow and volume candles, and a spread chart from @market-chart/charts. Kagi, P&F, hollow and volume candles use the new custom-series API.',
    component: ChartTypesExample,
  },
  {
    id: 'order-flow',
    title: 'Profiles & order flow',
    description:
      'Volume profiles (visible, session, fixed range), market profile (TPO), footprint with delta and CVD from trades, and a liquidity heatmap from order books.',
    component: OrderFlowExample,
  },
  {
    id: 'drawings',
    title: 'Drawing tools',
    description:
      '35 drawing tools from @market-chart/drawing-tools with selection, dragging, handles, magnet, undo/redo, copy/paste, locking, grouping, z-order and JSON save/load. The toolbar is app code built on the headless useDrawingToolbar hook.',
    component: DrawingsExample,
  },
  {
    id: 'indicators',
    title: 'Indicators',
    description:
      '44 built-in indicators from @market-chart/indicators. Add, configure (form generated from each input schema), hide and remove them; start the simulated feed to see incremental updates; save and restore the configuration as JSON.',
    component: IndicatorsExample,
  },
  {
    id: 'pro',
    title: 'Pro engine',
    description:
      'Left and right price scales, collision-free value labels, resizable panes, kinetic scrolling, keyboard navigation and crosshair sync between two charts.',
    component: ProEngineExample,
  },
  {
    id: 'realtime',
    title: 'Realtime (simulated)',
    description:
      'A local tick simulator streams updates through series.update(). No network and no real prices.',
    component: RealtimeExample,
  },
  {
    id: 'types',
    title: 'Series types & scales',
    description: 'All series types, price-scale modes, inversion and crosshair modes.',
    component: SeriesTypesExample,
  },
  {
    id: 'themes',
    title: 'Themes',
    description: 'Built-in dark and light themes plus a custom theme created with createTheme().',
    component: ThemesExample,
  },
  {
    id: 'plugin',
    title: 'Custom plugin',
    description:
      'Plugins with render layers, event subscriptions and dependencies, cleaned up automatically on removal.',
    component: PluginExample,
  },
  {
    id: 'static',
    title: 'SSR StaticChart',
    description:
      'Server-renderable SVG charts from @market-chart/react/ssr — used here client-side for preview.',
    component: StaticExample,
  },
  {
    id: 'large',
    title: 'Performance',
    description:
      'Load 100K–1M synthetic candles and measure on this machine with the real canvas: setData, first frame, pan and zoom frame times, and sustained realtime throughput with and without indicators.',
    component: LargeDataExample,
  },
];

function currentId(): string {
  const hash = window.location.hash.slice(1);
  return examples.some((e) => e.id === hash) ? hash : examples[0]!.id;
}

export function App() {
  const [id, setId] = useState(currentId);
  useEffect(() => {
    const onHash = () => setId(currentId());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const example = examples.find((e) => e.id === id)!;
  const Component = example.component;
  return (
    <div className="layout">
      <nav className="nav" aria-label="Examples">
        <h1>market-chart</h1>
        <p>Playground · all data is synthetic</p>
        {examples.map((e) => (
          <button
            key={e.id}
            aria-current={e.id === id ? 'page' : undefined}
            onClick={() => (window.location.hash = e.id)}
          >
            {e.title}
          </button>
        ))}
      </nav>
      <main className="main">
        <h2>{example.title}</h2>
        <p className="desc">{example.description}</p>
        <Component key={example.id} />
      </main>
    </div>
  );
}
