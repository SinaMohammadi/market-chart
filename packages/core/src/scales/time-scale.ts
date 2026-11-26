import type { LogicalRange, TimeRange } from '../model/types.js';
import type { Timeline } from '../model/timeline.js';
import { clamp } from '../utils/math.js';

export interface TimeScaleOptions {
  /** Distance between bar centres in CSS pixels. */
  barSpacing: number;
  minBarSpacing: number;
  maxBarSpacing: number;
  /** Empty space (in bars) between the last bar and the right edge. */
  rightOffset: number;
  /** Prevent scrolling before the first bar. */
  fixLeftEdge: boolean;
  /** Prevent scrolling past the last bar. */
  fixRightEdge: boolean;
  /** Keep the latest bar in view when new bars arrive while it is visible. */
  shiftVisibleRangeOnNewBar: boolean;
  /** Show the time axis. */
  visible: boolean;
  /** Show hours/minutes in crosshair labels. `'auto'` decides from the data interval. */
  timeVisible: boolean | 'auto';
  secondsVisible: boolean;
}

export const defaultTimeScaleOptions: TimeScaleOptions = {
  barSpacing: 8,
  minBarSpacing: 0.5,
  maxBarSpacing: 60,
  rightOffset: 5,
  fixLeftEdge: false,
  fixRightEdge: false,
  shiftVisibleRangeOnNewBar: true,
  visible: true,
  timeVisible: 'auto',
  secondsVisible: false,
};

const MIN_VISIBLE_BARS = 2;

type PendingView = { kind: 'fit' } | { kind: 'logical'; range: LogicalRange } | null;

/**
 * Maps logical bar indices to horizontal pixel coordinates.
 *
 * State is two numbers: `barSpacing` (px per bar) and `rightOffset` (bars between the last bar
 * and the right edge). Bar `i` is centred at `x = width − (lastIndex + rightOffset − i + 0.5) · barSpacing`.
 */
export class TimeScale {
  private _options: TimeScaleOptions;
  private _width = 0;
  private _barSpacing: number;
  private _rightOffset: number;
  private _pending: PendingView = null;
  private readonly timeline: Timeline;
  private readonly onChange: () => void;

  constructor(timeline: Timeline, options: TimeScaleOptions, onChange: () => void) {
    this.timeline = timeline;
    this._options = options;
    this._barSpacing = options.barSpacing;
    this._rightOffset = options.rightOffset;
    this.onChange = onChange;
  }

  get options(): TimeScaleOptions {
    return this._options;
  }

  get width(): number {
    return this._width;
  }

  get barSpacing(): number {
    return this._barSpacing;
  }

  get rightOffset(): number {
    return this._rightOffset;
  }

  private get lastIndex(): number {
    return this.timeline.lastIndex;
  }

  applyOptions(options: TimeScaleOptions): void {
    const spacingChanged = options.barSpacing !== this._options.barSpacing;
    const offsetChanged = options.rightOffset !== this._options.rightOffset;
    this._options = options;
    if (spacingChanged) this._barSpacing = options.barSpacing;
    if (offsetChanged) this._rightOffset = options.rightOffset;
    this.constrain();
    this.onChange();
  }

  /**
   * Sets the pane width. Bar spacing and right offset are kept, so a wider pane shows more history.
   * A view requested before the width was known is applied by `applyPendingView()` once layout settles.
   */
  setWidth(width: number): void {
    if (width === this._width) return;
    this._width = Math.max(0, width);
    this.constrain();
  }

  get hasPendingView(): boolean {
    return this._pending !== null;
  }

  /** Applies a deferred `fitContent` / `setVisibleLogicalRange`. Returns true if something was applied. */
  applyPendingView(): boolean {
    if (!this._pending || this._width <= 0) return false;
    const pending = this._pending;
    this._pending = null;
    if (pending.kind === 'fit') this.fitContent();
    else this.setVisibleLogicalRange(pending.range);
    return true;
  }

  indexToX(index: number): number {
    return this._width - (this.lastIndex + this._rightOffset - index + 0.5) * this._barSpacing;
  }

  /** Fractional logical index at `x`. */
  xToLogical(x: number): number {
    return this.lastIndex + this._rightOffset + 0.5 - (this._width - x) / this._barSpacing;
  }

  /** Nearest existing bar index at `x` (clamped to data), or -1 without data. */
  xToIndex(x: number): number {
    if (this.timeline.length === 0) return -1;
    return clamp(Math.round(this.xToLogical(x)), 0, this.lastIndex);
  }

  visibleLogicalRange(): LogicalRange {
    const to = this.lastIndex + this._rightOffset + 0.5;
    return { from: to - this._width / this._barSpacing, to };
  }

  /** Integer indices of existing bars intersecting the viewport, or null. */
  visibleIndexRange(): { from: number; to: number } | null {
    if (this.timeline.length === 0 || this._width <= 0) return null;
    const range = this.visibleLogicalRange();
    const from = Math.max(0, Math.floor(range.from));
    const to = Math.min(this.lastIndex, Math.ceil(range.to));
    return from <= to ? { from, to } : null;
  }

  visibleTimeRange(): TimeRange | null {
    const range = this.visibleIndexRange();
    if (!range) return null;
    return { from: this.timeline.timeAt(range.from)!, to: this.timeline.timeAt(range.to)! };
  }

