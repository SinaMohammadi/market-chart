import { useEffect, useMemo, useState } from 'react';
import type { SeriesApi } from '@market-chart/core';
import { CandlestickSeries, Chart, HistogramSeries } from '@market-chart/react';
import { LEGEND_FIELDS, MARKER_FIELDS, UiPreferencesStore } from '@market-chart/ui';
import type { UiPreferences } from '@market-chart/ui';
import { ChartInterface } from '@market-chart/ui/react';
import { syntheticBars, volumeOf } from '../data';
import { useTheme } from '../site';
import { useTradingChart } from './useTradingChart';

const bars = syntheticBars('ETHUSDT', 500);
const volume = volumeOf(bars);
const volumeOptions = {
  priceScaleId: 'volume',
  priceFormat: { type: 'volume' as const },
  lastValueVisible: false,
  priceLineVisible: false,
};

/**
 * The legend shows the hovered bar's date, time, timestamp, open, high, low, close, change and volume, plus
 * every indicator's values with buttons for settings, visibility and removal. Price labels mark the visible
 * high and low and the previous close. Both are user preferences: the checkboxes below call
 * `preferences.update(…)`, exactly what Settings → Legend and price labels does.
 */
export default function LegendMarkers() {
  const theme = useTheme();
  const preferences = useMemo(
    () =>
      new UiPreferencesStore({
        defaults: {
          legend: { fields: { timestamp: true } },
          markers: { highLow: true, previousClose: true },
        },
      }),
    [],
  );
  const [prefs, setPrefs] = useState<UiPreferences>(preferences.get());
  useEffect(() => preferences.on('change', ({ preferences: p }) => setPrefs(p)), [preferences]);
  const { chart, setChart, ui, indicators } = useTradingChart({ preferences });
  const [candles, setCandles] = useState<SeriesApi<'candlestick'> | null>(null);

  useEffect(() => {
    if (!chart || !indicators || !candles || indicators.list().length) return;
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    indicators.add('bollinger', candles);
    indicators.add('macd', candles);
  }, [chart, indicators, candles]);

  return (
    <>
      <fieldset className="demo-fields">
        <legend>Legend</legend>
        {LEGEND_FIELDS.map((field) => (
          <label key={field}>
            <input
              type="checkbox"
              checked={prefs.legend.fields[field]}
              onChange={(e) =>
                preferences.update({ legend: { fields: { [field]: e.target.checked } } })
              }
            />
            {field}
          </label>
        ))}
      </fieldset>
      <fieldset className="demo-fields">
        <legend>Price labels</legend>
        {MARKER_FIELDS.map((field) => (
          <label key={field}>
            <input
              type="checkbox"
              checked={prefs.markers[field]}
              onChange={(e) => preferences.update({ markers: { [field]: e.target.checked } })}
            />
            {field}
          </label>
        ))}
      </fieldset>
      <ChartInterface ui={ui} height={520} header={false}>
        <Chart ref={setChart} theme={theme} height="100%">
          <CandlestickSeries data={bars} ref={setCandles} />
          <HistogramSeries data={volume} options={volumeOptions} />
        </Chart>
      </ChartInterface>
    </>
  );
}
