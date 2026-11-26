// @vitest-environment jsdom
/**
 * Timeline synchronisation: several series with their own timestamps share one canonical time axis.
 *
 * Every series keeps its own data indices; the chart's timeline is the sorted union of all timestamps and
 * each series maps local index → timeline index. These tests check that the mapping is by timestamp (never
 * by array position) through every public entry point: painting, crosshair, conversions, realtime updates,
 * historical insertion and the viewport.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '@market-chart/core';
import type {
  ChartApi,
  CrosshairMoveEvent,
  CustomSeriesPaintContext,
  SeriesApi,
} from '@market-chart/core';
import { installCanvasMock } from '../canvas-mock.js';
import { createRandom } from '../random.js';
import { MINUTE, generateBars } from '../synthetic.js';

let restore: () => void = () => undefined;
let container: HTMLDivElement;
const charts: ChartApi[] = [];

function make(width = 800, options: Parameters<typeof createChart>[1] = {}): ChartApi {
  const chart = createChart(container, { autoSize: false, width, height: 400, ...options });
  charts.push(chart);
  return chart;
}

beforeEach(() => {
  restore = installCanvasMock();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  for (const chart of charts.splice(0)) if (!chart.destroyed) chart.destroy();
  container.remove();
  restore();
});

const T0 = Date.UTC(2024, 0, 2, 10, 0);
const at = (minute: number): number => T0 + minute * MINUTE;
const bar = (minute: number, close = 100 + minute) => ({
  time: at(minute),
  open: close,
  high: close + 1,
  low: close - 1,
  close,
});
const point = (minute: number, value = minute) => ({ time: at(minute), value });

/** A value series whose painter records the x it was given for each visible point (CSS px). */
interface Probe {
  readonly series: SeriesApi<'custom'>;
  /** time → painted x, from the last frame. */
  readonly painted: Map<number, number>;
}

function probe(chart: ChartApi, pane = 0): Probe {
  const painted = new Map<number, number>();
  const series = chart.addCustomSeries(
    {
      kind: 'value',
      paint(c: CustomSeriesPaintContext) {
        painted.clear();
        for (let i = c.from; i <= c.to; i++) painted.set(c.data.time(i), c.x(i) / c.pixelRatio);
      },
    },
    { pane },
  );
  return { series, painted };
}

/** Every painted point sits exactly where the time scale puts its own timestamp. */
function expectPaintedAtOwnTime(chart: ChartApi, p: Probe): void {
  expect(p.painted.size).toBeGreaterThan(0);
  for (const [time, x] of p.painted) {
    expect(x).toBeCloseTo(chart.timeScale().timeToCoordinate(time)!, 6);
  }
}

/** The chart's timeline, read through the public conversions (integer logical index ↔ time). */
function timelineOf(chart: ChartApi, expectedLength: number): number[] {
  const ts = chart.timeScale();
  return Array.from({ length: expectedLength }, (_, i) => ts.logicalToTime(i)!);
}

function crosshairAt(chart: ChartApi, time: number, pane = 0): CrosshairMoveEvent {
  let event: CrosshairMoveEvent | null = null;
  const off = chart.on('crosshairMove', (e) => (event = e));
  chart.render();
  chart.setCrosshairPosition(time, null, pane);
  chart.render();
  off();
  if (!event) throw new Error('no crosshairMove event');
  return event;
}

/** Times at the visible range's edge bar centres (interpolated), i.e. what the user sees. */
function visibleTimes(chart: ChartApi): { from: number; to: number } {
  const ts = chart.timeScale();
  const range = ts.getVisibleLogicalRange()!;
  return { from: ts.logicalToTime(range.from + 0.5)!, to: ts.logicalToTime(range.to - 0.5)! };
}

