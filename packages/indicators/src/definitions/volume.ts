import { calc, defineIndicator } from '../types.js';
import type { Bar } from '../types.js';
import { price, volumeOf } from '../source.js';
import { Ema, RollingSum, Sma } from '../primitives.js';
import { colors, lengthInput, multiplierInput, periodKey, sourceInput } from './common.js';

const N = Number.NaN;

export const volume = defineIndicator({
  type: 'volume',
  name: 'Volume',
  shortName: 'Vol',
  category: 'volume',
  placement: 'pane',
  needsVolume: true,
  priceFormat: { type: 'volume' },
  inputs: { maLength: lengthInput(20, 'MA length') },
  outputs: [
    {
      id: 'volume',
      name: 'Volume',
      kind: 'histogram',
      color: 'rgba(38, 166, 154, 0.5)',
      colorNegative: 'rgba(239, 83, 80, 0.5)',
      colorMode: 'bar',
    },
    { id: 'ma', name: 'Volume MA', kind: 'line', color: colors.blue, lineWidth: 1 },
  ],
  create: (p) =>
    calc(
      {
        ma: new Sma(p.maLength),
      },
      (s, bar) => {
        const v = Number.isFinite(bar.volume) ? bar.volume : N;
        return [v, s.ma.next(v)];
      },
    ),
});

export const obv = defineIndicator({
  type: 'obv',
  name: 'On Balance Volume',
  shortName: 'OBV',
  category: 'volume',
  placement: 'pane',
  needsVolume: true,
  priceFormat: { type: 'volume' },
  inputs: {},
  outputs: [{ id: 'obv', name: 'OBV', kind: 'line', color: colors.blue }],
  create: () =>
    calc(
      {
        total: 0,
        prevClose: N,
      },
      (s, bar) => {
        if (Number.isFinite(s.prevClose))
          s.total += Math.sign(bar.close - s.prevClose) * volumeOf(bar);
        s.prevClose = bar.close;
        return [s.total];
      },
    ),
});

/** Session/period VWAP state with standard-deviation bands. */
class VwapState {
  sumPv = 0;
  sumV = 0;
  sumP2v = 0;

  reset(): void {
    this.sumPv = 0;
    this.sumV = 0;
    this.sumP2v = 0;
  }

  next(p: number, v: number, k: number): number[] {
    this.sumPv += p * v;
    this.sumV += v;
    this.sumP2v += p * p * v;
    if (this.sumV <= 0) return [N, N, N];
    const vwap = this.sumPv / this.sumV;
    if (k <= 0) return [vwap, N, N];
    const dev = Math.sqrt(Math.max(0, this.sumP2v / this.sumV - vwap * vwap));
    return [vwap, vwap + k * dev, vwap - k * dev];
  }
}

const vwapOutputs = [
  { id: 'vwap', name: 'VWAP', kind: 'line', color: colors.blue, lineWidth: 2 },
  { id: 'upper', name: 'Upper band', kind: 'line', color: colors.teal, lineWidth: 1 },
  { id: 'lower', name: 'Lower band', kind: 'line', color: colors.teal, lineWidth: 1 },
] as const;

export const vwap = defineIndicator({
  type: 'vwap',
  name: 'Volume Weighted Average Price',
  shortName: 'VWAP',
  description:
    'Resets at the start of each trading day, week (Monday) or month; UTC days without a session.',
  category: 'volume',
  placement: 'overlay',
  needsVolume: true,
  inputs: {
    anchor: {
      type: 'enum',
      default: 'day',
      options: ['day', 'week', 'month'],
      label: 'Anchor period',
    },
    source: sourceInput('hlc3'),
    bandMultiplier: multiplierInput(1, 'Bands multiplier (0 = off)'),
  },
  outputs: vwapOutputs,
  fills: [{ from: 'upper', to: 'lower', color: 'rgba(38, 166, 154, 0.06)' }],
  create: (p, context) => {
    // Read from the closure: calculator state is deep-copied, a session must not be part of it.
    const session = context?.session ?? null;
    return calc(
      {
        state: new VwapState(),
        period: N,
      },
      (s, bar) => {
        const key = periodKey(bar.time, p.anchor, session);
        if (key !== s.period) {
          s.period = key;
          s.state.reset();
        }
        return s.state.next(price(bar, p.source), volumeOf(bar), p.bandMultiplier);
      },
    );
  },
});

