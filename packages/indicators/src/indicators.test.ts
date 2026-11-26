import { describe, expect, it } from 'vitest';
import { generateBars } from '@market-chart/testing';
import { createDefaultRegistry } from './builtins.js';
import { cloneState } from './clone.js';
import { builtInIndicators } from './definitions/index.js';
import * as defs from './definitions/index.js';
import { resolveParams } from './params.js';
import { Ema, Lag, RollingExtreme, RollingSum, Sma, StdDev, Wma } from './primitives.js';
import { IndicatorRegistry } from './registry.js';
import { IndicatorRunner, computeIndicator } from './runner.js';
import type { Bar, IndicatorDefinition } from './types.js';
import { calc, defineIndicator } from './types.js';
import {
  firstMismatch,
  refAroonUp,
  refCci,
  refCmf,
  refEma,
  refHighest,
  refLowest,
  refMfi,
  refObv,
  refRma,
  refRsi,
  refSessionVwap,
  refSma,
  refStdev,
  refTrueRange,
  refWilliamsR,
  refWma,
} from './test-support/reference.js';

const HOUR = 3_600_000;
const raw = generateBars({
  count: 600,
  interval: HOUR,
  startPrice: 100,
  volatility: 0.02,
  seed: 21,
  baseVolume: 500,
});
const bars: Bar[] = raw.map((b) => ({ ...b, volume: b.volume ?? 0 }));
const closes = bars.map((b) => b.close);

function output(
  definition: IndicatorDefinition,
  params: Record<string, unknown> | undefined,
  id: string,
): Float64Array {
  const result = computeIndicator(definition, bars, params);
  const index = definition.outputs.findIndex((o) => o.id === id);
  return result.values[index]!;
}

function expectMatches(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  tolerance = 1e-8,
): void {
  const at = firstMismatch(actual, expected, tolerance);
  if (at >= 0) throw new Error(`mismatch at ${at}: got ${actual[at]}, expected ${expected[at]}`);
  expect(at).toBe(-1);
}

const def = (d: unknown) => d as IndicatorDefinition;

describe('primitives', () => {
  const xs = closes;
  const run = (p: { next(v: number): number }) => xs.map((v) => p.next(v));

  it('small hand-checked values', () => {
    const sma = new Sma(3);
    expect(
      [1, 2, 3, 4, 5].map((v) => sma.next(v)).map((v) => (Number.isNaN(v) ? null : v)),
    ).toEqual([null, null, 2, 3, 4]);
    const ema = new Ema(3);
    expect([1, 2, 3, 4, 5].map((v) => ema.next(v)).slice(2)).toEqual([2, 3, 4]);
    const lag = new Lag(2);
    expect([1, 2, 3, 4].map((v) => lag.next(v)).slice(2)).toEqual([1, 2]);
  });

  it('match naive references over a long series', () => {
    expectMatches(run(new Sma(14)), refSma(xs, 14));
    expectMatches(run(new Ema(14)), refEma(xs, 14));
    expectMatches(run(new Wma(14)), refWma(xs, 14));
    expectMatches(run(new StdDev(20)), refStdev(xs, 20), 1e-6);
    expectMatches(
      run(new RollingSum(5)),
      refSma(xs, 5).map((v) => v * 5),
    );
    expectMatches(run(new RollingExtreme(10, 'max')), refHighest(xs, 10));
    expectMatches(run(new RollingExtreme(10, 'min')), refLowest(xs, 10));
  });

  it('do not drift over many values', () => {
    const sma = new Sma(50);
    const wma = new Wma(50);
    let last = 0;
    let lastW = 0;
    for (let i = 0; i < 200_000; i++) {
      const v = 1e6 + Math.sin(i) * 1000;
      last = sma.next(v);
      lastW = wma.next(v);
    }
    const window = Array.from({ length: 50 }, (_, k) => 1e6 + Math.sin(200_000 - 50 + k) * 1000);
    expect(last).toBeCloseTo(window.reduce((a, b) => a + b, 0) / 50, 6);
    expect(lastW).toBeCloseTo(window.reduce((a, b, k) => a + b * (k + 1), 0) / ((50 * 51) / 2), 6);
  });

  it('ignore non-finite input without advancing', () => {
    const sma = new Sma(2);
    expect(Number.isNaN(sma.next(Number.NaN))).toBe(true);
    sma.next(1);
    expect(sma.next(3)).toBe(2);
  });

  it('report bars since the extreme', () => {
    const max = new RollingExtreme(3, 'max');
    [5, 9, 2, 1].forEach((v) => max.next(v));
    expect(max.barsSince).toBe(2);
  });

  it('cloneState keeps prototypes and independence', () => {
    const a = new Sma(3);
    a.next(1);
    const b = cloneState(a);
    b.next(2);
    b.next(3);
    expect(b instanceof Sma).toBe(true);
    expect(Number.isNaN(a.next(5))).toBe(true);
  });
});

