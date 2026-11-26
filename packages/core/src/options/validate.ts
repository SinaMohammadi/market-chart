import { darkTheme } from '../theme/themes.js';
import type { ChartTheme } from '../theme/themes.js';
import { ChartError, isFiniteNumber } from '../utils/errors.js';
import type { ChartOptions } from './chart-options.js';
import type { PriceScaleOptions } from '../scales/price-scale.js';

const PRICE_MODES = new Set(['normal', 'logarithmic', 'percentage', 'indexed']);
const CROSSHAIR_MODES = new Set(['normal', 'magnet', 'hidden']);
const LINE_STYLES = new Set(['solid', 'dashed', 'dotted']);

function positive(value: unknown, name: string): void {
  if (!isFiniteNumber(value) || value <= 0)
    throw new ChartError(`${name} must be a positive number, got ${String(value)}`);
}

function nonNegative(value: unknown, name: string): void {
  if (!isFiniteNumber(value) || value < 0)
    throw new ChartError(`${name} must be a non-negative number, got ${String(value)}`);
}

function oneOf(value: unknown, allowed: Set<string>, name: string): void {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new ChartError(`${name} must be one of ${[...allowed].join(', ')}, got ${String(value)}`);
  }
}

export function validatePriceScaleOptions(o: PriceScaleOptions, name: string): void {
  oneOf(o.mode, PRICE_MODES, `${name}.mode`);
  const { top, bottom } = o.scaleMargins;
  nonNegative(top, `${name}.scaleMargins.top`);
  nonNegative(bottom, `${name}.scaleMargins.bottom`);
  if (top + bottom >= 1) throw new ChartError(`${name}.scaleMargins top + bottom must be < 1`);
  nonNegative(o.minimumWidth, `${name}.minimumWidth`);
}

/** Fills a partial custom theme from the dark theme and checks every token is a string. */
export function normalizeTheme(theme: ChartOptions['theme']): ChartOptions['theme'] {
  if (typeof theme === 'string') return theme;
  if (theme === null || typeof theme !== 'object')
    throw new ChartError('theme must be a theme name or object');
  const merged: Record<string, unknown> = { ...darkTheme };
  for (const key of Object.keys(darkTheme) as (keyof ChartTheme)[]) {
    const value = (theme as unknown as Record<string, unknown>)[key];
    if (value !== undefined) {
      if (typeof value !== 'string') throw new ChartError(`theme.${key} must be a string`);
      merged[key] = value;
    }
  }
  return merged as unknown as ChartTheme;
}

/** Runtime validation for options that may come from untrusted sources (imports, JSON). */
export function validateChartOptions(o: ChartOptions): ChartOptions {
  positive(o.layout.fontSize, 'layout.fontSize');
  if (typeof o.layout.fontFamily !== 'string')
    throw new ChartError('layout.fontFamily must be a string');
  nonNegative(o.width, 'width');
  nonNegative(o.height, 'height');
  nonNegative(o.panes.separatorHeight, 'panes.separatorHeight');
  const ts = o.timeScale;
  positive(ts.barSpacing, 'timeScale.barSpacing');
  positive(ts.minBarSpacing, 'timeScale.minBarSpacing');
  nonNegative(ts.maxBarSpacing, 'timeScale.maxBarSpacing');
  if (!isFiniteNumber(ts.rightOffset))
    throw new ChartError('timeScale.rightOffset must be a finite number');
  validatePriceScaleOptions(o.rightPriceScale, 'rightPriceScale');
  validatePriceScaleOptions(o.leftPriceScale, 'leftPriceScale');
  nonNegative(o.panes.minHeight, 'panes.minHeight');
  if (typeof o.ariaLabel !== 'string') throw new ChartError('ariaLabel must be a string');
  if (typeof o.localization.locale !== 'string' || !o.localization.locale)
    throw new ChartError('localization.locale must be a non-empty string');
  oneOf(o.localization.direction, new Set(['ltr', 'rtl']), 'localization.direction');
  if (typeof o.localization.localizeNumbers !== 'boolean')
    throw new ChartError('localization.localizeNumbers must be a boolean');
  oneOf(o.crosshair.mode, CROSSHAIR_MODES, 'crosshair.mode');
  for (const [name, line] of [
    ['crosshair.vertLine', o.crosshair.vertLine],
    ['crosshair.horzLine', o.crosshair.horzLine],
    ['grid.vertLines', o.grid.vertLines],
    ['grid.horzLines', o.grid.horzLines],
  ] as const) {
    oneOf(line.style, LINE_STYLES, `${name}.style`);
  }
  return { ...o, theme: normalizeTheme(o.theme) };
}
