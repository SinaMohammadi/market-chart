import type { DrawingStyle, DrawingToolDefinition, LevelStyle } from './types.js';
import { DrawingError } from './types.js';

export const baseStyle: DrawingStyle = {
  lineColor: '#2962ff',
  lineWidth: 2,
  lineStyle: 'solid',
  fillColor: 'transparent',
  textColor: '#d1d4dc',
  fontSize: 13,
  extendLeft: false,
  extendRight: false,
  showLabels: true,
  levels: [],
};

const LINE_STYLES = new Set(['solid', 'dashed', 'dotted']);

function color(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64)
    throw new DrawingError(`style.${key} must be a colour string`);
  return value;
}

function number(value: unknown, key: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new DrawingError(`style.${key} must be a number in [${min}, ${max}]`);
  }
  return value;
}

function bool(value: unknown, key: string): boolean {
  if (typeof value !== 'boolean') throw new DrawingError(`style.${key} must be a boolean`);
  return value;
}

function levels(value: unknown): LevelStyle[] {
  if (!Array.isArray(value) || value.length > 32)
    throw new DrawingError('style.levels must be an array of at most 32 levels');
  return value.map((raw, i) => {
    if (!raw || typeof raw !== 'object')
      throw new DrawingError(`style.levels[${i}] must be an object`);
    const l = raw as Record<string, unknown>;
    const out: { value: number; color?: string; visible?: boolean } = {
      value: number(l['value'], `levels[${i}].value`, -1000, 1000),
    };
    if (l['color'] !== undefined) out.color = color(l['color'], `levels[${i}].color`);
    if (l['visible'] !== undefined) out.visible = bool(l['visible'], `levels[${i}].visible`);
    return out;
  });
}

/** Validates a (partial) style from untrusted input. Unknown keys are dropped. */
export function sanitizeStyle(input: unknown): Partial<DrawingStyle> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object') throw new DrawingError('style must be an object');
  const s = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (s['lineColor'] !== undefined) out['lineColor'] = color(s['lineColor'], 'lineColor');
  if (s['fillColor'] !== undefined) out['fillColor'] = color(s['fillColor'], 'fillColor');
  if (s['textColor'] !== undefined) out['textColor'] = color(s['textColor'], 'textColor');
  if (s['lineWidth'] !== undefined) out['lineWidth'] = number(s['lineWidth'], 'lineWidth', 0.5, 20);
  if (s['fontSize'] !== undefined) out['fontSize'] = number(s['fontSize'], 'fontSize', 6, 96);
  if (s['lineStyle'] !== undefined) {
    if (!LINE_STYLES.has(s['lineStyle'] as string))
      throw new DrawingError('style.lineStyle must be solid, dashed or dotted');
    out['lineStyle'] = s['lineStyle'];
  }
  for (const key of ['extendLeft', 'extendRight', 'showLabels'] as const) {
    if (s[key] !== undefined) out[key] = bool(s[key], key);
  }
  if (s['levels'] !== undefined) out['levels'] = levels(s['levels']);
  return out as Partial<DrawingStyle>;
}

/** Base style, then the tool's defaults, then (validated) user values. */
export function resolveStyle(
  definition: DrawingToolDefinition,
  input?: unknown,
  base: DrawingStyle = baseStyle,
): DrawingStyle {
  return { ...base, ...definition.defaultStyle, ...sanitizeStyle(input) };
}
