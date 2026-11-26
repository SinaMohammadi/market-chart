import { EventEmitter } from '@market-chart/core';
import type {
  ChartApi,
  DataChangedEvent,
  LineStyle,
  OhlcBar,
  PaneLayerDrawContext,
  PriceLineApi,
  SeriesApi,
  SeriesColumns,
  SeriesData,
  SeriesType,
  Unsubscribe,
} from '@market-chart/core';
import { indicatorLabel, resolveParams } from '../params.js';
import { createDefaultRegistry } from '../builtins.js';
import type { IndicatorRegistry } from '../registry.js';
import type { IndicatorResult } from '../runner.js';
import { IndicatorRunner } from '../runner.js';
import type { Bar, IndicatorDefinition, OutputSpec } from '../types.js';
import { IndicatorError } from '../types.js';

export interface OutputStyle {
  color?: string;
  colorNegative?: string;
  lineWidth?: number;
  lineStyle?: LineStyle;
  visible?: boolean;
}

/** Plain-JSON visual settings of an indicator instance. */
export interface IndicatorStyle {
  outputs?: Readonly<Record<string, OutputStyle>>;
  fillsVisible?: boolean;
  levelsVisible?: boolean;
  levelColor?: string;
  /** Last-value labels on the price axis. Default: on for pane indicators, off for overlays. */
  valueLabelsVisible?: boolean;
}

export interface AddIndicatorOptions {
  params?: Readonly<Record<string, unknown>>;
  style?: IndicatorStyle;
  visible?: boolean;
  /** Stable id (for persistence). Generated when omitted. */
  id?: string;
}

/** Serialisable description of an indicator instance (see `IndicatorManager.serialize`). */
export interface IndicatorConfig {
  readonly id: string;
  readonly type: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly style: IndicatorStyle;
  readonly visible: boolean;
  /** Id of the source series at serialisation time; map it back in `restore`. */
  readonly sourceSeriesId: string;
}

export interface IndicatorHandle {
  readonly id: string;
  readonly type: string;
  readonly definition: IndicatorDefinition;
  readonly source: SeriesApi;
  readonly removed: boolean;
  /** Legend label, e.g. `RSI 14 close`. */
  label(): string;
  params(): Readonly<Record<string, unknown>>;
  /** Validates and applies new parameters, then recomputes everything. */
  setParams(patch: Readonly<Record<string, unknown>>): void;
  style(): IndicatorStyle;
  setStyle(patch: IndicatorStyle): void;
  visible(): boolean;
  setVisible(visible: boolean): void;
  /** Output id → series that plots it. */
  series(): ReadonlyMap<string, SeriesApi>;
  /** Pane index of the indicator's outputs. */
  pane(): number;
  /** Moves all outputs to another pane (`'new'` adds a pane below). Not part of `config()`. */
  moveToPane(target: number | 'new'): void;
  /** Raw computed columns (index-aligned with the source bars). */
  result(): IndicatorResult;
  /** Values plotted at `time` per output id (null where there is no value). */
  valuesAt(time: number): Readonly<Record<string, number | null>>;
  config(): IndicatorConfig;
  remove(): void;
}

export interface IndicatorManagerEvents {
  added: { readonly indicator: IndicatorHandle };
  removed: { readonly id: string };
  changed: { readonly indicator: IndicatorHandle };
  error: { readonly error: unknown; readonly id?: string };
}

const DEFAULT_INTERVAL = 60_000;

function toBar(point: SeriesData<SeriesType>): Bar | null {
  const p = point as Partial<OhlcBar> & { time: number; value?: number };
  if (typeof p.open === 'number') {
    return {
      time: p.time,
      open: p.open,
      high: p.high!,
      low: p.low!,
      close: p.close!,
      volume: p.volume ?? Number.NaN,
    };
  }
  if (typeof p.value === 'number' && Number.isFinite(p.value)) {
    return {
      time: p.time,
      open: p.value,
      high: p.value,
      low: p.value,
      close: p.value,
      volume: Number.NaN,
    };
  }
  return null; // whitespace
}

/**
 * Bars from a series' columns (OHLC, or `value` used as all four prices). Whitespace points (NaN) are skipped.
 * Reading columns avoids materialising one object per point twice, which dominated recalculation on large series.
 */
