import type { ZonedClock } from './zoned-clock.js';

/** Granularity of a time-axis tick, from coarsest to finest. */
export type TickGranularity = 'year' | 'month' | 'day' | 'time' | 'seconds';

/**
 * Formats wall-clock dates. All Intl formatters use `timeZone: 'UTC'` and are fed
 * zone-shifted dates from `ZonedClock.wallDate`, so output is deterministic for any zone.
 */
export class TimeFormatter {
  private readonly clock: ZonedClock;
  private readonly year: Intl.DateTimeFormat;
  private readonly month: Intl.DateTimeFormat;
  private readonly day: Intl.DateTimeFormat;
  private readonly full: Intl.DateTimeFormat;

  /** Applied to every label (e.g. native digits for the chart locale). */
  private readonly post: (text: string) => string;

  constructor(clock: ZonedClock, locale = 'en-US', post?: ((text: string) => string) | null) {
    this.clock = clock;
    this.post = post ?? ((text) => text);
    const base = { timeZone: 'UTC' } as const;
    this.year = new Intl.DateTimeFormat(locale, { ...base, year: 'numeric' });
    this.month = new Intl.DateTimeFormat(locale, { ...base, month: 'short' });
    this.day = new Intl.DateTimeFormat(locale, { ...base, day: 'numeric' });
    this.full = new Intl.DateTimeFormat(locale, {
      ...base,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  tick(time: number, granularity: TickGranularity): string {
    return this.post(this.rawTick(time, granularity));
  }

  private rawTick(time: number, granularity: TickGranularity): string {
    const d = this.clock.wallDate(time);
    switch (granularity) {
      case 'year':
        return this.year.format(d);
      case 'month':
        return this.month.format(d);
      case 'day':
        return this.day.format(d);
      case 'time':
        return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
      case 'seconds':
        return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    }
  }

  /** Crosshair label. `intraday` adds the wall-clock time. */
  crosshair(time: number, intraday: boolean, withSeconds = false): string {
    const d = this.clock.wallDate(time);
    const date = this.full.format(d);
    if (!intraday) return this.post(date);
    const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    return this.post(`${date}  ${withSeconds ? `${hm}:${pad(d.getUTCSeconds())}` : hm}`);
  }
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
