import { cloneState } from './clone.js';
import { resolveParams } from './params.js';
import type {
  Bar,
  IndicatorCalculator,
  IndicatorDefinition,
  InputSchema,
  Params,
} from './types.js';
import { IndicatorError } from './types.js';

/** Columnar indicator output. Arrays may be longer than `length`; read [0, length). */
export interface IndicatorResult {
  readonly length: number;
  readonly times: Float64Array;
  /** One array per output, in definition order. NaN = no value. */
  readonly values: readonly Float64Array[];
  /** 1 when the input bar closed at or above its open (used by bar-coloured histograms). */
  readonly barUp: Uint8Array;
}

/**
 * Runs a calculator over a bar stream with realtime semantics:
 * - `reset(bars)` computes history in one pass (no per-bar snapshots);
 * - `append(bar)` processes a new bar in O(cost of one step);
 * - `updateLast(bar)` replaces the last bar (tick update) by restoring the state snapshot taken
 *   before that bar and re-running one step, so indicators never drift on repeated ticks.
 */
export class IndicatorRunner<S extends InputSchema = InputSchema> {
  readonly definition: IndicatorDefinition<S>;
  readonly params: Params<S>;
  private calculator: IndicatorCalculator;
  private snapshot: IndicatorCalculator | null = null;
  private _length = 0;
  private times = new Float64Array(64);
  private values: Float64Array[];
  private barUp = new Uint8Array(64);

  constructor(definition: IndicatorDefinition<S>, params?: Readonly<Record<string, unknown>>) {
    this.definition = definition;
    this.params = resolveParams(definition, params);
    this.calculator = definition.create(this.params);
    this.values = definition.outputs.map(() => new Float64Array(64));
  }

  get length(): number {
    return this._length;
  }

  get lastTime(): number | undefined {
    return this._length > 0 ? this.times[this._length - 1] : undefined;
  }

  result(): IndicatorResult {
    return { length: this._length, times: this.times, values: this.values, barUp: this.barUp };
  }

  reset(bars: readonly Bar[]): void {
    this.calculator = this.definition.create(this.params);
    this.snapshot = null;
    this._length = 0;
    this.ensureCapacity(bars.length);
    let prev = -Infinity;
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]!;
      if (!(bar.time > prev))
        throw new IndicatorError(`bars must be sorted by strictly increasing time (index ${i})`);
      prev = bar.time;
      if (i === bars.length - 1) this.snapshot = cloneState(this.calculator);
      this.write(i, bar, this.calculator.next(bar));
      this._length = i + 1;
    }
  }

  append(bar: Bar): void {
    const last = this.lastTime;
    if (last !== undefined && !(bar.time > last)) {
      throw new IndicatorError(
        `append() needs a newer bar (got ${bar.time}, last ${last}); use updateLast()`,
      );
    }
    this.ensureCapacity(this._length + 1);
    this.snapshot = cloneState(this.calculator);
    this.write(this._length, bar, this.calculator.next(bar));
    this._length++;
  }

  updateLast(bar: Bar): void {
    if (this._length === 0 || !this.snapshot)
      throw new IndicatorError('updateLast() needs at least one bar');
    if (bar.time !== this.lastTime)
      throw new IndicatorError('updateLast() must keep the time of the last bar');
    this.calculator = cloneState(this.snapshot);
    this.write(this._length - 1, bar, this.calculator.next(bar));
  }

  private write(index: number, bar: Bar, output: ArrayLike<number>): void {
    this.times[index] = bar.time;
    this.barUp[index] = bar.close >= bar.open ? 1 : 0;
    for (let o = 0; o < this.values.length; o++) {
      const v = output[o];
      this.values[o]![index] = typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN;
    }
  }

  private ensureCapacity(required: number): void {
    if (required <= this.times.length) return;
    const capacity = Math.max(required, this.times.length * 2);
    const grow = <A extends Float64Array | Uint8Array>(source: A, make: (n: number) => A): A => {
      const next = make(capacity);
      next.set(source.subarray(0, this._length) as never);
      return next;
    };
    this.times = grow(this.times, (n) => new Float64Array(n));
    this.barUp = grow(this.barUp, (n) => new Uint8Array(n));
    this.values = this.values.map((v) => grow(v, (n) => new Float64Array(n)));
  }
}

/**
 * Pure batch computation: bars in, columns out. No chart or DOM dependency, so it can run in a
 * Web Worker (structured-clone the bars, transfer the returned typed arrays).
 */
export function computeIndicator<S extends InputSchema>(
  definition: IndicatorDefinition<S>,
  bars: readonly Bar[],
  params?: Readonly<Record<string, unknown>>,
): IndicatorResult {
  const runner = new IndicatorRunner(definition, params);
  runner.reset(bars);
  const { length, times, values, barUp } = runner.result();
  return {
    length,
    times: times.slice(0, length),
    values: values.map((v) => v.slice(0, length)),
    barUp: barUp.slice(0, length),
  };
}
