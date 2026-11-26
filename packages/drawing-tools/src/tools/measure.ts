import { boxOf, distanceToBox } from '../geometry.js';
import { arrowHead, fillBox, label, line, stroke } from '../render.js';
import type { Anchor, Drawing, DrawingToolDefinition, DrawingView, Point } from '../types.js';
import { formatDuration, project } from './common.js';

const PROFIT = 'rgba(8, 153, 129, 0.25)';
const LOSS = 'rgba(242, 54, 69, 0.25)';
const DEFAULT_BARS = 20;

function percent(from: number, to: number): string {
  if (from === 0) return '';
  const value = ((to - from) / Math.abs(from)) * 100;
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
}

/**
 * Position tools keep three anchors: entry (time, price), (end time, target price), (end time, stop price).
 * Handles: entry, target, stop (at the entry time) and the right edge.
 */
function position(type: string, name: string, side: 'long' | 'short'): DrawingToolDefinition {
  const dir = side === 'long' ? 1 : -1;
  return {
    type,
    name,
    category: 'measure',
    points: 3,
    defaultStyle: { lineColor: '#787b86', lineWidth: 1, textColor: '#ffffff' },
    seed(first: Anchor, view: DrawingView): Anchor[] {
      const y = view.priceToY(first.price);
      const end = view.logicalToTime(view.timeToLogical(first.time) + DEFAULT_BARS);
      const target = view.yToPrice(y - dir * Math.max(40, view.height * 0.12));
      const stop = view.yToPrice(y + dir * Math.max(20, view.height * 0.06));
      return [first, { time: end, price: target }, { time: end, price: stop }];
    },
    handles(d, view) {
      const [entry, target, stop] = d.points;
      const x0 = view.timeToX(entry!.time);
      return [
        { x: x0, y: view.priceToY(entry!.price) },
        { x: x0, y: view.priceToY(target!.price) },
        { x: x0, y: view.priceToY(stop!.price) },
        { x: view.timeToX(target!.time), y: view.priceToY(entry!.price) },
      ];
    },
    moveHandle(points, index, anchor) {
      const [entry, target, stop] = points as [Anchor, Anchor, Anchor];
      switch (index) {
        case 0:
          return [anchor, target, stop];
        case 1:
          return [entry, { time: target.time, price: anchor.price }, stop];
        case 2:
          return [entry, target, { time: stop.time, price: anchor.price }];
        default:
          return [
            entry,
            { time: anchor.time, price: target.price },
            { time: anchor.time, price: stop.price },
          ];
      }
    },
    draw(ctx, d, view, state) {
      const [entry, target, stop] = d.points as [Anchor, Anchor, Anchor];
      const x0 = view.timeToX(entry.time);
      const x1 = view.timeToX(target.time);
      const ye = view.priceToY(entry.price);
      const yt = view.priceToY(target.price);
      const ys = view.priceToY(stop.price);
      fillBox(ctx, boxOf({ x: x0, y: ye }, { x: x1, y: yt }), PROFIT);
      fillBox(ctx, boxOf({ x: x0, y: ye }, { x: x1, y: ys }), LOSS);
      stroke(ctx, d.style, state);
      line(ctx, { x: x0, y: ye }, { x: x1, y: ye });
      if (!d.style.showLabels) return;
      const reward = Math.abs(target.price - entry.price);
      const risk = Math.abs(entry.price - stop.price);
      const ratio = risk > 0 ? (reward / risk).toFixed(2) : '∞';
      const mid = (x0 + x1) / 2;
      const opts = { fontSize: d.style.fontSize - 1, align: 'center' as const, padding: 4 };
      label(
        ctx,
        `Target ${view.formatPrice(target.price)} (${percent(entry.price, target.price)})`,
        mid,
        yt,
        {
          ...opts,
          color: d.style.textColor,
          background: '#089981',
          // Labels sit outside the zone edge they describe.
          baseline: yt < ye ? 'bottom' : 'top',
        },
      );
      label(
        ctx,
        `Stop ${view.formatPrice(stop.price)} (${percent(entry.price, stop.price)})`,
        mid,
        ys,
        {
          ...opts,
          color: d.style.textColor,
          background: '#f23645',
          baseline: ys > ye ? 'top' : 'bottom',
        },
      );
      label(
        ctx,
        `${side === 'long' ? 'Long' : 'Short'} ${view.formatPrice(entry.price)} · R:R ${ratio}`,
        mid,
        ye,
        {
          ...opts,
          color: d.style.textColor,
          background: 'rgba(60, 64, 75, 0.9)',
          baseline: 'middle',
        },
      );
    },
    distance(d, view, x, y) {
      const [entry, target, stop] = d.points as [Anchor, Anchor, Anchor];
      const x0 = view.timeToX(entry.time);
      const x1 = view.timeToX(target.time);
      const ys = [
        view.priceToY(entry.price),
        view.priceToY(target.price),
        view.priceToY(stop.price),
      ];
      const box = {
        left: Math.min(x0, x1),
        right: Math.max(x0, x1),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
      };
      return distanceToBox({ x, y }, box, true);
    },
  };
}

