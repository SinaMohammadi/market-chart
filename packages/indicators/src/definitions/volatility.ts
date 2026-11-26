import { calc, defineIndicator } from '../types.js';
import { price, trueRange } from '../source.js';
import { AtrState, Ema, Lag, RollingExtreme, Rma, Sma, StdDev } from '../primitives.js';
import { colors, lengthInput, maTypeInput, multiplierInput, sourceInput } from './common.js';

const N = Number.NaN;

export const bollinger = defineIndicator({
  type: 'bollinger',
  name: 'Bollinger Bands',
  shortName: 'BB',
  category: 'volatility',
  placement: 'overlay',
  inputs: {
    length: lengthInput(20),
    multiplier: multiplierInput(2, 'StdDev'),
    source: sourceInput(),
  },
  outputs: [
    { id: 'basis', name: 'Basis', kind: 'line', color: colors.orange, lineWidth: 1 },
    { id: 'upper', name: 'Upper', kind: 'line', color: colors.blue, lineWidth: 1 },
    { id: 'lower', name: 'Lower', kind: 'line', color: colors.blue, lineWidth: 1 },
  ],
  fills: [{ from: 'upper', to: 'lower', color: 'rgba(41, 98, 255, 0.08)' }],
  create: (p) =>
    calc(
      {
        ma: new Sma(p.length),
        dev: new StdDev(p.length),
      },
      (s, bar) => {
        const v = price(bar, p.source);
        const basis = s.ma.next(v);
        const d = s.dev.next(v) * p.multiplier;
        return [basis, basis + d, basis - d];
      },
    ),
});

export const atr = defineIndicator({
  type: 'atr',
  name: 'Average True Range',
  shortName: 'ATR',
  category: 'volatility',
  placement: 'pane',
  inputs: { length: lengthInput(14), smoothing: maTypeInput('rma') },
  outputs: [{ id: 'atr', name: 'ATR', kind: 'line', color: colors.red }],
  create: (p) =>
    calc(
      {
        atr: new AtrState(p.length, p.smoothing),
      },
      (s, bar) => {
        return [s.atr.next(bar.high, bar.low, bar.close)];
      },
    ),
});

export const keltner = defineIndicator({
  type: 'keltner',
  name: 'Keltner Channels',
  shortName: 'KC',
  category: 'volatility',
  placement: 'overlay',
  inputs: {
    length: lengthInput(20),
    multiplier: multiplierInput(2),
    source: sourceInput(),
    useEma: { type: 'bool', default: true, label: 'Use exponential MA' },
    bandsStyle: {
      type: 'enum',
      default: 'atr',
      options: ['atr', 'tr', 'range'],
      label: 'Bands style',
    },
    atrLength: lengthInput(10, 'ATR length'),
  },
  outputs: [
    { id: 'basis', name: 'Basis', kind: 'line', color: colors.blue, lineWidth: 1 },
    { id: 'upper', name: 'Upper', kind: 'line', color: colors.blue, lineWidth: 1 },
    { id: 'lower', name: 'Lower', kind: 'line', color: colors.blue, lineWidth: 1 },
  ],
  fills: [{ from: 'upper', to: 'lower', color: 'rgba(41, 98, 255, 0.07)' }],
  create: (p) =>
    calc(
      {
        ma: p.useEma ? new Ema(p.length) : new Sma(p.length),
        atr: new AtrState(p.atrLength),
        range: new Rma(p.length),
        prevClose: N,
      },
      (s, bar) => {
        const basis = s.ma.next(price(bar, p.source));
        const atrValue = s.atr.next(bar.high, bar.low, bar.close);
        const tr = trueRange(bar, s.prevClose);
        s.prevClose = bar.close;
        const rangeValue = s.range.next(bar.high - bar.low);
        const width = p.bandsStyle === 'atr' ? atrValue : p.bandsStyle === 'tr' ? tr : rangeValue;
        return [basis, basis + p.multiplier * width, basis - p.multiplier * width];
      },
    ),
});

export const donchian = defineIndicator({
  type: 'donchian',
  name: 'Donchian Channels',
  shortName: 'DC',
  category: 'volatility',
  placement: 'overlay',
  inputs: { length: lengthInput(20) },
  outputs: [
    { id: 'basis', name: 'Basis', kind: 'line', color: colors.orange, lineWidth: 1 },
    { id: 'upper', name: 'Upper', kind: 'line', color: colors.blue, lineWidth: 1 },
    { id: 'lower', name: 'Lower', kind: 'line', color: colors.blue, lineWidth: 1 },
  ],
  fills: [{ from: 'upper', to: 'lower', color: 'rgba(41, 98, 255, 0.07)' }],
  create: (p) =>
    calc(
      {
        highest: new RollingExtreme(p.length, 'max'),
        lowest: new RollingExtreme(p.length, 'min'),
      },
      (s, bar) => {
        const upper = s.highest.next(bar.high);
        const lower = s.lowest.next(bar.low);
        return [(upper + lower) / 2, upper, lower];
      },
    ),
});

export const stdDev = defineIndicator({
  type: 'stddev',
  name: 'Standard Deviation',
  shortName: 'StdDev',
  category: 'volatility',
  placement: 'pane',
  inputs: { length: lengthInput(20, 'Length', 2), source: sourceInput() },
  outputs: [{ id: 'stddev', name: 'StdDev', kind: 'line', color: colors.blue }],
  create: (p) =>
    calc(
      {
        dev: new StdDev(p.length),
      },
      (s, bar) => {
        return [s.dev.next(price(bar, p.source))];
      },
    ),
});

export const historicalVolatility = defineIndicator({
  type: 'hv',
  name: 'Historical Volatility',
  shortName: 'HV',
  category: 'volatility',
  placement: 'pane',
  inputs: {
    length: lengthInput(10, 'Length', 2),
    periodsPerYear: { type: 'int', default: 365, min: 1, max: 1_000_000, label: 'Bars per year' },
  },
  outputs: [{ id: 'hv', name: 'HV', kind: 'line', color: colors.blue }],
  create: (p) =>
    calc(
      {
        dev: new StdDev(p.length),
        prevClose: N,
      },
      (s, bar) => {
        const prev = s.prevClose;
        s.prevClose = bar.close;
        const ret = prev > 0 && bar.close > 0 ? Math.log(bar.close / prev) : N;
        return [100 * s.dev.next(ret) * Math.sqrt(p.periodsPerYear)];
      },
    ),
});

export const chaikinVolatility = defineIndicator({
  type: 'chaikin-volatility',
  name: 'Chaikin Volatility',
  shortName: 'CV',
  category: 'volatility',
  placement: 'pane',
  inputs: { emaLength: lengthInput(10, 'EMA length'), rocLength: lengthInput(10, 'ROC length') },
  outputs: [{ id: 'cv', name: 'CV', kind: 'line', color: colors.blue }],
  levels: [{ value: 0, label: '0' }],
  create: (p) =>
    calc(
      {
        ma: new Ema(p.emaLength),
        lag: new Lag(p.rocLength),
      },
      (s, bar) => {
        const e = s.ma.next(bar.high - bar.low);
        const old = s.lag.next(e);
        return [old > 0 ? (100 * (e - old)) / old : N];
      },
    ),
});

export const volatilityIndicators = [
  bollinger,
  atr,
  keltner,
  donchian,
  stdDev,
  historicalVolatility,
  chaikinVolatility,
];
