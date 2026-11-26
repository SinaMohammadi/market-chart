import type { PriceLineApi, SeriesApi, Unsubscribe } from '@market-chart/core';
import type { ChartUi } from './chart-ui.js';
import { mainSeries } from './builtins/helpers.js';
import type { MarkerPreferences } from './preferences.js';

type Point = Readonly<Record<string, number>>;

/** Upper bound of bars scanned for the visible high/low (the engine caps visible bars far below this). */
const MAX_SCAN = 20_000;

export interface MarkerValues {
  /** Highest high and lowest low of the visible bars of the main series. */
  readonly high: { readonly price: number; readonly time: number } | null;
  readonly low: { readonly price: number; readonly time: number } | null;
  /** Close of the bar before the last one. */
  readonly previousClose: number | null;
}

/** The bar before `time` on the chart's time axis (skipping a few gaps), or undefined. */
export function previousPoint(
  series: SeriesApi,
  chart: ChartUi['chart'],
  time: number,
): Point | undefined {
  const scale = chart.timeScale();
  const logical = scale.timeToLogical(time);
  if (logical === null) return undefined;
  for (let i = Math.round(logical) - 1, tries = 0; i >= 0 && tries < 8; i--, tries++) {
    const t = scale.logicalToTime(i);
    if (t === null) return undefined;
    const p = series.dataAt(t) as Point | undefined;
    if (p) return p;
  }
  return undefined;
}

/**
 * Price markers on the chart, driven by the user's preferences: visible-range high and low, previous close,
 * and switches for the last-price line and axis labels. Everything is drawn by the engine through its public
 * price-line and series-option APIs; this class only decides what to show.
 */
export class PriceMarkers {
  private readonly ui: ChartUi;
  private readonly offs: Unsubscribe[] = [];
  private lines: {
    series: SeriesApi;
    high: PriceLineApi | null;
    low: PriceLineApi | null;
    previousClose: PriceLineApi | null;
  } | null = null;
  private pending = false;
  private destroyed = false;
  private applied: Pick<MarkerPreferences, 'lastPriceLine' | 'lastValueLabel' | 'indicatorLabels'> =
    {
      lastPriceLine: true,
      lastValueLabel: true,
      indicatorLabels: true,
    };
  private _values: MarkerValues = { high: null, low: null, previousClose: null };

  constructor(ui: ChartUi) {
    this.ui = ui;
    const schedule = (): void => this.schedule();
    const chart = ui.chart;
    this.offs.push(
      chart.on('visibleRangeChange', schedule),
      chart.on('dataChanged', schedule),
      chart.on('seriesAdded', schedule),
      chart.on('seriesRemoved', schedule),
      chart.on('themeChanged', schedule),
      ui.preferences.on('change', schedule),
      ui.i18n.on('change', schedule),
    );
    this.update();
  }

  /** The values currently marked (also when the lines are switched off). */
  values(): MarkerValues {
    return this._values;
  }

  /** Re-applies the markers now (normally batched after chart changes). */
  update(): void {
    if (this.destroyed || this.ui.chart.destroyed) return;
    const prefs = this.ui.preferences.get().markers;
    const series = mainSeries(this.ui.context()) ?? null;
    if (this.lines && this.lines.series !== series) this.removeLines();
    this.applySeriesSwitches(series, prefs);
    this._values = series ? this.compute(series) : { high: null, low: null, previousClose: null };
    if (!series) return;
    if (!this.lines) this.lines = { series, high: null, low: null, previousClose: null };
    const t = this.ui.i18n.t.bind(this.ui.i18n);
    const o = series.options() as { upColor?: unknown; downColor?: unknown };
    const up = typeof o.upColor === 'string' ? o.upColor : '#26a69a';
    const down = typeof o.downColor === 'string' ? o.downColor : '#ef5350';
    const { high, low, previousClose } = this._values;
    this.lines.high = this.line(this.lines.high, prefs.highLow ? high?.price : undefined, {
      title: t('markers.high'),
      color: up,
    });
    this.lines.low = this.line(this.lines.low, prefs.highLow ? low?.price : undefined, {
      title: t('markers.low'),
      color: down,
    });
    this.lines.previousClose = this.line(
      this.lines.previousClose,
      prefs.previousClose ? (previousClose ?? undefined) : undefined,
      { title: t('markers.previousClose'), color: '#787b86' },
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.offs.splice(0)) off();
    this.removeLines();
  }

