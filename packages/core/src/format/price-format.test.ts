import { describe, expect, it } from 'vitest';
import { createPriceFormatter, safePrecision } from './price-format.js';

describe('createPriceFormatter', () => {
  it('formats prices with precision', () => {
    const f = createPriceFormatter({ type: 'price', precision: 2 });
    expect(f(1234.5)).toBe('1234.50');
    expect(f(-3.14159)).toBe('−3.14');
  });
  it('derives precision from minMove and snaps to it', () => {
    const f = createPriceFormatter({ type: 'price', minMove: 0.25 });
    expect(f(10.1)).toBe('10.00');
    expect(f(10.2)).toBe('10.25');
  });
  it('does not print negative zero', () => {
    const f = createPriceFormatter({ type: 'price', precision: 2 });
    expect(f(-0.001)).toBe('0.00');
  });
  it('formats volume compactly', () => {
    const f = createPriceFormatter({ type: 'volume' });
    expect(f(950)).toBe('950');
    expect(f(1500)).toBe('1.5K');
    expect(f(2_000_000)).toBe('2M');
    expect(f(3_450_000_000)).toBe('3.45B');
  });
  it('formats percent', () => {
    expect(createPriceFormatter({ type: 'percent' })(12.345)).toBe('12.35%');
  });
});

describe('createPriceFormatter with untrusted formats (security)', () => {
  it('clamps precision instead of throwing a RangeError on every frame', () => {
    for (const precision of [1e9, -5, Number.NaN, Infinity, 2.7, 101]) {
      const f = createPriceFormatter({ type: 'price', precision });
      expect(() => f(1.5)).not.toThrow();
    }
    expect(createPriceFormatter({ type: 'price', precision: 1e9 })(1)).toBe(`1.${'0'.repeat(20)}`);
    expect(createPriceFormatter({ type: 'percent', precision: -3 })(1.26)).toBe('1%');
    expect(() => createPriceFormatter({ type: 'volume', precision: 500 })(1234)).not.toThrow();
  });
  it('ignores a zero, negative or non-finite minMove', () => {
    for (const minMove of [0, -1, Number.NaN, Infinity]) {
      expect(createPriceFormatter({ type: 'price', precision: 2, minMove })(1.234)).toBe('1.23');
    }
  });
  it('falls back for an unknown format type', () => {
    expect(createPriceFormatter({ type: 'evil' } as never)(1)).toBe('1.00');
  });
  it('safePrecision', () => {
    expect(safePrecision(undefined, 4)).toBe(4);
    expect(safePrecision('3' as never)).toBe(2);
    expect(safePrecision(25)).toBe(20);
  });
});