describe('multiple series with different timestamps', () => {
  it('maps identical timestamps to the same logical positions', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    const a = probe(chart);
    const b = probe(chart, 1);
    candles.setData([0, 1, 2, 3].map((m) => bar(m)));
    a.series.setData([0, 1, 2, 3].map((m) => point(m)));
    b.series.setData([0, 1, 2, 3].map((m) => point(m, 50)));
    chart.render();
    expect(timelineOf(chart, 4)).toEqual([0, 1, 2, 3].map(at));
    expectPaintedAtOwnTime(chart, a);
    expectPaintedAtOwnTime(chart, b);
    const event = crosshairAt(chart, at(2));
    expect(event.logicalIndex).toBe(2);
    expect(event.seriesData.size).toBe(3);
  });

  it('keeps candles, volume and RSI on their own timestamps when points are missing', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    const volume = probe(chart);
    const rsi = probe(chart, 1);
    candles.setData([0, 1, 2, 3].map((m) => bar(m)));
    volume.series.setData([0, 2, 3].map((m) => point(m, 1000 + m)));
    rsi.series.setData([1, 2, 3].map((m) => point(m, 50 + m)));
    chart.render();

    const ts = chart.timeScale();
    expect(timelineOf(chart, 4)).toEqual([0, 1, 2, 3].map(at));
    // Volume's local index 1 is 10:02 — it must sit on logical 2, not on logical 1 (10:01).
    expect(ts.timeToLogical(at(2))).toBe(2);
    expect(volume.painted.get(at(2))).toBeCloseTo(ts.logicalToCoordinate(2), 6);
    expect(rsi.painted.get(at(1))).toBeCloseTo(ts.logicalToCoordinate(1), 6);
    expectPaintedAtOwnTime(chart, volume);
    expectPaintedAtOwnTime(chart, rsi);

    // At 10:01 volume has no value: it must be absent, never borrowed from 10:00 or 10:02.
    const e1 = crosshairAt(chart, at(1));
    expect(e1.time).toBe(at(1));
    expect(e1.seriesData.has(volume.series)).toBe(false);
    expect(e1.seriesData.get(rsi.series)).toEqual(point(1, 51));
    expect(e1.seriesData.get(candles)).toEqual(bar(1));
    // At 10:00 RSI has no value.
    const e0 = crosshairAt(chart, at(0));
    expect(e0.seriesData.has(rsi.series)).toBe(false);
    expect(e0.seriesData.get(volume.series)).toEqual(point(0, 1000));
    expect(volume.series.dataAt(at(1))).toBeUndefined();
  });

  it('handles series with different start and end times', () => {
    const chart = make();
    const early = probe(chart);
    const late = probe(chart, 1);
    early.series.setData([0, 1, 2, 3, 4].map((m) => point(m)));
    late.series.setData([3, 4, 5, 6, 7, 8].map((m) => point(m)));
    chart.timeScale().fitContent();
    chart.render();
    expect(timelineOf(chart, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(at));
    expect(chart.timeScale().timeToLogical(at(5))).toBe(5);
    expectPaintedAtOwnTime(chart, early);
    expectPaintedAtOwnTime(chart, late);
    const e = crosshairAt(chart, at(7), 1);
    expect(e.seriesData.has(early.series)).toBe(false);
    expect(e.seriesData.get(late.series)).toEqual(point(7));
  });

  it('rejects duplicate timestamps in setData and never duplicates timeline entries on update', () => {
    const chart = make();
    const a = probe(chart);
    a.series.setData([0, 1, 2].map((m) => point(m)));
    expect(() => a.series.setData([point(0), point(1), point(1)])).toThrow(/strictly increasing/);
    expect(a.series.length()).toBe(3); // previous data kept
    a.series.update(point(2, 99));
    a.series.update(point(2, 98));
    const b = probe(chart);
    b.series.setData([point(1), point(2)]);
    b.series.update(point(2, 7));
    chart.render();
    expect(a.series.length()).toBe(3);
    expect(chart.timeScale().timeToLogical(at(2))).toBe(2);
    expect(chart.timeScale().logicalToTime(2)).toBe(at(2));
    // Nothing beyond index 2: logical 3 is extrapolated one interval later, not a duplicate of 10:02.
    expect(chart.timeScale().logicalToTime(3)).toBe(at(3));
    expect(a.series.dataAt(at(2))).toEqual(point(2, 98));
  });

  it('inserts out-of-order updates at their timestamp', () => {
    const chart = make();
    const a = probe(chart);
    const b = probe(chart);
    a.series.setData([0, 2, 4].map((m) => point(m)));
    b.series.setData([1, 3].map((m) => point(m)));
    a.series.update(point(3, 33)); // between existing points of `a`; the time exists via `b`
    b.series.update(point(0, 0)); // before b's first point
    a.series.update(point(1, 11));
    chart.render();
    expect(timelineOf(chart, 5)).toEqual([0, 1, 2, 3, 4].map(at));
    expect(a.series.data()).toEqual([point(0), point(1, 11), point(2), point(3, 33), point(4)]);
    expect(b.series.data()).toEqual([point(0, 0), point(1), point(3)]);
    expectPaintedAtOwnTime(chart, a);
    expectPaintedAtOwnTime(chart, b);
  });

  it('handles empty and single-point series', () => {
    const chart = make();
    const empty = probe(chart);
    const single = probe(chart);
    chart.render();
    expect(chart.timeScale().timeToLogical(at(0))).toBeNull();
    expect(chart.timeScale().getVisibleLogicalRange()).toBeNull();
    single.series.setData([point(5)]);
    chart.render();
    expect(chart.timeScale().timeToLogical(at(5))).toBe(0);
    expect(chart.timeScale().logicalToTime(0)).toBe(at(5));
    expectPaintedAtOwnTime(chart, single);
    expect(empty.series.length()).toBe(0);
    const e = crosshairAt(chart, at(5));
    expect(e.seriesData.size).toBe(1);
    single.series.setData([]);
    chart.render();
    expect(chart.timeScale().timeToLogical(at(5))).toBeNull();
  });
});