describe('indicators match reference implementations', () => {
  it('moving averages', () => {
    expectMatches(output(def(defs.sma), { length: 20 }, 'ma'), refSma(closes, 20));
    expectMatches(output(def(defs.ema), { length: 20 }, 'ma'), refEma(closes, 20));
    expectMatches(output(def(defs.wma), { length: 20 }, 'ma'), refWma(closes, 20));
    const e1 = refEma(closes, 10);
    const e2 = refEma(e1, 10);
    const e3 = refEma(e2, 10);
    expectMatches(
      output(def(defs.dema), { length: 10 }, 'ma'),
      e1.map((v, i) => 2 * v - e2[i]!),
    );
    expectMatches(
      output(def(defs.tema), { length: 10 }, 'ma'),
      e1.map((v, i) => 3 * v - 3 * e2[i]! + e3[i]!),
    );
    const half = refWma(closes, 8);
    const full = refWma(closes, 16);
    const firstFull = full.findIndex(Number.isFinite);
    const diff = half.map((v, i) => 2 * v - full[i]!).slice(firstFull);
    const hull = [...Array(firstFull).fill(Number.NaN), ...refWma(diff, 4)];
    expectMatches(output(def(defs.hma), { length: 16 }, 'ma'), hull);
  });

  it('RSI, CCI, Williams %R, Aroon', () => {
    expectMatches(output(def(defs.rsi), { length: 14 }, 'rsi'), refRsi(closes, 14));
    const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
    expectMatches(output(def(defs.cci), { length: 20 }, 'cci'), refCci(tp, 20), 1e-6);
    expectMatches(output(def(defs.williamsR), { length: 14 }, 'r'), refWilliamsR(bars, 14));
    expectMatches(output(def(defs.aroon), { length: 14 }, 'up'), refAroonUp(bars, 14));
  });

  it('MACD', () => {
    const line = refEma(closes, 12).map((v, i) => v - refEma(closes, 26)[i]!);
    const signal = refEma(line, 9);
    expectMatches(output(def(defs.macd), undefined, 'macd'), line);
    expectMatches(output(def(defs.macd), undefined, 'signal'), signal);
    expectMatches(
      output(def(defs.macd), undefined, 'histogram'),
      line.map((v, i) => v - signal[i]!),
    );
  });

  it('Bollinger, ATR, Donchian', () => {
    const basis = refSma(closes, 20);
    const dev = refStdev(closes, 20);
    expectMatches(
      output(def(defs.bollinger), undefined, 'upper'),
      basis.map((v, i) => v + 2 * dev[i]!),
      1e-6,
    );
    expectMatches(output(def(defs.atr), { length: 14 }, 'atr'), refRma(refTrueRange(bars), 14));
    expectMatches(
      output(def(defs.donchian), { length: 20 }, 'upper'),
      refHighest(
        bars.map((b) => b.high),
        20,
      ),
    );
  });

  it('ROC and Momentum', () => {
    const roc = closes.map((v, i) =>
      i < 9 ? Number.NaN : (100 * (v - closes[i - 9]!)) / closes[i - 9]!,
    );
    expectMatches(output(def(defs.roc), { length: 9 }, 'roc'), roc);
    const mom = closes.map((v, i) => (i < 10 ? Number.NaN : v - closes[i - 10]!));
    expectMatches(output(def(defs.momentum), { length: 10 }, 'mom'), mom);
  });

  it('volume indicators', () => {
    expectMatches(output(def(defs.obv), undefined, 'obv'), refObv(bars));
    expectMatches(output(def(defs.mfi), { length: 14 }, 'mfi'), refMfi(bars, 14), 1e-6);
    expectMatches(output(def(defs.cmf), { length: 20 }, 'cmf'), refCmf(bars, 20), 1e-6);
    expectMatches(output(def(defs.vwap), { bandMultiplier: 0 }, 'vwap'), refSessionVwap(bars));
  });

  it('pivot points from the previous UTC day', () => {
    const day = 86_400_000;
    const daily: Bar[] = [
      { time: 0, open: 10, high: 12, low: 8, close: 11, volume: 1 },
      { time: day / 2, open: 11, high: 13, low: 9, close: 10, volume: 1 },
      { time: day, open: 10, high: 10.5, low: 9.5, close: 10, volume: 1 },
    ];
    const result = computeIndicator(def(defs.pivotPoints), daily);
    const [p, r1, , , s1] = result.values;
    const pivot = (13 + 8 + 10) / 3;
    expect(Number.isNaN(p![0]!)).toBe(true);
    expect(p![2]).toBeCloseTo(pivot, 12);
    expect(r1![2]).toBeCloseTo(2 * pivot - 8, 12);
    expect(s1![2]).toBeCloseTo(2 * pivot - 13, 12);
  });
});