function barsFromColumns(columns: SeriesColumns): Bar[] {
  const { length, times, fields } = columns;
  const open = fields['open'];
  const high = fields['high'];
  const low = fields['low'];
  const close = fields['close'];
  const volume = fields['volume'];
  const value = fields['value'];
  const bars: Bar[] = [];
  for (let i = 0; i < length; i++) {
    const time = times[i]!;
    if (open && high && low && close) {
      const o = open[i]!;
      if (!Number.isFinite(o)) continue;
      bars.push({
        time,
        open: o,
        high: high[i]!,
        low: low[i]!,
        close: close[i]!,
        volume: volume ? volume[i]! : Number.NaN,
      });
    } else if (value) {
      const v = value[i]!;
      if (Number.isFinite(v))
        bars.push({ time, open: v, high: v, low: v, close: v, volume: Number.NaN });
    }
  }
  return bars;
}

/** Colour choice of a histogram column: by sign, by bar direction, or by change from the previous value. */
function histogramPositive(
  output: OutputSpec,
  value: number,
  index: number,
  column: Float64Array,
  barUp: Uint8Array,
): boolean {
  switch (output.colorMode ?? 'sign') {
    case 'bar':
      return barUp[index] === 1;
    case 'change': {
      const prev = index > 0 ? column[index - 1]! : Number.NaN;
      return !Number.isFinite(prev) || value >= prev;
    }
    default:
      return value >= 0;
  }
}

function lowerBound(times: Float64Array, length: number, target: number): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

let instanceCounter = 0;

class IndicatorInstance implements IndicatorHandle {
  readonly id: string;
  readonly definition: IndicatorDefinition;
  readonly source: SeriesApi;
  private runner: IndicatorRunner;
  private _style: IndicatorStyle;
  private _visible: boolean;
  private _removed = false;
  private readonly outputSeries = new Map<string, SeriesApi>();
  private levelLines: PriceLineApi[] = [];
  private offsets: Readonly<Record<string, number>> = {};
  private readonly pluginId: string;
  /** Source length after the last sync, to tell ticks (same length) from new bars (+1). */
  private knownSourceLength = 0;

  constructor(
    private readonly manager: IndicatorManager,
    private readonly chart: ChartApi,
    definition: IndicatorDefinition,
    source: SeriesApi,
    options: AddIndicatorOptions,
  ) {
    this.id = options.id ?? `ind-${++instanceCounter}`;
    this.definition = definition;
    this.source = source;
    this.runner = new IndicatorRunner(definition, options.params);
    this._style = sanitizeStyle(options.style ?? {}, definition);
    this._visible = options.visible ?? true;
    this.offsets = definition.offsets?.(this.runner.params) ?? {};
    this.pluginId = `market-chart/indicator-fills/${this.id}`;
    this.createSeries();
    this.installFills();
    this.recompute();
  }

  get type(): string {
    return this.definition.type;
  }

  get removed(): boolean {
    return this._removed;
  }

  label(): string {
    return indicatorLabel(this.definition, this.runner.params);
  }

  params(): Readonly<Record<string, unknown>> {
    return { ...this.runner.params };
  }

  setParams(patch: Readonly<Record<string, unknown>>): void {
    this.assertAlive();
    const next = resolveParams(this.definition, { ...this.runner.params, ...patch });
    this.runner = new IndicatorRunner(this.definition, next);
    this.offsets = this.definition.offsets?.(this.runner.params) ?? {};
    this.applyStyle();
    this.recompute();
    this.manager.notifyChanged(this);
  }

  style(): IndicatorStyle {
    return this._style;
  }

  setStyle(patch: IndicatorStyle): void {
    this.assertAlive();
    const outputs = { ...this._style.outputs };
    for (const [id, style] of Object.entries(patch.outputs ?? {}))
      outputs[id] = { ...outputs[id], ...style };
    this._style = sanitizeStyle({ ...this._style, ...patch, outputs }, this.definition);
    this.applyStyle();
    this.pushAll(); // histogram colours are baked into the data
    this.manager.notifyChanged(this);
  }

  visible(): boolean {
    return this._visible;
  }

  setVisible(visible: boolean): void {
    this.assertAlive();
    this._visible = visible;
    this.applyStyle();
    this.manager.notifyChanged(this);
  }

