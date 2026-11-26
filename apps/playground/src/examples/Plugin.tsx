import { useEffect, useState } from 'react';
import { CandlestickSeries, Chart, useChart } from '@market-chart/react';
import type { ChartPlugin } from '@market-chart/core';
import { syntheticBars } from '../data';

/** Watermark drawn below the series. */
function watermark(text: string): ChartPlugin {
  return {
    id: 'example/watermark',
    version: '1.0.0',
    install(ctx) {
      ctx.addPaneLayer({
        zOrder: 'below',
        draw({ ctx: c, pixelRatio, width, height }) {
          c.font = `600 ${Math.round(48 * pixelRatio)}px system-ui, sans-serif`;
          c.fillStyle = 'rgba(128, 128, 140, 0.12)';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(text, (width / 2) * pixelRatio, (height / 2) * pixelRatio);
        },
      });
    },
  };
}

/** Marks the highest high and lowest low of the visible range, recomputed on scroll/zoom. */
const visibleExtremes: ChartPlugin = {
  id: 'example/visible-extremes',
  version: '1.0.0',
  dependencies: ['example/watermark'],
  install(ctx) {
    let extremes: { high: number; low: number } | null = null;
    const recompute = () => {
      const series = ctx.chart.series()[0];
      const range = ctx.chart.timeScale().getVisibleRange();
      if (!series || series.type !== 'candlestick' || !range) return;
      let high = -Infinity;
      let low = Infinity;
      // series.data() copies; fine for a demo, a production plugin would cache per data change.
      for (const bar of series.data() as { time: number; high: number; low: number }[]) {
        if (bar.time < range.from || bar.time > range.to) continue;
        high = Math.max(high, bar.high);
        low = Math.min(low, bar.low);
      }
      extremes = high >= low ? { high, low } : null;
    };
    ctx.on('visibleRangeChange', () => {
      recompute();
      ctx.requestRedraw();
    });
    ctx.on('dataChanged', recompute);
    recompute();
    ctx.addPaneLayer({
      zOrder: 'above',
      draw({ ctx: c, pixelRatio, width, priceToY }) {
        if (!extremes) return;
        for (const [value, color] of [
          [extremes.high, '#26a69a'],
          [extremes.low, '#ef5350'],
        ] as const) {
          const y = priceToY(value);
          if (y === null) continue;
          c.fillStyle = color;
          c.fillRect(
            0,
            Math.round(y * pixelRatio),
            width * pixelRatio,
            Math.max(1, Math.floor(pixelRatio)),
          );
          c.font = `${11 * pixelRatio}px system-ui, sans-serif`;
          c.textBaseline = value === extremes.high ? 'bottom' : 'top';
          c.fillText(
            `${value === extremes.high ? 'visible high' : 'visible low'} ${value.toFixed(2)}`,
            8 * pixelRatio,
            y * pixelRatio + (value === extremes.high ? -3 : 3) * pixelRatio,
          );
        }
      },
    });
  },
};

function Plugins({ enabled }: { enabled: boolean }) {
  const chart = useChart();
  useEffect(() => {
    if (!chart || !enabled) return;
    chart.use(watermark('market-chart'));
    chart.use(visibleExtremes);
    return () => {
      if (chart.destroyed) return;
      chart.removePlugin(visibleExtremes.id);
      chart.removePlugin('example/watermark');
    };
  }, [chart, enabled]);
  return null;
}

export function PluginExample() {
  const bars = syntheticBars('XAGUSD', 1_500);
  const [enabled, setEnabled] = useState(true);
  return (
    <>
      <div className="toolbar">
        <button aria-pressed={enabled} onClick={() => setEnabled((v) => !v)}>
          {enabled ? 'Uninstall plugins' : 'Install plugins'}
        </button>
        <span className="desc" style={{ margin: 0 }}>
          Two plugins built only on the public plugin API: a watermark layer and a visible-range
          high/low overlay (which declares a dependency on the first).
        </span>
      </div>
      <div className="card">
        <Chart height={500}>
          <CandlestickSeries data={bars} />
          <Plugins enabled={enabled} />
        </Chart>
      </div>
    </>
  );
}
