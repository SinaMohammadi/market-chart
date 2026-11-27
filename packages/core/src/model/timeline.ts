import { indexOfSorted, lowerBound } from '../utils/binary-search.js';

/** The subset of a data store the timeline needs. */
export interface TimeSource {
  readonly length: number;
  readonly times: Float64Array;
  lastTime(): number | undefined;
}

const EMPTY_MAPPING = new Int32Array(0);

/** Calendar axis: empty slots for missing times, so closed hours and weekends take space. */
export interface CalendarFill {
  /** Slot length in ms; null detects the most common distance between bars. */
  readonly step: number | null;
  /** At most this many empty slots per gap (longer gaps are shortened). */
  readonly maxGapBars: number;
}

/** The most common positive distance between consecutive times (the smaller one on ties), or NaN. */
export function commonStep(times: Float64Array, length: number): number {
  const counts = new Map<number, number>();
  for (let i = 1; i < length; i++) {
    const d = times[i]! - times[i - 1]!;
    if (d > 0) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best = Number.NaN;
  let bestCount = 0;
  for (const [d, n] of counts)
    if (n > bestCount || (n === bestCount && d < best)) {
      best = d;
      bestCount = n;
    }
  return best;
}

/** Empty slots between `a` and `b` at `step`: none unless at least two steps apart (month lengths vary). */
function fillersBetween(a: number, b: number, step: number, max: number): number {
  const k = Math.round((b - a) / step);
  if (k < 2) return 0;
  let n = Math.min(k - 1, max);
  while (n > 0 && a + n * step >= b) n--;
  return n;
}

/** `times` with empty slots added (see `CalendarFill`). */
function fillCalendar(
  times: Float64Array<ArrayBuffer>,
  length: number,
  step: number,
  max: number,
): { times: Float64Array<ArrayBuffer>; length: number } {
  let extra = 0;
  for (let i = 1; i < length; i++) extra += fillersBetween(times[i - 1]!, times[i]!, step, max);
  if (extra === 0) return { times, length };
  const out = new Float64Array(length + extra);
  let k = 0;
  for (let i = 0; i < length; i++) {
    if (i > 0) {
      const a = times[i - 1]!;
      const n = fillersBetween(a, times[i]!, step, max);
      for (let j = 1; j <= n; j++) out[k++] = a + j * step;
    }
    out[k++] = times[i]!;
  }
  return { times: out, length: k };
}

function sameTimes(a: Float64Array, b: Float64Array, length: number): boolean {
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface Mapping {
  data: Int32Array;
  length: number;
  /** `data` is the timeline's shared identity array (local index = global index); copy before writing. */
  shared: boolean;
}

/**
 * The shared horizontal axis: a sorted, de-duplicated union of the timestamps of every series.
 * Each registered store gets a `localToGlobal` mapping (local data index → timeline index).
 */
export class Timeline {
  private _times = new Float64Array(0);
  private _length = 0;
  private readonly _mappings = new Map<TimeSource, Mapping>();
  private _version = 0;
  /** identity[i] === i for the whole capacity; shared by every store whose times equal the timeline's. */
  private _identity = new Int32Array(0);
  private _calendar: CalendarFill | null = null;
  /** Slot length while the calendar axis is on (NaN when off or unknown). */
  private _step = Number.NaN;

  /** Turns the calendar axis on or off; takes effect with the next `rebuild`. */
  setCalendar(calendar: CalendarFill | null): void {
    this._calendar = calendar;
  }

  /** Slot length of the calendar axis in ms, or null when it is off (or there are too few bars to tell). */
  get calendarStep(): number | null {
    return Number.isFinite(this._step) ? this._step : null;
  }

  get length(): number {
    return this._length;
  }

  /** Backing array; may be longer than `length`. Read only [0, length). */
  get times(): Float64Array {
    return this._times;
  }

  get lastIndex(): number {
    return this._length - 1;
  }

  /** Incremented whenever existing indices may have shifted (full rebuild). */
  get version(): number {
    return this._version;
  }

  timeAt(index: number): number | undefined {
    return index >= 0 && index < this._length ? this._times[index] : undefined;
  }

  /** Exact index of `time`, or -1. */
  indexOf(time: number): number {
    return indexOfSorted(this._times, time, this._length);
  }

  /** Nearest index for an arbitrary time (clamped to the data range), or -1 when empty. */
  nearestIndex(time: number): number {
    if (this._length === 0) return -1;
    const i = lowerBound(this._times, time, this._length);
    if (i <= 0) return 0;
    if (i >= this._length) return this._length - 1;
    return time - this._times[i - 1]! <= this._times[i]! - time ? i - 1 : i;
  }

  /** Local → global index mapping for `store`. May be longer than `store.length`; read [0, store.length). */
  mapping(store: TimeSource): Int32Array {
    return this._mappings.get(store)?.data ?? EMPTY_MAPPING;
  }

  /**
   * Recomputes the union and all mappings. O(k · n) for k stores. Stores whose times equal the union so far
   * (the common case: volume and indicator series share the price series' times) are compared, not merged,
   * so they cost no allocation.
   */
  rebuild(stores: Iterable<TimeSource>): void {
    const list = [...stores];
    let union = new Float64Array(0);
    let unionLength = 0;
    for (const store of list) {
      if (store.length === unionLength && sameTimes(union, store.times, unionLength)) continue;
      if (unionLength === 0) {
        // Reuse the previous buffer when it is large enough: rebuilds then allocate nothing.
        union = this._times.length >= store.length ? this._times : new Float64Array(store.length);
        union.set(store.times.subarray(0, store.length));
        unionLength = store.length;
        continue;
      }
      const merged = new Float64Array(unionLength + store.length);
      const times = store.times;
      let a = 0;
      let b = 0;
      let k = 0;
      while (a < unionLength || b < store.length) {
        if (b >= store.length || (a < unionLength && union[a]! < times[b]!)) {
          merged[k++] = union[a++]!;
        } else if (a >= unionLength || times[b]! < union[a]!) {
          merged[k++] = times[b++]!;
        } else {
          merged[k++] = union[a++]!;
          b++;
        }
      }
      union = merged;
      unionLength = k;
    }
    this._step = Number.NaN;
    if (this._calendar) {
      const step = this._calendar.step ?? commonStep(union, unionLength);
      if (Number.isFinite(step) && step > 0) {
        this._step = step;
        const filled = fillCalendar(union, unionLength, step, this._calendar.maxGapBars);
        union = filled.times;
        unionLength = filled.length;
      }
    }
    this._times = union;
    this._length = unionLength;
    this._mappings.clear();
    for (const store of list) this._mappings.set(store, this.computeMapping(store));
    this._version++;
  }

  /**
   * Fast path after `store` appended exactly one point at its end. Amortised O(1).
   * Returns false when the change cannot be applied incrementally and the caller must `rebuild()`.
   */
  appendFrom(store: TimeSource): boolean {
    const mapping = this._mappings.get(store);
    if (!mapping || mapping.length !== store.length - 1) return false;
    const time = store.lastTime()!;
    let globalIndex: number;
    if (this._length === 0 || time > this._times[this._length - 1]!) {
      // Calendar axis: empty slots for the time between the previous last bar and this one.
      const last = this._length > 0 ? this._times[this._length - 1]! : Number.NaN;
      const n = Number.isFinite(this._step)
        ? fillersBetween(last, time, this._step, this._calendar!.maxGapBars)
        : 0;
      this.ensureCapacity(this._length + n + 1);
      for (let j = 1; j <= n; j++) this._times[this._length++] = last + j * this._step;
      this._times[this._length] = time;
      globalIndex = this._length++;
    } else {
      globalIndex = this.indexOf(time);
      if (globalIndex < 0) return false;
    }
    if (mapping.shared && globalIndex === mapping.length) {
      if (mapping.length >= mapping.data.length) mapping.data = this.identity(mapping.length + 1);
      mapping.length++;
      return true;
    }
    if (mapping.shared || mapping.length >= mapping.data.length) {
      const grown = new Int32Array(
        Math.max(64, mapping.data.length * (mapping.shared ? 1 : 2), mapping.length + 1),
      );
      grown.set(mapping.data.subarray(0, mapping.length));
      mapping.data = grown;
      mapping.shared = false;
    }
    mapping.data[mapping.length++] = globalIndex;
    return true;
  }

  remove(store: TimeSource): void {
    this._mappings.delete(store);
  }

  private computeMapping(store: TimeSource): Mapping {
    const times = store.times;
    if (store.length === this._length && sameTimes(this._times, times, store.length)) {
      return { data: this.identity(store.length), length: store.length, shared: true };
    }
    const data = new Int32Array(Math.max(64, store.length));
    let g = 0;
    for (let i = 0; i < store.length; i++) {
      while (this._times[g]! < times[i]!) g++;
      data[i] = g;
    }
    return { data, length: store.length, shared: false };
  }

  /** The shared identity array, grown (geometrically) to at least `length` entries. */
  private identity(length: number): Int32Array {
    if (this._identity.length < length) {
      const next = new Int32Array(Math.max(64, length, this._identity.length * 2));
      for (let i = 0; i < next.length; i++) next[i] = i;
      this._identity = next;
    }
    return this._identity;
  }

  private ensureCapacity(required: number): void {
    if (required <= this._times.length) return;
    const next = new Float64Array(Math.max(required, this._times.length * 2, 64));
    next.set(this._times.subarray(0, this._length));
    this._times = next;
  }
}
