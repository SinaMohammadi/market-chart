import { describe, expect, it, vi } from 'vitest';
import type { LinePoint, SeriesApi } from '@market-chart/core';
import { applySeriesData } from './data-diff.js';

function fakeSeries() {
  return { setData: vi.fn(), update: vi.fn() } as unknown as SeriesApi<'line'> & {
    setData: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

const p = (time: number, value = time): LinePoint => ({ time, value });

describe('applySeriesData', () => {
  it('does nothing for the same array', () => {
    const s = fakeSeries();
    const data = [p(1)];
    applySeriesData(s, data, data);
    expect(s.setData).toHaveBeenCalledTimes(0);
    expect(s.update).toHaveBeenCalledTimes(0);
  });

  it('uses setData for the first push', () => {
    const s = fakeSeries();
    applySeriesData(s, undefined, [p(1)]);
    expect(s.setData).toHaveBeenCalledTimes(1);
  });

  it('updates the last point and appends incrementally', () => {
    const s = fakeSeries();
    const prev = [p(1), p(2)];
    const next = [prev[0]!, p(2, 5), p(3)];
    applySeriesData(s, prev, next);
    expect(s.setData).toHaveBeenCalledTimes(0);
    expect(s.update.mock.calls).toEqual([[p(2, 5)], [p(3)]]);
  });

  it('falls back to setData when history changed', () => {
    const s = fakeSeries();
    applySeriesData(s, [p(1), p(2)], [p(1), p(2), p(3)]);
    expect(s.setData).toHaveBeenCalledTimes(1);
  });

  it('falls back to setData when the last time changed', () => {
    const s = fakeSeries();
    const first = p(1);
    applySeriesData(s, [first, p(2)], [first, p(3)]);
    expect(s.setData).toHaveBeenCalledTimes(1);
  });
});
