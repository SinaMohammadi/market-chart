import { describe, expect, it } from 'vitest';
import { ColumnStore, OHLC_FIELDS, VALUE_FIELDS } from './column-store.js';
import { Timeline } from './timeline.js';

const ohlc = (time: number, close = 10) => ({
  time,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
});

describe('ColumnStore', () => {
  it('stores rows in typed columns', () => {
    const store = new ColumnStore(OHLC_FIELDS, ['volume']);
    store.replace([ohlc(1, 10), { ...ohlc(2, 11), volume: 5 }]);
    expect(store.length).toBe(2);
    expect(store.column('close')[1]).toBe(11);
    expect(Number.isNaN(store.column('volume')[0]!)).toBe(true);
    expect(store.rowAt(1)).toEqual({ time: 2, open: 11, high: 12, low: 10, close: 11, volume: 5 });
    expect(store.rowAt(0)).toEqual({ time: 1, open: 10, high: 11, low: 9, close: 10 });
  });

  it('rejects unsorted or duplicate times and keeps previous data', () => {
    const store = new ColumnStore(VALUE_FIELDS);
    store.replace([{ time: 1, value: 1 }]);
    expect(() =>
      store.replace([
        { time: 2, value: 1 },
        { time: 2, value: 2 },
      ]),
    ).toThrow(/strictly increasing/);
    expect(() =>
      store.replace([
        { time: 3, value: 1 },
        { time: 1, value: 2 },
      ]),
    ).toThrow(/row 1/);
    expect(store.length).toBe(1);
  });

  it('stores whitespace for optional fields and omits it from rows', () => {
    const store = new ColumnStore(VALUE_FIELDS, ['value']);
    store.replace([
      { time: 1, value: 1 },
      { time: 2 },
      { time: 3, value: null as unknown as number },
    ]);
    expect(Number.isNaN(store.column('value')[1]!)).toBe(true);
    expect(store.rowAt(1)).toEqual({ time: 2 });
    expect(store.rowAt(2)).toEqual({ time: 3 });
    expect(() => store.replace([{ time: 1, value: Number.NaN }])).toThrow(/"value"/);
  });

  it('rejects invalid values with the field name', () => {
    const store = new ColumnStore(VALUE_FIELDS);
    expect(() => store.replace([{ time: 1, value: Number.NaN }])).toThrow(/"value"/);
    expect(() => store.replace([{ time: Number.POSITIVE_INFINITY, value: 1 }])).toThrow(
      /invalid time/,
    );
    expect(() => store.replace([null as unknown as { time: number }])).toThrow(/must be an object/);
  });

  it('upserts: append, replace, insert', () => {
    const store = new ColumnStore(VALUE_FIELDS);
    store.replace([
      { time: 10, value: 1 },
      { time: 30, value: 3 },
    ]);
    expect(store.upsert({ time: 40, value: 4 })).toEqual({ kind: 'appended', index: 2 });
    expect(store.upsert({ time: 40, value: 5 })).toEqual({ kind: 'replaced', index: 2 });
    expect(store.upsert({ time: 20, value: 2 })).toEqual({ kind: 'inserted', index: 1 });
    expect(Array.from(store.times.subarray(0, store.length))).toEqual([10, 20, 30, 40]);
    expect(Array.from(store.column('value').subarray(0, store.length))).toEqual([1, 2, 3, 5]);
  });

  it('grows capacity across many appends', () => {
    const store = new ColumnStore(VALUE_FIELDS);
    for (let i = 0; i < 1000; i++) store.upsert({ time: i, value: i * 2 });
    expect(store.length).toBe(1000);
    expect(store.column('value')[999]).toBe(1998);
  });

  it('tracks per-point colours sparsely', () => {
    const store = new ColumnStore(VALUE_FIELDS);
    store.replace([
      { time: 1, value: 1 },
      { time: 2, value: 2, color: 'red' },
    ]);
    expect(store.colors?.[1]).toBe('red');
    store.upsert({ time: 3, value: 3 });
    expect(store.colors?.[2]).toBeUndefined();
    store.upsert({ time: 0, value: 0, color: 'blue' });
    expect(store.colors?.[0]).toBe('blue');
    expect(store.colors?.[2]).toBe('red');
  });

  it('finds index ranges by time', () => {
    const store = new ColumnStore(VALUE_FIELDS);
    store.replace([10, 20, 30, 40].map((time) => ({ time, value: 1 })));
    expect(store.indexRange(15, 35)).toEqual({ from: 1, to: 2 });
    expect(store.indexRange(41, 50)).toBeNull();
  });
});

describe('Timeline', () => {
  const make = (times: number[]) => {
    const store = new ColumnStore(VALUE_FIELDS);
    store.replace(times.map((time) => ({ time, value: time })));
    return store;
  };

  it('builds the union of series times with mappings', () => {
    const a = make([1, 3, 5]);
    const b = make([2, 3, 6]);
    const timeline = new Timeline();
    timeline.rebuild([a, b]);
    expect(Array.from(timeline.times.subarray(0, timeline.length))).toEqual([1, 2, 3, 5, 6]);
    expect(Array.from(timeline.mapping(a).subarray(0, a.length))).toEqual([0, 2, 3]);
    expect(Array.from(timeline.mapping(b).subarray(0, b.length))).toEqual([1, 2, 4]);
  });

  it('appends incrementally', () => {
    const a = make([1, 2]);
    const b = make([1, 2]);
    const timeline = new Timeline();
    timeline.rebuild([a, b]);
    const version = timeline.version;
    a.upsert({ time: 3, value: 3 });
    expect(timeline.appendFrom(a)).toBe(true);
    b.upsert({ time: 3, value: 3 });
    expect(timeline.appendFrom(b)).toBe(true);
    expect(timeline.length).toBe(3);
    expect(timeline.mapping(b)[2]).toBe(2);
    expect(timeline.version).toBe(version);
  });

  it('refuses incremental append for out-of-order times', () => {
    const a = make([1, 5]);
    const b = make([1]);
    const timeline = new Timeline();
    timeline.rebuild([a, b]);
    b.upsert({ time: 3, value: 3 });
    expect(timeline.appendFrom(b)).toBe(false);
  });

  it('nearestIndex clamps and rounds', () => {
    const timeline = new Timeline();
    timeline.rebuild([make([10, 20, 30])]);
    expect(timeline.nearestIndex(0)).toBe(0);
    expect(timeline.nearestIndex(14)).toBe(0);
    expect(timeline.nearestIndex(16)).toBe(1);
    expect(timeline.nearestIndex(99)).toBe(2);
  });
});

