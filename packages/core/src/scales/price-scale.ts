import { clamp } from '../utils/math.js';
import { niceStep } from './nice-number.js';

export type PriceScaleMode = 'normal' | 'logarithmic' | 'percentage' | 'indexed';

export interface ScaleMargins {
  /** Fraction of the pane height left empty above the data (0..1). */
  readonly top: number;
  /** Fraction of the pane height left empty below the data (0..1). */
  readonly bottom: number;
}

export interface PriceScaleOptions {
  mode: PriceScaleMode;
  autoScale: boolean;
  invertScale: boolean;
  scaleMargins: ScaleMargins;
  /** Draw the axis (only meaningful for the pane's `'right'` scale; overlay scales have no axis). */
  visible: boolean;
  borderVisible: boolean;
  /** Minimum axis width in CSS pixels. */
  minimumWidth: number;
}

export const defaultPriceScaleOptions: PriceScaleOptions = {
  mode: 'normal',
  autoScale: true,
  invertScale: false,
  scaleMargins: { top: 0.1, bottom: 0.1 },
  visible: true,
  borderVisible: true,
  minimumWidth: 0,
};

export interface PriceTick {
  /** Value in the scale's display space (price, percent or index). */
  readonly value: number;
  readonly y: number;
}

/** Transformed-space range. */
interface Range {
  min: number;
  max: number;
}

const LOG_FLOOR = 1e-12;

/**
 * Maps prices to vertical pixel coordinates.
 *
 * The scale works in a *transformed space* that depends on the mode
 * (price, log10(price), percent change from base, or base-indexed to 100).
 * Margins are applied when mapping, not stored in the range, so manual scaling stays intuitive.
 */
export class PriceScale {
  readonly id: string;
  private _options: PriceScaleOptions;
  private _height = 0;
  private _range: Range | null = null;
  private _base: number | null = null;

  constructor(id: string, options: PriceScaleOptions) {
    this.id = id;
    this._options = options;
  }

  get options(): PriceScaleOptions {
    return this._options;
  }

  get height(): number {
    return this._height;
  }

  get mode(): PriceScaleMode {
    return this._options.mode;
  }

  /** True when the scale has no usable range (no visible data yet). */
  get isEmpty(): boolean {
    return this._range === null || this._height <= 0;
  }

  /** Base value for percentage / indexed modes (first visible value of the scale's first series). */
  get base(): number | null {
    return this._base;
  }

  applyOptions(options: PriceScaleOptions): void {
    if (options.mode !== this._options.mode) this._range = null;
    this._options = options;
  }

  setHeight(height: number): void {
    this._height = Math.max(0, height);
  }

  setBase(base: number | null): void {
    this._base = base !== null && Number.isFinite(base) && base !== 0 ? base : null;
  }

  /** Raw price → transformed space. Returns NaN when the mode cannot represent the value. */
  transform(price: number): number {
    switch (this._options.mode) {
      case 'normal':
        return price;
      case 'logarithmic':
        return Math.log10(Math.max(price, LOG_FLOOR));
      case 'percentage':
        return this._base === null
          ? Number.NaN
          : ((price - this._base) / Math.abs(this._base)) * 100;
      case 'indexed':
        return this._base === null ? Number.NaN : (price / this._base) * 100;
    }
  }

  /** Transformed space → raw price. */
  untransform(value: number): number {
    switch (this._options.mode) {
      case 'normal':
        return value;
      case 'logarithmic':
        return 10 ** value;
      case 'percentage':
        return this._base === null ? Number.NaN : (value / 100) * Math.abs(this._base) + this._base;
      case 'indexed':
        return this._base === null ? Number.NaN : (value / 100) * this._base;
    }
  }

  /** Sets the range from raw data extremes (auto-scale). Ignored when auto-scale is off. */
  setAutoscaleRange(minPrice: number, maxPrice: number): void {
    if (!this._options.autoScale && this._range) return;
    this.setTransformedRange(this.transform(minPrice), this.transform(maxPrice));
  }

  setTransformedRange(min: number, max: number): void {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    if (min > max) [min, max] = [max, min];
    if (min === max) {
      const pad = Math.abs(min) * 0.01 || 1;
      min -= pad;
      max += pad;
    }
    this._range = { min, max };
  }

  clearRange(): void {
    this._range = null;
  }

  /** Display-space value → y coordinate (CSS px within the pane). */
  valueToCoordinate(value: number): number {
    const range = this._range;
    if (!range) return Number.NaN;
    const { top, bottom } = this._options.scaleMargins;
    const usable = this._height * (1 - top - bottom);
    const ratio = (value - range.min) / (range.max - range.min);
    const fromTop = this._height * top + (1 - ratio) * usable;
    return this._options.invertScale ? this._height - fromTop : fromTop;
  }

  coordinateToValue(y: number): number {
    const range = this._range;
    if (!range) return Number.NaN;
    const { top, bottom } = this._options.scaleMargins;
    const usable = this._height * (1 - top - bottom) || 1;
    const fromTop = this._options.invertScale ? this._height - y : y;
    const ratio = 1 - (fromTop - this._height * top) / usable;
    return range.min + ratio * (range.max - range.min);
  }

  priceToCoordinate(price: number): number {
    return this.valueToCoordinate(this.transform(price));
  }

  coordinateToPrice(y: number): number {
    return this.untransform(this.coordinateToValue(y));
  }

  /**
   * Stretches the range around its centre. `factor > 1` zooms out. Disables auto-scale.
   * Returns the new options so the owner can persist the auto-scale change.
   */
  scaleBy(factor: number): void {
    const range = this._range;
    if (!range || !(factor > 0)) return;
    const centre = (range.min + range.max) / 2;
    const half = clamp(((range.max - range.min) / 2) * factor, 1e-10, 1e15);
    this._range = { min: centre - half, max: centre + half };
  }

  /** Moves the range by `dy` CSS pixels (content follows the pointer). */
  shiftBy(dy: number): void {
    const range = this._range;
    if (!range || this._height <= 0) return;
    const { top, bottom } = this._options.scaleMargins;
    const usable = this._height * (1 - top - bottom) || 1;
    const delta = ((range.max - range.min) * dy) / usable;
    const sign = this._options.invertScale ? -1 : 1;
    this._range = { min: range.min + sign * delta, max: range.max + sign * delta };
  }

  /** Nicely spaced ticks across the full pane height (including margins). */
  ticks(minSpacingPx: number, minStep = 0): PriceTick[] {
    if (this.isEmpty) return [];
    const a = this.coordinateToValue(0);
    const b = this.coordinateToValue(this._height);
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const span = high - low;
    if (!(span > 0)) return [];
    const isLog = this._options.mode === 'logarithmic';
    const step = Math.max(niceStep((span * minSpacingPx) / this._height), isLog ? 0 : minStep);
    const out: PriceTick[] = [];
    const first = Math.ceil(low / step) * step;
    let lastLabel = Number.NaN;
    for (let i = 0, v = first; v <= high + step * 1e-9 && i < 200; i++, v = first + i * step) {
      let value = v;
      if (isLog) {
        // Ticks are evenly spaced in log space; snap the displayed price to 2 significant digits.
        const price = Number((10 ** v).toPrecision(2));
        if (price === lastLabel) continue;
        lastLabel = price;
        value = Math.log10(price);
      }
      out.push({ value: isLog ? 10 ** value : value, y: this.valueToCoordinate(value) });
    }
    return out;
  }
}
