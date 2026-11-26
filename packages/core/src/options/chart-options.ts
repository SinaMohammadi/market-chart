import type { PriceScaleOptions } from '../scales/price-scale.js';
import { defaultPriceScaleOptions } from '../scales/price-scale.js';
import type { TimeScaleOptions } from '../scales/time-scale.js';
import { defaultTimeScaleOptions } from '../scales/time-scale.js';
import type { ThemeInput } from '../theme/themes.js';
import type { TimeZone } from '../time/zoned-clock.js';
import type { DeepPartial } from '../utils/merge.js';

export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface GridLineOptions {
  visible: boolean;
  /** `null` uses the theme colour. */
  color: string | null;
  style: LineStyle;
}

export interface CrosshairLineOptions {
  visible: boolean;
  labelVisible: boolean;
  /** `null` uses the theme colour. */
  color: string | null;
  width: number;
  style: LineStyle;
}

/** `normal`: follows the pointer. `magnet`: snaps horizontally to the hovered bar's close. */
export type CrosshairMode = 'normal' | 'magnet' | 'hidden';

export interface KineticScrollOptions {
  /** Keep scrolling after a mouse drag is released with momentum. */
  mouse: boolean;
  /** Keep scrolling after a touch swipe is released with momentum. */
  touch: boolean;
}

export interface InteractionOptions {
  /** Drag the pane to scroll. */
  dragScroll: boolean;
  /** Mouse wheel / trackpad zoom. */
  wheelZoom: boolean;
  /** Horizontal wheel / shift+wheel scroll. */
  wheelScroll: boolean;
  /** Two-finger pinch zoom on touch devices. */
  pinchZoom: boolean;
  /** Drag the price/time axes to scale them. */
  axisDragScale: boolean;
  /** Double-click an axis to reset it. */
  axisDoubleClickReset: boolean;
  kineticScroll: KineticScrollOptions;
  /** Long-press on touch devices shows a crosshair that follows the finger; a tap hides it. */
  touchCrosshair: boolean;
  /**
   * A touch long-press emits `contextMenu` (instead of showing the crosshair). Enable it when a context menu
   * UI is attached; right-click and the keyboard ContextMenu key always emit it.
   */
  touchContextMenu: boolean;
  /** Arrow keys, +/−, Home/End and Escape when the chart has focus. */
  keyboard: boolean;
  /** Drag the separator between panes to resize them. */
  paneResize: boolean;
}

export interface ChartOptions {
  theme: ThemeInput;
  /** Follow the container size with a ResizeObserver. When false, `width`/`height` are used. */
  autoSize: boolean;
  width: number;
  height: number;
  layout: {
    fontFamily: string;
    fontSize: number;
  };
  grid: {
    vertLines: GridLineOptions;
    horzLines: GridLineOptions;
  };
  crosshair: {
    mode: CrosshairMode;
    vertLine: CrosshairLineOptions;
    horzLine: CrosshairLineOptions;
  };
  timeScale: TimeScaleOptions;
  /** Options for every pane's right price scale. Overlay scales are configured per id. */
  rightPriceScale: PriceScaleOptions;
  /**
   * Options for every pane's left price scale (id `'left'`). The left axis column is shown only while
   * at least one series uses `priceScaleId: 'left'` and `visible` is true.
   */
  leftPriceScale: PriceScaleOptions;
  localization: {
    /** BCP 47 locale for dates and, with `localizeNumbers`, numbers on the axes. */
    locale: string;
    timeZone: TimeZone;
    /**
     * Text direction of canvas text (titles, drawing text) and of the chart element. The time axis always
     * runs from past (left) to future (right), as on financial platforms in RTL languages.
     */
    direction: 'ltr' | 'rtl';
    /** Use the locale's digits and decimal/group separators for prices and dates (e.g. Persian digits). */
    localizeNumbers: boolean;
  };
  interaction: InteractionOptions;
  panes: {
    separatorHeight: number;
    /** Minimum pane height in CSS px when resizing by drag. */
    minHeight: number;
  };
  /** Accessible name of the interactive surface. */
  ariaLabel: string;
}

export type ChartOptionsInput = DeepPartial<ChartOptions>;

export const defaultChartOptions: ChartOptions = {
  theme: 'dark',
  autoSize: true,
  width: 0,
  height: 0,
  layout: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
    fontSize: 12,
  },
  grid: {
    vertLines: { visible: true, color: null, style: 'solid' },
    horzLines: { visible: true, color: null, style: 'solid' },
  },
  crosshair: {
    mode: 'normal',
    vertLine: { visible: true, labelVisible: true, color: null, width: 1, style: 'dashed' },
    horzLine: { visible: true, labelVisible: true, color: null, width: 1, style: 'dashed' },
  },
  timeScale: defaultTimeScaleOptions,
  rightPriceScale: defaultPriceScaleOptions,
  leftPriceScale: defaultPriceScaleOptions,
  localization: {
    locale: 'en-US',
    timeZone: 'UTC',
    direction: 'ltr',
    localizeNumbers: false,
  },
  interaction: {
    dragScroll: true,
    wheelZoom: true,
    wheelScroll: true,
    pinchZoom: true,
    axisDragScale: true,
    axisDoubleClickReset: true,
    kineticScroll: { mouse: false, touch: true },
    touchCrosshair: true,
    touchContextMenu: false,
    keyboard: true,
    paneResize: true,
  },
  panes: {
    separatorHeight: 1,
    minHeight: 30,
  },
  ariaLabel: 'Financial chart',
};

/**
 * Non-serialisable hooks (functions). Kept apart from `ChartOptions` so persisted or imported
 * configuration can never carry executable code.
 */
export interface ChartFormatters {
  /** Formats the crosshair time label. Receives UTC ms. */
  time?: (time: number) => string;
}