describe('ColumnStore.replaceColumns', () => {
  it('loads typed arrays or number arrays with the same validation as rows', () => {
    const store = new ColumnStore(OHLC_FIELDS, ['volume']);
    store.replaceColumns(new Float64Array([1, 2, 3]), {
      open: [1, 2, 3],
      high: [2, 3, 4],
      low: [0, 1, 2],
      close: new Float64Array([1.5, 2.5, 3.5]),
    });
    expect(store.length).toBe(3);
    expect(store.rowAt(1)).toEqual({ time: 2, open: 2, high: 3, low: 1, close: 2.5 });
    expect(Number.isNaN(store.column('volume')[0]!)).toBe(true);
  });

  it('rejects bad input and keeps the previous data', () => {
    const store = new ColumnStore(VALUE_FIELDS, ['value']);
    store.replaceColumns([1, 2], { value: [5, Number.NaN] });
    expect(() => store.replaceColumns([2, 1], { value: [1, 2] })).toThrow(/strictly increasing/);
    expect(() => store.replaceColumns([1, 2], { value: [1] })).toThrow(/1 values but there are 2/);
    expect(() => store.replaceColumns([1, 2], { value: [1, Infinity] })).toThrow(/invalid/);
    expect(() => store.replaceColumns([1, 2], { nope: [1, 2] } as never)).toThrow(/unknown field/);
    expect(() => store.replaceColumns([1, Number.NaN], { value: [1, 2] })).toThrow(
      /time at index 1/,
    );
    expect(store.length).toBe(2);
    expect(store.rowAt(0)).toEqual({ time: 1, value: 5 });
    const required = new ColumnStore(OHLC_FIELDS, ['volume']);
    expect(() => required.replaceColumns([1], { open: [1], high: [1], low: [1] })).toThrow(
      /missing required column "close"/,
    );
    expect(() =>
      required.replaceColumns([1], { open: [Number.NaN], high: [1], low: [1], close: [1] }),
    ).toThrow(/"open" at index 0 is NaN/);
  });

  it('stores per-point colours', () => {
    const store = new ColumnStore(VALUE_FIELDS, ['value']);
    store.replaceColumns([1, 2, 3], { value: [1, 2, 3] }, [undefined, 'red', null]);
    expect(store.colors).toEqual([undefined, 'red', undefined]);
  });
});

describe('Timeline fast paths', () => {
  const source = (times: number[]) => {
    const store = new ColumnStore(VALUE_FIELDS, ['value']);
    store.replace(times.map((time) => ({ time, value: 1 })));
    return store;
  };

  it('shares one identity mapping for stores with identical times', () => {
    const a = source([10, 20, 30]);
    const b = source([10, 20, 30]);
    const timeline = new Timeline();
    timeline.rebuild([a, b]);
    expect(timeline.length).toBe(3);
    expect(timeline.mapping(a)).toBe(timeline.mapping(b));
    expect([...timeline.mapping(b).subarray(0, 3)]).toEqual([0, 1, 2]);
  });

  it('keeps identity mappings correct when stores append, and copies when they diverge', () => {
    const a = source([10, 20, 30]);
    const b = source([10, 20, 30]);
    const timeline = new Timeline();
    timeline.rebuild([a, b]);
    a.upsert({ time: 40, value: 1 });
    expect(timeline.appendFrom(a)).toBe(true);
    b.upsert({ time: 40, value: 1 });
    expect(timeline.appendFrom(b)).toBe(true);
    expect(timeline.length).toBe(4);
    expect([...timeline.mapping(a).subarray(0, 4)]).toEqual([0, 1, 2, 3]);
    // a gets a new bar that b does not have; b then appends a later one: b's mapping diverges from identity.
    a.upsert({ time: 50, value: 1 });
    expect(timeline.appendFrom(a)).toBe(true);
    b.upsert({ time: 60, value: 1 });
    expect(timeline.appendFrom(b)).toBe(true);
    expect([...timeline.mapping(b).subarray(0, 5)]).toEqual([0, 1, 2, 3, 5]);
    expect([...timeline.mapping(a).subarray(0, 5)]).toEqual([0, 1, 2, 3, 4]);
  });

  it('merges different time sets', () => {
    const timeline = new Timeline();
    const a = source([10, 30]);
    const b = source([20, 30, 40]);
    timeline.rebuild([a, b]);
    expect([...timeline.times.subarray(0, timeline.length)]).toEqual([10, 20, 30, 40]);
    expect([...timeline.mapping(a).subarray(0, 2)]).toEqual([0, 2]);
    expect([...timeline.mapping(b).subarray(0, 3)]).toEqual([1, 2, 3]);
    // Rebuilding with fewer points reuses the buffer and stays correct.
    timeline.rebuild([source([5])]);
    expect([...timeline.times.subarray(0, timeline.length)]).toEqual([5]);
  });
});