  /** Pane of the indicator's first output. */
  pane(): number {
    const first = this.outputSeries.values().next().value as SeriesApi | undefined;
    return first ? first.options().pane : this.source.options().pane;
  }

  moveToPane(target: number | 'new'): void {
    this.assertAlive();
    const panes = this.chart.panes().length;
    if (target !== 'new' && (!Number.isInteger(target) || target < 0 || target >= panes)) {
      throw new IndicatorError(`moveToPane() expects 'new' or a pane index from 0 to ${panes - 1}`);
    }
    const sourceOptions = this.source.options();
    let pane = target === 'new' ? panes : target;
    // On the source's pane the outputs share its scale (overlay); elsewhere they get the pane's right scale.
    const priceScaleId = pane === sourceOptions.pane ? sourceOptions.priceScaleId : 'right';
    let first = true;
    for (const series of this.outputSeries.values()) {
      series.applyOptions({ pane, priceScaleId } as never);
      // A new pane gets its index from the first series, and empty panes are compacted: follow it.
      if (first) pane = series.options().pane;
      first = false;
    }
    this.manager.notifyChanged(this);
  }

  series(): ReadonlyMap<string, SeriesApi> {
    return this.outputSeries;
  }

  result(): IndicatorResult {
    return this.runner.result();
  }

  valuesAt(time: number): Readonly<Record<string, number | null>> {
    const { times, values, length } = this.runner.result();
    let index = lowerBound(times, length, time);
    if (!(index < length && times[index] === time)) {
      index = -1;
      // Past the last bar, outputs with a positive offset are plotted on times extrapolated one bar
      // interval at a time (see `plottedTime`): invert that to find which bar a future time shows.
      if (length > 0 && time > times[length - 1]!) {
        const step = length >= 2 ? times[length - 1]! - times[length - 2]! : DEFAULT_INTERVAL;
        const ahead = (time - times[length - 1]!) / step;
        if (Number.isInteger(ahead)) index = length - 1 + ahead;
      }
    }
    const out: Record<string, number | null> = {};
    this.definition.outputs.forEach((output, o) => {
      const source = index >= 0 ? index - (this.offsets[output.id] ?? 0) : -1;
      const v = source >= 0 && source < length ? values[o]![source]! : Number.NaN;
      out[output.id] = Number.isFinite(v) ? v : null;
    });
    return out;
  }

  config(): IndicatorConfig {
    return {
      id: this.id,
      type: this.type,
      params: this.params(),
      style: JSON.parse(JSON.stringify(this._style)) as IndicatorStyle,
      visible: this._visible,
      sourceSeriesId: this.source.id,
    };
  }

  remove(): void {
    this.manager.remove(this);
  }

  /** Called by the manager. */
  dispose(): void {
    if (this._removed) return;
    this._removed = true;
    if (this.chart.destroyed) return;
    if (this.chart.hasPlugin(this.pluginId)) this.chart.removePlugin(this.pluginId);
    for (const series of this.outputSeries.values()) {
      if (this.chart.series().includes(series)) this.chart.removeSeries(series);
    }
    this.outputSeries.clear();
    this.levelLines = [];
  }

  /**
   * Reacts to a change of the source series. `update` (from the chart's `dataChanged` event) says which
   * point changed; without it only the last point is assumed to have changed.
   */
  onSourceChanged(kind: 'set' | 'update', update?: DataChangedEvent['update']): void {
    if (this._removed) return;
    if (kind === 'set') {
      this.recompute();
      return;
    }
    const lastPoint = this.source.lastPoint();
    const sourceLength = this.source.length();
    if (update && lastPoint && update.time !== lastPoint.time) {
      // An older point changed (historical correction or late insertion), not the last one: every value
      // from that bar on may be different. Recent corrections re-run only the tail.
      if (update.kind === 'replaced' && this.rewriteFrom(update.time)) return;
      this.recompute();
      return;
    }
    const bar = lastPoint ? toBar(lastPoint) : null;
    const lastTime = this.runner.lastTime;
    if (!bar) {
      // The last point is whitespace. If it replaced a value, that bar's outputs must go; a new whitespace
      // point adds no bar but must be counted, so the next value is recognised as a single new bar.
      if (lastPoint && lastTime !== undefined && lastPoint.time <= lastTime) this.recompute();
      else this.knownSourceLength = sourceLength;
      return;
    }
    if (
      lastTime !== undefined &&
      bar.time === lastTime &&
      sourceLength === this.knownSourceLength
    ) {
      this.runner.updateLast(bar);
      this.pushLast(false);
    } else if (
      (lastTime === undefined || bar.time > lastTime) &&
      (sourceLength === this.knownSourceLength + 1 ||
        // A trailing whitespace point that received a value.
        (update?.kind === 'replaced' && sourceLength === this.knownSourceLength))
    ) {
      this.runner.append(bar);
      this.knownSourceLength = sourceLength;
      this.pushLast(true);
    } else {
      // Historical correction, whitespace or out-of-order data: recompute everything.
      this.recompute();
    }
  }

