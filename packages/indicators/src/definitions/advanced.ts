import type { TradingSession } from '@market-chart/core';
import { calc, defineIndicator } from '../types.js';
import type { Bar } from '../types.js';
import { RollingExtreme } from '../primitives.js';
import { colors, lengthInput, periodInput, periodKey } from './common.js';

const N = Number.NaN;

/** Tracks the previous completed period's high/low/close and the current period's open. */
class PeriodTracker {
  key = N;
  high = N;
  low = N;
  close = N;
  open = N;
  prevHigh = N;
  prevLow = N;
  prevClose = N;

  /** Returns true when `bar` starts a new period (of `session` when given, else of the UTC calendar). */
  next(bar: Bar, period: string, session: TradingSession | null): boolean {
    const key = periodKey(bar.time, period, session);
    const isNew = key !== this.key;
    if (isNew) {
      if (Number.isFinite(this.key)) {
        this.prevHigh = this.high;
        this.prevLow = this.low;
        this.prevClose = this.close;
      }
      this.key = key;
      this.open = bar.open;
      this.high = bar.high;
      this.low = bar.low;
    } else {
      this.high = Math.max(this.high, bar.high);
      this.low = Math.min(this.low, bar.low);
    }
    this.close = bar.close;
    return isNew;
  }
}

export const pivotPoints = defineIndicator({
  type: 'pivots',
  name: 'Pivot Points Standard',
  shortName: 'Pivots',
  description:
    'Levels from the previous trading day, week or month (UTC days without a session); constant during the current period.',
  category: 'advanced',
  placement: 'overlay',
  inputs: {
    kind: {
      type: 'enum',
      default: 'traditional',
      options: ['traditional', 'fibonacci', 'woodie', 'camarilla'],
      label: 'Type',
    },
    period: periodInput,
  },
  outputs: [
    { id: 'p', name: 'P', kind: 'step', color: colors.orange, lineWidth: 1 },
    { id: 'r1', name: 'R1', kind: 'step', color: colors.red, lineWidth: 1 },
    { id: 'r2', name: 'R2', kind: 'step', color: colors.red, lineWidth: 1 },
    { id: 'r3', name: 'R3', kind: 'step', color: colors.red, lineWidth: 1 },
    { id: 's1', name: 'S1', kind: 'step', color: colors.teal, lineWidth: 1 },
    { id: 's2', name: 'S2', kind: 'step', color: colors.teal, lineWidth: 1 },
    { id: 's3', name: 'S3', kind: 'step', color: colors.teal, lineWidth: 1 },
  ],
  create: (p, context) => {
    // Read from the closure: calculator state is deep-copied, a session must not be part of it.
    const session = context?.session ?? null;
    return calc(
      {
        tracker: new PeriodTracker(),
        levels: [N, N, N, N, N, N, N],
      },
      (s, bar) => {
        const isNew = s.tracker.next(bar, p.period, session);
        if (isNew && Number.isFinite(s.tracker.prevHigh)) {
          const { prevHigh: h, prevLow: l, prevClose: c, open } = s.tracker;
          const range = h - l;
          let pivot = (h + l + c) / 3;
          let r: number[];
          let sup: number[];
          switch (p.kind) {
            case 'fibonacci':
              r = [pivot + 0.382 * range, pivot + 0.618 * range, pivot + range];
              sup = [pivot - 0.382 * range, pivot - 0.618 * range, pivot - range];
              break;
            case 'woodie':
              pivot = (h + l + 2 * open) / 4;
              r = [2 * pivot - l, pivot + range, h + 2 * (pivot - l)];
              sup = [2 * pivot - h, pivot - range, l - 2 * (h - pivot)];
              break;
            case 'camarilla':
              r = [c + (1.1 * range) / 12, c + (1.1 * range) / 6, c + (1.1 * range) / 4];
              sup = [c - (1.1 * range) / 12, c - (1.1 * range) / 6, c - (1.1 * range) / 4];
              break;
            default:
              r = [2 * pivot - l, pivot + range, h + 2 * (pivot - l)];
              sup = [2 * pivot - h, pivot - range, l - 2 * (h - pivot)];
          }
          s.levels = [pivot, r[0]!, r[1]!, r[2]!, sup[0]!, sup[1]!, sup[2]!];
        }
        return s.levels;
      },
    );
  },
});

