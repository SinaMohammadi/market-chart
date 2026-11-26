import { calc, defineIndicator } from '../types.js';
import { price } from '../source.js';
import {
  Ema,
  Lag,
  MeanDeviation,
  RollingExtreme,
  RollingSum,
  RsiState,
  Sma,
} from '../primitives.js';
import { colors, lengthInput, sourceInput } from './common.js';

const N = Number.NaN;

export const rsi = defineIndicator({
  type: 'rsi',
  name: 'Relative Strength Index',
  shortName: 'RSI',
  category: 'momentum',
  placement: 'pane',
  inputs: { length: lengthInput(14, 'Length', 2), source: sourceInput() },
  outputs: [{ id: 'rsi', name: 'RSI', kind: 'line', color: colors.purple }],
  levels: [
    { value: 70, label: '70' },
    { value: 50, label: '50' },
    { value: 30, label: '30' },
  ],
  create: (p) =>
    calc(
      {
        rsi: new RsiState(p.length),
      },
      (s, bar) => {
        return [s.rsi.next(price(bar, p.source))];
      },
    ),
});

export const macd = defineIndicator({
  type: 'macd',
  name: 'Moving Average Convergence Divergence',
  shortName: 'MACD',
  category: 'momentum',
  placement: 'pane',
  inputs: {
    fast: lengthInput(12, 'Fast length'),
    slow: lengthInput(26, 'Slow length'),
    signal: lengthInput(9, 'Signal smoothing'),
    source: sourceInput(),
  },
  outputs: [
    {
      id: 'histogram',
      name: 'Histogram',
      kind: 'histogram',
      color: 'rgba(38, 166, 154, 0.7)',
      colorNegative: 'rgba(239, 83, 80, 0.7)',
      colorMode: 'sign',
    },
    { id: 'macd', name: 'MACD', kind: 'line', color: colors.blue, lineWidth: 2 },
    { id: 'signal', name: 'Signal', kind: 'line', color: colors.orange, lineWidth: 1 },
  ],
  validate: (p) => (p.fast >= p.slow ? 'fast length must be smaller than slow length' : null),
  create: (p) =>
    calc(
      {
        fastMa: new Ema(p.fast),
        slowMa: new Ema(p.slow),
        signalMa: new Ema(p.signal),
      },
      (s, bar) => {
        const v = price(bar, p.source);
        const line = s.fastMa.next(v) - s.slowMa.next(v);
        const signal = s.signalMa.next(line);
        return [line - signal, line, signal];
      },
    ),
});

export const stochastic = defineIndicator({
  type: 'stochastic',
  name: 'Stochastic',
  shortName: 'Stoch',
  category: 'momentum',
  placement: 'pane',
  inputs: {
    kLength: lengthInput(14, '%K length'),
    kSmoothing: lengthInput(1, '%K smoothing'),
    dSmoothing: lengthInput(3, '%D smoothing'),
  },
  outputs: [
    { id: 'k', name: '%K', kind: 'line', color: colors.blue },
    { id: 'd', name: '%D', kind: 'line', color: colors.orange },
  ],
  levels: [
    { value: 80, label: '80' },
    { value: 20, label: '20' },
  ],
  create: (p) =>
    calc(
      {
        highest: new RollingExtreme(p.kLength, 'max'),
        lowest: new RollingExtreme(p.kLength, 'min'),
        kMa: new Sma(p.kSmoothing),
        dMa: new Sma(p.dSmoothing),
      },
      (s, bar) => {
        const hh = s.highest.next(bar.high);
        const ll = s.lowest.next(bar.low);
        const raw = hh > ll ? (100 * (bar.close - ll)) / (hh - ll) : hh === ll ? 50 : N;
        const k = s.kMa.next(raw);
        return [k, s.dMa.next(k)];
      },
    ),
});

