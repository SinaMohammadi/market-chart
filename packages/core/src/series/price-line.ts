import type { LineStyle } from '../options/chart-options.js';

export interface PriceLineOptions {
  price: number;
  /** `null` uses the series colour. */
  color: string | null;
  lineWidth: number;
  lineStyle: LineStyle;
  lineVisible: boolean;
  /** Label with the price on the series' price axis. */
  axisLabelVisible: boolean;
  /** Text drawn above the line at the left edge of the pane. */
  title: string;
  /** Include the line when auto-scaling, so it stays in view (e.g. indicator levels). */
  autoscale: boolean;
}

export const defaultPriceLineOptions: PriceLineOptions = {
  price: 0,
  color: null,
  lineWidth: 1,
  lineStyle: 'dashed',
  lineVisible: true,
  axisLabelVisible: true,
  title: '',
  autoscale: false,
};

export interface PriceLineApi {
  applyOptions(options: Partial<PriceLineOptions>): void;
  options(): Readonly<PriceLineOptions>;
  /** Removes the line from its series. Further calls are no-ops. */
  remove(): void;
}

/** Internal state of one price line. */
export interface PriceLineEntry {
  options: PriceLineOptions;
  readonly api: PriceLineApi;
}
