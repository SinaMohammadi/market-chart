import { useState } from 'react';
import type { SeriesApi } from '@market-chart/core';
import { CandlestickSeries, Chart } from '@market-chart/react';
import { Indicator } from '@market-chart/indicators/react';
import { syntheticBars } from '../data';
import { useTheme } from '../site';

const bars = syntheticBars('EXAMPLE', 600);

/** Any built-in indicator by type, with its default parameters (overlay or own pane). */
export default function IndicatorPreview({ type }: { type: string }) {
  const theme = useTheme();
  const [candles, setCandles] = useState<SeriesApi<'candlestick'> | null>(null);
  return (
    <Chart height={380} theme={theme}>
      <CandlestickSeries data={bars} ref={setCandles} />
      <Indicator key={type} type={type} source={candles} />
    </Chart>
  );
}