export const stochRsi = defineIndicator({
  type: 'stoch-rsi',
  name: 'Stochastic RSI',
  shortName: 'Stoch RSI',
  category: 'momentum',
  placement: 'pane',
  inputs: {
    k: lengthInput(3, 'K'),
    d: lengthInput(3, 'D'),
    rsiLength: lengthInput(14, 'RSI length', 2),
    stochLength: lengthInput(14, 'Stochastic length'),
    source: sourceInput(),
  },
  outputs: [
    { id: 'k', name: 'K', kind: 'line', color: colors.blue },
    { id: 'd', name: 'D', kind: 'line', color: colors.orange },
  ],
  levels: [
    { value: 80, label: '80' },
    { value: 20, label: '20' },
  ],
  create: (p) =>
    calc(
      {
        rsi: new RsiState(p.rsiLength),
        highest: new RollingExtreme(p.stochLength, 'max'),
        lowest: new RollingExtreme(p.stochLength, 'min'),
        kMa: new Sma(p.k),
        dMa: new Sma(p.d),
      },
      (s, bar) => {
        const r = s.rsi.next(price(bar, p.source));
        const hh = s.highest.next(r);
        const ll = s.lowest.next(r);
        const raw = hh > ll ? (100 * (r - ll)) / (hh - ll) : hh === ll ? 50 : N;
        const k = s.kMa.next(raw);
        return [k, s.dMa.next(k)];
      },
    ),
});

export const cci = defineIndicator({
  type: 'cci',
  name: 'Commodity Channel Index',
  shortName: 'CCI',
  category: 'momentum',
  placement: 'pane',
  inputs: { length: lengthInput(20), source: sourceInput('hlc3') },
  outputs: [{ id: 'cci', name: 'CCI', kind: 'line', color: colors.blue }],
  levels: [
    { value: 100, label: '+100' },
    { value: 0, label: '0' },
    { value: -100, label: '−100' },
  ],
  create: (p) =>
    calc(
      {
        ma: new Sma(p.length),
        dev: new MeanDeviation(p.length),
      },
      (s, bar) => {
        const v = price(bar, p.source);
        const mean = s.ma.next(v);
        const dev = s.dev.next(v, mean);
        return [dev > 0 ? (v - mean) / (0.015 * dev) : N];
      },
    ),
});

export const roc = defineIndicator({
  type: 'roc',
  name: 'Rate of Change',
  shortName: 'ROC',
  category: 'momentum',
  placement: 'pane',
  inputs: { length: lengthInput(9), source: sourceInput() },
  outputs: [{ id: 'roc', name: 'ROC', kind: 'line', color: colors.blue }],
  levels: [{ value: 0, label: '0' }],
  create: (p) =>
    calc(
      {
        lag: new Lag(p.length),
      },
      (s, bar) => {
        const v = price(bar, p.source);
        const old = s.lag.next(v);
        return [old !== 0 ? (100 * (v - old)) / old : N];
      },
    ),
});

export const momentum = defineIndicator({
  type: 'momentum',
  name: 'Momentum',
  shortName: 'Mom',
  category: 'momentum',
  placement: 'pane',
  inputs: { length: lengthInput(10), source: sourceInput() },
  outputs: [{ id: 'mom', name: 'Momentum', kind: 'line', color: colors.blue }],
  levels: [{ value: 0, label: '0' }],
  create: (p) =>
    calc(
      {
        lag: new Lag(p.length),
      },
      (s, bar) => {
        const v = price(bar, p.source);
        return [v - s.lag.next(v)];
      },
    ),
});

export const williamsR = defineIndicator({
  type: 'williams-r',
  name: 'Williams %R',
  shortName: '%R',
  category: 'momentum',
  placement: 'pane',
  inputs: { length: lengthInput(14), source: sourceInput() },
  outputs: [{ id: 'r', name: '%R', kind: 'line', color: colors.purple }],
  levels: [
    { value: -20, label: '−20' },
    { value: -50, label: '−50' },
    { value: -80, label: '−80' },
  ],
  create: (p) =>
    calc(
      {
        highest: new RollingExtreme(p.length, 'max'),
        lowest: new RollingExtreme(p.length, 'min'),
      },
      (s, bar) => {
        const hh = s.highest.next(bar.high);
        const ll = s.lowest.next(bar.low);
        return [hh > ll ? (100 * (price(bar, p.source) - hh)) / (hh - ll) : N];
      },
    ),
});

