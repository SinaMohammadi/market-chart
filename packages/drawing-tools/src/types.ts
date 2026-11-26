import type { LineStyle } from '@market-chart/core';

/** A point in data space: UTC ms time (may lie between bars or in the future) and price. */
export interface Anchor {
  readonly time: number;
  readonly price: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A level of Fibonacci/Gann tools (or deviation multiple of a regression channel). */
export interface LevelStyle {
  readonly value: number;
  readonly color?: string;
  readonly visible?: boolean;
}

/** Visual settings. Every tool reads the subset it needs. Plain JSON. */
export interface DrawingStyle {
  readonly lineColor: string;
  readonly lineWidth: number;
  readonly lineStyle: LineStyle;
  /** Fill of closed shapes and zones; `'transparent'` for none. */
  readonly fillColor: string;
  readonly textColor: string;
  readonly fontSize: number;
  readonly extendLeft: boolean;
  readonly extendRight: boolean;
  /** Level / price / measurement labels. */
  readonly showLabels: boolean;
  readonly levels: readonly LevelStyle[];
}

export interface Drawing {
  readonly id: string;
  readonly type: string;
  /** Series whose price scale and pane the drawing is attached to. */
  readonly seriesId: string;
  readonly points: readonly Anchor[];
  readonly style: DrawingStyle;
  readonly text: string;
  readonly locked: boolean;
  readonly visible: boolean;
  readonly zIndex: number;
  readonly groupId: string | null;
}

/**
 * Coordinate system of one drawing on one pane: CSS px relative to the pane's top-left corner.
 * Conversions extrapolate beyond the data (drawings can extend into the future).
 */
export interface DrawingView {
  readonly width: number;
  readonly height: number;
  readonly barSpacing: number;
  timeToX(time: number): number;
  xToTime(x: number): number;
  priceToY(price: number): number;
  yToPrice(y: number): number;
  /** Fractional bar index of a time / time of a fractional bar index. */
  timeToLogical(time: number): number;
  logicalToTime(logical: number): number;
  logicalToX(logical: number): number;
  formatPrice(price: number): string;
}

/** Read access to the source series values (closes), used by data-driven tools such as the regression channel. */
export interface DrawingDataAccess {
  /** Points with `from <= time <= to`, as bar logical index and value. */
  values(
    from: number,
    to: number,
  ): { readonly logical: readonly number[]; readonly value: readonly number[] };
}

export type DrawingToolCategory =
  'lines' | 'shapes' | 'annotations' | 'measure' | 'fibonacci' | 'gann' | 'patterns';

export interface DrawState {
  readonly selected: boolean;
  readonly hovered: boolean;
}

/**
 * A drawing tool. Tools are stateless: they map anchors to pixels, draw, and measure distances.
 * `ctx` is in CSS px (already scaled by the device pixel ratio) and clipped to the pane.
 */
export interface DrawingToolDefinition<D = unknown> {
  readonly type: string;
  readonly name: string;
  readonly category: DrawingToolCategory;
  /** Number of anchors the user places. */
  readonly points: number;
  readonly defaultStyle?: Partial<DrawingStyle>;
  readonly defaultText?: string;
  /** Double-click opens text editing (the app shows the editor via the `textEdit` event). */
  readonly editableText?: boolean;
  /**
   * Anchors created by the first click. Returning `points` anchors creates the drawing immediately
   * (one-click tools such as positions).
   */
  seed?(first: Anchor, view: DrawingView): Anchor[];
  /** Pixel positions of the handles (default: the projected anchors). */
  handles?(drawing: Drawing, view: DrawingView): Point[];
  /** New anchors after handle `index` was dragged to `anchor` (default: replace that anchor). */
  moveHandle?(
    points: readonly Anchor[],
    index: number,
    anchor: Anchor,
    view: DrawingView,
  ): Anchor[];
  /** Data-derived values, recomputed only when the drawing or the source data changes. */
  compute?(drawing: Drawing, data: DrawingDataAccess): D;
  draw(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    view: DrawingView,
    state: DrawState,
    derived: D | undefined,
  ): void;
  /** Distance in px from (x, y) to the shape (0 inside filled areas). */
  distance(
    drawing: Drawing,
    view: DrawingView,
    x: number,
    y: number,
    derived: D | undefined,
  ): number;
}

export class DrawingError extends Error {
  constructor(message: string) {
    super(`[market-chart/drawing-tools] ${message}`);
    this.name = 'DrawingError';
  }
}

/** Identity helper for typed custom tools. */
export function defineTool<D = unknown>(
  definition: DrawingToolDefinition<D>,
): DrawingToolDefinition<D> {
  return definition;
}
