import type { TradingSession } from '@market-chart/core';
import { MA_TYPES } from '../primitives.js';

/** Shared input specs. */
export const sourceInput = (fallback: 'close' | 'hl2' | 'hlc3' = 'close') =>
  ({ type: 'source', default: fallback, label: 'Source' }) as const;

export const lengthInput = (fallback: number, label = 'Length', min = 1) =>
  ({ type: 'int', default: fallback, min, max: 5000, label }) as const;

export const multiplierInput = (fallback: number, label = 'Multiplier') =>
  ({ type: 'float', default: fallback, min: 0, max: 100, step: 0.1, label }) as const;

export const maTypeInput = (fallback: 'sma' | 'ema' | 'wma' | 'rma') =>
  ({ type: 'enum', default: fallback, options: MA_TYPES, label: 'Smoothing' }) as const;

export const periodInput = {
  type: 'enum',
  default: 'day',
  options: ['day', 'week', 'month'],
  label: 'Period',
} as const;

export const NaN3 = [Number.NaN, Number.NaN, Number.NaN];

const DAY = 86_400_000;

/**
 * Period bucket of a timestamp: the trading day, week or month of `session` when given, otherwise of the
 * UTC calendar. Weeks start on Monday (1970-01-01 was a Thursday).
 */
export function periodKey(
  time: number,
  period: string,
  session: TradingSession | null = null,
): number {
  if (session)
    return session.periodKey(time, period === 'week' || period === 'month' ? period : 'day');
  const day = Math.floor(time / DAY);
  if (period === 'week') return Math.floor((day + 3) / 7);
  if (period === 'month') {
    const d = new Date(time);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  }
  return day;
}

/** Shared colour palette for indicator outputs. */
export const colors = {
  blue: '#2962ff',
  orange: '#ff9800',
  purple: '#7e57c2',
  teal: '#26a69a',
  red: '#ef5350',
  green: '#4caf50',
  grey: '#9598a1',
  yellow: '#fbc02d',
  pink: '#ec407a',
  cyan: '#00bcd4',
} as const;