export const longPosition = position('long-position', 'Long Position', 'long');
export const shortPosition = position('short-position', 'Short Position', 'short');

function barsBetween(view: DrawingView, a: Anchor, b: Anchor): number {
  return Math.round(view.timeToLogical(b.time) - view.timeToLogical(a.time));
}

function rangeLabel(d: Drawing, view: DrawingView, withPrice: boolean, withTime: boolean): string {
  const [a, b] = d.points as [Anchor, Anchor];
  const parts: string[] = [];
  if (withPrice) {
    const delta = b.price - a.price;
    parts.push(
      `${delta >= 0 ? '+' : '−'}${view.formatPrice(Math.abs(delta))} (${percent(a.price, b.price)})`,
    );
  }
  if (withTime) parts.push(`${barsBetween(view, a, b)} bars, ${formatDuration(b.time - a.time)}`);
  return parts.join('\n');
}

function range(
  type: string,
  name: string,
  withPrice: boolean,
  withTime: boolean,
): DrawingToolDefinition {
  return {
    type,
    name,
    category: 'measure',
    points: 2,
    defaultStyle: { fillColor: 'rgba(41, 98, 255, 0.15)', textColor: '#ffffff' },
    draw(ctx, d, view, state) {
      const [a, b] = project(d, view) as [Point, Point];
      const box = boxOf(a, b);
      fillBox(ctx, box, d.style.fillColor);
      stroke(ctx, d.style, state);
      const midX = (box.left + box.right) / 2;
      const midY = (box.top + box.bottom) / 2;
      if (withPrice) {
        line(ctx, { x: midX, y: a.y }, { x: midX, y: b.y });
        arrowHead(ctx, { x: midX, y: a.y }, { x: midX, y: b.y }, 7);
      }
      if (withTime) {
        stroke(ctx, d.style, state);
        line(ctx, { x: a.x, y: midY }, { x: b.x, y: midY });
        arrowHead(ctx, { x: a.x, y: midY }, { x: b.x, y: midY }, 7);
      }
      if (!d.style.showLabels) return;
      const below = b.y >= a.y;
      label(
        ctx,
        rangeLabel(d, view, withPrice, withTime),
        midX,
        below ? box.bottom + 6 : box.top - 6,
        {
          color: d.style.textColor,
          fontSize: d.style.fontSize - 1,
          align: 'center',
          baseline: below ? 'top' : 'bottom',
          background: 'rgba(41, 98, 255, 0.9)',
        },
      );
    },
    distance(d, view, x, y) {
      const [a, b] = project(d, view) as [Point, Point];
      return distanceToBox({ x, y }, boxOf(a, b), true);
    },
  };
}

export const priceRange = range('price-range', 'Price Range', true, false);
export const dateRange = range('date-range', 'Date Range', false, true);
export const datePriceRange = range('date-price-range', 'Date and Price Range', true, true);

export const measureTools = [longPosition, shortPosition, priceRange, dateRange, datePriceRange];
