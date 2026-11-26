import { calc, defineIndicator } from '../types.js';
import { price, volumeOf } from '../source.js';
import { AtrState, Ema, RollingExtreme, Rma, Sma, Wma, createMa } from '../primitives.js';
import { colors, lengthInput, multiplierInput, sourceInput } from './common.js';

const N = Number.NaN;

export const sma = defineIndicator({
  type: 'sma',
  name: 'Simple Moving Average',
  shortName: 'SMA',
  category: 'trend',
  placement: 'overlay',
  inputs: { length: lengthInput(20), source: sourceInput() },
  outputs: [{ id: 'ma', name: 'SMA', kind: 'line', color: colors.blue }],
  create: (p) =>
    calc(
      {
        ma: new Sma(p.length),
      },
      (s, bar) => {
        return [s.ma.next(price(bar, p.source))];
      },
    ),
});

export const ema = defineIndicator({
  type: 'ema',
  name: 'Exponential Moving Average',
  shortName: 'EMA',
  category: 'trend',
  placement: 'overlay',
  inputs: { length: lengthInput(20), source: sourceInput() },
  outputs: [{ id: 'ma', name: 'EMA', kind: 'line', color: colors.orange }],
  create: (p) =>
    calc(
      {
        ma: new Ema(p.length),
      },
      (s, bar) => {
        return [s.ma.next(price(bar, p.source))];
      },
    ),
});

export const wma = defineIndicator({
  type: 'wma',
  name: 'Weighted Moving Average',
  shortName: 'WMA',
  category: 'trend',
  placement: 'overlay',
  inputs: { length: lengthInput(20), source: sourceInput() },
  outputs: [{ id: 'ma', name: 'WMA', kind: 'line', color: colors.purple }],
  create: (p) =>
    calc(
      {
        ma: new Wma(p.length),
      },
      (s, bar) => {
        return [s.ma.next(price(bar, p.source))];
      },
    ),
});

export const vwma = defineIndicator({
  type: 'vwma',
  name: 'Volume Weighted Moving Average',
  shortName: 'VWMA',
  category: 'trend',
  placement: 'overlay',
  needsVolume: true,
  inputs: { length: lengthInput(20), source: sourceInput() },
  outputs: [{ id: 'ma', name: 'VWMA', kind: 'line', color: colors.cyan }],
  create: (p) =>
    calc(
      {
        pv: new Sma(p.length),
        v: new Sma(p.length),
      },
      (s, bar) => {
        const volume = volumeOf(bar);
        const num = s.pv.next(price(bar, p.source) * volume);
        const den = s.v.next(volume);
        return [den > 0 ? num / den : N];
      },
    ),
});

export const dema = defineIndicator({
  type: 'dema',
  name: 'Double Exponential Moving Average',
  shortName: 'DEMA',
  category: 'trend',
  placement: 'overlay',
  inputs: { length: lengthInput(20), source: sourceInput() },
  outputs: [{ id: 'ma', name: 'DEMA', kind: 'line', color: colors.teal }],
  create: (p) =>
    calc(
      {
        e1: new Ema(p.length),
        e2: new Ema(p.length),
      },
      (s, bar) => {
        const a = s.e1.next(price(bar, p.source));
        const b = s.e2.next(a);
        return [2 * a - b];
      },
    ),
});

export const tema = defineIndicator({
  type: 'tema',
  name: 'Triple Exponential Moving Average',
  shortName: 'TEMA',
  category: 'trend',
  placement: 'overlay',
  inputs: { length: lengthInput(20), source: sourceInput() },
  outputs: [{ id: 'ma', name: 'TEMA', kind: 'line', color: colors.pink }],
  create: (p) =>
    calc(
      {
        e1: new Ema(p.length),
        e2: new Ema(p.length),
        e3: new Ema(p.length),
      },
      (s, bar) => {
        const a = s.e1.next(price(bar, p.source));
        const b = s.e2.next(a);
        const c = s.e3.next(b);
        return [3 * a - 3 * b + c];
      },
    ),
});

