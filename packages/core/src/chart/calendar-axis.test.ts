import { describe, expect, it } from 'vitest';
import { ColumnStore, VALUE_FIELDS } from '../model/column-store.js';
import { Timeline, commonStep } from '../model/timeline.js';
import { TimeScale, defaultTimeScaleOptions } from '../scales/time-scale.js';
import { createTradingSession } from '../time/session.js';
import { sessionMarks } from './session-marks.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (t: number) => new Date(t).toISOString().slice(0, 16);

/** Weekday daily bars from Monday 2024-01-01 (no weekends), `count` trading days. */
function weekdays(count: number): number[] {
  const out: number[] = [];
  for (let t = Date.UTC(2024, 0, 1); out.length < count; t += DAY) {
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6) out.push(t);
  }
  return out;
}

function storeOf(times: readonly number[]): ColumnStore<'value'> {
  const store = new ColumnStore(VALUE_FIELDS);
  store.replace(times.map((time, i) => ({ time, value: i })));
  return store;
}

describe('calendar axis in the timeline', () => {
  it('detects the common bar step and adds empty slots for weekends', () => {
    const times = weekdays(10);
    const store = storeOf(times);
    expect(commonStep(store.times, store.length)).toBe(DAY);
    const timeline = new Timeline();
    timeline.setCalendar({ step: null, maxGapBars: 5000 });
    timeline.rebuild([store]);
    expect(timeline.calendarStep).toBe(DAY);
    // Two weeks of trading days plus the weekend between them: every calendar day.
    expect(timeline.length).toBe(12);
    const mapping = timeline.mapping(store);
    for (let i = 0; i < store.length; i++) expect(timeline.timeAt(mapping[i]!)).toBe(times[i]);
    // Off again: one slot per bar.
    timeline.setCalendar(null);
    timeline.rebuild([store]);
    expect(timeline.length).toBe(10);
    expect(timeline.calendarStep).toBeNull();
  });

  it('leaves months alone and shortens very long gaps', () => {
    const months = Array.from({ length: 13 }, (_, m) => Date.UTC(2024, m, 1));
    const timeline = new Timeline();
    timeline.setCalendar({ step: null, maxGapBars: 5000 });
    timeline.rebuild([storeOf(months)]);
    expect(timeline.length).toBe(13);
    // Hourly bars with a 30-day hole: capped at 100 empty slots.
    const hours = [0, 1, 2, 3, 3 + 30 * 24, 4 + 30 * 24].map((h) => h * HOUR);
    timeline.setCalendar({ step: null, maxGapBars: 100 });
    timeline.rebuild([storeOf(hours)]);
    expect(timeline.length).toBe(6 + 100);
  });

  it('adds empty slots when a later bar is appended across a gap', () => {
    const times = weekdays(5); // Monday to Friday
    const store = storeOf(times);
    const timeline = new Timeline();
    timeline.setCalendar({ step: null, maxGapBars: 5000 });
    timeline.rebuild([store]);
    expect(timeline.length).toBe(5);
    const monday = times[4]! + 3 * DAY;
    store.upsert({ time: monday, value: 9 });
    expect(timeline.appendFrom(store)).toBe(true);
    expect(Array.from(timeline.times.subarray(5, timeline.length)).map(iso)).toEqual([
      '2024-01-06T00:00',
      '2024-01-07T00:00',
      '2024-01-08T00:00',
    ]);
    expect(timeline.timeAt(timeline.mapping(store)[5]!)).toBe(monday);
  });
});

describe('session marks', () => {
  it('shades closed slots and puts a break where each session opens', () => {
    // Hourly slots from Monday 12:00 UTC to Tuesday 23:00 UTC (calendar axis: every hour present).
    const start = Date.UTC(2024, 0, 8, 12);
    const times = Array.from({ length: 36 }, (_, i) => start + i * HOUR);
    const timeline = new Timeline();
    timeline.rebuild([storeOf(times)]);
    const scale = new TimeScale(
      timeline,
      { ...defaultTimeScaleOptions, rightOffset: 0, barSpacing: 10 },
      () => undefined,
    );
    scale.setWidth(360);
    const nyse = createTradingSession({ hours: '0930-1600:12345', timeZone: 'America/New_York' });
    const marks = sessionMarks(nyse, timeline, scale, { breaks: true, closed: true });
    const indexAt = (x: number) => Math.round(scale.xToLogical(x + 5));
    // Open 14:30–21:00 UTC; hourly slots at 15:00 … 20:00 are open (14:00 starts before the open).
    expect(marks.breaks.map((x) => iso(times[indexAt(x)]!))).toEqual([
      '2024-01-08T15:00',
      '2024-01-09T15:00',
    ]);
    const at = (x: number) => {
      const i = indexAt(x);
      return i < times.length ? iso(times[i]!) : 'end';
    };
    expect(marks.closed.map((r) => [at(r.from), at(r.to)])).toEqual([
      ['2024-01-08T12:00', '2024-01-08T15:00'],
      ['2024-01-08T21:00', '2024-01-09T15:00'],
      ['2024-01-09T21:00', 'end'],
    ]);
  });
});
