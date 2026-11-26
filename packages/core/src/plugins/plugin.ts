import type { Unsubscribe } from '../model/types.js';
import type { ChartApi, ChartEventMap, ChartEventName } from '../chart/api.js';
import type { Rect } from '../model/types.js';
import type { ChartInputHandler } from '../interaction/input-handler.js';

/** Coordinate helpers handed to layer draw callbacks. All values are CSS pixels relative to the pane. */
export interface PaneLayerCoordinates {
  timeToX(time: number): number | null;
  xToTime(x: number): number | null;
  /** Price → y on the given scale (default `'right'`). */
  priceToY(price: number, priceScaleId?: string): number | null;
  yToPrice(y: number, priceScaleId?: string): number | null;
}

export interface PaneLayerDrawContext extends PaneLayerCoordinates {
  /**
   * Canvas 2D context, origin at the pane's top-left, already clipped to the pane.
   * Units are **bitmap pixels**: multiply CSS coordinates by `pixelRatio`.
   */
  readonly ctx: CanvasRenderingContext2D;
  readonly pixelRatio: number;
  /** Pane size in CSS px. */
  readonly width: number;
  readonly height: number;
  readonly pane: number;
}

/**
 * - `below`: under series (main surface)
 * - `above`: over series (main surface)
 * - `top`: over the crosshair (overlay surface, redrawn on pointer movement — keep it cheap)
 */
export type PaneLayerZOrder = 'below' | 'above' | 'top';

export interface PaneLayer {
  /** Pane index, default 0. */
  readonly pane?: number;
  readonly zOrder: PaneLayerZOrder;
  draw(context: PaneLayerDrawContext): void;
}

export interface ChartPluginContext {
  readonly chart: ChartApi;
  /** Subscribes to a chart event; automatically unsubscribed when the plugin is removed. */
  on<K extends ChartEventName>(
    event: K,
    listener: (payload: ChartEventMap[K]) => void,
  ): Unsubscribe;
  /** Registers a render layer; automatically removed with the plugin. */
  addPaneLayer(layer: PaneLayer): Unsubscribe;
  /**
   * Schedules a redraw. `overlay` repaints only the cheap overlay surface (crosshair and `top` layers),
   * which is enough when only `top`-layer content changed (e.g. a shape being dragged).
   */
  requestRedraw(surface?: 'all' | 'overlay'): void;
  /** Registers an input handler (drawing tools, custom gestures); removed with the plugin. */
  addInputHandler(handler: ChartInputHandler): Unsubscribe;
  /** Pane rectangle in chart CSS px from the last layout, or null. */
  paneRect(pane: number): Rect | null;
  /** Reports a non-fatal error through the chart's `error` event. */
  reportError(error: unknown): void;
}

export interface ChartPlugin {
  readonly id: string;
  readonly version: string;
  /**
   * Plugins that must already be installed: an id, or `{ id, version }` with a semver range that the installed
   * plugin's version must satisfy (e.g. `'^1.2.0'`).
   */
  readonly dependencies?: readonly (string | { readonly id: string; readonly version?: string })[];
  /** Compatible `@market-chart/core` versions as a semver range (checked against `CORE_VERSION`). */
  readonly requires?: { readonly core?: string };
  install(context: ChartPluginContext): void;
  destroy?(): void;
}