export const awesomeOscillator = defineIndicator({
  type: 'ao',
  name: 'Awesome Oscillator',
  shortName: 'AO',
  category: 'momentum',
  placement: 'pane',
  inputs: { fast: lengthInput(5, 'Fast length'), slow: lengthInput(34, 'Slow length') },
  outputs: [
    {
      id: 'ao',
      name: 'AO',
      kind: 'histogram',
      color: 'rgba(38, 166, 154, 0.8)',
      colorNegative: 'rgba(239, 83, 80, 0.8)',
      colorMode: 'change',
    },
  ],
  validate: (p) => (p.fast >= p.slow ? 'fast length must be smaller than slow length' : null),
  create: (p) =>
    calc(
      {
        fastMa: new Sma(p.fast),
        slowMa: new Sma(p.slow),
      },
      (s, bar) => {
        const v = (bar.high + bar.low) / 2;
        return [s.fastMa.next(v) - s.slowMa.next(v)];
      },
    ),
});

export const ultimateOscillator = defineIndicator({
  type: 'uo',
  name: 'Ultimate Oscillator',
  shortName: 'UO',
  category: 'momentum',
  placement: 'pane',
  inputs: {
    fast: lengthInput(7, 'Fast length'),
    middle: lengthInput(14, 'Middle length'),
    slow: lengthInput(28, 'Slow length'),
  },
  outputs: [{ id: 'uo', name: 'UO', kind: 'line', color: colors.red }],
  levels: [
    { value: 70, label: '70' },
    { value: 30, label: '30' },
  ],
  create: (p) =>
    calc(
      {
        bp1: new RollingSum(p.fast),
        tr1: new RollingSum(p.fast),
        bp2: new RollingSum(p.middle),
        tr2: new RollingSum(p.middle),
        bp3: new RollingSum(p.slow),
        tr3: new RollingSum(p.slow),
        prevClose: N,
      },
      (s, bar) => {
        const prev = s.prevClose;
        s.prevClose = bar.close;
        if (!Number.isFinite(prev)) return [N];
        const low = Math.min(bar.low, prev);
        const bp = bar.close - low;
        const tr = Math.max(bar.high, prev) - low;
        const a1 = s.bp1.next(bp) / s.tr1.next(tr);
        const a2 = s.bp2.next(bp) / s.tr2.next(tr);
        const a3 = s.bp3.next(bp) / s.tr3.next(tr);
        return [(100 * (4 * a1 + 2 * a2 + a3)) / 7];
      },
    ),
});

export const trix = defineIndicator({
  type: 'trix',
  name: 'TRIX',
  shortName: 'TRIX',
  category: 'momentum',
  placement: 'pane',
  inputs: { length: lengthInput(18) },
  outputs: [{ id: 'trix', name: 'TRIX', kind: 'line', color: colors.red }],
  levels: [{ value: 0, label: '0' }],
  create: (p) =>
    calc(
      {
        e1: new Ema(p.length),
        e2: new Ema(p.length),
        e3: new Ema(p.length),
        lag: new Lag(1),
      },
      (s, bar) => {
        const v = bar.close > 0 ? Math.log(bar.close) : N;
        const e = s.e3.next(s.e2.next(s.e1.next(v)));
        return [10000 * (e - s.lag.next(e))];
      },
    ),
});

export const momentumIndicators = [
  rsi,
  macd,
  stochastic,
  stochRsi,
  cci,
  roc,
  momentum,
  williamsR,
  awesomeOscillator,
  ultimateOscillator,
  trix,
];
