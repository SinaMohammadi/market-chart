import { useState } from 'react';
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  Chart,
  HistogramSeries,
  LineSeries,
} from '@market-chart/react';
import { closes, syntheticBars } from '../data';
import { useTheme } from '../site';

const bars = syntheticBars('ETHUSDT', 300);
const line = closes(bars);
const TYPES = ['candlestick', 'bar', 'line', 'area', 'baseline', 'histogram'] as const;

export default function SeriesTypes() {
  const theme = useTheme();
  const [type, setType] = useState<(typeof TYPES)[number]>('candlestick');
  return (
    <>
      <div className="demo-toolbar" role="group" aria-label="Series type">
        {TYPES.map((t) => (
          <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
            {t}
          </button>
        ))}
      </div>
      <Chart height={340} theme={theme}>
        {type === 'candlestick' ? <CandlestickSeries data={bars} /> : null}
        {type === 'bar' ? <BarSeries data={bars} /> : null}
        {type === 'line' ? <LineSeries data={line} /> : null}
        {type === 'area' ? <AreaSeries data={line} /> : null}
        {type === 'baseline' ? (
          <BaselineSeries data={line} options={{ baseValue: line[0]!.value }} />
        ) : null}
        {type === 'histogram' ? <HistogramSeries data={line} /> : null}
      </Chart>
    </>
  );
}
