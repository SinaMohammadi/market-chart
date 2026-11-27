/** Region of the chart under a point. */
export type ChartRegion = 'pane' | 'priceAxis' | 'timeAxis' | 'separator' | 'none';

/** Pointer information passed to plugin input handlers. Coordinates are CSS px. */
export interface ChartPointerEvent {
  /** Relative to the chart's top-left corner. */
  readonly x: number;
  readonly y: number;
  readonly region: ChartRegion;
  /** Pane under the pointer, or null over axes / outside panes. */
  readonly pane: number | null;
  /** x relative to the pane area's left edge (the time scale's coordinate space). */
  readonly paneX: number;
  /** y relative to the top of `pane` (NaN when `pane` is null). */
  readonly paneY: number;
  readonly pointerType: string;
  readonly button: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export interface ChartKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/**
 * Lets a plugin take part in input handling (drawing tools, custom interactions).
 * Handlers run before the chart's built-in behaviour, most recently registered first.
 */
export interface ChartInputHandler {
  /**
   * Return true to capture the gesture: the chart then skips panning, axis scaling and clicks, and sends
   * every following move and the release of this pointer to `pointerMove` / `pointerUp`.
   */
  pointerDown?(event: ChartPointerEvent): boolean;
  pointerMove?(event: ChartPointerEvent): void;
  pointerUp?(event: ChartPointerEvent): void;
  /** The captured gesture was interrupted (second finger, pointer cancel, chart destroyed). */
  pointerCancel?(): void;
  /**
   * A captured touch was held still (with `interaction.touchContextMenu`). Return true to turn the gesture
   * into a context-menu request: the chart then calls `pointerCancel` and emits `contextMenu` at the point.
   * Without this method, or when it returns false, the handler keeps the gesture.
   */
  longPress?(event: ChartPointerEvent): boolean;
  /** Mouse/pen movement without a pressed button. Return a CSS cursor to override the default. */
  hover?(event: ChartPointerEvent): string | null;
  /** Return true when handled; the chart then skips its own handling. */
  doubleClick?(event: ChartPointerEvent): boolean;
  /** Return true when handled (the browser default is prevented). */
  keyDown?(event: ChartKeyEvent): boolean;
}