  private assertAlive(): void {
    if (this._removed) throw new IndicatorError(`indicator "${this.id}" has been removed`);
  }

  private outputStyle(output: OutputSpec): Required<
    Pick<OutputStyle, 'color' | 'lineWidth' | 'lineStyle' | 'visible'>
  > & {
    colorNegative: string;
  } {
    const s = this._style.outputs?.[output.id] ?? {};
    return {
      color: s.color ?? output.color,
      colorNegative: s.colorNegative ?? output.colorNegative ?? output.color,
      lineWidth: s.lineWidth ?? output.lineWidth ?? 2,
      lineStyle: s.lineStyle ?? output.lineStyle ?? 'solid',
      visible: s.visible ?? !output.hidden,
    };
  }

  private paneAndScale(): { pane: number; priceScaleId: string } {
    if (this.definition.placement === 'overlay') {
      const o = this.source.options();
      return { pane: o.pane, priceScaleId: o.priceScaleId };
    }
    return { pane: this.chart.panes().length, priceScaleId: 'right' };
  }

  private createSeries(): void {
    const { pane, priceScaleId } = this.paneAndScale();
    const priceFormat =
      this.definition.priceFormat ??
      (this.definition.placement === 'overlay'
        ? this.source.options().priceFormat
        : { type: 'price' as const, precision: 2 });
    let targetPane = pane;
    for (const output of this.definition.outputs) {
      const style = this.outputStyle(output);
      const common = {
        pane: targetPane,
        priceScaleId,
        priceFormat,
        title: output.name,
        visible: this._visible && style.visible,
        priceLineVisible: false,
        lastValueVisible: this.valueLabelsVisible(),
      };
      const series =
        output.kind === 'histogram'
          ? this.chart.addSeries('histogram', { ...common, color: style.color, base: 0 })
          : this.chart.addSeries('line', {
              ...common,
              color: style.color,
              lineWidth: style.lineWidth,
              lineStyle: style.lineStyle,
              lineType: output.kind === 'step' ? 'step' : 'simple',
              lineVisible: output.kind !== 'dots',
              pointMarkersVisible: output.kind === 'dots',
              pointMarkersRadius: output.kind === 'dots' ? 1.5 : null,
            });
      // A new pane gets its final index from the first series; keep the rest in the same pane.
      targetPane = series.options().pane;
      this.outputSeries.set(output.id, series);
    }
    this.createLevels();
  }

  private createLevels(): void {
    const first = this.outputSeries.values().next().value as SeriesApi | undefined;
    if (!first) return;
    for (const level of this.definition.levels ?? []) {
      this.levelLines.push(
        first.createPriceLine({
          price: level.value,
          color: this._style.levelColor ?? level.color ?? 'rgba(149, 152, 161, 0.6)',
          lineStyle: 'dashed',
          lineWidth: 1,
          axisLabelVisible: false,
          lineVisible: this._visible && this._style.levelsVisible !== false,
          autoscale: true,
        }),
      );
    }
  }

  private valueLabelsVisible(): boolean {
    return this._style.valueLabelsVisible ?? this.definition.placement === 'pane';
  }