export const hma = defineIndicator({
  type: 'hma',
  name: 'Hull Moving Average',
  shortName: 'HMA',
  category: 'trend',
  placement: 'overlay',
  inputs: { length: lengthInput(9, 'Length', 2), source: sourceInput() },
  outputs: [{ id: 'ma', name: 'HMA', kind: 'line', color: colors.yellow }],
  create: (p) =>
    calc(
      {
        half: new Wma(Math.max(1, Math.floor(p.length / 2))),
        full: new Wma(p.length),
        out: new Wma(Math.max(1, Math.floor(Math.sqrt(p.length)))),
      },
      (s, bar) => {
        const v = price(bar, p.source);
        const h = s.half.next(v);
        const f = s.full.next(v);
        return [s.out.next(2 * h - f)];
      },
    ),
});

export const maRibbon = defineIndicator({
  type: 'ma-ribbon',
  name: 'Moving Average Ribbon',
  shortName: 'Ribbon',
  category: 'trend',
  placement: 'overlay',
  inputs: {
    maType: { type: 'enum', default: 'ema', options: ['ema', 'sma'], label: 'Type' },
    start: lengthInput(20, 'First length'),
    step: lengthInput(10, 'Step'),
    source: sourceInput(),
  },
  outputs: [
    '#f44336',
    '#ff7043',
    '#ffa726',
    '#ffca28',
    '#d4e157',
    '#9ccc65',
    '#66bb6a',
    '#26a69a',
  ].map((color, i) => ({
    id: `ma${i + 1}`,
    name: `MA ${i + 1}`,
    kind: 'line' as const,
    color,
    lineWidth: 1,
  })),
  create: (p) =>
    calc(
      {
        mas: Array.from({ length: 8 }, (_, i) => createMa(p.maType, p.start + i * p.step)),
      },
      (s, bar) => {
        const v = price(bar, p.source);
        return s.mas.map((m) => m.next(v));
      },
    ),
});

export const supertrend = defineIndicator({
  type: 'supertrend',
  name: 'Supertrend',
  shortName: 'Supertrend',
  category: 'trend',
  placement: 'overlay',
  inputs: { atrPeriod: lengthInput(10, 'ATR length'), factor: multiplierInput(3, 'Factor') },
  outputs: [
    { id: 'up', name: 'Up trend', kind: 'line', color: colors.teal, lineWidth: 2 },
    { id: 'down', name: 'Down trend', kind: 'line', color: colors.red, lineWidth: 2 },
  ],
  create: (p) =>
    calc(
      {
        atr: new AtrState(p.atrPeriod),
        prevAtr: N,
        prevLower: N,
        prevUpper: N,
        prevClose: N,
        prevTrend: N,
        direction: 1,
      },
      (s, bar) => {
        const atr = s.atr.next(bar.high, bar.low, bar.close);
        const prevClose = s.prevClose;
        s.prevClose = bar.close;
        if (!Number.isFinite(atr)) return [N, N];
        const mid = (bar.high + bar.low) / 2;
        let lower = mid - p.factor * atr;
        let upper = mid + p.factor * atr;
        const pl = s.prevLower;
        const pu = s.prevUpper;
        if (Number.isFinite(pl)) lower = lower > pl || prevClose < pl ? lower : pl;
        if (Number.isFinite(pu)) upper = upper < pu || prevClose > pu ? upper : pu;
        if (!Number.isFinite(s.prevAtr)) s.direction = 1;
        else if (s.prevTrend === pu) s.direction = bar.close > upper ? -1 : 1;
        else s.direction = bar.close < lower ? 1 : -1;
        const trend = s.direction === -1 ? lower : upper;
        s.prevAtr = atr;
        s.prevLower = lower;
        s.prevUpper = upper;
        s.prevTrend = trend;
        // direction -1 = up trend (line below price), +1 = down trend.
        return s.direction === -1 ? [trend, N] : [N, trend];
      },
    ),
});

