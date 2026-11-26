import type { ChartApi } from '@market-chart/core';
import { CandlestickSeries, Chart, HistogramSeries } from '@market-chart/react';
import { syntheticBars, volumeOf } from '../data';
import { useTheme } from '../site';

const bars = syntheticBars('BTCUSDT', 500);
const volume = volumeOf(bars);
const volumeOptions = {
  priceScaleId: 'volume',
  priceFormat: { type: 'volume' as const },
  lastValueVisible: false,
  priceLineVisible: false,
};

// Volume uses its own overlay scale, squeezed into the bottom 20% of the pane.
const onReady = (chart: ChartApi) =>
  chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

export default function QuickStart() {
  const theme = useTheme();
  return (
    <Chart height={380} theme={theme} onReady={onReady}>
      <CandlestickSeries data={bars} />
      <HistogramSeries data={volume} options={volumeOptions} />
    </Chart>
  );
}