  private applyStyle(): void {
    for (const output of this.definition.outputs) {
      const series = this.outputSeries.get(output.id);
      if (!series) continue;
      const style = this.outputStyle(output);
      const visible = this._visible && style.visible;
      const lastValueVisible = this.valueLabelsVisible();
      if (output.kind === 'histogram')
        series.applyOptions({ color: style.color, visible, lastValueVisible });
      else
        series.applyOptions({
          color: style.color,
          lineWidth: style.lineWidth,
          lineStyle: style.lineStyle,
          visible,
          lastValueVisible,
        });
    }
    const levelsVisible = this._visible && this._style.levelsVisible !== false;
    this.levelLines.forEach((line, i) => {
      const level = this.definition.levels?.[i];
      line.applyOptions({
        lineVisible: levelsVisible,
        color: this._style.levelColor ?? level?.color ?? 'rgba(149, 152, 161, 0.6)',
      });
    });
  }

  private recompute(): void {
    const bars = this.manager.barsOf(this.source);
    this.runner.reset(bars);
    this.knownSourceLength = this.source.length();
    this.pushAll();
  }

  /**
   * Correction of the source bar at `time`, when it is one of the last few computed bars: re-runs only
   * the bars from there on and pushes just those points. False when a full recomputation is needed (older
   * bar, or the correction turned a value into whitespace or vice versa).
   */
  private rewriteFrom(time: number): boolean {
    const { times, length } = this.runner.result();
    const index = lowerBound(times, length, time);
    if (index >= length || times[index] !== time || !this.runner.canRewrite(index)) return false;
    const bars: Bar[] = [];
    for (let i = index; i < length; i++) {
      const point = this.source.dataAt(times[i]!);
      const bar = point ? toBar(point) : null;
      if (!bar) return false;
      bars.push(bar);
    }
    this.runner.rewrite(index, bars);
    this.definition.outputs.forEach((output, o) => {
      const series = this.outputSeries.get(output.id) as SeriesApi<'line'> | undefined;
      if (!series) return;
      for (let i = index; i < length; i++) {
        const point = this.pointFor(output, o, i);
        if (point) series.update(point);
      }
    });
    return true;
  }

  /** Time at which bar `index` is plotted for an output with `offset` (extrapolated into the future). */
  private plottedTime(index: number, offset: number): number | null {
    const { times, length } = this.runner.result();
    const target = index + offset;
    if (target < 0) return null;
    if (target < length) return times[target]!;
    if (length === 0) return null;
    const step = length >= 2 ? times[length - 1]! - times[length - 2]! : DEFAULT_INTERVAL;
    return times[length - 1]! + (target - (length - 1)) * step;
  }

  private pointFor(output: OutputSpec, o: number, index: number): SeriesData<'line'> | null {
    const { values, barUp } = this.runner.result();
    const time = this.plottedTime(index, this.offsets[output.id] ?? 0);
    if (time === null) return null;
    const value = values[o]![index]!;
    if (!Number.isFinite(value)) return { time };
    if (output.kind !== 'histogram') return { time, value };
    const style = this.outputStyle(output);
    const positive = histogramPositive(output, value, index, values[o]!, barUp);
    return { time, value, color: positive ? style.color : style.colorNegative };
  }

  /** Writes a whole output as columns (no object per point; this dominated recalculation on large series). */
  private pushOutput(output: OutputSpec, o: number): void {
    const series = this.outputSeries.get(output.id);
    if (!series) return;
    const { length, times, values, barUp } = this.runner.result();
    const offset = this.offsets[output.id] ?? 0;
    const start = Math.max(0, -offset);
    const n = Math.max(0, length - start);
    const outTimes = new Float64Array(n);
    const outValues = new Float64Array(n);
    const colors = output.kind === 'histogram' ? new Array<string | undefined>(n) : undefined;
    const column = values[o]!;
    const step = length >= 2 ? times[length - 1]! - times[length - 2]! : DEFAULT_INTERVAL;
    const style = colors ? this.outputStyle(output) : null;
    for (let i = start; i < length; i++) {
      const k = i - start;
      const target = i + offset;
      outTimes[k] =
        target < length ? times[target]! : times[length - 1]! + (target - (length - 1)) * step;
      const value = column[i]!;
      outValues[k] = value;
      if (colors && style && Number.isFinite(value)) {
        colors[k] = histogramPositive(output, value, i, column, barUp)
          ? style.color
          : style.colorNegative;
      }
    }
    series.setColumns({
      times: outTimes,
      fields: { value: outValues },
      ...(colors ? { colors } : {}),
    });
  }

  private pushAll(): void {
    this.definition.outputs.forEach((output, o) => this.pushOutput(output, o));
  }