export const parabolicSar = defineIndicator({
  type: 'psar',
  name: 'Parabolic SAR',
  shortName: 'SAR',
  category: 'trend',
  placement: 'overlay',
  inputs: {
    start: { type: 'float', default: 0.02, min: 0.001, max: 1, step: 0.01, label: 'Start' },
    increment: { type: 'float', default: 0.02, min: 0.001, max: 1, step: 0.01, label: 'Increment' },
    maximum: { type: 'float', default: 0.2, min: 0.001, max: 1, step: 0.01, label: 'Maximum' },
  },
  outputs: [{ id: 'sar', name: 'SAR', kind: 'dots', color: colors.blue }],
  validate: (p) => (p.start > p.maximum ? 'start must not exceed maximum' : null),
  create: (p) =>
    calc(
      {
        index: 0,
        result: N,
        maxMin: N,
        acceleration: N,
        isBelow: false,
        high1: N,
        low1: N,
        high2: N,
        low2: N,
        close1: N,
      },
      (s, bar) => {
        const i = s.index++;
        let out = N;
        if (i >= 1) {
          let firstTrendBar = false;
          if (i === 1) {
            if (bar.close > s.close1) {
              s.isBelow = true;
              s.maxMin = bar.high;
              s.result = s.low1;
            } else {
              s.isBelow = false;
              s.maxMin = bar.low;
              s.result = s.high1;
            }
            firstTrendBar = true;
            s.acceleration = p.start;
          }
          s.result = s.result + s.acceleration * (s.maxMin - s.result);
          if (s.isBelow) {
            if (s.result > bar.low) {
              firstTrendBar = true;
              s.isBelow = false;
              s.result = Math.max(bar.high, s.maxMin);
              s.maxMin = bar.low;
              s.acceleration = p.start;
            }
          } else if (s.result < bar.high) {
            firstTrendBar = true;
            s.isBelow = true;
            s.result = Math.min(bar.low, s.maxMin);
            s.maxMin = bar.high;
            s.acceleration = p.start;
          }
          if (!firstTrendBar) {
            if (s.isBelow) {
              if (bar.high > s.maxMin) {
                s.maxMin = bar.high;
                s.acceleration = Math.min(s.acceleration + p.increment, p.maximum);
              }
            } else if (bar.low < s.maxMin) {
              s.maxMin = bar.low;
              s.acceleration = Math.min(s.acceleration + p.increment, p.maximum);
            }
          }
          if (s.isBelow) {
            s.result = Math.min(s.result, s.low1);
            if (i > 1) s.result = Math.min(s.result, s.low2);
          } else {
            s.result = Math.max(s.result, s.high1);
            if (i > 1) s.result = Math.max(s.result, s.high2);
          }
          out = s.result;
        }
        s.high2 = s.high1;
        s.low2 = s.low1;
        s.high1 = bar.high;
        s.low1 = bar.low;
        s.close1 = bar.close;
        return [out];
      },
    ),
});

export const adx = defineIndicator({
  type: 'adx',
  name: 'Average Directional Index',
  shortName: 'ADX',
  category: 'trend',
  placement: 'pane',
  inputs: {
    diLength: lengthInput(14, 'DI length'),
    adxSmoothing: lengthInput(14, 'ADX smoothing'),
  },
  outputs: [
    { id: 'adx', name: 'ADX', kind: 'line', color: colors.red, lineWidth: 2 },
    { id: 'plusDi', name: '+DI', kind: 'line', color: colors.teal, lineWidth: 1 },
    { id: 'minusDi', name: '−DI', kind: 'line', color: colors.orange, lineWidth: 1 },
  ],
  levels: [{ value: 25, label: '25' }],
  create: (p) =>
    calc(
      {
        tr: new Rma(p.diLength),
        plusDm: new Rma(p.diLength),
        minusDm: new Rma(p.diLength),
        smooth: new Rma(p.adxSmoothing),
        prevHigh: N,
        prevLow: N,
        prevClose: N,
        plus: N,
        minus: N,
      },
      (s, bar) => {
        const { prevHigh, prevLow, prevClose } = s;
        s.prevHigh = bar.high;
        s.prevLow = bar.low;
        s.prevClose = bar.close;
        if (!Number.isFinite(prevHigh)) return [N, N, N];
        const up = bar.high - prevHigh;
        const down = prevLow - bar.low;
        const tr = Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - prevClose),
          Math.abs(bar.low - prevClose),
        );
        const atr = s.tr.next(tr);
        const pdm = s.plusDm.next(up > down && up > 0 ? up : 0);
        const mdm = s.minusDm.next(down > up && down > 0 ? down : 0);
        if (Number.isFinite(atr) && atr > 0) {
          // Like Pine's fixnan: keep the previous DI when the range is zero.
          s.plus = (100 * pdm) / atr;
          s.minus = (100 * mdm) / atr;
        }
        if (!Number.isFinite(s.plus)) return [N, N, N];
        const sum = s.plus + s.minus;
        const value = s.smooth.next(Math.abs(s.plus - s.minus) / (sum === 0 ? 1 : sum));
        return [100 * value, s.plus, s.minus];
      },
    ),
});

