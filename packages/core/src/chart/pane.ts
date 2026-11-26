import type { Rect } from '../model/types.js';
import type { PriceScaleOptions } from '../scales/price-scale.js';
import { PriceScale, defaultPriceScaleOptions } from '../scales/price-scale.js';
import type { SeriesModel } from '../series/series-model.js';
import type { DeepPartial } from '../utils/merge.js';
import { deepMerge } from '../utils/merge.js';

export const RIGHT_SCALE_ID = 'right';
export const LEFT_SCALE_ID = 'left';

export type AxisSide = 'left' | 'right';

const overlayDefaults: PriceScaleOptions = { ...defaultPriceScaleOptions, visible: false };

/** A horizontal band of the chart with its own price scales and series. Internal. */
export class Pane {
  /** Position from the top; changes when empty panes above are removed. */
  index: number;
  stretchFactor = 1;
  rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  readonly series: SeriesModel[] = [];
  private readonly _scales = new Map<string, PriceScale>();
  private readonly scaleInputs = new Map<string, DeepPartial<PriceScaleOptions>>();
  private chartRight: PriceScaleOptions;
  private chartLeft: PriceScaleOptions;

  constructor(index: number, chartRight: PriceScaleOptions, chartLeft: PriceScaleOptions) {
    this.index = index;
    this.chartRight = chartRight;
    this.chartLeft = chartLeft;
    this._scales.set(RIGHT_SCALE_ID, new PriceScale(RIGHT_SCALE_ID, chartRight));
    this._scales.set(LEFT_SCALE_ID, new PriceScale(LEFT_SCALE_ID, chartLeft));
  }

  get rightScale(): PriceScale {
    return this._scales.get(RIGHT_SCALE_ID)!;
  }

  get leftScale(): PriceScale {
    return this._scales.get(LEFT_SCALE_ID)!;
  }

  axisScale(side: AxisSide): PriceScale {
    return side === 'left' ? this.leftScale : this.rightScale;
  }

  get scales(): IterableIterator<PriceScale> {
    return this._scales.values();
  }

  /** Existing scale or null (does not create overlay scales). */
  findScale(id: string): PriceScale | null {
    return this._scales.get(id) ?? null;
  }

  scale(id: string): PriceScale {
    let scale = this._scales.get(id);
    if (!scale) {
      scale = new PriceScale(id, this.resolveScaleOptions(id));
      this._scales.set(id, scale);
    }
    return scale;
  }

  applyScaleOptions(id: string, patch: DeepPartial<PriceScaleOptions>): void {
    this.scaleInputs.set(id, deepMerge(this.scaleInputs.get(id) ?? {}, patch));
    this.scale(id).applyOptions(this.resolveScaleOptions(id));
  }

  /** Called when chart-level `rightPriceScale` / `leftPriceScale` options change. */
  setChartScaleOptions(right: PriceScaleOptions, left: PriceScaleOptions): void {
    this.chartRight = right;
    this.chartLeft = left;
    this.rightScale.applyOptions(this.resolveScaleOptions(RIGHT_SCALE_ID));
    this.leftScale.applyOptions(this.resolveScaleOptions(LEFT_SCALE_ID));
  }

  hasSeriesOn(id: string): boolean {
    return this.series.some((s) => s.options.priceScaleId === id);
  }

  /** First series attached to scale `id` (its format drives the axis labels). */
  mainSeriesOf(id: string): SeriesModel | undefined {
    return this.series.find((s) => s.options.priceScaleId === id);
  }

  /** Drops overlay scales no series uses any more (keeps user options for when they come back). */
  pruneScales(): void {
    for (const id of [...this._scales.keys()]) {
      if (id !== RIGHT_SCALE_ID && id !== LEFT_SCALE_ID && !this.hasSeriesOn(id))
        this._scales.delete(id);
    }
  }

  private resolveScaleOptions(id: string): PriceScaleOptions {
    const base =
      id === RIGHT_SCALE_ID
        ? this.chartRight
        : id === LEFT_SCALE_ID
          ? this.chartLeft
          : overlayDefaults;
    return deepMerge(base, this.scaleInputs.get(id));
  }
}
