// Server rendering of every client component in plain Node (no DOM): it must not throw, must not touch
// storage or the network, and must produce stable markup that hydration can match.
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  CandlestickSeries,
  Chart,
  ChartLayout,
  ChartProvider,
  HistogramSeries,
  ProgressiveChart,
} from '@market-chart/react';
import { StaticChart } from '@market-chart/react/ssr';
import { Indicator } from '@market-chart/indicators/react';
import { createSyntheticDatafeed } from '@market-chart/datafeed';
import { DatafeedSeries } from '@market-chart/datafeed/react';
import { createLocalStorage } from '@market-chart/persistence';
import { useChartPersistence } from '@market-chart/persistence/react';
import { HOUR, generateBars } from '@market-chart/testing';

const bars = generateBars({ count: 200, interval: HOUR, seed: 5 });
const line = bars.map((b) => ({ time: b.time, value: b.close }));

function Persist() {
  // A storage adapter is created during render: it must stay lazy on the server.
  useChartPersistence({ id: 'ssr', storage: createLocalStorage() });
  return null;
}

function App() {
  const feed = createSyntheticDatafeed({ now: () => Date.UTC(2024, 0, 10) });
  return (
    <ChartProvider>
      <Chart height={320} theme="dark" chartId="main">
        <CandlestickSeries data={bars} />
        <HistogramSeries data={line} options={{ priceScaleId: 'volume' }} />
        <Indicator type="rsi" source={null} />
        <DatafeedSeries datafeed={feed} symbol="SYN:BTCUSD" interval="1h" />
        <Persist />
      </Chart>
      <ChartLayout layout="2h" height={300}>
        {() => <CandlestickSeries data={bars} />}
      </ChartLayout>
      <ProgressiveChart type="area" data={line} height={180} title="Preview" />
      <StaticChart type="candlestick" data={bars} height={120} title="Static" />
    </ChartProvider>
  );
}

describe('server rendering', () => {
  it('renders all client components without a DOM', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    const html = renderToString(<App />);
    // Interactive charts render sized placeholders only; the engine starts after mount.
    expect(html).toContain('height:320px');
    expect(html).not.toContain('<canvas');
    // The progressive chart and the static chart render meaningful SVG on the server.
    expect(html).toContain('data-chart-state="static"');
    expect((html.match(/<svg/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-label="Preview"');
  });

  it('is deterministic, so hydration can match it', () => {
    expect(renderToString(<App />)).toBe(renderToString(<App />));
  });
});