describe('every built-in indicator', () => {
  const tick = (bar: Bar, k: number): Bar => {
    const close = bar.close * (1 + 0.003 * Math.sin(k + bar.time));
    return {
      ...bar,
      close,
      high: Math.max(bar.high, close),
      low: Math.min(bar.low, close),
      volume: bar.volume * 0.5,
    };
  };

  for (const definition of builtInIndicators) {
    it(`${definition.type}: produces values and streams identically to batch`, () => {
      const batch = computeIndicator(definition, bars);
      expect(batch.length).toBe(bars.length);
      const anyFinite = batch.values.some((v) => v.some(Number.isFinite));
      expect(anyFinite).toBe(true);
      for (const values of batch.values)
        for (const v of values) expect(Number.isFinite(v) || Number.isNaN(v)).toBe(true);

      // Stream: history, then each new bar arrives as a few provisional ticks and its final value.
      const runner = new IndicatorRunner(definition);
      const split = 400;
      runner.reset(bars.slice(0, split));
      for (let i = split; i < bars.length; i++) {
        const bar = bars[i]!;
        runner.append(tick(bar, 1));
        runner.updateLast(tick(bar, 2));
        runner.updateLast(tick(bar, 3));
        runner.updateLast(bar);
      }
      const streamed = runner.result();
      expect(streamed.length).toBe(bars.length);
      batch.values.forEach((values, o) => {
        const at = firstMismatch(values, streamed.values[o]!.subarray(0, streamed.length), 1e-9);
        if (at >= 0)
          throw new Error(`${definition.type}.${definition.outputs[o]!.id} differs at ${at}`);
      });
    });

    it(`${definition.type}: rewriting recent bars matches batch over the corrected bars`, () => {
      const runner = new IndicatorRunner(definition);
      runner.reset(bars.slice(0, 450));
      for (let i = 450; i < 500; i++) runner.append(bars[i]!);
      const corrected = bars.slice(0, 500).map((b, i) => (i >= 488 ? tick(b, 7) : b));
      const from = 500 - IndicatorRunner.REWIND_BARS;
      expect(runner.canRewrite(from - 1)).toBe(false);
      expect(runner.canRewrite(from)).toBe(true);
      runner.rewrite(488, corrected.slice(488));
      const batch = computeIndicator(definition, corrected);
      const out = runner.result();
      batch.values.forEach((values, o) => {
        const at = firstMismatch(values, out.values[o]!.subarray(0, out.length), 1e-9);
        if (at >= 0)
          throw new Error(`${definition.type}.${definition.outputs[o]!.id} differs at ${at}`);
      });
      expect(() => runner.rewrite(498, [corrected[499]!, corrected[499]!])).toThrow(
        /keep their times/,
      );
    });

    it(`${definition.type}: survives flat prices and zero volume`, () => {
      const flat: Bar[] = Array.from({ length: 120 }, (_, i) => ({
        time: i * HOUR,
        open: 5,
        high: 5,
        low: 5,
        close: 5,
        volume: 0,
      }));
      const result = computeIndicator(definition, flat);
      for (const values of result.values)
        for (const v of values) expect(v === Infinity || v === -Infinity).toBe(false);
    });
  }
});