  /** Pushes the last bar's values; `appended` means a new bar was added. */
  private pushLast(appended: boolean): void {
    const { length } = this.runner.result();
    const index = length - 1;
    this.definition.outputs.forEach((output, o) => {
      const series = this.outputSeries.get(output.id) as SeriesApi<'line'> | undefined;
      if (!series) return;
      const offset = this.offsets[output.id] ?? 0;
      if (offset > 0 && appended) {
        // Future points were extrapolated from the previous bar interval; rebuild them.
        this.pushOutput(output, o);
        return;
      }
      const point = this.pointFor(output, o, index);
      if (point) series.update(point);
      // A colour that depends on the previous value may change the next column too; nothing else moves.
    });
  }

  private installFills(): void {
    const fills = this.definition.fills ?? [];
    if (!fills.length) return;
    const first = this.outputSeries.values().next().value as SeriesApi | undefined;
    this.chart.use({
      id: this.pluginId,
      version: '1.0.0',
      install: (ctx) => {
        ctx.addPaneLayer({
          // Read lazily: pane indices change when other panes are removed.
          get pane() {
            return first ? first.options().pane : 0;
          },
          zOrder: 'below',
          draw: (c) => this.drawFills(c),
        });
      },
    });
  }

  private drawFills(c: PaneLayerDrawContext): void {
    if (!this._visible || this._style.fillsVisible === false) return;
    const { values, length } = this.runner.result();
    if (length === 0) return;
    const ids = this.definition.outputs.map((o) => o.id);
    const scaleId = this.outputSeries.values().next().value?.options().priceScaleId ?? 'right';
    const t0 = c.xToTime(0);
    const t1 = c.xToTime(c.width);
    for (const fill of this.definition.fills ?? []) {
      const a = ids.indexOf(fill.from);
      const b = ids.indexOf(fill.to);
      const offset = this.offsets[fill.from] ?? 0;
      if ((this.offsets[fill.to] ?? 0) !== offset) continue;
      // Visible bar index range (in source indices) with one bar of margin.
      let from = 0;
      let to = length - 1;
      if (t0 !== null && t1 !== null) {
        const { times } = this.runner.result();
        from = Math.max(0, lowerBound(times, length, t0) - offset - 2);
        to = Math.min(length - 1, lowerBound(times, length, t1) - offset + 1);
        if (t1 > times[length - 1]!) to = length - 1;
      }
      const pr = c.pixelRatio;
      const paths = new Map<string, number[][]>();
      for (let i = from; i < to; i++) {
        const a0 = values[a]![i]!;
        const b0 = values[b]![i]!;
        const a1 = values[a]![i + 1]!;
        const b1 = values[b]![i + 1]!;
        if (![a0, b0, a1, b1].every(Number.isFinite)) continue;
        const ta = this.plottedTime(i, offset);
        const tb = this.plottedTime(i + 1, offset);
        if (ta === null || tb === null) continue;
        const x0 = c.timeToX(ta);
        const x1 = c.timeToX(tb);
        const ya0 = c.priceToY(a0, scaleId);
        const yb0 = c.priceToY(b0, scaleId);
        const ya1 = c.priceToY(a1, scaleId);
        const yb1 = c.priceToY(b1, scaleId);
        if (
          x0 === null ||
          x1 === null ||
          ya0 === null ||
          yb0 === null ||
          ya1 === null ||
          yb1 === null
        )
          continue;
        const color = fill.colorNegative && a0 + a1 < b0 + b1 ? fill.colorNegative : fill.color;
        let list = paths.get(color);
        if (!list) paths.set(color, (list = []));
        list.push([x0 * pr, ya0 * pr, x1 * pr, ya1 * pr, x1 * pr, yb1 * pr, x0 * pr, yb0 * pr]);
      }
      for (const [color, quads] of paths) {
        c.ctx.beginPath();
        for (const q of quads) {
          c.ctx.moveTo(q[0]!, q[1]!);
          c.ctx.lineTo(q[2]!, q[3]!);
          c.ctx.lineTo(q[4]!, q[5]!);
          c.ctx.lineTo(q[6]!, q[7]!);
          c.ctx.closePath();
        }
        c.ctx.fillStyle = color;
        c.ctx.fill();
      }
    }
  }
}

