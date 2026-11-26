import { useState } from 'react';
import { Code } from '../components/Code';
import { Example } from '../components/Example';
import QuickStart from '../demos/QuickStart';
import quickStartSource from '../demos/QuickStart.tsx?raw';
import FullInterface from '../demos/FullInterface';
import fullInterfaceSource from '../demos/FullInterface.tsx?raw';
import hookSource from '../demos/useTradingChart.ts?raw';
import { Link } from '../site';

const MANAGERS = {
  npm: 'npm install',
  pnpm: 'pnpm add',
  yarn: 'yarn add',
} as const;

const VANILLA = `import { createChart } from '@market-chart/core';

const chart = createChart(document.getElementById('chart')!, { theme: 'dark' });
const candles = chart.addSeries('candlestick');
candles.setData(bars); // [{ time, open, high, low, close }], time in UTC milliseconds

// Realtime: replace the forming bar or append a new one.
candles.update({ time, open, high, low, close });

chart.on('crosshairMove', ({ time, seriesData }) => {
  const bar = seriesData.get(candles);
});`;

const INDICATORS = `import { getIndicatorManager } from '@market-chart/indicators';

const indicators = getIndicatorManager(chart);
const rsi = indicators.add('rsi', candles, { params: { length: 14 } });
indicators.add('bollinger', candles);
rsi.setParams({ length: 21 });   // recalculated in place`;

export default function GettingStarted() {
  const [manager, setManager] = useState<keyof typeof MANAGERS>('npm');
  return (
    <>
      <h2 id="requirements">Requirements</h2>
      <ul>
        <li>A modern browser (the engine renders with Canvas 2D).</li>
        <li>React 18 or 19 for the React packages. The engine itself has no dependencies.</li>
        <li>TypeScript is optional; every package ships its types.</li>
      </ul>

      <h2 id="install">Install</h2>
      <div className="tabs" role="tablist" aria-label="Package manager">
        {(Object.keys(MANAGERS) as (keyof typeof MANAGERS)[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={manager === m}
            className="tab"
            onClick={() => setManager(m)}
          >
            {m}
          </button>
        ))}
      </div>
      <Code
        language="sh"
        title="the engine and React bindings"
        code={`${MANAGERS[manager]} @market-chart/core @market-chart/react`}
      />
      <p>Add only the features you use:</p>
      <Code
        language="sh"
        title="optional packages"
        code={`${MANAGERS[manager]} @market-chart/indicators @market-chart/drawing-tools @market-chart/ui`}
      />

      <h2 id="first-chart">Your first chart</h2>
      <p>
        A <code>&lt;Chart&gt;</code> holds series components. Data is an array of bars with{' '}
        <code>time</code> in UTC milliseconds. The chart sizes itself to its container&apos;s width.
      </p>
      <Example
        title="Candles and volume"
        sources={[{ file: 'QuickStart.tsx', code: quickStartSource }]}
      >
        <QuickStart />
      </Example>

      <h2 id="interface">Add the complete interface</h2>
      <p>
        <code>@market-chart/ui</code> wraps the chart with a header, a drawing sidebar, a legend,
        context menus and settings. It uses the drawing and indicator managers, so everything the
        user does is available to your code too.
      </p>
      <Example
        title="Chart interface"
        sources={[
          { file: 'FullInterface.tsx', code: fullInterfaceSource },
          { file: 'useTradingChart.ts', code: hookSource },
        ]}
      >
        <FullInterface height={520} />
      </Example>

      <h2 id="vanilla">Without React</h2>
      <p>The engine works with any framework, or none:</p>
      <Code code={VANILLA} language="ts" title="vanilla.ts" />

      <h2 id="indicators">Indicators from code</h2>
      <Code code={INDICATORS} language="ts" title="indicators.ts" />

      <h2 id="next">Next steps</h2>
      <ul>
        <li>
          <Link to="/builder">Chart builder</Link>: pick options and copy the generated code.
        </li>
        <li>
          <Link to="/packages/datafeed">Datafeeds</Link>: connect history and realtime data.
        </li>
        <li>
          <Link to="/packages/persistence">Persistence</Link>: save layouts automatically.
        </li>
        <li>
          <Link to="/packages/i18n">Languages</Link>: Persian, Arabic, right-to-left and your own
          languages.
        </li>
        <li>
          <Link to="/guides/ssr">Server rendering</Link>: Next.js App Router.
        </li>
      </ul>
    </>
  );
}
