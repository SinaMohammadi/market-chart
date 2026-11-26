/**
 * Calendar fields of an instant in a configured time zone.
 * `month` is 0-based, `weekday` 0 = Sunday, matching `Date`.
 */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

/** `'UTC'`, `'local'` (the runtime's zone) or any IANA zone such as `'America/New_York'`. */
export type TimeZone = 'UTC' | 'local' | (string & {});

const HOUR = 3_600_000;

/**
 * Converts UTC instants to wall-clock fields for a time zone.
 *
 * For IANA zones the UTC offset is computed with `Intl.DateTimeFormat` once per hour bucket and
 * cached, so formatting thousands of tick labels per frame stays cheap. No browser globals are used.
 */
export class ZonedClock {
  readonly timeZone: TimeZone;
  private readonly offsetCache = new Map<number, number>();
  private readonly dtf: Intl.DateTimeFormat | null;

  constructor(timeZone: TimeZone = 'UTC') {
    this.timeZone = timeZone;
    if (timeZone === 'UTC' || timeZone === 'local') {
      this.dtf = null;
    } else {
      // Throws a RangeError for unknown zones, which surfaces as a clear configuration error.
      this.dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
    }
  }

  /** Offset in ms to add to a UTC instant to obtain wall-clock time in this zone. */
  offset(time: number): number {
    if (this.timeZone === 'UTC') return 0;
    if (this.timeZone === 'local') return -new Date(time).getTimezoneOffset() * 60_000;
    const bucket = Math.floor(time / HOUR);
    const cached = this.offsetCache.get(bucket);
    if (cached !== undefined) return cached;
    const parts = this.dtf!.formatToParts(new Date(bucket * HOUR));
    const read = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    const wall = Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      read('hour'),
      read('minute'),
      read('second'),
    );
    const value = wall - bucket * HOUR;
    if (this.offsetCache.size > 10_000) this.offsetCache.clear();
    this.offsetCache.set(bucket, value);
    return value;
  }

  /** A `Date` whose UTC getters return wall-clock fields in this zone. */
  wallDate(time: number): Date {
    return new Date(time + this.offset(time));
  }

  parts(time: number): ZonedParts {
    const d = this.wallDate(time);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      weekday: d.getUTCDay(),
    };
  }
}