export const anchoredVwap = defineIndicator({
  type: 'anchored-vwap',
  name: 'Anchored VWAP',
  shortName: 'AVWAP',
  description: 'VWAP accumulated from the anchor time (or the first bar when no anchor is set).',
  category: 'volume',
  placement: 'overlay',
  needsVolume: true,
  inputs: {
    anchorTime: { type: 'time', default: null, label: 'Anchor time' },
    source: sourceInput('hlc3'),
    bandMultiplier: multiplierInput(0, 'Bands multiplier (0 = off)'),
  },
  outputs: vwapOutputs,
  create: (p) =>
    calc(
      {
        state: new VwapState(),
      },
      (s, bar) => {
        if (p.anchorTime !== null && bar.time < p.anchorTime) return [N, N, N];
        return s.state.next(price(bar, p.source), volumeOf(bar), p.bandMultiplier);
      },
    ),
});

export const mfi = defineIndicator({
  type: 'mfi',
  name: 'Money Flow Index',
  shortName: 'MFI',
  category: 'volume',
  placement: 'pane',
  needsVolume: true,
  inputs: { length: lengthInput(14) },
  outputs: [{ id: 'mfi', name: 'MFI', kind: 'line', color: colors.purple }],
  levels: [
    { value: 80, label: '80' },
    { value: 20, label: '20' },
  ],
  create: (p) =>
    calc(
      {
        positive: new RollingSum(p.length),
        negative: new RollingSum(p.length),
        prevTp: N,
      },
      (s, bar) => {
        const tp = (bar.high + bar.low + bar.close) / 3;
        const prev = s.prevTp;
        s.prevTp = tp;
        if (!Number.isFinite(prev)) return [N];
        const flow = tp * volumeOf(bar);
        const up = s.positive.next(tp > prev ? flow : 0);
        const down = s.negative.next(tp < prev ? flow : 0);
        if (!Number.isFinite(up) || !Number.isFinite(down)) return [N];
        return [down === 0 ? 100 : 100 - 100 / (1 + up / down)];
      },
    ),
});

/** Money flow volume of a bar (Chaikin). */
function moneyFlowVolume(bar: Bar): number {
  const range = bar.high - bar.low;
  if (range === 0) return 0;
  return ((2 * bar.close - bar.low - bar.high) / range) * volumeOf(bar);
}

export const cmf = defineIndicator({
  type: 'cmf',
  name: 'Chaikin Money Flow',
  shortName: 'CMF',
  category: 'volume',
  placement: 'pane',
  needsVolume: true,
  inputs: { length: lengthInput(20) },
  outputs: [{ id: 'cmf', name: 'CMF', kind: 'line', color: colors.teal }],
  levels: [{ value: 0, label: '0' }],
  create: (p) =>
    calc(
      {
        flow: new RollingSum(p.length),
        vol: new RollingSum(p.length),
      },
      (s, bar) => {
        const f = s.flow.next(moneyFlowVolume(bar));
        const v = s.vol.next(volumeOf(bar));
        return [v > 0 ? f / v : N];
      },
    ),
});

export const accumulationDistribution = defineIndicator({
  type: 'ad',
  name: 'Accumulation/Distribution',
  shortName: 'A/D',
  category: 'volume',
  placement: 'pane',
  needsVolume: true,
  priceFormat: { type: 'volume' },
  inputs: {},
  outputs: [{ id: 'ad', name: 'A/D', kind: 'line', color: colors.blue }],
  create: () =>
    calc(
      {
        total: 0,
      },
      (s, bar) => {
        s.total += moneyFlowVolume(bar);
        return [s.total];
      },
    ),
});

export const volumeOscillator = defineIndicator({
  type: 'volume-oscillator',
  name: 'Volume Oscillator',
  shortName: 'Vol Osc',
  category: 'volume',
  placement: 'pane',
  needsVolume: true,
  inputs: { short: lengthInput(5, 'Short length'), long: lengthInput(10, 'Long length') },
  outputs: [{ id: 'osc', name: 'Volume Osc', kind: 'line', color: colors.blue }],
  levels: [{ value: 0, label: '0' }],
  validate: (p) => (p.short >= p.long ? 'short length must be smaller than long length' : null),
  create: (p) =>
    calc(
      {
        shortMa: new Ema(p.short),
        longMa: new Ema(p.long),
      },
      (s, bar) => {
        const v = volumeOf(bar);
        const short = s.shortMa.next(v);
        const long = s.longMa.next(v);
        return [long > 0 ? (100 * (short - long)) / long : N];
      },
    ),
});

export const volumeIndicators = [
  volume,
  obv,
  vwap,
  anchoredVwap,
  mfi,
  cmf,
  accumulationDistribution,
  volumeOscillator,
];