describe('realtime updates', () => {
  it('updates several series independently without corrupting their mappings', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    const volume = probe(chart);
    const line = probe(chart, 1);
    candles.setData([0, 1, 2].map((m) => bar(m)));
    volume.series.setData([0, 1].map((m) => point(m)));
    line.series.setData([0, 1, 2].map((m) => point(m)));
    // Volume lags behind; candles get a new bar, then a tick; line runs ahead; volume catches up.
    candles.update(bar(3));
    candles.update({ ...bar(3), close: 104.5 });
    line.series.update(point(3));
    line.series.update(point(4));
    volume.series.update(point(2));
    volume.series.update(point(3));
    candles.update(bar(4));
    chart.render();
    expect(timelineOf(chart, 5)).toEqual([0, 1, 2, 3, 4].map(at));
    expect(candles.length()).toBe(5);
    expect(volume.series.data().map((p) => p.time)).toEqual([0, 1, 2, 3].map(at));
    expectPaintedAtOwnTime(chart, volume);
    expectPaintedAtOwnTime(chart, line);
    expect(crosshairAt(chart, at(4)).seriesData.has(volume.series)).toBe(false);
    expect(crosshairAt(chart, at(3)).seriesData.get(candles)).toEqual({ ...bar(3), close: 104.5 });
  });

  it('keeps following the latest bar when new bars arrive', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    candles.setData(Array.from({ length: 200 }, (_, m) => bar(m)));
    chart.render();
    const offset = chart.timeScale().rightOffset();
    candles.update(bar(200));
    candles.update(bar(201));
    expect(chart.timeScale().rightOffset()).toBe(offset);
  });
});

