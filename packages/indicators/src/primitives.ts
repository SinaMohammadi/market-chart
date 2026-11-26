/**
 * Incremental building blocks. Every primitive:
 * - consumes one value per `next` call and returns its current output (NaN while warming up);
 * - ignores non-finite inputs (returns NaN without advancing), so chained primitives start
 *   naturally once their input becomes available;
 * - keeps all state in own properties, so `cloneState` can snapshot it.
 */

export interface Smoother {
  next(value: number): number;
}

/** Simple moving average. Exact sum recomputed once per window to prevent floating-point drift. */
export class Sma implements Smoother {
  private readonly buffer: Float64Array;
  private index = 0;
  private count = 0;
  private sum = 0;

  constructor(readonly period: number) {
    this.buffer = new Float64Array(period);
  }

  next(value: number): number {
    if (!Number.isFinite(value)) return Number.NaN;
    const n = this.period;
    if (this.count < n) {
      this.buffer[this.count++] = value;
      this.sum += value;
      return this.count === n ? this.sum / n : Number.NaN;
    }
    this.sum += value - this.buffer[this.index]!;
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % n;
    if (this.index === 0) {
      let exact = 0;
      for (let i = 0; i < n; i++) exact += this.buffer[i]!;
      this.sum = exact;
    }
    return this.sum / n;
  }
}

/** Rolling sum over `period` values (NaN until full). */
export class RollingSum implements Smoother {
  private readonly sma: Sma;

  constructor(readonly period: number) {
    this.sma = new Sma(period);
  }

  next(value: number): number {
    return this.sma.next(value) * this.period;
  }
}

/** Exponential average seeded with the SMA of the first `period` values (Pine `ta.ema` semantics). */
export class Ema implements Smoother {
  private readonly seed: Sma;
  private value = Number.NaN;
  private readonly alpha: number;

  constructor(
    readonly period: number,
    alpha?: number,
  ) {
    this.seed = new Sma(period);
    this.alpha = alpha ?? 2 / (period + 1);
  }

  next(value: number): number {
    if (!Number.isFinite(value)) return Number.NaN;
    if (Number.isNaN(this.value)) {
      this.value = this.seed.next(value);
      return this.value;
    }
    this.value = this.alpha * value + (1 - this.alpha) * this.value;
    return this.value;
  }
}

/** Wilder's running moving average (RMA): EMA with alpha = 1/period. */
export class Rma extends Ema {
  constructor(period: number) {
    super(period, 1 / period);
  }
}

/** Linearly weighted moving average (newest weight = period), O(1) per value. */
export class Wma implements Smoother {
  private readonly buffer: Float64Array;
  private index = 0;
  private count = 0;
  private sum = 0;
  private weighted = 0;
  private readonly denominator: number;

  constructor(readonly period: number) {
    this.buffer = new Float64Array(period);
    this.denominator = (period * (period + 1)) / 2;
  }

  next(value: number): number {
    if (!Number.isFinite(value)) return Number.NaN;
    const n = this.period;
    if (this.count < n) {
      this.buffer[this.count++] = value;
      this.sum += value;
      this.weighted += this.count * value;
      return this.count === n ? this.weighted / this.denominator : Number.NaN;
    }
    this.weighted += n * value - this.sum;
    this.sum += value - this.buffer[this.index]!;
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % n;
    if (this.index === 0) {
      let s = 0;
      let w = 0;
      for (let i = 0; i < n; i++) {
        s += this.buffer[i]!;
        w += (i + 1) * this.buffer[i]!;
      }
      this.sum = s;
      this.weighted = w;
    }
    return this.weighted / this.denominator;
  }
}

export type MaType = 'sma' | 'ema' | 'wma' | 'rma';
export const MA_TYPES: readonly MaType[] = ['sma', 'ema', 'wma', 'rma'];

export function createMa(type: MaType, period: number): Smoother {
  switch (type) {
    case 'sma':
      return new Sma(period);
    case 'ema':
      return new Ema(period);
    case 'wma':
      return new Wma(period);
    case 'rma':
      return new Rma(period);
  }
}

/**
 * Rolling maximum or minimum over the last `period` values using a monotonic deque (amortised O(1)).
 * `barsSince` is the age of the extreme (0 = current value). Ties resolve to the most recent value.
 */
export class RollingExtreme {
  private values: number[] = [];
  private positions: number[] = [];
  private head = 0;
  private counter = 0;
  barsSince = Number.NaN;

  constructor(
    readonly period: number,
    readonly kind: 'max' | 'min',
  ) {}

