import { describe, expect, it } from 'vitest';
import { ColumnStore, VALUE_FIELDS } from './column-store.js';
import { Timeline } from './timeline.js';

/** Small deterministic PRNG (mulberry32), so failures reproduce. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectConsistent(timeline: Timeline, stores: readonly ColumnStore<'value'>[]): void {
  const union = [...new Set(stores.flatMap((s) => Array.from(s.times.subarray(0, s.length))))].sort(
    (a, b) => a - b,
  );
  // Strictly increasing, and exactly the union of all series' timestamps.
  expect(Array.from(timeline.times.subarray(0, timeline.length))).toEqual(union);
  for (const store of stores) {
    const mapping = timeline.mapping(store);
    // Local index i resolves to the timeline slot holding *its own* time (one assertion per store: fast).
    const wrong: number[] = [];
    for (let i = 0; i < store.length; i++) {
      if (timeline.timeAt(mapping[i]!) !== store.times[i] || union[mapping[i]!] !== store.times[i])
        wrong.push(i);
    }
    expect(wrong).toEqual([]);
  }
}

describe('Timeline (property)', () => {
  it('stays the sorted union with exact mappings under random appends, inserts and replaces', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = random(seed);
      const stores = [0, 1, 2].map(() => new ColumnStore(VALUE_FIELDS, ['value']));
      const timeline = new Timeline();
      stores.forEach((s, k) =>
        s.replace(
          [...new Set(Array.from({ length: Math.floor(r() * 30) }, () => Math.floor(r() * 60)))]
            .sort((a, b) => a - b)
            .map((time) => ({ time, value: k })),
        ),
      );
      timeline.rebuild(stores);
      expectConsistent(timeline, stores);
      for (let step = 0; step < 200; step++) {
        const store = stores[Math.floor(r() * stores.length)]!;
        const last = store.lastTime() ?? -1;
        const time = r() < 0.6 ? last + 1 + Math.floor(r() * 3) : Math.floor(r() * (last + 2));
        const result = store.upsert({ time, value: step });
        // The chart's update path: fast append, falling back to a rebuild.
        if (result.kind === 'appended') {
          if (!timeline.appendFrom(store)) timeline.rebuild(stores);
        } else if (result.kind === 'inserted') timeline.rebuild(stores);
        expectConsistent(timeline, stores);
      }
    }
  });

  it('keeps identity mappings shared and exact when series share timestamps', () => {
    const a = new ColumnStore(VALUE_FIELDS);
    const b = new ColumnStore(VALUE_FIELDS);
    const rows = Array.from({ length: 100 }, (_, i) => ({ time: i * 10, value: i }));
    a.replace(rows);
    b.replace(rows);
    const timeline = new Timeline();
    timeline.rebuild([a, b]);
    for (let i = 100; i < 300; i++) {
      for (const s of i % 2 ? [a, b] : [b, a]) {
        s.upsert({ time: i * 10, value: i });
        expect(timeline.appendFrom(s)).toBe(true);
      }
    }
    expectConsistent(timeline, [a, b]);
    // A store that lags behind is no longer the identity, and stays exact.
    a.upsert({ time: 3000, value: 0 });
    expect(timeline.appendFrom(a)).toBe(true);
    b.upsert({ time: 3010, value: 0 });
    expect(timeline.appendFrom(b)).toBe(true);
    expectConsistent(timeline, [a, b]);
  });

  it('handles empty and single-point stores', () => {
    const empty = new ColumnStore(VALUE_FIELDS);
    const one = new ColumnStore(VALUE_FIELDS);
    const timeline = new Timeline();
    timeline.rebuild([empty, one]);
    expect(timeline.length).toBe(0);
    expect(timeline.nearestIndex(5)).toBe(-1);
    one.replace([{ time: 5, value: 1 }]);
    timeline.rebuild([empty, one]);
    expectConsistent(timeline, [empty, one]);
    expect(timeline.nearestIndex(-100)).toBe(0);
    expect(timeline.nearestIndex(100)).toBe(0);
  });
});