describe('historical insertion keeps the view', () => {
  function scrolledChart(): { chart: ChartApi; candles: SeriesApi<'candlestick'> } {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    // A gap at minute 150 (missing bar).
    candles.setData(
      Array.from({ length: 200 }, (_, m) => m)
        .filter((m) => m !== 150)
        .map((m) => bar(m)),
    );
    chart.render();
    chart.timeScale().setVisibleLogicalRange({ from: 10, to: 60 });
    chart.render();
    return { chart, candles };
  }

  it('prepending history (setData) keeps the visible times and zoom', () => {
    const { chart, candles } = scrolledChart();
    const before = visibleTimes(chart);
    const spacing = chart.timeScale().barSpacing();
    candles.setData(
      Array.from({ length: 300 }, (_, m) => m - 100)
        .filter((m) => m !== 150)
        .map((m) => bar(m)),
    );
    chart.render();
    expect(visibleTimes(chart)).toEqual(before);
    expect(chart.timeScale().barSpacing()).toBe(spacing);
  });

  it('inserting a missing bar after the visible range keeps the visible times', () => {
    const { chart, candles } = scrolledChart();
    const before = visibleTimes(chart);
    candles.update(bar(150));
    chart.render();
    expect(visibleTimes(chart)).toEqual(before);
  });

  it('another series filling a gap after the visible range keeps the visible times', () => {
    const { chart } = scrolledChart();
    const volume = probe(chart);
    volume.series.setData([0, 1, 2].map((m) => point(m)));
    chart.render();
    const before = visibleTimes(chart);
    volume.series.update(point(150)); // appended to volume; a new time in the middle of the timeline
    chart.render();
    expect(visibleTimes(chart)).toEqual(before);
    expectPaintedAtOwnTime(chart, volume);
  });

  it('inserting bars before the visible range keeps the visible times', () => {
    const { chart, candles } = scrolledChart();
    const before = visibleTimes(chart);
    candles.update(bar(-1));
    candles.update(bar(-2));
    chart.render();
    expect(visibleTimes(chart)).toEqual(before);
  });

  it('keeps the zoom when the series holding the last timestamp is shortened', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    const forecast = probe(chart);
    candles.setData(Array.from({ length: 200 }, (_, m) => bar(m)));
    forecast.series.setData(Array.from({ length: 20 }, (_, i) => point(200 + i)));
    chart.render();
    chart.timeScale().setVisibleLogicalRange({ from: 50, to: 100 });
    chart.render();
    const before = visibleTimes(chart);
    const spacing = chart.timeScale().barSpacing();
    forecast.series.setData(Array.from({ length: 10 }, (_, i) => point(200 + i)));
    chart.render();
    expect(chart.timeScale().barSpacing()).toBe(spacing);
    expect(visibleTimes(chart)).toEqual(before);
  });
});

describe('crosshair and coordinates across panes', () => {
  it('resolves one logical time position shared by every pane', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    const p1 = probe(chart, 1);
    const p2 = probe(chart, 2);
    candles.setData([0, 1, 2, 3, 4, 5].map((m) => bar(m)));
    p1.series.setData([0, 2, 4].map((m) => point(m)));
    p2.series.setData([1, 3, 5].map((m) => point(m)));
    chart.render();
    for (const pane of [0, 1, 2]) {
      const e = crosshairAt(chart, at(3), pane);
      expect(e.time).toBe(at(3));
      expect(e.logicalIndex).toBe(3);
      expect(e.pane).toBe(pane);
      expect(e.seriesData.has(p1.series)).toBe(false);
      expect(e.seriesData.get(p2.series)).toEqual(point(3));
    }
    // A time between bars resolves to the nearest bar, never to another series' neighbour.
    const between = crosshairAt(chart, at(3) + 20_000, 1);
    expect(between.time).toBe(at(3));
    expectPaintedAtOwnTime(chart, p1);
    expectPaintedAtOwnTime(chart, p2);
  });

  it('pixel ↔ logical ↔ time conversions are consistent after zoom and pan', () => {
    const chart = make();
    const candles = chart.addSeries('candlestick');
    const p = probe(chart, 1);
    candles.setData(Array.from({ length: 500 }, (_, m) => bar(m)));
    p.series.setData(
      Array.from({ length: 500 }, (_, m) => m)
        .filter((m) => m % 3 !== 0)
        .map((m) => point(m)),
    );
    chart.render();
    const ts = chart.timeScale();
    for (const [from, to] of [
      [100.25, 180.75],
      [0, 40],
      [450, 520],
    ] as const) {
      ts.setVisibleLogicalRange({ from, to });
      chart.render();
      expectPaintedAtOwnTime(chart, p);
      for (const logical of [from + 1.5, (from + to) / 2, to - 2.25]) {
        const x = ts.logicalToCoordinate(logical);
        expect(ts.coordinateToLogical(x)).toBeCloseTo(logical, 9);
        const time = ts.coordinateToTime(x)!;
        expect(ts.timeToLogical(time)).toBeCloseTo(logical, 6);
        expect(ts.timeToCoordinate(time)).toBeCloseTo(x, 6);
      }
    }
  });
});

