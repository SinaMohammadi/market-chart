import { describe, expect, it } from 'vitest';
import { indexOfSorted, lowerBound, upperBound } from './binary-search.js';
import { deepMerge } from './merge.js';
import { decimalsOf, roundToStep } from './math.js';

describe('binary search', () => {
  const values = new Float64Array([1, 3, 3, 5, 9]);
  it('lowerBound returns first index >= target', () => {
    expect(lowerBound(values, 0)).toBe(0);
    expect(lowerBound(values, 3)).toBe(1);
    expect(lowerBound(values, 4)).toBe(3);
    expect(lowerBound(values, 10)).toBe(5);
  });
  it('upperBound returns first index > target', () => {
    expect(upperBound(values, 3)).toBe(3);
    expect(upperBound(values, 9)).toBe(5);
  });
  it('respects an explicit length', () => {
    expect(lowerBound(values, 9, 3)).toBe(3);
    expect(indexOfSorted(values, 9, 4)).toBe(-1);
    expect(indexOfSorted(values, 5)).toBe(3);
  });
});

describe('deepMerge', () => {
  it('merges nested objects without mutating inputs', () => {
    const base = { a: 1, nested: { b: 2, c: 3 } };
    const result = deepMerge(base, { nested: { c: 4 } });
    expect(result).toEqual({ a: 1, nested: { b: 2, c: 4 } });
    expect(base.nested.c).toBe(3);
    expect(result.nested).not.toBe(base.nested);
  });
  it('keeps identity of untouched branches', () => {
    const base = { x: { y: 1 }, z: { w: 2 } };
    const result = deepMerge(base, { x: { y: 5 } });
    expect(result.z).toBe(base.z);
  });
  it('ignores undefined and replaces arrays', () => {
    const base = { list: [1, 2], v: 1 };
    expect(deepMerge(base, { list: [3], v: undefined })).toEqual({ list: [3], v: 1 });
  });
  it('blocks prototype pollution keys', () => {
    const malicious = JSON.parse(
      '{"__proto__": {"polluted": true}, "constructor": {"x": 1}}',
    ) as object;
    const result = deepMerge(
      { safe: 1 } as Record<string, unknown>,
      malicious as Record<string, unknown>,
    );
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
  });
});

describe('math', () => {
  it('decimalsOf', () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.01)).toBe(2);
    expect(decimalsOf(0.00025)).toBe(5);
    expect(decimalsOf(1e-8)).toBe(8);
  });
  it('roundToStep removes floating point noise', () => {
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundToStep(1.237, 0.05)).toBe(1.25);
  });
});
