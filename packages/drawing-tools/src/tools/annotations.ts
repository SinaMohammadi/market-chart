import { distance, distanceToBox, distanceToSegment, inBox } from '../geometry.js';
import { estimateTextBox, label, line, stroke } from '../render.js';
import type { DrawingToolDefinition } from '../types.js';
import { project } from './common.js';

export const text: DrawingToolDefinition = {
  type: 'text',
  name: 'Text',
  category: 'annotations',
  points: 1,
  editableText: true,
  defaultText: 'Text',
  draw(ctx, d, view, state) {
    const [a] = project(d, view);
    const box = label(ctx, d.text || ' ', a!.x, a!.y, {
      color: d.style.textColor,
      fontSize: d.style.fontSize,
      background: d.style.fillColor,
    });
    if (state.selected || state.hovered) {
      stroke(ctx, { ...d.style, lineWidth: 1, lineStyle: 'dashed' });
      ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    }
  },
  distance(d, view, x, y) {
    const [a] = project(d, view);
    return distanceToBox(
      { x, y },
      estimateTextBox(d.text || ' ', a!.x, a!.y, d.style.fontSize),
      true,
    );
  },
};

const PIN_RADIUS = 7;

export const note: DrawingToolDefinition = {
  type: 'note',
  name: 'Note',
  category: 'annotations',
  points: 1,
  editableText: true,
  defaultText: 'Note',
  draw(ctx, d, view, state) {
    const [a] = project(d, view);
    ctx.beginPath();
    ctx.arc(a!.x, a!.y, PIN_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = d.style.lineColor;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${PIN_RADIUS + 3}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('i', a!.x, a!.y + 0.5);
    if (state.selected || state.hovered) {
      label(ctx, d.text, a!.x + PIN_RADIUS + 6, a!.y, {
        color: d.style.textColor,
        fontSize: d.style.fontSize,
        baseline: 'middle',
        background: 'rgba(30, 34, 45, 0.92)',
        padding: 6,
      });
    }
  },
  distance(d, view, x, y) {
    const [a] = project(d, view);
    return Math.max(0, distance({ x, y }, a!) - PIN_RADIUS);
  },
};

export const callout: DrawingToolDefinition = {
  type: 'callout',
  name: 'Callout',
  category: 'annotations',
  points: 2,
  editableText: true,
  defaultText: 'Callout',
  defaultStyle: { fillColor: 'rgba(41, 98, 255, 0.85)', textColor: '#ffffff' },
  draw(ctx, d, view, state) {
    const [target, at] = project(d, view);
    stroke(ctx, d.style, state);
    line(ctx, target!, at!);
    ctx.beginPath();
    ctx.arc(target!.x, target!.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = d.style.lineColor;
    ctx.fill();
    label(ctx, d.text || ' ', at!.x, at!.y, {
      color: d.style.textColor,
      fontSize: d.style.fontSize,
      background: d.style.fillColor,
      padding: 6,
      baseline: 'middle',
    });
  },
  distance(d, view, x, y) {
    const [target, at] = project(d, view);
    const box = estimateTextBox(
      d.text || ' ',
      at!.x,
      at!.y - (d.style.fontSize * 1.3 * d.text.split('\n').length) / 2,
      d.style.fontSize,
      6,
    );
    return Math.min(distanceToBox({ x, y }, box, true), distanceToSegment({ x, y }, target!, at!));
  },
};

export const priceLabel: DrawingToolDefinition = {
  type: 'price-label',
  name: 'Price Label',
  category: 'annotations',
  points: 1,
  defaultStyle: { fillColor: '#2962ff', textColor: '#ffffff' },
  draw(ctx, d, view) {
    const [a] = project(d, view);
    const text = d.text || view.formatPrice(d.points[0]!.price);
    const box = label(ctx, text, a!.x + 10, a!.y - 12, {
      color: d.style.textColor,
      fontSize: d.style.fontSize,
      background: d.style.fillColor,
      baseline: 'bottom',
      padding: 5,
    });
    ctx.beginPath();
    ctx.moveTo(a!.x, a!.y);
    ctx.lineTo(box.left + 4, box.bottom);
    ctx.lineTo(box.left + 14, box.bottom);
    ctx.closePath();
    ctx.fillStyle = d.style.fillColor;
    ctx.fill();
  },
  distance(d, view, x, y) {
    const [a] = project(d, view);
    const text = d.text || view.formatPrice(d.points[0]!.price);
    const box = estimateTextBox(
      text,
      a!.x + 10,
      a!.y - 12 - d.style.fontSize * 1.3,
      d.style.fontSize,
      5,
    );
    return inBox({ x, y }, box)
      ? 0
      : Math.min(distanceToBox({ x, y }, box, true), distance({ x, y }, a!));
  },
};

export const annotationTools = [text, note, callout, priceLabel];
