import { useEffect, useMemo, useState } from 'react';
import { CandlestickSeries, Chart, HistogramSeries, LineSeries } from '@market-chart/react';
import type { ChartApi, ChartOptionsInput } from '@market-chart/core';
import { Indicator } from '@market-chart/indicators/react';
import type { SeriesApi } from '@market-chart/core';
import { syntheticBars, volume } from '../data';

const topOptions: ChartOptionsInput = {
  leftPriceScale: { scaleMargins: { top: 0.15, bottom: 0.15 } },
  ariaLabel: 'Synthetic BTCUSDT with ETHUSDT on the left scale',
};
const bottomOptions: ChartOptionsInput = { ariaLabel: 'Synthetic ETHUSDT' };
const ethOnLeft = {
  priceScaleId: 'left',
  color: '#7e57c2',
  lineWidth: 2,
  title: 'ETHUSDT',
  priceLineVisible: false,
};
const sma20 = { length: 20 };
const sma50 = { length: 50 };
const sma20Style = {
  outputs: { ma: { color: '#f5a623', lineWidth: 1 } },
  valueLabelsVisible: true,
};
const sma50Style = {
  outputs: { ma: { color: '#29b6f6', lineWidth: 1 } },
  valueLabelsVisible: true,
};
const volumePane = {
  pane: 1,
  priceFormat: { type: 'volume' as const },
  lastValueVisible: true,
  priceLineVisible: false,
};

/**
 * Two charts with crosshairs kept in sync through the public `setCrosshairPosition` API.
 * Only pointer-driven events are forwarded (`source === 'pointer'`), which avoids feedback loops.
 */
function useCrosshairSync(a: ChartApi | null, b: ChartApi | null, enabled: boolean): void {
  useEffect(() => {
    if (!a || !b || !enabled) return;
    const link = (from: ChartApi, to: ChartApi) =>
      from.on('crosshairMove', (e) => {
        if (e.source !== 'pointer') return;
        if (e.time === null) to.clearCrosshair();
        else to.setCrosshairPosition(e.time);
      });
    const offs = [link(a, b), link(b, a)];
    return () => offs.forEach((off) => off());
  }, [a, b, enabled]);
}

export function ProEngineExample() {
  const btc = syntheticBars('BTCUSDT', 1_200);
  const eth = syntheticBars('ETHUSDT', 1_200);
  const derived = useMemo(
    () => ({
      ethLine: eth.map((b) => ({ time: b.time, value: b.close })),
      vol: volume(btc),
    }),
    [btc, eth],
  );
  const [top, setTop] = useState<ChartApi | null>(null);
  const [btcSeries, setBtcSeries] = useState<SeriesApi<'candlestick'> | null>(null);
  const [bottom, setBottom] = useState<ChartApi | null>(null);
  const [sync, setSync] = useState(true);
  const [kineticMouse, setKineticMouse] = useState(false);
  useCrosshairSync(top, bottom, sync);

  useEffect(() => {
    for (const chart of [top, bottom])
      chart?.applyOptions({ interaction: { kineticScroll: { mouse: kineticMouse } } });
  }, [top, bottom, kineticMouse]);

  return (
    <>
      <div className="toolbar">
        <button aria-pressed={sync} onClick={() => setSync((v) => !v)}>
          crosshair sync
        </button>
        <button aria-pressed={kineticMouse} onClick={() => setKineticMouse((v) => !v)}>
          kinetic mouse scroll
        </button>
        <span className="desc" style={{ margin: 0 }}>
          Drag the line between the price and volume panes to resize them. Click a chart, then use
          ←/→ (Shift for 10 bars), +/−, Home/End, Esc. On touch devices, long-press to show the
          crosshair.
        </span>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <Chart
          height={460}
          options={topOptions}
          ref={setTop}
          onReady={(c) => c.panes()[0]?.setStretchFactor(3)}
        >
          <CandlestickSeries data={btc} ref={setBtcSeries} />
          <LineSeries data={derived.ethLine} options={ethOnLeft} />
          <Indicator type="sma" source={btcSeries} params={sma20} style={sma20Style} />
          <Indicator type="sma" source={btcSeries} params={sma50} style={sma50Style} />
          <HistogramSeries data={derived.vol} options={volumePane} />
        </Chart>
      </div>
      <div className="card">
        <Chart height={220} options={bottomOptions} ref={setBottom}>
          <CandlestickSeries data={eth} />
        </Chart>
      </div>
      <p className="desc" style={{ marginTop: 10 }}>
        BTCUSDT uses the right scale; ETHUSDT is on the left scale. The last-value labels of the
        candles and both moving averages are placed so they do not overlap. All data is synthetic.
      </p>
    </>
  );
}