  setBarSpacing(spacing: number): void {
    this._barSpacing = spacing;
    this.constrain();
    this.onChange();
  }

  setRightOffset(offset: number): void {
    this._rightOffset = offset;
    this.constrain();
    this.onChange();
  }

  /** Scrolls by `dx` CSS pixels (positive moves content to the right, revealing history). */
  scrollBy(dx: number): void {
    if (dx === 0) return;
    this._rightOffset -= dx / this._barSpacing;
    this.constrain();
    this.onChange();
  }

  /** Multiplies bar spacing by `factor`, keeping the logical index under `anchorX` fixed. */
  zoom(anchorX: number, factor: number): void {
    if (!(factor > 0) || factor === 1) return;
    const anchor = this.xToLogical(anchorX);
    this._barSpacing = this.clampSpacing(this._barSpacing * factor);
    this._rightOffset = anchor - this.lastIndex - 0.5 + (this._width - anchorX) / this._barSpacing;
    this.constrain();
    this.onChange();
  }

  /** Shows all bars plus the configured right offset. */
  fitContent(): void {
    if (this._width <= 0) {
      this._pending = { kind: 'fit' };
      return;
    }
    const count = this.timeline.length;
    if (count === 0) return;
    this._rightOffset = this._options.rightOffset;
    this._barSpacing = this.clampSpacing(this._width / (count + this._options.rightOffset));
    this.constrain();
    this.onChange();
  }

  setVisibleLogicalRange(range: LogicalRange): void {
    if (this._width <= 0) {
      this._pending = { kind: 'logical', range };
      return;
    }
    const length = range.to - range.from;
    if (!(length > 0)) return;
    this._barSpacing = this.clampSpacing(this._width / length);
    this._rightOffset = range.to - this.lastIndex - 0.5;
    this.constrain();
    this.onChange();
  }

  setVisibleRange(range: TimeRange): void {
    const from = this.timeline.nearestIndex(range.from);
    const to = this.timeline.nearestIndex(range.to);
    if (from < 0 || to < 0) return;
    this.setVisibleLogicalRange({ from: Math.min(from, to) - 0.5, to: Math.max(from, to) + 0.5 });
  }

  /** Scrolls by a number of bars (positive reveals history). */
  scrollBars(count: number): void {
    this.scrollBy(count * this._barSpacing);
  }

  /** Shows the first bar at the left edge, keeping bar spacing. */
  scrollToStart(): void {
    if (this.timeline.length === 0 || this._width <= 0) return;
    const visibleBars = this._width / this._barSpacing;
    this.setVisibleLogicalRange({ from: -0.5, to: -0.5 + visibleBars });
  }

  scrollToRealtime(): void {
    this._rightOffset = this._options.rightOffset;
    this.constrain();
    this.onChange();
  }

  reset(): void {
    this._barSpacing = this._options.barSpacing;
    this._rightOffset = this._options.rightOffset;
    this.constrain();
    this.onChange();
  }

  /**
   * Called after the timeline changed. `anchorIndex` is the *new* index of the bar that was last
   * before the change, or -1 when there was no data or the data was replaced entirely.
   *
   * - `view` given (the latest bar was scrolled out of view): the bar that was at the right edge keeps
   *   its x. `barsFromEnd` is its distance from the last bar *before* the change, `logical` its index
   *   *after* the change. Insertions anywhere (before, inside or after the visible range) therefore leave
   *   the viewed times in place, not only appends.
   * - No anchor: start at the latest bar with default spacing.
   * - Bars appended after the anchor: keep following the latest bar if it was visible
   *   (and `shiftVisibleRangeOnNewBar`), otherwise keep the viewed bars in place.
   * - Bars prepended (history pagination) need no adjustment: offsets are relative to the last bar.
   */
  handleTimelineChange(
    anchorIndex: number,
    view?: { readonly barsFromEnd: number; readonly logical: number },
  ): void {
    if (view) {
      this._rightOffset += view.barsFromEnd - (this.lastIndex - view.logical);
    } else if (anchorIndex < 0) {
      this._barSpacing = this.clampSpacing(this._options.barSpacing);
      this._rightOffset = this._options.rightOffset;
    } else {
      const added = this.lastIndex - anchorIndex;
      const lastWasVisible = this._rightOffset >= -0.5;
      if (added > 0 && !(this._options.shiftVisibleRangeOnNewBar && lastWasVisible))
        this._rightOffset -= added;
    }
    this.constrain();
  }

  private clampSpacing(spacing: number): number {
    const max =
      this._options.maxBarSpacing > 0 ? this._options.maxBarSpacing : Math.max(1, this._width / 2);
    return clamp(spacing, this._options.minBarSpacing, Math.max(this._options.minBarSpacing, max));
  }

  private constrain(): void {
    this._barSpacing = this.clampSpacing(this._barSpacing);
    const count = this.timeline.length;
    if (count === 0 || this._width <= 0) return;
    const visibleBars = this._width / this._barSpacing;
    const minVisible = Math.min(MIN_VISIBLE_BARS, count);
    let lower = minVisible - 1 - this.lastIndex;
    let upper = visibleBars - minVisible;
    if (this._options.fixLeftEdge) lower = Math.max(lower, visibleBars - this.lastIndex - 1);
    if (this._options.fixRightEdge) upper = Math.min(upper, 0);
    if (lower > upper) lower = upper;
    this._rightOffset = clamp(this._rightOffset, lower, upper);
  }
}