export const aroon = defineIndicator({
  type: 'aroon',
  name: 'Aroon',
  shortName: 'Aroon',
  category: 'trend',
  placement: 'pane',
  inputs: { length: lengthInput(14) },
  outputs: [
    { id: 'up', name: 'Aroon Up', kind: 'line', color: colors.orange },
    { id: 'down', name: 'Aroon Down', kind: 'line', color: colors.blue },
  ],
  create: (p) =>
    calc(
      {
        highest: new RollingExtreme(p.length + 1, 'max'),
        lowest: new RollingExtreme(p.length + 1, 'min'),
      },
      (s, bar) => {
        const h = s.highest.next(bar.high);
        const l = s.lowest.next(bar.low);
        if (!Number.isFinite(h) || !Number.isFinite(l)) return [N, N];
        return [
          (100 * (p.length - s.highest.barsSince)) / p.length,
          (100 * (p.length - s.lowest.barsSince)) / p.length,
        ];
      },
    ),
});

export const ichimoku = defineIndicator({
  type: 'ichimoku',
  name: 'Ichimoku Cloud',
  shortName: 'Ichimoku',
  category: 'trend',
  placement: 'overlay',
  inputs: {
    conversion: lengthInput(9, 'Conversion line'),
    base: lengthInput(26, 'Base line'),
    spanB: lengthInput(52, 'Leading span B'),
    displacement: lengthInput(26, 'Displacement'),
  },
  outputs: [
    { id: 'conversion', name: 'Conversion', kind: 'line', color: colors.blue, lineWidth: 1 },
    { id: 'base', name: 'Base', kind: 'line', color: '#b71c1c', lineWidth: 1 },
    { id: 'lagging', name: 'Lagging span', kind: 'line', color: '#43a047', lineWidth: 1 },
    { id: 'spanA', name: 'Leading span A', kind: 'line', color: '#a5d6a7', lineWidth: 1 },
    { id: 'spanB', name: 'Leading span B', kind: 'line', color: '#ef9a9a', lineWidth: 1 },
  ],
  fills: [
    {
      from: 'spanA',
      to: 'spanB',
      color: 'rgba(67, 160, 71, 0.15)',
      colorNegative: 'rgba(244, 67, 54, 0.15)',
    },
  ],
  offsets: (p) => ({
    lagging: -(p.displacement - 1),
    spanA: p.displacement - 1,
    spanB: p.displacement - 1,
  }),
  create: (p) =>
    calc(
      {
        convHigh: new RollingExtreme(p.conversion, 'max'),
        convLow: new RollingExtreme(p.conversion, 'min'),
        baseHigh: new RollingExtreme(p.base, 'max'),
        baseLow: new RollingExtreme(p.base, 'min'),
        bHigh: new RollingExtreme(p.spanB, 'max'),
        bLow: new RollingExtreme(p.spanB, 'min'),
      },
      (s, bar) => {
        const conversion = (s.convHigh.next(bar.high) + s.convLow.next(bar.low)) / 2;
        const base = (s.baseHigh.next(bar.high) + s.baseLow.next(bar.low)) / 2;
        const spanB = (s.bHigh.next(bar.high) + s.bLow.next(bar.low)) / 2;
        return [conversion, base, bar.close, (conversion + base) / 2, spanB];
      },
    ),
});

export const trendIndicators = [
  sma,
  ema,
  wma,
  vwma,
  dema,
  tema,
  hma,
  maRibbon,
  supertrend,
  parabolicSar,
  adx,
  aroon,
  ichimoku,
];