describe('parameters and registry', () => {
  it('validates parameters', () => {
    const rsi = def(defs.rsi);
    expect(resolveParams(rsi, { length: 7 })).toEqual({ length: 7, source: 'close' });
    expect(() => resolveParams(rsi, { length: 1.5 })).toThrow(/integer/);
    expect(() => resolveParams(rsi, { length: 0 })).toThrow(/>= 2/);
    expect(() => resolveParams(rsi, { source: 'volume' })).toThrow(/one of/);
    expect(() => resolveParams(rsi, { bogus: 1 })).toThrow(/unknown parameter/);
    expect(() => resolveParams(def(defs.macd), { fast: 30 })).toThrow(/fast length/);
  });
  it('rejects inherited keys and huge lengths from stored configs (security)', () => {
    const rsi = def(defs.rsi);
    for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf'])
      expect(() => resolveParams(rsi, { [key]: 1 })).toThrow(/unknown parameter/);
    expect(() =>
      resolveParams(rsi, JSON.parse('{"__proto__": {"length": 3}}') as Record<string, unknown>),
    ).toThrow(/unknown parameter/);
    expect(() => resolveParams(rsi, { length: 1e9 })).toThrow(/<= 5000/);
  });

  it('ships 44 valid built-ins with unique types', () => {
    const registry = createDefaultRegistry();
    expect(registry.list()).toHaveLength(44);
    expect(new Set(builtInIndicators.map((d) => d.type)).size).toBe(44);
    expect(registry.list('momentum').length).toBeGreaterThan(5);
  });

  it('registers custom indicators and rejects broken ones', () => {
    const registry = new IndicatorRegistry();
    const typical = defineIndicator({
      type: 'typical-price',
      name: 'Typical price',
      shortName: 'TP',
      category: 'trend',
      placement: 'overlay',
      inputs: { scale: { type: 'float', default: 1 } },
      outputs: [{ id: 'tp', name: 'TP', kind: 'line', color: '#fff' }],
      create: (p) => calc({}, (_s, bar) => [((bar.high + bar.low + bar.close) / 3) * p.scale]),
    });
    registry.register(typical);
    expect(
      computeIndicator(registry.get('typical-price'), bars.slice(0, 2), { scale: 2 }).values[0]![0],
    ).toBeCloseTo(((bars[0]!.high + bars[0]!.low + bars[0]!.close) / 3) * 2, 10);
    expect(() => registry.register(typical)).toThrow(/already registered/);
    expect(() => registry.register({ ...typical, type: 'Bad Type' })).toThrow(
      /invalid indicator type/,
    );
    expect(() =>
      registry.register({
        ...typical,
        type: 'x',
        fills: [{ from: 'tp', to: 'nope', color: '#000' }],
      }),
    ).toThrow(/unknown output/);
    expect(() => registry.get('missing')).toThrow(/unknown indicator/);
  });

  it('rejects out-of-order input', () => {
    const runner = new IndicatorRunner(def(defs.sma));
    expect(() => runner.reset([bars[1]!, bars[0]!])).toThrow(/strictly increasing/);
    runner.reset(bars.slice(0, 3));
    expect(() => runner.append(bars[1]!)).toThrow(/newer bar/);
    expect(() => runner.updateLast(bars[0]!)).toThrow(/time of the last bar/);
  });
});
