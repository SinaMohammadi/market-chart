import type { Timeline } from '../model/timeline.js';
import type { Rect } from '../model/types.js';
import type { ChartOptions, CrosshairLineOptions } from '../options/chart-options.js';
import type { PaneLayerCoordinates, PaneLayerZOrder } from '../plugins/plugin.js';
import type { PluginHost } from '../plugins/plugin-host.js';
import { styledHorizontalLine, styledVerticalLine } from '../render/draw-utils.js';
import type { PriceScale, PriceTick } from '../scales/price-scale.js';
import type { TimeTick } from '../scales/time-ticks.js';
import type { TimeScale } from '../scales/time-scale.js';
import type { SeriesPaintContext } from '../series/paint-context.js';
import type { SeriesModel } from '../series/series-model.js';
import type { ChartTheme } from '../theme/themes.js';
import type { ChartLayout } from './layout.js';
import type { AxisSide, Pane } from './pane.js';
import type { PlacedLabel } from '../render/label-layout.js';

export interface SeriesFrame {
  readonly model: SeriesModel;
  readonly scale: PriceScale;
  /** Padded local range to paint, or null when nothing is visible. */
  readonly range: { from: number; to: number } | null;
  /** Formats a raw price for this series' scale and mode. */
  readonly formatPrice: (price: number) => string;
}

/** One price axis (left or right) of one pane. */
export interface AxisFrame {
  readonly side: AxisSide;
  readonly scale: PriceScale;
  readonly ticks: readonly PriceTick[];
  /** Formats a tick value (display space of the scale). */
  readonly formatTick: (value: number) => string;
  /** Formats the value at pane-relative y for the crosshair label, or null when the scale is empty. */
  readonly formatCoordinate: (y: number) => string | null;
  /** Last-value labels after collision resolution (pane-relative). */
  readonly labels: readonly PlacedLabel[];
}

export interface PaneFrame {
  readonly pane: Pane;
  readonly rect: Rect;
  /** Ticks used for horizontal grid lines (right scale, or left when the right one is empty). */
  readonly gridTicks: readonly PriceTick[];
  readonly left: AxisFrame | null;
  readonly right: AxisFrame | null;
  readonly series: readonly SeriesFrame[];
}

export interface FrameState {
  readonly pixelRatio: number;
  readonly layout: ChartLayout;
  readonly theme: ChartTheme;
  readonly options: ChartOptions;
  readonly font: string;
  readonly timeline: Timeline;
  readonly timeScale: TimeScale;
  readonly timeTicks: readonly TimeTick[];
  readonly panes: readonly PaneFrame[];
  readonly plugins: PluginHost;
  readonly coordinates: (pane: number) => PaneLayerCoordinates;
}

export interface CrosshairFrame {
  /** Bar-centre x (CSS px, chart coordinates). */
  readonly x: number;
  /** Horizontal line y (CSS px, chart coordinates), or null to hide it. */
  readonly y: number | null;
  readonly pane: number | null;
  readonly timeLabel: string;
  readonly priceLabels: { readonly left: string | null; readonly right: string | null };
}

const AXIS_PADDING = 6;
const TICK_LENGTH = 4;

function lineWidthPx(pr: number, width = 1): number {
  return Math.max(1, Math.floor(width * pr));
}

function paneLayers(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  paneFrame: PaneFrame,
  zOrder: PaneLayerZOrder,
): void {
  const { pixelRatio: pr } = frame;
  const { rect, pane } = paneFrame;
  frame.plugins.forEachLayer(pane.index, zOrder, (layer) => {
    ctx.save();
    try {
      layer.draw({
        ctx,
        pixelRatio: pr,
        width: rect.width,
        height: rect.height,
        pane: pane.index,
        ...frame.coordinates(pane.index),
      });
    } finally {
      ctx.restore();
    }
  });
}

/** Clips and translates `ctx` to a pane in bitmap space, runs `fn`, restores. */
function withPane(
  ctx: CanvasRenderingContext2D,
  pr: number,
  rect: Rect,
  fn: (w: number, h: number) => void,
): void {
  const top = Math.round(rect.y * pr);
  const left = Math.round(rect.x * pr);
  const w = Math.round((rect.x + rect.width) * pr) - left;
  const h = Math.round((rect.y + rect.height) * pr) - top;
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, left, top);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  fn(w, h);
  ctx.restore();
}

