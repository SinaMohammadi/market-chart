import { createDigitLocalizer, createPriceFormatter } from '@market-chart/core';
import type { PriceFormat, SeriesApi } from '@market-chart/core';
import type { IndicatorHandle } from '@market-chart/indicators';
import type { ChartUi } from './chart-ui.js';
import { mainSeries } from './builtins/helpers.js';
import { previousPoint } from './markers.js';
import type { LegendField } from './preferences.js';

/** One labelled value of the legend (`O 1512.30`, `Vol 1.2K`, a date…). */
export interface LegendItem {
  readonly key: LegendField | string;
  /** Short translated label (`O`, `H`…); empty for dates and times. */
  readonly label: string;
  readonly text: string;
  /** Raw number (prices, volume, timestamp in ms), for custom renderers. */
  readonly value: number | null;
  /** `up` / `down` for values that follow the bar's direction (OHLC, change). */
  readonly trend?: 'up' | 'down' | 'flat';
  readonly color?: string;
}

export interface LegendIndicatorRow {
  readonly indicator: IndicatorHandle;
  readonly label: string;
  readonly visible: boolean;
  readonly items: readonly LegendItem[];
}

export interface LegendData {
  /** Bar time shown (hovered bar, or the last bar when the crosshair is away), or null without data. */
  readonly time: number | null;
  /** True when the values follow the crosshair, false when they show the last bar. */
  readonly hovered: boolean;
  /** Main series title (series `title`, the application's symbol, or the series type). */
  readonly title: string;
  readonly series: SeriesApi | null;
  /** Date, time and timestamp items (each one only when enabled). */
  readonly timeItems: readonly LegendItem[];
  /** OHLC, change and volume items (each one only when enabled and available). */
  readonly items: readonly LegendItem[];
  readonly indicators: readonly LegendIndicatorRow[];
}

type Point = Readonly<Record<string, number>>;

const isVolumeSeries = (s: SeriesApi): boolean => s.options().priceFormat.type === 'volume';

function colorOf(series: SeriesApi): string | undefined {
  const o = series.options() as { color?: unknown; lineColor?: unknown; upColor?: unknown };
  const c = o.color ?? o.lineColor ?? o.upColor;
  return typeof c === 'string' ? c : undefined;
}

/** The legend uses the language's digits exactly when the chart axes do (Settings → local digits). */
const localDigits = (ui: ChartUi): boolean =>
  ui.preferences.get().localDigits && ui.i18n.numerals === 'native';

/** Latin digits for Intl formatting unless the user asked for local digits. */
const numerals = (ui: ChartUi): { numberingSystem?: string } =>
  localDigits(ui) ? {} : { numberingSystem: 'latn' };

/** Formats prices with the series' format and, when the user wants them, the language's digits. */
function priceFormatter(ui: ChartUi, format: PriceFormat): (v: number) => string {
  const base = createPriceFormatter(format);
  const localize = localDigits(ui) ? createDigitLocalizer(ui.i18n.formatLocale) : null;
  return localize ? (v) => localize(base(v)) : base;
}

function dateText(ui: ChartUi, time: number, base: Intl.DateTimeFormatOptions): string {
  const options = { ...base, ...numerals(ui) };
  const zone = ui.chart.options().localization.timeZone;
  const timeZone = zone === 'local' ? undefined : zone;
  try {
    return ui.i18n.formatDate(time, timeZone ? { ...options, timeZone } : options);
  } catch {
    return ui.i18n.formatDate(time, options);
  }
}

/**
 * Legend values at `time` (the hovered bar) or at the last bar: date, time and timestamp, open, high, low,
 * close, change and volume of the main series, and the value of every indicator output. Only fields enabled
 * in the user's legend preferences are returned, already formatted for the current language.
 */