/** Colours are CSS colour strings; stored styles cannot smuggle in huge strings or non-strings. */
function colorValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64)
    throw new IndicatorError(`${name} must be a colour string of at most 64 characters`);
  return value;
}

/** Default cap on how many indicators `restore()` re-creates from one (untrusted) list. */
export const MAX_RESTORED_INDICATORS = 100;

function sanitizeStyle(style: IndicatorStyle, definition: IndicatorDefinition): IndicatorStyle {
  if (style === null || typeof style !== 'object')
    throw new IndicatorError('style must be an object');
  const outputs: Record<string, OutputStyle> = {};
  const known = new Set(definition.outputs.map((o) => o.id));
  for (const [id, s] of Object.entries(style.outputs ?? {})) {
    if (!known.has(id))
      throw new IndicatorError(`style references unknown output "${id}" of "${definition.type}"`);
    const clean: OutputStyle = {};
    if (!s || typeof s !== 'object')
      throw new IndicatorError(`style of output "${id}" must be an object`);
    if (s.color !== undefined) clean.color = colorValue(s.color, 'color');
    if (s.colorNegative !== undefined)
      clean.colorNegative = colorValue(s.colorNegative, 'colorNegative');
    if (s.lineWidth !== undefined) {
      if (typeof s.lineWidth !== 'number' || !(s.lineWidth > 0) || s.lineWidth > 20)
        throw new IndicatorError('lineWidth must be in (0, 20]');
      clean.lineWidth = s.lineWidth;
    }
    if (s.lineStyle !== undefined) {
      if (!['solid', 'dashed', 'dotted'].includes(s.lineStyle))
        throw new IndicatorError('lineStyle must be solid, dashed or dotted');
      clean.lineStyle = s.lineStyle;
    }
    if (s.visible !== undefined) clean.visible = Boolean(s.visible);
    outputs[id] = clean;
  }
  const out: IndicatorStyle = { outputs };
  if (style.fillsVisible !== undefined) out.fillsVisible = Boolean(style.fillsVisible);
  if (style.levelsVisible !== undefined) out.levelsVisible = Boolean(style.levelsVisible);
  if (style.levelColor !== undefined) out.levelColor = colorValue(style.levelColor, 'levelColor');
  if (style.valueLabelsVisible !== undefined)
    out.valueLabelsVisible = Boolean(style.valueLabelsVisible);
  return out;
}

/**
 * Attaches indicators to a chart. Indicator output is plotted with ordinary series, so everything
 * (crosshair data, legends, scales, panes) works through the public chart API.
 *
 * Realtime: when the source series receives `update()`, indicators update incrementally
 * (one calculator step per tick); `setData()` triggers a full recomputation.
 */
export class IndicatorManager {
  readonly chart: ChartApi;
  readonly registry: IndicatorRegistry;
  private readonly instances = new Map<string, IndicatorInstance>();
  private readonly emitter = new EventEmitter<IndicatorManagerEvents>();
  private readonly offs: Unsubscribe[] = [];
  private destroyed = false;
  /**
   * Bars of the series whose change is being dispatched, built once and shared by every indicator on it.
   * Scoped to the dispatch, so nothing is retained afterwards.
   */
  private shared: { readonly source: SeriesApi; bars: Bar[] | null } | null = null;

  constructor(chart: ChartApi, registry: IndicatorRegistry = createDefaultRegistry()) {
    this.chart = chart;
    this.registry = registry;
    this.offs.push(
      chart.on('dataChanged', ({ series, kind, update }) => {
        // Output series changes re-enter this listener; restore the outer dispatch afterwards.
        const outer = this.shared;
        this.shared = { source: series, bars: null };
        try {
          for (const instance of this.instances.values()) {
            if (instance.source !== series) continue;
            try {
              instance.onSourceChanged(kind, update);
            } catch (error) {
              this.emitter.emit('error', { error, id: instance.id });
            }
          }
        } finally {
          this.shared = outer;
        }
      }),
      chart.on('seriesRemoved', ({ seriesId }) => {
        for (const instance of [...this.instances.values()])
          if (instance.source.id === seriesId) this.remove(instance);
      }),
      chart.on('destroy', () => this.destroy()),
    );
  }

