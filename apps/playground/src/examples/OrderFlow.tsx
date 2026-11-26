import { useEffect, useMemo, useState } from 'react';
import { Chart } from '@market-chart/react';
import type { ChartApi } from '@market-chart/core';
import {
  addFootprintSeries,
  addHeatmapSeries,
  addMarketProfile,
  addVolumeProfile,
  aggregateFootprint,
  cumulativeVolumeDelta,
  deltaHistogram,
} from '@market-chart/charts';
import type { Trade } from '@market-chart/charts';
import { MINUTE, generateBars, generateOrderBooks, generateTrades } from '@market-chart/testing';

const VIEWS = {
  'vp-visible': 'Volume profile · visible range',
  'vp-session': 'Volume profile · sessions',
  'vp-fixed': 'Volume profile · fixed range',
  tpo: 'Market profile (TPO)',
  footprint: 'Footprint + delta + CVD',
  heatmap: 'Liquidity heatmap',
} as const;
type ViewId = keyof typeof VIEWS;

const FIVE = 5 * MINUTE;

function build(chart: ChartApi, view: ViewId, data: ReturnType<typeof useData>): () => void {
  const cleanups: (() => void)[] = [];
  const candles = () => {
    const s = chart.addSeries('candlestick');
    s.setData(data.bars);
    cleanups.push(() => chart.removeSeries(s));
    return s;
  };
  switch (view) {
    case 'vp-visible':
    case 'vp-session':
    case 'vp-fixed': {
      const s = candles();
      const mode = view === 'vp-visible' ? 'visible' : view === 'vp-session' ? 'session' : 'fixed';
      const vp = addVolumeProfile(chart, s, {
        mode,
        rows: mode === 'visible' ? 48 : 24,
        from: data.bars[data.bars.length - 160]!.time,
        to: data.bars[data.bars.length - 60]!.time,
        trades: data.trades,
      });
      cleanups.push(() => vp.remove());
      break;
    }
    case 'tpo': {
      const s = candles();
      const tpo = addMarketProfile(chart, s, { periodMinutes: 30 });
      cleanups.push(() => tpo.remove());
      chart
        .timeScale()
        .setVisibleLogicalRange({ from: data.bars.length - 300, to: data.bars.length });
      return () => cleanups.forEach((c) => c());
    }
    case 'footprint': {
      const fp = addFootprintSeries(chart, { tickSize: data.tick });
      fp.setData(data.footprint);
      const delta = chart.addSeries('histogram', {
        pane: 1,
        title: 'Delta',
        priceFormat: { type: 'volume' },
      });
      delta.setData(deltaHistogram(data.footprint));
      const cvd = chart.addSeries('candlestick', {
        pane: 2,
        title: 'CVD',
        priceFormat: { type: 'volume' },
      });
      cvd.setData(cumulativeVolumeDelta(data.recentTrades, { interval: FIVE }));
      chart.panes()[0]?.setStretchFactor(3);
      cleanups.push(() => [fp.series, delta, cvd].forEach((x) => chart.removeSeries(x)));
      chart
        .timeScale()
        .setVisibleLogicalRange({ from: data.footprint.length - 12, to: data.footprint.length });
      return () => cleanups.forEach((c) => c());
    }
    case 'heatmap': {
      const heat = addHeatmapSeries(chart, { priceStep: data.tick });
      heat.setData(data.books);
      cleanups.push(() => chart.removeSeries(heat.series));
      break;
    }
  }
  chart.timeScale().fitContent();
  return () => cleanups.forEach((c) => c());
}

/** Synthetic 5-minute bars, trades consistent with them, and order books around their closes. */
function useData() {
  return useMemo(() => {
    const bars = generateBars({
      count: 864,
      interval: FIVE,
      startPrice: 2_000,
      volatility: 0.0025,
      seed: 31,
      baseVolume: 400,
    });
    const tick = 0.5;
    const trades = generateTrades(bars, {
      interval: FIVE,
      tradesPerBar: 60,
      tickSize: tick,
    }) as Trade[];
    const recent = bars.slice(-120);
    const recentTrades = trades.filter((t) => t.time >= recent[0]!.time);
    const footprint = aggregateFootprint(recentTrades, { interval: FIVE, tickSize: tick * 2 });
    const books = generateOrderBooks(
      recent.map((b) => ({ time: b.time, price: b.close })),
      { tickSize: tick, levels: 40, baseSize: 5 },
    );
    return { bars, trades, recentTrades, footprint, books, tick: tick * 2 };
  }, []);
}

export function OrderFlowExample() {
  const [chart, setChart] = useState<ChartApi | null>(null);
  const [view, setView] = useState<ViewId>('vp-visible');
  const data = useData();
  useEffect(() => (chart ? build(chart, view, data) : undefined), [chart, view, data]);
  return (
    <>
      <div className="toolbar">
        {(Object.keys(VIEWS) as ViewId[]).map((v) => (
          <button key={v} aria-pressed={v === view} onClick={() => setView(v)}>
            {VIEWS[v]}
          </button>
        ))}
      </div>
      <div className="card">
        <Chart height={600} ref={setChart} />
      </div>
      <p className="desc" style={{ marginTop: 10 }}>
        Profiles here use the synthetic trades for an exact buy/sell split (with only OHLCV bars,
        each bar&apos;s volume is spread over its range). Footprint cells show bid × ask when bars
        are wide; diagonal imbalances (≥ 3×) are coloured and each bar&apos;s point of control is
        outlined. Trades and order books are synthetic.
      </p>
    </>
  );
}