export function legendData(ui: ChartUi, hoveredTime: number | null = null): LegendData {
  const prefs = ui.preferences.get().legend;
  const fields = prefs.fields;
  const t = ui.i18n.t.bind(ui.i18n);
  const context = ui.context();
  const series = mainSeries(context) ?? null;
  const indicators = ui.capabilities.indicators;
  const symbol = ui.capabilities.symbol?.value();
  const title = series
    ? series.options().title || symbol || t(`chartType.${series.type}`)
    : (symbol ?? '');
  const last = series?.lastPoint() as Point | undefined;
  const time = hoveredTime ?? (last ? last['time']! : null);
  const empty: LegendData = {
    time,
    hovered: hoveredTime !== null,
    title,
    series,
    timeItems: [],
    items: [],
    indicators: [],
  };
  if (!series || time === null) return empty;

  const timeItems: LegendItem[] = [];
  if (fields.date)
    timeItems.push({
      key: 'date',
      label: '',
      text: dateText(ui, time, { dateStyle: 'medium' }),
      value: time,
    });
  if (fields.time)
    timeItems.push({
      key: 'time',
      label: '',
      text: dateText(ui, time, { timeStyle: 'short' }),
      value: time,
    });
  if (fields.timestamp)
    timeItems.push({
      key: 'timestamp',
      label: t('legend.timestampShort'),
      text: ui.i18n.formatNumber(time, { useGrouping: false, ...numerals(ui) }),
      value: time,
    });

  const items: LegendItem[] = [];
  const point = series.dataAt(time) as Point | undefined;
  const price = priceFormatter(ui, series.options().priceFormat);
  if (point) {
    const open = point['open'];
    const close = point['close'] ?? point['value'];
    const trend: LegendItem['trend'] =
      open === undefined || close === undefined
        ? undefined
        : close > open
          ? 'up'
          : close < open
            ? 'down'
            : 'flat';
    const add = (key: 'open' | 'high' | 'low' | 'close', short: string) => {
      const v = point[key];
      if (fields[key] && typeof v === 'number' && !Number.isNaN(v))
        items.push({ key, label: t(short), text: price(v), value: v, trend });
    };
    add('open', 'legend.o');
    add('high', 'legend.h');
    add('low', 'legend.l');
    add('close', 'legend.c');
    if (fields.close && point['close'] === undefined && typeof point['value'] === 'number')
      items.push({ key: 'close', label: '', text: price(point['value']), value: point['value'] });
    if (fields.change && typeof close === 'number') {
      const prev = previousPoint(series, ui.chart, time);
      const before = prev ? (prev['close'] ?? prev['value']) : undefined;
      if (typeof before === 'number' && before !== 0) {
        const diff = close - before;
        const pct = (diff / Math.abs(before)) * 100;
        const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
        const pctText = ui.i18n.formatNumber(Math.abs(pct), {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          ...numerals(ui),
        });
        items.push({
          key: 'change',
          label: '',
          text: `${sign}${price(Math.abs(diff))} (${sign}${pctText}%)`,
          value: diff,
          trend: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
        });
      }
    }
  }
  if (fields.volume) {
    // Volume on the bar itself, or a separate volume histogram (priceFormat `volume`).
    let volume = point?.['volume'];
    let format: PriceFormat = { type: 'volume' };
    if (typeof volume !== 'number') {
      const vs = ui.chart.series().find((s) => s !== series && isVolumeSeries(s));
      const vp = vs?.dataAt(time) as Point | undefined;
      volume = vp?.['value'];
      if (vs) format = vs.options().priceFormat;
    }
    if (typeof volume === 'number' && !Number.isNaN(volume))
      items.push({
        key: 'volume',
        label: t('legend.vol'),
        text: priceFormatter(ui, format)(volume),
        value: volume,
      });
  }

  const rows: LegendIndicatorRow[] = [];
  if (fields.indicators && indicators) {
    for (const handle of indicators.list()) {
      const values = handle.visible() ? handle.valuesAt(time) : {};
      const outputs = handle.series();
      const rowItems: LegendItem[] = [];
      for (const [id, s] of outputs) {
        const v = values[id];
        if (typeof v !== 'number' || Number.isNaN(v)) continue;
        const color = colorOf(s);
        rowItems.push({
          key: id,
          label: '',
          text: priceFormatter(ui, s.options().priceFormat)(v),
          value: v,
          ...(color ? { color } : {}),
        });
      }
      rows.push({
        indicator: handle,
        label: handle.label(),
        visible: handle.visible(),
        items: rowItems,
      });
    }
  }
  return { ...empty, timeItems, items, indicators: rows };
}