export function drawMain(ctx: CanvasRenderingContext2D, frame: FrameState): void {
  const { pixelRatio: pr, layout, theme, options } = frame;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, Math.round(layout.width * pr), Math.round(layout.height * pr));

  for (const paneFrame of frame.panes) {
    withPane(ctx, pr, paneFrame.rect, (w, h) => {
      drawGrid(ctx, frame, paneFrame, w, h);
      paneLayers(ctx, frame, paneFrame, 'below');
      for (const s of paneFrame.series) {
        if (!s.range || !s.model.options.visible || s.scale.isEmpty) continue;
        const context: SeriesPaintContext = {
          ctx,
          pixelRatio: pr,
          width: w,
          height: h,
          timeScale: frame.timeScale,
          priceScale: s.scale,
          store: s.model.store,
          mapping: frame.timeline.mapping(s.model.store),
          from: s.range.from,
          to: s.range.to,
        };
        ctx.save();
        s.model.definition.paint(context, s.model.options as never);
        ctx.restore();
      }
      drawPriceLines(ctx, frame, paneFrame, w);
      paneLayers(ctx, frame, paneFrame, 'above');
    });
    drawPriceLineTitles(ctx, frame, paneFrame);
    if (paneFrame.left) drawPriceAxis(ctx, frame, paneFrame, paneFrame.left);
    if (paneFrame.right) drawPriceAxis(ctx, frame, paneFrame, paneFrame.right);
  }

  drawSeparators(ctx, frame);
  if (options.timeScale.visible) drawTimeAxis(ctx, frame);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  paneFrame: PaneFrame,
  w: number,
  h: number,
): void {
  const { pixelRatio: pr, options, theme } = frame;
  const width = lineWidthPx(pr);
  const { horzLines, vertLines } = options.grid;
  if (horzLines.visible) {
    ctx.fillStyle = horzLines.color ?? theme.gridColor;
    for (const tick of paneFrame.gridTicks) {
      styledHorizontalLine(ctx, Math.round(tick.y * pr), 0, w, width, horzLines.style, pr);
    }
  }
  if (vertLines.visible) {
    ctx.fillStyle = vertLines.color ?? theme.gridColor;
    for (const tick of frame.timeTicks) {
      styledVerticalLine(ctx, Math.round(tick.x * pr), 0, h, width, vertLines.style, pr);
    }
  }
}

function drawPriceLines(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  paneFrame: PaneFrame,
  w: number,
): void {
  const { pixelRatio: pr } = frame;
  for (const s of paneFrame.series) {
    const o = s.model.options;
    const last = s.model.lastValueIndex();
    if (!o.visible || !o.priceLineVisible || last < 0 || s.scale.isEmpty) continue;
    const y = s.scale.priceToCoordinate(s.model.valueAt(last));
    if (!Number.isFinite(y)) continue;
    ctx.fillStyle = o.priceLineColor ?? s.model.colorAt(last);
    styledHorizontalLine(
      ctx,
      Math.round(y * pr),
      0,
      w,
      lineWidthPx(pr, o.priceLineWidth),
      o.priceLineStyle,
      pr,
    );
  }
  for (const s of paneFrame.series) {
    if (!s.model.options.visible || s.scale.isEmpty) continue;
    for (const line of s.model.priceLines) {
      const o = line.options;
      if (!o.lineVisible) continue;
      const y = s.scale.priceToCoordinate(o.price);
      if (!Number.isFinite(y)) continue;
      ctx.fillStyle = priceLineColor(frame, s, o.color);
      styledHorizontalLine(
        ctx,
        Math.round(y * pr),
        0,
        w,
        lineWidthPx(pr, o.lineWidth),
        o.lineStyle,
        pr,
      );
    }
  }
}

function priceLineColor(frame: FrameState, s: SeriesFrame, color: string | null): string {
  if (color !== null) return color;
  const last = s.model.lastValueIndex();
  return last >= 0 ? s.model.colorAt(last) : frame.theme.lineColor;
}