  private schedule(): void {
    if (this.pending || this.destroyed) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.update();
    });
  }

  private compute(series: SeriesApi): MarkerValues {
    const scale = this.ui.chart.timeScale();
    let high: MarkerValues['high'] = null;
    let low: MarkerValues['low'] = null;
    const range = scale.getVisibleLogicalRange();
    if (range) {
      const from = Math.max(0, Math.ceil(range.from));
      const to = Math.min(Math.floor(range.to), from + MAX_SCAN);
      for (let i = from; i <= to; i++) {
        const time = scale.logicalToTime(i);
        if (time === null) continue;
        const p = series.dataAt(time) as Point | undefined;
        if (!p) continue;
        const h = p['high'] ?? p['value'];
        const l = p['low'] ?? p['value'];
        if (typeof h === 'number' && !Number.isNaN(h) && (!high || h > high.price))
          high = { price: h, time };
        if (typeof l === 'number' && !Number.isNaN(l) && (!low || l < low.price))
          low = { price: l, time };
      }
    }
    const last = series.lastPoint() as Point | undefined;
    const prev = last ? previousPoint(series, this.ui.chart, last['time']!) : undefined;
    const close = prev ? (prev['close'] ?? prev['value']) : undefined;
    return { high, low, previousClose: typeof close === 'number' ? close : null };
  }

  private line(
    current: PriceLineApi | null,
    price: number | undefined,
    style: { title: string; color: string },
  ): PriceLineApi | null {
    if (price === undefined) {
      current?.remove();
      return null;
    }
    if (current) {
      const o = current.options();
      if (o.price !== price || o.title !== style.title || o.color !== style.color)
        current.applyOptions({ price, ...style });
      return current;
    }
    return this.lines!.series.createPriceLine({
      price,
      ...style,
      lineStyle: 'dotted',
      lineWidth: 1,
      axisLabelVisible: true,
      autoscale: false,
    });
  }

  private removeLines(): void {
    if (!this.lines) return;
    this.lines.high?.remove();
    this.lines.low?.remove();
    this.lines.previousClose?.remove();
    this.lines = null;
  }

  /**
   * Series switches are applied only when the user changes them from the defaults, so an application's own
   * series options are left alone until the user asks otherwise.
   */
  private applySeriesSwitches(series: SeriesApi | null, prefs: MarkerPreferences): void {
    if (series) {
      const patch: { priceLineVisible?: boolean; lastValueVisible?: boolean } = {};
      if (prefs.lastPriceLine !== this.applied.lastPriceLine)
        patch.priceLineVisible = prefs.lastPriceLine;
      if (prefs.lastValueLabel !== this.applied.lastValueLabel)
        patch.lastValueVisible = prefs.lastValueLabel;
      if (patch.priceLineVisible !== undefined || patch.lastValueVisible !== undefined) {
        series.applyOptions(patch);
        this.applied = {
          ...this.applied,
          lastPriceLine: prefs.lastPriceLine,
          lastValueLabel: prefs.lastValueLabel,
        };
      }
    }
    const indicators = this.ui.capabilities.indicators;
    if (!indicators) return;
    // New indicators need the setting too while labels are switched off.
    if (prefs.indicatorLabels !== this.applied.indicatorLabels || !prefs.indicatorLabels) {
      for (const handle of indicators.list())
        for (const s of handle.series().values())
          if (s.options().lastValueVisible !== prefs.indicatorLabels)
            s.applyOptions({ lastValueVisible: prefs.indicatorLabels });
      this.applied = { ...this.applied, indicatorLabels: prefs.indicatorLabels };
    }
  }
}
