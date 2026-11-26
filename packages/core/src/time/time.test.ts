import { describe, expect, it } from 'vitest';
import { ColumnStore, VALUE_FIELDS } from '../model/column-store.js';
import { Timeline } from '../model/timeline.js';
import { TimeScale, defaultTimeScaleOptions } from '../scales/time-scale.js';
import { TimeTickGenerator } from '../scales/time-ticks.js';
import { TimeFormatter } from './time-format.js';
import { ZonedClock } from './zoned-clock.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('ZonedClock', () => {
  it('UTC has zero offset', () => {
    const clock = new ZonedClock('UTC');
    expect(clock.offset(Date.UTC(2024, 5, 1))).toBe(0);
    expect(clock.parts(Date.UTC(2024, 5, 1, 13, 45))).toMatchObject({
      year: 2024,
      month: 5,
      day: 1,
      hour: 13,
      minute: 45,
    });
  });

  it('handles IANA zones including DST', () => {
    const clock = new ZonedClock('America/New_York');
    expect(clock.offset(Date.UTC(2024, 0, 15, 12))).toBe(-5 * HOUR);
    expect(clock.offset(Date.UTC(2024, 6, 15, 12))).toBe(-4 * HOUR);
    expect(clock.parts(Date.UTC(2024, 6, 15, 12)).hour).toBe(8);
  });

  it('throws for unknown zones', () => {
    expect(() => new ZonedClock('Not/AZone')).toThrow();
  });
});

describe('TimeFormatter', () => {
  const formatter = new TimeFormatter(new ZonedClock('UTC'));
  it('formats tick granularities', () => {
    const t = Date.UTC(2024, 2, 9, 7, 5, 3);
    expect(formatter.tick(t, 'year')).toBe('2024');
    expect(formatter.tick(t, 'month')).toBe('Mar');
    expect(formatter.tick(t, 'day')).toBe('9');
    expect(formatter.tick(t, 'time')).toBe('07:05');
    expect(formatter.tick(t, 'seconds')).toBe('07:05:03');
  });
  it('formats crosshair labels', () => {
    const t = Date.UTC(2024, 2, 9, 7, 5);
    expect(formatter.crosshair(t, false)).toContain('Mar');
    expect(formatter.crosshair(t, true)).toContain('07:05');
  });
});

describe('TimeTickGenerator', () => {
  function setup(times: number[], width = 1000, barSpacing = 10) {
    const store = new ColumnStore(VALUE_FIELDS);
    store.replace(times.map((time) => ({ time, value: 1 })));
    const timeline = new Timeline();
    timeline.rebuild([store]);
    const scale = new TimeScale(
      timeline,
      { ...defaultTimeScaleOptions, barSpacing, rightOffset: 0 },
      () => undefined,
    );
    scale.setWidth(width);
    const clock = new ZonedClock('UTC');
    const generator = new TimeTickGenerator(clock, new TimeFormatter(clock));
    return { timeline, scale, generator };
  }

  it('ranks calendar boundaries', () => {
    const start = Date.UTC(2023, 11, 30);
    const { timeline, generator } = setup(Array.from({ length: 5 }, (_, i) => start + i * DAY));
    // Dec 30, Dec 31, Jan 1 (year), Jan 2, Jan 3
    expect(generator.weightAt(timeline, 2)).toBeGreaterThan(generator.weightAt(timeline, 3));
    expect(generator.weightAt(timeline, 1)).toBe(generator.weightAt(timeline, 3));
  });

  it('keeps labels apart and prefers significant boundaries', () => {
    const start = Date.UTC(2024, 0, 1);
    const { timeline, scale, generator } = setup(
      Array.from({ length: 200 }, (_, i) => start + i * HOUR),
      1000,
      5,
    );
    const ticks = generator.ticks(timeline, scale, 60);
    expect(ticks.length).toBeGreaterThan(3);
    for (let i = 1; i < ticks.length; i++)
      expect(ticks[i]!.x - ticks[i - 1]!.x).toBeGreaterThanOrEqual(60 - 1e-9);
    // Day boundaries are labelled with the day number.
    expect(ticks.some((t) => /^\d{1,2}$/.test(t.label))).toBe(true);
  });
});