  /**
   * @internal Bars of `source` for a full recalculation (read-only; shared within one dispatch, see `shared`).
   */
  barsOf(source: SeriesApi): readonly Bar[] {
    if (this.shared?.source === source)
      return (this.shared.bars ??= barsFromColumns(source.columns()));
    return barsFromColumns(source.columns());
  }

  on<K extends keyof IndicatorManagerEvents>(
    event: K,
    listener: (payload: IndicatorManagerEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  add(type: string, source: SeriesApi, options: AddIndicatorOptions = {}): IndicatorHandle {
    if (this.destroyed) throw new IndicatorError('indicator manager has been destroyed');
    if (!this.chart.series().includes(source))
      throw new IndicatorError('source series does not belong to this chart');
    if (options.id !== undefined && this.instances.has(options.id))
      throw new IndicatorError(`indicator id "${options.id}" is already used`);
    const definition = this.registry.get(type);
    const instance = new IndicatorInstance(this, this.chart, definition, source, options);
    this.instances.set(instance.id, instance);
    this.emitter.emit('added', { indicator: instance });
    return instance;
  }

  get(id: string): IndicatorHandle | undefined {
    return this.instances.get(id);
  }

  /** The indicator that plots `series` (one of its outputs), if any. */
  indicatorForSeries(series: SeriesApi): IndicatorHandle | undefined {
    for (const instance of this.instances.values()) {
      for (const output of instance.series().values()) if (output === series) return instance;
    }
    return undefined;
  }

  list(): IndicatorHandle[] {
    return [...this.instances.values()];
  }

  remove(indicator: IndicatorHandle | string): void {
    const id = typeof indicator === 'string' ? indicator : indicator.id;
    const instance = this.instances.get(id);
    if (!instance) return;
    this.instances.delete(id);
    instance.dispose();
    this.emitter.emit('removed', { id });
  }

  clear(): void {
    for (const id of [...this.instances.keys()]) this.remove(id);
  }

  serialize(): IndicatorConfig[] {
    return this.list().map((indicator) => indicator.config());
  }

  /**
   * Re-creates indicators from configs (e.g. loaded from storage). Every config is validated; invalid
   * ones are skipped and reported through the `error` event, so one bad entry cannot break the rest.
   * At most `options.max` (default 100) are restored: a stored list of thousands would
   * otherwise create thousands of series and freeze the page; the rest are reported as errors.
   */
  restore(
    configs: readonly IndicatorConfig[],
    resolveSource: (seriesId: string) => SeriesApi | undefined,
    options: { readonly max?: number } = {},
  ): IndicatorHandle[] {
    if (!Array.isArray(configs)) throw new IndicatorError('restore() expects an array of configs');
    const max = options.max ?? MAX_RESTORED_INDICATORS;
    if (configs.length > max) {
      this.emitter.emit('error', {
        error: new IndicatorError(
          `restore() got ${configs.length} indicators; only the first ${max} are restored`,
        ),
        id: undefined,
      });
    }
    const restored: IndicatorHandle[] = [];
    for (const config of configs.slice(0, max)) {
      try {
        if (!config || typeof config !== 'object' || typeof config.type !== 'string')
          throw new IndicatorError('invalid indicator config');
        const source = resolveSource(String(config.sourceSeriesId));
        if (!source)
          throw new IndicatorError(`source series "${String(config.sourceSeriesId)}" not found`);
        restored.push(
          this.add(config.type, source, {
            id: typeof config.id === 'string' ? config.id : undefined,
            params: config.params,
            style: config.style,
            visible: config.visible !== false,
          }),
        );
      } catch (error) {
        this.emitter.emit('error', {
          error,
          id: typeof config?.id === 'string' ? config.id : undefined,
        });
      }
    }
    return restored;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const off of this.offs.splice(0)) off();
    this.emitter.clear();
    managers.delete(this.chart);
  }

  /** @internal */
  notifyChanged(instance: IndicatorInstance): void {
    this.emitter.emit('changed', { indicator: instance });
  }
}

const managers = new WeakMap<ChartApi, IndicatorManager>();

/** The chart's shared manager (created on first use, destroyed with the chart). */
export function getIndicatorManager(
  chart: ChartApi,
  registry?: IndicatorRegistry,
): IndicatorManager {
  let manager = managers.get(chart);
  if (!manager) {
    manager = new IndicatorManager(chart, registry);
    managers.set(chart, manager);
  }
  return manager;
}
