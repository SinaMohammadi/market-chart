import { useMemo, useState } from 'react';
import { CandlestickSeries, Chart, HistogramSeries } from '@market-chart/react';
import type { ChartApi, SeriesApi } from '@market-chart/core';
import { Indicator } from '@market-chart/indicators/react';
import type { IndicatorHandle } from '@market-chart/indicators';
import { syntheticBars, volume } from '../data';
import { Legend } from '../Legend';

const volumeOptions = {
  priceScaleId: 'volume',
  priceFormat: { type: 'volume' as const },
  lastValueVisible: false,
};
const chartOptions = { crosshair: { mode: 'magnet' as const } };
const fast = { length: 20 };
const slow = { length: 50 };
const slowStyle = { outputs: { ma: { color: '#ab47bc', lineWidth: 1 } } };
const fastStyle = { outputs: { ma: { color: '#f5a623', lineWidth: 1 } } };

export function AdvancedExample() {
  const bars = syntheticBars('ETHUSDT', 3_000);
  const vol = useMemo(() => volume(bars), [bars]);
  const [candles, setCandles] = useState<SeriesApi<'candlestick'> | null>(null);
  const [fastHandle, setFast] = useState<IndicatorHandle | null>(null);
  const [slowHandle, setSlow] = useState<IndicatorHandle | null>(null);

  const onReady = (chart: ChartApi) => {
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    chart.panes()[0]?.setStretchFactor(3);
  };

  return (
    <div className="card">
      <Chart height={600} onReady={onReady} options={chartOptions}>
        <CandlestickSeries data={bars} ref={setCandles} />
        <HistogramSeries data={vol} options={volumeOptions} />
        <Indicator type="sma" source={candles} params={fast} style={fastStyle} onReady={setFast} />
        <Indicator type="sma" source={candles} params={slow} style={slowStyle} onReady={setSlow} />
        <Indicator type="rsi" source={candles} />
        <Legend
          symbol="ETHUSDT · 1h"
          series={candles}
          extra={[
            { label: 'SMA 20', series: fastHandle?.series().get('ma') ?? null, color: '#f5a623' },
            { label: 'SMA 50', series: slowHandle?.series().get('ma') ?? null, color: '#ab47bc' },
          ]}
        />
      </Chart>
    </div>
  );
}
