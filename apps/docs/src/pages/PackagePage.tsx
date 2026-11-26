import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Code } from '../components/Code';
import { Example } from '../components/Example';
import { Markdown } from '../components/Markdown';
import { PACKAGES, readme } from '../pages';
import type { PackageName } from '../pages';
import { Link, useRoute } from '../site';
import ChartTypes from '../demos/ChartTypes';
import chartTypesSource from '../demos/ChartTypes.tsx?raw';
import Drawings from '../demos/Drawings';
import drawingsSource from '../demos/Drawings.tsx?raw';
import FullInterface from '../demos/FullInterface';
import fullInterfaceSource from '../demos/FullInterface.tsx?raw';
import IndicatorPreview from '../demos/IndicatorPreview';
import indicatorPreviewSource from '../demos/IndicatorPreview.tsx?raw';
import Languages from '../demos/Languages';
import languagesSource from '../demos/Languages.tsx?raw';
import LegendMarkers from '../demos/LegendMarkers';
import legendMarkersSource from '../demos/LegendMarkers.tsx?raw';
import Persistence from '../demos/Persistence';
import persistenceSource from '../demos/Persistence.tsx?raw';
import QuickStart from '../demos/QuickStart';
import quickStartSource from '../demos/QuickStart.tsx?raw';
import Realtime from '../demos/Realtime';
import realtimeSource from '../demos/Realtime.tsx?raw';
import SeriesTypes from '../demos/SeriesTypes';
import seriesTypesSource from '../demos/SeriesTypes.tsx?raw';
import hookSource from '../demos/useTradingChart.ts?raw';
import TradingObjects from '../demos/TradingObjects';
import tradingObjectsSource from '../demos/TradingObjects.tsx?raw';
import simulatedSource from '../demos/simulated.ts?raw';

type Loader = () => Promise<Record<string, unknown>>;

/** Entry points of each package, imported at runtime to list what they really export. */
const ENTRIES: Record<PackageName, readonly (readonly [string, Loader])[]> = {
  core: [
    ['@market-chart/core', () => import('@market-chart/core')],
    ['@market-chart/core/static', () => import('@market-chart/core/static')],
  ],
  react: [
    ['@market-chart/react', () => import('@market-chart/react')],
    ['@market-chart/react/ssr', () => import('@market-chart/react/ssr')],
  ],
  indicators: [
    ['@market-chart/indicators', () => import('@market-chart/indicators')],
    ['@market-chart/indicators/react', () => import('@market-chart/indicators/react')],
  ],
  'drawing-tools': [
    ['@market-chart/drawing-tools', () => import('@market-chart/drawing-tools')],
    ['@market-chart/drawing-tools/react', () => import('@market-chart/drawing-tools/react')],
  ],
  charts: [['@market-chart/charts', () => import('@market-chart/charts')]],
  datafeed: [
    ['@market-chart/datafeed', () => import('@market-chart/datafeed')],
    ['@market-chart/datafeed/react', () => import('@market-chart/datafeed/react')],
  ],
  persistence: [
    ['@market-chart/persistence', () => import('@market-chart/persistence')],
    ['@market-chart/persistence/react', () => import('@market-chart/persistence/react')],
  ],
  i18n: [['@market-chart/i18n', () => import('@market-chart/i18n')]],
  ui: [
    ['@market-chart/ui', () => import('@market-chart/ui')],
    ['@market-chart/ui/react', () => import('@market-chart/ui/react')],
  ],
  trading: [
    ['@market-chart/trading', () => import('@market-chart/trading')],
    ['@market-chart/trading/react', () => import('@market-chart/trading/react')],
  ],
  testing: [['@market-chart/testing', () => import('@market-chart/testing')]],
};

const hook = { file: 'useTradingChart.ts', code: hookSource };

