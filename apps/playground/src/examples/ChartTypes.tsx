import { useEffect, useState } from 'react';
import { Chart } from '@market-chart/react';
import type { ChartApi } from '@market-chart/core';
import {
  addHollowCandleSeries,
  addKagiSeries,
  addPointFigureSeries,
  addVolumeCandleSeries,
  heikinAshi,
  lineBreak,
  rangeBars,
  renko,
  spread,
} from '@market-chart/charts';
import { syntheticBars } from '../data';

const TYPES = {
  'heikin-ashi': 'Heikin-Ashi',
  renko: 'Renko (ATR box)',
  'line-break': 'Three Line Break',
  kagi: 'Kagi (1 % reversal)',
  'point-figure': 'Point & Figure (3-box)',
  'range-bars': 'Range bars',
  hollow: 'Hollow candles',
  'volume-candles': 'Volume candles',
  spread: 'Spread ETH / BTC (ratio)',
} as const;

type TypeId = keyof typeof TYPES;

/** Builds the selected chart type imperatively on the chart and returns a cleanup. */
function show(chart: ChartApi, type: TypeId): () => void {
  const bars = syntheticBars('BTCUSDT', 1_500);
  const created = [] as ReturnType<ChartApi['series']>[number][];
  const candles = (data: Parameters<ReturnType<ChartApi['addSeries']>['setData']>[0]) => {
    const s = chart.addSeries('candlestick', { priceLineVisible: false });
    s.setData(data as never);
    created.push(s);
  };
  switch (type) {
    case 'heikin-ashi':
      candles(heikinAshi(bars));
      break;
    case 'renko':
      candles(renko(bars, { boxSize: { atr: 14 } }));
      break;
    case 'line-break':
      candles(lineBreak(bars, { lines: 3 }));
      break;
    case 'range-bars':
      candles(rangeBars(bars, { range: 150 }));
      break;
    case 'kagi': {
      const k = addKagiSeries(chart, { reversal: 0.01, mode: 'percent' });
      k.setData(bars);
      created.push(k.series);
      break;
    }
    case 'point-figure': {
      const pf = addPointFigureSeries(chart, { boxSize: { atr: 14 }, reversal: 3 });
      pf.setData(bars);
      created.push(pf.series);
      break;
    }
    case 'hollow': {
      const s = addHollowCandleSeries(chart);
      s.setData(bars);
      created.push(s);
      break;
    }
    case 'volume-candles': {
      const s = addVolumeCandleSeries(chart);
      s.setData(bars);
      created.push(s);
      break;
    }
    case 'spread': {
      const s = chart.addSeries('line', {
        priceFormat: { type: 'price', precision: 5, minMove: 0.00001 },
      });
      s.setData(spread(syntheticBars('ETHUSDT', 1_500), bars, 'ratio'));
      created.push(s);
      break;
    }
  }
  chart.timeScale().fitContent();
  return () => {
    for (const s of created)
      if (!chart.destroyed && chart.series().includes(s)) chart.removeSeries(s);
  };
}

export function ChartTypesExample() {
  const [chart, setChart] = useState<ChartApi | null>(null);
  const [type, setType] = useState<TypeId>('renko');
  useEffect(() => (chart ? show(chart, type) : undefined), [chart, type]);
  return (
    <>
      <div className="toolbar">
        {(Object.keys(TYPES) as TypeId[]).map((t) => (
          <button key={t} aria-pressed={t === type} onClick={() => setType(t)}>
            {TYPES[t]}
          </button>
        ))}
      </div>
      <div className="card">
        <Chart height={540} ref={setChart} />
      </div>
      <p className="desc" style={{ marginTop: 10 }}>
        Renko, Line Break, Kagi and Point & Figure are time-independent: each brick, line or column
        is placed at the time of the bar that formed it (+1 ms when one bar forms several). Range
        bars here are built from OHLC bars, which assumes an intrabar path (exact with tick data).
        All data is synthetic.
      </p>
    </>
  );
}
