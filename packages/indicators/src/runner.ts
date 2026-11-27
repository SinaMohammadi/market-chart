import { cloneState } from './clone.js';
import { resolveParams } from './params.js';
import type {
  Bar,
  IndicatorCalculator,
  IndicatorContext,
  IndicatorDefinition,
  InputSchema,
  Params,
} from './types.js';
import { IndicatorError } from './types.js';

const NO_CONTEXT: IndicatorContext = { session: null };

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
  /** How many trailing bars `rewrite()` can rewind to without a full `reset()`. */
  static readonly REWIND_BARS = 16;
  readonly definition: IndicatorDefinition<S>;
  readonly params: Params<S>;
  private calculator: IndicatorCalculator;
  /**
   * Calculator state *before* bar `i`, for the last `REWIND_BARS` bars, at slot `i % REWIND_BARS`
   * (`snapshotIndex` says which bar a slot belongs to). The latest one backs `updateLast`; the older ones
   * let corrections of recent bars re-run only the tail. Snapshots are never mutated, only cloned.
   */
  private readonly snapshots: (IndicatorCalculator | null)[] =
    new Array<IndicatorCalculator | null>(IndicatorRunner.REWIND_BARS).fill(null);
  private readonly snapshotIndex = new Int32Array(IndicatorRunner.REWIND_BARS).fill(-1);
  private _length = 0;
  private times = new Float64Array(64);
  private values: Float64Array[];
  private barUp = new Uint8Array(64);

  readonly context: IndicatorContext;

  constructor(
    definition: IndicatorDefinition<S>,
    params?: Readonly<Record<string, unknown>>,
    context: IndicatorContext = NO_CONTEXT,
  ) {
    this.definition = definition;
    this.params = resolveParams(definition, params);
    this.context = context;
    this.calculator = definition.create(this.params, context);
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
    this.calculator = this.definition.create(this.params, this.context);
    this.snapshots.fill(null);
    this.snapshotIndex.fill(-1);
    this._length = 0;
    this.ensureCapacity(bars.length);
    const keepFrom = bars.length - IndicatorRunner.REWIND_BARS;
    let prev = -Infinity;
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]!;
      if (!(bar.time > prev))
        throw new IndicatorError(`bars must be sorted by strictly increasing time (index ${i})`);
      prev = bar.time;
      if (i >= keepFrom) this.keepSnapshot(i);
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
    this.keepSnapshot(this._length);
    this.write(this._length, bar, this.calculator.next(bar));
    this._length++;
  }

  updateLast(bar: Bar): void {
    const snapshot = this.snapshotBefore(this._length - 1);
    if (this._length === 0 || !snapshot)
      throw new IndicatorError('updateLast() needs at least one bar');
    if (bar.time !== this.lastTime)
      throw new IndicatorError('updateLast() must keep the time of the last bar');
    this.calculator = cloneState(snapshot);
    this.write(this._length - 1, bar, this.calculator.next(bar));
  }

  /** True when `rewrite(index, …)` can run (bar `index` is one of the last `REWIND_BARS`). */
  canRewrite(index: number): boolean {
    return index >= 0 && index < this._length && this.snapshotBefore(index) !== null;
  }

  /**
   * Re-runs bars `index … length - 1` from the state before `index` — a correction of a recent, already
   * processed bar (O(length − index) steps instead of a full reset). `bars` are the new bars for exactly
   * those indices, with the same times. Throws (leaving the result unchanged) when that is not the case.
   */
  rewrite(index: number, bars: readonly Bar[]): void {
    const snapshot = this.snapshotBefore(index);
    if (!snapshot) throw new IndicatorError(`rewrite(): bar ${index} is not one of the last bars`);
    if (bars.length !== this._length - index)
      throw new IndicatorError(`rewrite(): expected ${this._length - index} bars`);
    for (let k = 0; k < bars.length; k++) {
      if (bars[k]!.time !== this.times[index + k])
        throw new IndicatorError('rewrite(): bars must keep their times');
    }
    this.calculator = cloneState(snapshot);
    for (let k = 0; k < bars.length; k++) {
      // The state before every later bar changed too: refresh those snapshots.
      if (k > 0) this.keepSnapshot(index + k);
      this.write(index + k, bars[k]!, this.calculator.next(bars[k]!));
    }
  }

  private keepSnapshot(index: number): void {
    const slot = index % IndicatorRunner.REWIND_BARS;
    this.snapshots[slot] = cloneState(this.calculator);
    this.snapshotIndex[slot] = index;
  }

  private snapshotBefore(index: number): IndicatorCalculator | null {
    if (index < 0) return null;
    const slot = index % IndicatorRunner.REWIND_BARS;
    return this.snapshotIndex[slot] === index ? this.snapshots[slot]! : null;
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
  context?: IndicatorContext,
): IndicatorResult {
  const runner = new IndicatorRunner(definition, params, context);
  runner.reset(bars);
  const { length, times, values, barUp } = runner.result();
  return {
    length,
    times: times.slice(0, length),
    values: values.map((v) => v.slice(0, length)),
    barUp: barUp.slice(0, length),
  };
}