  next(value: number): number {
    if (!Number.isFinite(value)) return Number.NaN;
    const position = this.counter++;
    const isMax = this.kind === 'max';
    while (this.values.length > this.head) {
      const last = this.values[this.values.length - 1]!;
      if (isMax ? last <= value : last >= value) {
        this.values.pop();
        this.positions.pop();
      } else break;
    }
    this.values.push(value);
    this.positions.push(position);
    while (this.positions[this.head]! <= position - this.period) this.head++;
    if (this.head > 64 && this.head * 2 > this.values.length) {
      this.values = this.values.slice(this.head);
      this.positions = this.positions.slice(this.head);
      this.head = 0;
    }
    if (this.counter < this.period) {
      this.barsSince = Number.NaN;
      return Number.NaN;
    }
    this.barsSince = position - this.positions[this.head]!;
    return this.values[this.head]!;
  }
}

/** Population standard deviation over `period` values (Pine `ta.stdev` with `biased = true`). */
export class StdDev implements Smoother {
  private readonly buffer: Float64Array;
  private index = 0;
  private count = 0;
  private sum = 0;
  private sumSq = 0;
  /** Values are shifted by the first input to keep sums small and the variance numerically stable. */
  private shift = Number.NaN;

  constructor(readonly period: number) {
    this.buffer = new Float64Array(period);
  }

  next(value: number): number {
    if (!Number.isFinite(value)) return Number.NaN;
    if (Number.isNaN(this.shift)) this.shift = value;
    const v = value - this.shift;
    const n = this.period;
    if (this.count < n) {
      this.buffer[this.count++] = v;
      this.sum += v;
      this.sumSq += v * v;
      return this.count === n ? this.result() : Number.NaN;
    }
    const old = this.buffer[this.index]!;
    this.sum += v - old;
    this.sumSq += v * v - old * old;
    this.buffer[this.index] = v;
    this.index = (this.index + 1) % n;
    if (this.index === 0) {
      let s = 0;
      let q = 0;
      for (let i = 0; i < n; i++) {
        s += this.buffer[i]!;
        q += this.buffer[i]! * this.buffer[i]!;
      }
      this.sum = s;
      this.sumSq = q;
    }
    return this.result();
  }

  private result(): number {
    const n = this.period;
    const mean = this.sum / n;
    return Math.sqrt(Math.max(0, this.sumSq / n - mean * mean));
  }
}

/** Returns the value from `period` inputs ago (NaN until available). */
export class Lag {
  private readonly buffer: Float64Array;
  private index = 0;
  private count = 0;

  constructor(readonly period: number) {
    this.buffer = new Float64Array(period + 1);
  }

  next(value: number): number {
    if (!Number.isFinite(value)) return Number.NaN;
    const size = this.period + 1;
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % size;
    this.count = Math.min(this.count + 1, size);
    return this.count === size ? this.buffer[this.index]! : Number.NaN;
  }
}

/** Mean absolute deviation from the window mean (used by CCI). O(period) per value. */
export class MeanDeviation {
  private readonly buffer: Float64Array;
  private index = 0;
  private count = 0;

  constructor(readonly period: number) {
    this.buffer = new Float64Array(period);
  }

  /** Returns the deviation around `mean` once the window is full. */
  next(value: number, mean: number): number {
    if (!Number.isFinite(value)) return Number.NaN;
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % this.period;
    this.count = Math.min(this.count + 1, this.period);
    if (this.count < this.period || !Number.isFinite(mean)) return Number.NaN;
    let total = 0;
    for (let i = 0; i < this.period; i++) total += Math.abs(this.buffer[i]! - mean);
    return total / this.period;
  }
}

/** Relative Strength Index state (Wilder smoothing), reused by RSI and Stochastic RSI. */
export class RsiState {
  private readonly gain: Rma;
  private readonly loss: Rma;
  private prev = Number.NaN;

  constructor(period: number) {
    this.gain = new Rma(period);
    this.loss = new Rma(period);
  }

  next(value: number): number {
    if (!Number.isFinite(value)) return Number.NaN;
    const prev = this.prev;
    this.prev = value;
    if (Number.isNaN(prev)) return Number.NaN;
    const change = value - prev;
    const up = this.gain.next(Math.max(change, 0));
    const down = this.loss.next(Math.max(-change, 0));
    if (!Number.isFinite(up) || !Number.isFinite(down)) return Number.NaN;
    if (down === 0) return 100;
    if (up === 0) return 0;
    return 100 - 100 / (1 + up / down);
  }
}

/** Average True Range with a selectable smoothing (default Wilder). */
export class AtrState {
  private readonly ma: Smoother;
  private prevClose = Number.NaN;

  constructor(period: number, type: MaType = 'rma') {
    this.ma = createMa(type, period);
  }

  next(high: number, low: number, close: number): number {
    const prev = this.prevClose;
    this.prevClose = close;
    const tr = Number.isFinite(prev)
      ? Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev))
      : high - low;
    return this.ma.next(tr);
  }
}