describe('time zones', () => {
  it('keeps UTC instants distinct across a daylight-saving transition', () => {
    // 2024-11-03: New York falls back from EDT to EST; 01:30 local happens twice (05:30Z and 06:30Z).
    const start = Date.UTC(2024, 10, 3, 3, 30);
    const hours = Array.from({ length: 6 }, (_, i) => start + i * 60 * MINUTE);
    const chart = make(800, { localization: { timeZone: 'America/New_York' } });
    const a = probe(chart);
    const b = probe(chart, 1);
    a.series.setData(hours.map((time, i) => ({ time, value: i })));
    b.series.setData(hours.filter((_, i) => i !== 2).map((time, i) => ({ time, value: i })));
    chart.render();
    expect(timelineOf(chart, 6)).toEqual(hours);
    expect(chart.timeScale().timeToLogical(hours[3]!)).toBe(3);
    expectPaintedAtOwnTime(chart, a);
    expectPaintedAtOwnTime(chart, b);
    expect(crosshairAt(chart, hours[2]!).seriesData.has(b.series)).toBe(false);
  });
});

describe('large datasets', () => {
  it('maps 200,000 candles and a sparse volume series by time', () => {
    const chart = make();
    const data = generateBars({ count: 200_000, interval: MINUTE, seed: 3 });
    const candles = chart.addSeries('candlestick');
    const volume = probe(chart);
    candles.setData(data);
    volume.series.setColumns({
      times: data.filter((_, i) => i % 7 !== 3).map((b) => b.time),
      fields: { value: data.filter((_, i) => i % 7 !== 3).map((b) => b.volume ?? 0) },
    });
    chart.render();
    const ts = chart.timeScale();
    for (const i of [0, 3, 10, 99_999, 199_997, 199_999]) {
      expect(ts.timeToLogical(data[i]!.time)).toBe(i);
      const e = crosshairAt(chart, data[i]!.time);
      expect(e.seriesData.has(volume.series)).toBe(i % 7 !== 3);
    }
    expectPaintedAtOwnTime(chart, volume);
  });
});

describe('property: random multi-series operations', () => {
  type Op = (r: () => number) => void;

  it('timeline stays the sorted union and every series stays on its own timestamps', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = createRandom(seed);
      const chart = make();
      const probes = [probe(chart), probe(chart, 1), probe(chart, 1)];
      const model = probes.map(() => new Map<number, number>());
      const minute = (): number => Math.floor(r() * 120);

      const ops: Op[] = [
        // setData with a random subset
        () => {
          const k = Math.floor(r() * probes.length);
          const times = [...new Set(Array.from({ length: Math.floor(r() * 40) }, minute))].sort(
            (a, b) => a - b,
          );
          model[k]!.clear();
          for (const m of times) model[k]!.set(m, m * 10 + k);
          probes[k]!.series.setData(times.map((m) => point(m, m * 10 + k)));
        },
        // update: append, replace or insert anywhere
        () => {
          const k = Math.floor(r() * probes.length);
          const m = minute();
          const value = Math.round(r() * 1000);
          model[k]!.set(m, value);
          probes[k]!.series.update(point(m, value));
        },
        // realtime append past the end
        () => {
          const k = Math.floor(r() * probes.length);
          const last = Math.max(-1, ...model[k]!.keys());
          const m = last + 1 + Math.floor(r() * 3);
          model[k]!.set(m, m);
          probes[k]!.series.update(point(m, m));
        },
      ];

      for (let step = 0; step < 60; step++) {
        ops[Math.floor(r() * ops.length)]!(r);
        if (step % 5 !== 4) continue;
        chart.timeScale().fitContent();
        chart.render();
        const union = [...new Set(model.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
        const ts = chart.timeScale();
        // Strictly increasing canonical timeline equal to the union.
        if (union.length > 0) expect(timelineOf(chart, union.length)).toEqual(union.map(at));
        union.forEach((m, i) => expect(ts.timeToLogical(at(m))).toBe(i));
        probes.forEach((p, k) => {
          const expected = [...model[k]!.entries()].sort((a, b) => a[0] - b[0]);
          expect(p.series.data()).toEqual(expected.map(([m, v]) => point(m, v)));
          if (expected.length) expectPaintedAtOwnTime(chart, p);
        });
        if (union.length) {
          const m = union[Math.floor(r() * union.length)]!;
          const e = crosshairAt(chart, at(m));
          probes.forEach((p, k) => {
            const v = model[k]!.get(m);
            if (v === undefined) expect(e.seriesData.has(p.series)).toBe(false);
            else expect(e.seriesData.get(p.series)).toEqual(point(m, v));
          });
        }
      }
      chart.destroy();
    }
  });
});