/** Price line titles, drawn in CSS px just above each line at the pane's left edge. */
function drawPriceLineTitles(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  paneFrame: PaneFrame,
): void {
  const rect = paneFrame.rect;
  let started = false;
  for (const s of paneFrame.series) {
    if (!s.model.options.visible || s.scale.isEmpty) continue;
    for (const line of s.model.priceLines) {
      const o = line.options;
      if (!o.title) continue;
      const y = s.scale.priceToCoordinate(o.price);
      if (!Number.isFinite(y) || y < frame.options.layout.fontSize || y > rect.height) continue;
      const rtl = frame.options.localization.direction === 'rtl';
      if (!started) {
        setTextMode(ctx, frame);
        // Titles start at the pane edge where the reading direction starts.
        ctx.textAlign = rtl ? 'right' : 'left';
        ctx.textBaseline = 'bottom';
        started = true;
      }
      ctx.fillStyle = priceLineColor(frame, s, o.color);
      ctx.fillText(o.title, rtl ? rect.x + rect.width - 4 : rect.x + 4, rect.y + y - 2);
    }
  }
  if (started) ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function setTextMode(ctx: CanvasRenderingContext2D, frame: FrameState): void {
  const pr = frame.pixelRatio;
  ctx.setTransform(pr, 0, 0, pr, 0, 0);
  ctx.font = frame.font;
  ctx.textBaseline = 'middle';
}

export function axisLabelHeight(fontSize: number): number {
  return Math.round(fontSize + 6);
}

interface AxisGeometry {
  /** Left edge of the axis column. */
  readonly x: number;
  readonly width: number;
  /** x of the pane boundary the axis is attached to. */
  readonly edge: number;
  /** +1 when the axis grows to the right of the pane, −1 when to the left. */
  readonly direction: 1 | -1;
}

function axisGeometry(frame: FrameState, side: AxisSide): AxisGeometry {
  const { layout } = frame;
  return side === 'right'
    ? {
        x: layout.paneLeft + layout.paneWidth,
        width: layout.rightAxisWidth,
        edge: layout.paneLeft + layout.paneWidth,
        direction: 1,
      }
    : { x: 0, width: layout.leftAxisWidth, edge: layout.paneLeft, direction: -1 };
}

/** Text anchor inside an axis: next to the tick marks, aligned away from the pane. */
function axisTextX(g: AxisGeometry): number {
  return g.edge + g.direction * (TICK_LENGTH + AXIS_PADDING / 2);
}

function drawPriceAxis(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  paneFrame: PaneFrame,
  axis: AxisFrame,
): void {
  const { pixelRatio: pr, theme } = frame;
  const g = axisGeometry(frame, axis.side);
  if (g.width <= 0) return;
  const rect = paneFrame.rect;
  const lw = lineWidthPx(pr);
  const edgePx = Math.round(g.edge * pr) - (g.direction < 0 ? lw : 0);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (axis.scale.options.borderVisible) {
    ctx.fillStyle = theme.borderColor;
    ctx.fillRect(edgePx, Math.round(rect.y * pr), lw, Math.round(rect.height * pr));
  }
  const labelHeight = axisLabelHeight(frame.options.layout.fontSize);
  const collides = (y: number): boolean =>
    axis.labels.some((l) => Math.abs(l.top + labelHeight / 2 - y) < labelHeight - 2);
  const visibleTicks = axis.ticks.filter((t) => !collides(t.y));
  const tickPx = Math.round(TICK_LENGTH * pr);
  ctx.fillStyle = theme.textColor;
  for (const tick of visibleTicks) {
    const x = g.direction > 0 ? Math.round(g.edge * pr) : Math.round(g.edge * pr) - tickPx;
    ctx.fillRect(x, Math.round((rect.y + tick.y) * pr), tickPx, lw);
  }

  setTextMode(ctx, frame);
  ctx.textAlign = g.direction > 0 ? 'left' : 'right';
  ctx.fillStyle = theme.textColor;
  const half = frame.options.layout.fontSize / 2;
  for (const tick of visibleTicks) {
    if (tick.y < half || tick.y > rect.height - half) continue;
    ctx.fillText(axis.formatTick(tick.value), axisTextX(g), rect.y + tick.y);
  }
  for (const label of axis.labels) {
    drawAxisLabel(ctx, frame, g, rect.y + label.top, label.text, label.background, label.color);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Filled label spanning the axis width; expects text mode. `top` in chart CSS px. */
function drawAxisLabel(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  g: AxisGeometry,
  top: number,
  text: string,
  background: string,
  foreground: string,
): void {
  const h = axisLabelHeight(frame.options.layout.fontSize);
  const y = Math.round(top);
  ctx.fillStyle = background;
  ctx.fillRect(g.x, y, g.width, h);
  ctx.fillStyle = foreground;
  ctx.textAlign = g.direction > 0 ? 'left' : 'right';
  ctx.fillText(text, axisTextX(g), y + h / 2);
}

function drawSeparators(ctx: CanvasRenderingContext2D, frame: FrameState): void {
  const { pixelRatio: pr, layout, theme } = frame;
  if (frame.panes.length < 2 || layout.separatorHeight <= 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.paneSeparatorColor;
  for (let i = 0; i < frame.panes.length - 1; i++) {
    const rect = frame.panes[i]!.rect;
    const y = Math.round((rect.y + rect.height) * pr);
    ctx.fillRect(
      0,
      y,
      Math.round(layout.width * pr),
      Math.max(1, Math.round(layout.separatorHeight * pr)),
    );
  }
}

function drawTimeAxis(ctx: CanvasRenderingContext2D, frame: FrameState): void {
  const { pixelRatio: pr, layout, theme } = frame;
  const axis = layout.timeAxis;
  if (axis.height <= 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.borderColor;
  ctx.fillRect(0, Math.round(axis.y * pr), Math.round(layout.width * pr), lineWidthPx(pr));
  ctx.fillStyle = theme.textColor;
  for (const tick of frame.timeTicks) {
    ctx.fillRect(
      Math.round((axis.x + tick.x) * pr),
      Math.round(axis.y * pr),
      lineWidthPx(pr),
      Math.round(TICK_LENGTH * pr),
    );
  }
  setTextMode(ctx, frame);
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.textColor;
  const y = axis.y + TICK_LENGTH + (axis.height - TICK_LENGTH) / 2;
  for (const tick of frame.timeTicks) {
    const half = ctx.measureText(tick.label).width / 2;
    if (tick.x - half < 0 || tick.x + half > layout.paneWidth) continue;
    ctx.fillText(tick.label, axis.x + tick.x, y);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function crosshairColor(line: CrosshairLineOptions, theme: ChartTheme): string {
  return line.color ?? theme.crosshairColor;
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  crosshair: CrosshairFrame | null,
): void {
  const { pixelRatio: pr, layout, theme, options } = frame;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, Math.round(layout.width * pr), Math.round(layout.height * pr));
  const paneRight = layout.paneLeft + layout.paneWidth;

  if (crosshair && options.crosshair.mode !== 'hidden') {
    const { vertLine, horzLine } = options.crosshair;
    const paneBottom = layout.height - layout.timeAxisHeight;
    if (vertLine.visible && crosshair.x >= layout.paneLeft && crosshair.x <= paneRight) {
      ctx.fillStyle = crosshairColor(vertLine, theme);
      styledVerticalLine(
        ctx,
        Math.round(crosshair.x * pr),
        0,
        Math.round(paneBottom * pr),
        lineWidthPx(pr, vertLine.width),
        vertLine.style,
        pr,
      );
    }
    if (horzLine.visible && crosshair.y !== null) {
      ctx.fillStyle = crosshairColor(horzLine, theme);
      styledHorizontalLine(
        ctx,
        Math.round(crosshair.y * pr),
        Math.round(layout.paneLeft * pr),
        Math.round(paneRight * pr),
        lineWidthPx(pr, horzLine.width),
        horzLine.style,
        pr,
      );
    }
    setTextMode(ctx, frame);
    if (horzLine.labelVisible && crosshair.y !== null) {
      const h = axisLabelHeight(options.layout.fontSize);
      for (const side of ['left', 'right'] as const) {
        const text = crosshair.priceLabels[side];
        const g = axisGeometry(frame, side);
        if (text === null || g.width <= 0) continue;
        drawAxisLabel(
          ctx,
          frame,
          g,
          crosshair.y - h / 2,
          text,
          theme.crosshairLabelBackground,
          theme.crosshairLabelText,
        );
      }
    }
    if (vertLine.labelVisible && options.timeScale.visible && layout.timeAxisHeight > 0) {
      const textWidth = ctx.measureText(crosshair.timeLabel).width;
      const w = textWidth + AXIS_PADDING * 2;
      const left = Math.max(layout.paneLeft, Math.min(paneRight - w, crosshair.x - w / 2));
      const axis = layout.timeAxis;
      ctx.fillStyle = theme.crosshairLabelBackground;
      ctx.fillRect(left, axis.y, w, axis.height);
      ctx.fillStyle = theme.crosshairLabelText;
      ctx.textAlign = 'left';
      ctx.fillText(crosshair.timeLabel, left + AXIS_PADDING, axis.y + axis.height / 2);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  for (const paneFrame of frame.panes) {
    withPane(ctx, pr, paneFrame.rect, () => paneLayers(ctx, frame, paneFrame, 'top'));
  }
}

/** Width in CSS px needed by a price axis for the given labels. */
export function priceAxisWidthFor(labelWidths: Iterable<number>, minimumWidth: number): number {
  let max = 0;
  for (const w of labelWidths) if (w > max) max = w;
  return Math.max(minimumWidth, Math.ceil(max + TICK_LENGTH + AXIS_PADDING * 1.5));
}

export function timeAxisHeightFor(fontSize: number): number {
  return Math.round(fontSize + TICK_LENGTH + 12);
}