/** Live examples shown at the top of each package page. */
const DEMOS: Partial<Record<PackageName, () => ReactNode>> = {
  trading: () => (
    <Example
      title="Orders and positions (simulated)"
      description="Drag a line to modify it, × to cancel, right-click for the order menu. A simulated in-memory broker answers; nothing is sent anywhere."
      sources={[
        { file: 'TradingObjects.tsx', code: tradingObjectsSource },
        { file: 'simulated.ts', code: simulatedSource },
        hook,
      ]}
    >
      <TradingObjects />
    </Example>
  ),
  core: () => (
    <Example
      title="Series types"
      description="The engine draws candlesticks, bars, lines, areas, baselines and histograms on Canvas 2D."
      sources={[{ file: 'SeriesTypes.tsx', code: seriesTypesSource }]}
    >
      <SeriesTypes />
    </Example>
  ),
  react: () => (
    <Example
      title="A chart in React"
      description="Components declare the series; data updates call series.update() instead of re-rendering."
      sources={[{ file: 'QuickStart.tsx', code: quickStartSource }]}
    >
      <QuickStart />
    </Example>
  ),
  indicators: () => (
    <Example
      title="An indicator"
      description={
        <>
          Any built-in by type. Browse and preview all of them in the{' '}
          <Link to="/reference/indicators">indicator reference</Link>.
        </>
      }
      sources={[{ file: 'IndicatorPreview.tsx', code: indicatorPreviewSource }]}
    >
      <IndicatorPreview type="macd" />
    </Example>
  ),
  'drawing-tools': () => (
    <Example
      title="Drawing on the chart"
      description="Pick a tool and click on the chart. Drag handles to edit; Delete removes the selection."
      sources={[{ file: 'Drawings.tsx', code: drawingsSource }]}
    >
      <Drawings />
    </Example>
  ),
  charts: () => (
    <Example title="Chart types" sources={[{ file: 'ChartTypes.tsx', code: chartTypesSource }]}>
      <ChartTypes />
    </Example>
  ),
  datafeed: () => (
    <Example title="Realtime datafeed" sources={[{ file: 'Realtime.tsx', code: realtimeSource }]}>
      <Realtime />
    </Example>
  ),
  persistence: () => (
    <Example
      title="Saved layouts"
      description="Add indicators and drawings or change settings, then reload the page."
      sources={[{ file: 'Persistence.tsx', code: persistenceSource }, hook]}
    >
      <Persistence />
    </Example>
  ),
  i18n: () => (
    <Example
      title="Languages and right-to-left"
      sources={[{ file: 'Languages.tsx', code: languagesSource }, hook]}
    >
      <Languages />
    </Example>
  ),
  ui: () => (
    <>
      <Example
        title="The complete interface"
        description="Right-click candles, indicators, drawings, axes or the background. Everything is configurable in Settings."
        sources={[{ file: 'FullInterface.tsx', code: fullInterfaceSource }, hook]}
      >
        <FullInterface />
      </Example>
      <Example
        title="Legend and price labels"
        sources={[{ file: 'LegendMarkers.tsx', code: legendMarkersSource }, hook]}
      >
        <LegendMarkers />
      </Example>
    </>
  ),
};

interface ExportGroup {
  readonly entry: string;
  readonly groups: readonly (readonly [string, readonly string[]])[];
}

function classify(name: string, value: unknown): string {
  if (typeof value === 'function') {
    if (/^use[A-Z]/.test(name)) return 'Hooks';
    if (/^class[\s{]/.test(Function.prototype.toString.call(value))) return 'Classes';
    if (/^[A-Z]/.test(name)) return 'Components and constructors';
    return 'Functions';
  }
  if (value && typeof value === 'object') return 'Objects and namespaces';
  return 'Constants';
}

function useExports(name: PackageName): readonly ExportGroup[] | null {
  const [groups, setGroups] = useState<readonly ExportGroup[] | null>(null);
  useEffect(() => {
    let live = true;
    setGroups(null);
    void Promise.all(
      ENTRIES[name].map(async ([entry, load]) => {
        const mod = await load();
        const by = new Map<string, string[]>();
        for (const key of Object.keys(mod).sort()) {
          const kind = classify(key, mod[key]);
          by.set(kind, [...(by.get(kind) ?? []), key]);
        }
        return { entry, groups: [...by.entries()] };
      }),
    ).then((result) => live && setGroups(result));
    return () => {
      live = false;
    };
  }, [name]);
  return groups;
}

export default function PackagePage() {
  const { path } = useRoute();
  const name = path.replace('/packages/', '') as PackageName;
  const [text, setText] = useState<string | null>(null);
  const exports = useExports(name);
  useEffect(() => {
    let live = true;
    setText(null);
    void readme(name).then((t) => live && setText(t));
    return () => {
      live = false;
    };
  }, [name]);
  if (!PACKAGES.some(([n]) => n === name)) return <p>Unknown package.</p>;
  const demo = DEMOS[name];
  return (
    <>
      <Code language="sh" title="install" code={`npm install @market-chart/${name}`} />
      {demo ? (
        <>
          <h2 id="live-example">Live example</h2>
          {demo()}
        </>
      ) : null}
      <h2 id="guide">Guide</h2>
      <p className="muted">
        From the package README (<code>packages/{name}/README.md</code>).
      </p>
      {text === null ? <p className="muted">Loading…</p> : <Markdown source={text} />}
      <h2 id="exports">Exports</h2>
      <p className="muted">
        Read from the package at runtime, so this list is always complete. Types are listed in the
        README and in the package's <code>.d.ts</code> files.
      </p>
      {exports === null ? (
        <p className="muted">Loading…</p>
      ) : (
        exports.map(({ entry, groups }) => (
          <div key={entry} className="exports">
            <h3 id={`exports-${entry.replace(/[^a-z]+/g, '-')}`}>
              <code>{entry}</code>
            </h3>
            {groups.map(([kind, names]) => (
              <div key={kind} className="exports-group">
                <span className="exports-kind">
                  {kind} <span className="badge">{names.length}</span>
                </span>
                <div className="chips">
                  {names.map((n) => (
                    <code key={n} className="chip">
                      {n}
                    </code>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </>
  );
}
