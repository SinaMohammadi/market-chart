import type { Timeline } from '../model/timeline.js';
import type { TickGranularity, TimeFormatter } from '../time/time-format.js';
import type { ZonedClock } from '../time/zoned-clock.js';
import type { TimeScale } from './time-scale.js';

export interface TimeTick {
  readonly index: number;
  readonly x: number;
  readonly label: string;
  readonly weight: number;
}

/** Weights: higher = more significant boundary. */
const W_YEAR = 70;
const W_MONTH = 60;
const W_DAY = 50;
const W_HOUR_12 = 46;
const W_HOUR_6 = 44;
const W_HOUR_3 = 42;
const W_HOUR = 40;
const W_MIN_30 = 34;
const W_MIN_15 = 32;
const W_MIN_5 = 30;
const W_MIN = 28;
const W_SECOND = 10;

const LEVELS = [
  W_YEAR,
  W_MONTH,
  W_DAY,
  W_HOUR_12,
  W_HOUR_6,
  W_HOUR_3,
  W_HOUR,
  W_MIN_30,
  W_MIN_15,
  W_MIN_5,
  W_MIN,
  W_SECOND,
];

function granularityOf(weight: number): TickGranularity {
  if (weight >= W_YEAR) return 'year';
  if (weight >= W_MONTH) return 'month';
  if (weight >= W_DAY) return 'day';
  if (weight >= W_MIN) return 'time';
  return 'seconds';
}

/**
 * Computes and caches tick weights per timeline index. Weights describe which calendar boundary
 * a bar starts (new year, month, day, round hour…), computed in the configured time zone.
 */
export class TimeTickGenerator {
  private weights = new Uint8Array(0);
  private computedVersion = -1;
  private clock: ZonedClock;
  private formatter: TimeFormatter;

  constructor(clock: ZonedClock, formatter: TimeFormatter) {
    this.clock = clock;
    this.formatter = formatter;
  }

  setClock(clock: ZonedClock, formatter: TimeFormatter): void {
    this.clock = clock;
    this.formatter = formatter;
    this.computedVersion = -1;
  }

  weightAt(timeline: Timeline, index: number): number {
    this.sync(timeline);
    if (index >= this.weights.length) this.grow(timeline.length);
    let w = this.weights[index]!;
    if (w === 0) {
      w = this.computeWeight(timeline, index);
      this.weights[index] = w;
    }
    return w;
  }

  /** Tick marks for the visible range with at least `minSpacingPx` between labels. */
  ticks(timeline: Timeline, scale: TimeScale, minSpacingPx: number): TimeTick[] {
    const visible = scale.visibleIndexRange();
    if (!visible) return [];
    const minBars = Math.max(1, Math.ceil(minSpacingPx / scale.barSpacing));
    // Start scanning at a stable anchor so tick choice does not jitter while scrolling.
    const chunk = minBars * 16;
    const start = Math.max(0, visible.from - (visible.from % chunk) - minBars);
    const end = Math.min(timeline.lastIndex, visible.to + minBars);
    const accepted: number[] = [];
    const acceptedWeights = new Map<number, number>();
    for (const level of LEVELS) {
      for (let i = start; i <= end; i++) {
        if (this.weightAt(timeline, i) !== level) continue;
        if (isFarEnough(accepted, i, minBars)) {
          insertSorted(accepted, i);
          acceptedWeights.set(i, level);
        }
      }
    }
    const out: TimeTick[] = [];
    for (const index of accepted) {
      if (index < visible.from || index > visible.to) continue;
      const weight = acceptedWeights.get(index)!;
      out.push({
        index,
        x: scale.indexToX(index),
        weight,
        label: this.formatter.tick(timeline.timeAt(index)!, granularityOf(weight)),
      });
    }
    return out;
  }

  private sync(timeline: Timeline): void {
    if (this.computedVersion !== timeline.version) {
      this.weights = new Uint8Array(Math.max(64, timeline.length));
      this.computedVersion = timeline.version;
    }
  }

  private grow(length: number): void {
    const next = new Uint8Array(Math.max(length, this.weights.length * 2));
    next.set(this.weights);
    this.weights = next;
  }

  private computeWeight(timeline: Timeline, index: number): number {
    const time = timeline.timeAt(index)!;
    if (index === 0) return W_YEAR;
    const prev = this.clock.parts(timeline.timeAt(index - 1)!);
    const cur = this.clock.parts(time);
    if (cur.year !== prev.year) return W_YEAR;
    if (cur.month !== prev.month) return W_MONTH;
    if (cur.day !== prev.day) return W_DAY;
    if (cur.hour !== prev.hour) {
      if (cur.hour % 12 === 0) return W_HOUR_12;
      if (cur.hour % 6 === 0) return W_HOUR_6;
      if (cur.hour % 3 === 0) return W_HOUR_3;
      return W_HOUR;
    }
    if (cur.minute !== prev.minute) {
      if (cur.minute % 30 === 0) return W_MIN_30;
      if (cur.minute % 15 === 0) return W_MIN_15;
      if (cur.minute % 5 === 0) return W_MIN_5;
      return W_MIN;
    }
    return W_SECOND;
  }
}

function isFarEnough(sorted: number[], value: number, minDistance: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  const next = sorted[lo];
  const prev = sorted[lo - 1];
  return (
    (next === undefined || next - value >= minDistance) &&
    (prev === undefined || value - prev >= minDistance)
  );
}

function insertSorted(sorted: number[], value: number): void {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  sorted.splice(lo, 0, value);
}