export const cpr = defineIndicator({
  type: 'cpr',
  name: 'Central Pivot Range',
  shortName: 'CPR',
  description:
    'Pivot, top and bottom central levels from the previous trading day, week or month (UTC days without a session).',
  category: 'advanced',
  placement: 'overlay',
  inputs: { period: periodInput },
  outputs: [
    { id: 'top', name: 'TC', kind: 'step', color: colors.blue, lineWidth: 1 },
    { id: 'pivot', name: 'Pivot', kind: 'step', color: colors.purple, lineWidth: 1 },
    { id: 'bottom', name: 'BC', kind: 'step', color: colors.blue, lineWidth: 1 },
  ],
  fills: [{ from: 'top', to: 'bottom', color: 'rgba(41, 98, 255, 0.1)' }],
  create: (p, context) => {
    // Read from the closure: calculator state is deep-copied, a session must not be part of it.
    const session = context?.session ?? null;
    return calc(
      {
        tracker: new PeriodTracker(),
        levels: [N, N, N],
      },
      (s, bar) => {
        const isNew = s.tracker.next(bar, p.period, session);
        if (isNew && Number.isFinite(s.tracker.prevHigh)) {
          const { prevHigh: h, prevLow: l, prevClose: c } = s.tracker;
          const pivot = (h + l + c) / 3;
          const bc = (h + l) / 2;
          const tc = 2 * pivot - bc;
          s.levels = [Math.max(tc, bc), pivot, Math.min(tc, bc)];
        }
        return s.levels;
      },
    );
  },
});

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export const fibonacciLevels = defineIndicator({
  type: 'fib-levels',
  name: 'Fibonacci Retracement Levels (rolling)',
  shortName: 'Fib',
  description:
    'Retracement levels of the highest high and lowest low over a rolling lookback. Measured from the extreme reached last.',
  category: 'advanced',
  placement: 'overlay',
  inputs: { lookback: lengthInput(100, 'Lookback', 2) },
  outputs: FIB_RATIOS.map((ratio, i) => ({
    id: `l${i}`,
    name: String(ratio),
    kind: 'line' as const,
    color: ['#787b86', '#f44336', '#ff9800', '#4caf50', '#009688', '#2196f3', '#787b86'][i]!,
    lineWidth: 1,
  })),
  create: (p) =>
    calc(
      {
        highest: new RollingExtreme(p.lookback, 'max'),
        lowest: new RollingExtreme(p.lookback, 'min'),
      },
      (s, bar) => {
        const hh = s.highest.next(bar.high);
        const ll = s.lowest.next(bar.low);
        if (!Number.isFinite(hh) || !Number.isFinite(ll)) return FIB_RATIOS.map(() => N);
        // Uptrend (low came first): retrace down from the high. Downtrend: retrace up from the low.
        const upTrend = s.highest.barsSince <= s.lowest.barsSince;
        const range = hh - ll;
        return FIB_RATIOS.map((r) => (upTrend ? hh - r * range : ll + r * range));
      },
    ),
});

export const supportResistance = defineIndicator({
  type: 'support-resistance',
  name: 'Support and Resistance (pivots)',
  shortName: 'S/R',
  description:
    'Most recent confirmed pivot high (resistance) and pivot low (support). A pivot is confirmed `rightBars` bars after it occurs.',
  category: 'advanced',
  placement: 'overlay',
  inputs: { leftBars: lengthInput(10, 'Left bars'), rightBars: lengthInput(10, 'Right bars') },
  outputs: [
    { id: 'resistance', name: 'Resistance', kind: 'step', color: colors.red, lineWidth: 2 },
    { id: 'support', name: 'Support', kind: 'step', color: colors.teal, lineWidth: 2 },
  ],
  create: (p) =>
    calc(
      {
        highs: [] as number[],
        lows: [] as number[],
        resistance: N,
        support: N,
      },
      (s, bar) => {
        const size = p.leftBars + p.rightBars + 1;
        s.highs.push(bar.high);
        s.lows.push(bar.low);
        if (s.highs.length > size) {
          s.highs.shift();
          s.lows.shift();
        }
        if (s.highs.length === size) {
          const c = p.leftBars;
          const h = s.highs[c]!;
          const l = s.lows[c]!;
          let isHigh = true;
          let isLow = true;
          for (let i = 0; i < size; i++) {
            if (i === c) continue;
            if (s.highs[i]! >= h) isHigh = false;
            if (s.lows[i]! <= l) isLow = false;
          }
          if (isHigh) s.resistance = h;
          if (isLow) s.support = l;
        }
        return [s.resistance, s.support];
      },
    ),
});

export const premiumDiscount = defineIndicator({
  type: 'premium-discount',
  name: 'Premium and Discount Zones',
  shortName: 'P/D',
  description: 'Rolling range split at its midpoint: above = premium, below = discount.',
  category: 'advanced',
  placement: 'overlay',
  inputs: { lookback: lengthInput(50, 'Lookback', 2) },
  outputs: [
    { id: 'top', name: 'Range high', kind: 'line', color: colors.red, lineWidth: 1 },
    {
      id: 'equilibrium',
      name: 'Equilibrium',
      kind: 'line',
      color: colors.grey,
      lineWidth: 1,
      lineStyle: 'dashed',
    },
    { id: 'bottom', name: 'Range low', kind: 'line', color: colors.teal, lineWidth: 1 },
  ],
  fills: [
    { from: 'top', to: 'equilibrium', color: 'rgba(239, 83, 80, 0.08)' },
    { from: 'equilibrium', to: 'bottom', color: 'rgba(38, 166, 154, 0.08)' },
  ],
  create: (p) =>
    calc(
      {
        highest: new RollingExtreme(p.lookback, 'max'),
        lowest: new RollingExtreme(p.lookback, 'min'),
      },
      (s, bar) => {
        const hh = s.highest.next(bar.high);
        const ll = s.lowest.next(bar.low);
        return [hh, (hh + ll) / 2, ll];
      },
    ),
});

export const advancedIndicators = [
  pivotPoints,
  cpr,
  fibonacciLevels,
  supportResistance,
  premiumDiscount,
];
