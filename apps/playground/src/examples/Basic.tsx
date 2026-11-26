import { useState } from 'react';
import { CandlestickSeries, Chart } from '@market-chart/react';
import type { SeriesApi } from '@market-chart/core';
import { syntheticBars } from '../data';
import { Legend } from '../Legend';

const options = { timeScale: { rightOffset: 8 } };

export function BasicExample() {
  const bars = syntheticBars('BTCUSDT', 2_000);
  const [series, setSeries] = useState<SeriesApi<'candlestick'> | null>(null);
  return (
    <div className="card">
      <Chart height={520} options={options}>
        <CandlestickSeries data={bars} ref={setSeries} />
        <Legend symbol="BTCUSDT · 1h" series={series} />
      </Chart>
    </div>
  );
}
