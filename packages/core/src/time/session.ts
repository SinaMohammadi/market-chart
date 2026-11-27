import { ChartError } from '../utils/errors.js';
import { ZonedClock } from './zoned-clock.js';
import type { TimeZone } from './zoned-clock.js';

/**
 * Trading hours of an exchange (see `createTradingSession`).
 *
 * `hours` is `'24x7'` or one or more `ranges:days` groups separated by `|`:
 * - ranges: `HHMM-HHMM`, several separated by commas (a lunch break: `0900-1130,1230-1500`). A range that
 *   ends at or before its start crosses midnight and belongs to the day it ends on (`1700-1600` for futures
 *   that open on the previous evening).
 * - days: ISO weekdays, `1` = Monday … `7` = Sunday (`12345` = Monday to Friday). Without days, every day.
 *
 * Examples: `'0930-1600:12345'` (New York stocks, with `timeZone: 'America/New_York'`), `'1700-1600:12345'`
 * (CME futures, Monday's session starts on Sunday evening), `'0900-1200,1300-1530:67'`.
 */
export interface TradingSessionSpec {
  readonly hours: string;
  /** Exchange time zone; hours and dates are wall-clock times there (DST included). Default `'UTC'`. */
  readonly timeZone?: TimeZone;
  /** Exchange dates (`YYYY-MM-DD`) without a session. */
  readonly holidays?: readonly string[];
  /** Different hours on some dates (`YYYY-MM-DD` → ranges, e.g. a half day `'0930-1300'`). */
  readonly specialHours?: Readonly<Record<string, string>>;
}

export type SessionPeriod = 'session' | 'day' | 'week' | 'month';

/**
 * Which time zone sessions are evaluated in: the exchange's (from the symbol), the chart's
 * (`localization.timeZone`), the computer's (`'local'`) or one the application sets.
 */
export type SessionTimeZoneChoice = 'exchange' | 'chart' | 'local' | 'application';

/**
 * The time zone for a choice. Falls back to the exchange's zone when the chosen one is not known (no
 * application zone set), and to UTC when there is no exchange zone either.
 */
export function resolveSessionTimeZone(
  choice: SessionTimeZoneChoice,
  zones: {
    readonly exchange?: TimeZone | null;
    readonly chart?: TimeZone | null;
    readonly application?: TimeZone | null;
  },
): TimeZone {
  const fallback = zones.exchange ?? 'UTC';
  if (choice === 'local') return 'local';
  if (choice === 'chart') return zones.chart ?? fallback;
  if (choice === 'application') return zones.application ?? fallback;
  return fallback;
}

const MINUTES_PER_DAY = 1440;
const MINUTE = 60_000;
const DAY_MS = 86_400_000;
const MAX_SPEC_LENGTH = 300;
const MAX_RANGES = 24;
const MAX_DATES = 10_000;
/** Looking further ahead for the next session than this means the hours have no trading day at all. */
const MAX_LOOKAHEAD_DAYS = 400;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Minutes from the trading day's midnight; `start` is negative for sessions that open the evening before. */
interface Range {
  readonly start: number;
  readonly end: number;
}

interface Group {
  readonly ranges: readonly Range[];
  /** Indexed by ISO weekday (1–7). */
  readonly days: readonly boolean[];
}

function fail(message: string): never {
  throw new ChartError(`trading session: ${message}`);
}

function parseMinutes(text: string, spec: string): number {
  if (!/^\d{4}$/.test(text)) fail(`invalid time "${text}" in "${spec}" (expected HHMM)`);
  const h = Number(text.slice(0, 2));
  const m = Number(text.slice(2));
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) fail(`invalid time "${text}" in "${spec}"`);
  return h * 60 + m;
}

function parseRanges(text: string, spec: string): Range[] {
  const parts = text.split(',');
  if (parts.length > MAX_RANGES) fail(`too many ranges in "${spec}"`);
  const ranges = parts.map((part) => {
    const m = /^(\d{4})-(\d{4})$/.exec(part.trim());
    if (!m) fail(`invalid range "${part}" in "${spec}" (expected HHMM-HHMM)`);
    const start = parseMinutes(m[1]!, spec);
    const end = parseMinutes(m[2]!, spec);
    if (start === end && start !== 0) fail(`empty range "${part}" in "${spec}"`);
    // 0000-0000 and 0000-2400 are the whole day; a range ending at or before its start opens the evening before.
    if (start === 0 && (end === 0 || end === MINUTES_PER_DAY))
      return { start: 0, end: MINUTES_PER_DAY };
    return end > start ? { start, end } : { start: start - MINUTES_PER_DAY, end };
  });
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++)
    if (ranges[i]!.start < ranges[i - 1]!.end) fail(`overlapping ranges in "${spec}"`);
  return ranges;
}

function parseGroups(hours: string): Group[] | null {
  if (typeof hours !== 'string' || !hours.trim()) fail('hours must be a non-empty string');
  if (hours.length > MAX_SPEC_LENGTH) fail('hours are too long');
  const spec = hours.trim();
  if (spec.toLowerCase() === '24x7') return null;
  return spec.split('|').map((group) => {
    const [ranges, days, extra] = group.split(':');
    if (extra !== undefined || ranges === undefined) fail(`invalid group "${group}" in "${spec}"`);
    const flags = [false, false, false, false, false, false, false, false];
    if (days === undefined) flags.fill(true);
    else {
      if (!/^[1-7]{1,7}$/.test(days))
        fail(`invalid days "${days}" in "${spec}" (1 = Monday … 7 = Sunday)`);
      for (const d of days) flags[Number(d)] = true;
    }
    return { ranges: parseRanges(ranges, spec), days: flags };
  });
}

/** Days since 1970-01-01 of a `YYYY-MM-DD` date. */
function dayOfDate(text: string): number {
  const m = DATE.exec(text);
  if (!m) fail(`invalid date "${text}" (expected YYYY-MM-DD)`);
  const time = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const day = time / DAY_MS;
  if (dateOfDay(day) !== text) fail(`invalid date "${text}"`);
  return day;
}

/** `YYYY-MM-DD` of a day number (days since 1970-01-01). */
export function dateOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a day number; 1970-01-01 was a Thursday. */
function isoWeekday(day: number): number {
  return ((((day + 3) % 7) + 7) % 7) + 1;
}

/**
 * Exchange trading hours in the exchange's time zone: which trading day an instant belongs to, whether the
 * market is open, and period keys for session-based calculations (VWAP, pivots, profiles, gap filling).
 * Daylight-saving changes are handled through the zone's offset at each instant.
 *
 * Trading days are numbered like dates: days since 1970-01-01 of the exchange date the session ends on.
 */
export class TradingSession {
  readonly timeZone: TimeZone;
  /** The hours as given (normalised). */
  readonly hours: string;
  private readonly clock: ZonedClock;
  private readonly groups: readonly Group[] | null;
  private readonly holidays: ReadonlySet<number>;
  private readonly special: ReadonlyMap<number, readonly Range[]>;
  private readonly cache = new Map<number, readonly Range[]>();
  private readonly spec: TradingSessionSpec;
  /** The last interval with a known answer (see `locate`). */
  private last: { day: number; open: boolean; from: number; to: number } = {
    day: Number.NaN,
    open: false,
    from: Number.POSITIVE_INFINITY,
    to: Number.NEGATIVE_INFINITY,
  };

  constructor(spec: TradingSessionSpec) {
    if (!spec || typeof spec !== 'object')
      fail('expected { hours, timeZone?, holidays?, specialHours? }');
    this.spec = { ...spec };
    this.timeZone = spec.timeZone ?? 'UTC';
    try {
      this.clock = new ZonedClock(this.timeZone);
    } catch {
      fail(`unknown time zone "${String(this.timeZone)}"`);
    }
    this.groups = parseGroups(spec.hours);
    this.hours = spec.hours.trim();
    const holidays = spec.holidays ?? [];
    if (!Array.isArray(holidays)) fail('holidays must be an array of YYYY-MM-DD dates');
    if (holidays.length > MAX_DATES) fail(`at most ${MAX_DATES} holidays`);
    this.holidays = new Set(holidays.map((d) => dayOfDate(String(d))));
    const special = Object.entries(spec.specialHours ?? {});
    if (special.length > MAX_DATES) fail(`at most ${MAX_DATES} special dates`);
    this.special = new Map(
      special.map(([date, hours]) => [dayOfDate(date), parseRanges(String(hours), String(hours))]),
    );
  }

  /**
   * The same hours, holidays and special hours read in another time zone, e.g. a 24x7 market whose days
   * should start at local midnight. Returns this session when the zone is the same.
   */
  withTimeZone(timeZone: TimeZone): TradingSession {
    return timeZone === this.timeZone ? this : new TradingSession({ ...this.spec, timeZone });
  }

  /** True when every instant is in a session (`24x7` without holidays or special hours). */
  get continuous(): boolean {
    return this.groups === null && this.holidays.size === 0 && this.special.size === 0;
  }

  /** Session ranges of a trading day (minutes from its midnight); empty when there is no session. */
  private rangesOf(day: number): readonly Range[] {
    const cached = this.cache.get(day);
    if (cached) return cached;
    let ranges: readonly Range[];
    if (this.holidays.has(day)) ranges = [];
    else if (this.special.has(day)) ranges = this.special.get(day)!;
    else if (this.groups === null) ranges = [{ start: 0, end: MINUTES_PER_DAY }];
    else {
      const weekday = isoWeekday(day);
      ranges = this.groups
        .filter((g) => g.days[weekday])
        .flatMap((g) => g.ranges)
        .sort((a, b) => a.start - b.start);
    }
    if (this.cache.size > 4096) this.cache.clear();
    this.cache.set(day, ranges);
    return ranges;
  }

  /** Wall-clock minutes since 1970-01-01 in the exchange zone. */
  private wallMinutes(time: number): number {
    return Math.floor((time + this.clock.offset(time)) / MINUTE);
  }

  /** Whether `day` (days since 1970-01-01) has a session. */
  isTradingDay(day: number): boolean {
    return this.rangesOf(day).length > 0;
  }

  /** The trading day `time` belongs to, or null when the market is closed at that instant. */
  tradingDay(time: number): number | null {
    const spot = this.locate(time);
    return spot.open ? spot.day : null;
  }

  isOpen(time: number): boolean {
    return this.locate(time).open;
  }

  /**
   * The trading day for grouping bars: the session's day while open, otherwise the next session's day (so
   * pre-market and after-hours bars, and daily bars stamped at midnight UTC, join the session they lead into).
   */
  sessionDay(time: number): number {
    return this.locate(time).day;
  }

  /**
   * Where `time` is: its trading day and whether the market is open. The answer holds for a whole interval
   * (an open session, or the closed time up to the next open), which is remembered: bars come in time
   * order, so most calls are answered without any time-zone arithmetic.
   */
  private locate(time: number): { readonly day: number; readonly open: boolean } {
    const last = this.last;
    if (time >= last.from && time < last.to) return last;
    if (!Number.isFinite(time)) return { day: Number.NaN, open: false };
    const wall = this.wallMinutes(time);
    const today = Math.floor(wall / MINUTES_PER_DAY);
    const at = (day: number, minute: number) =>
      this.instantOf((day * MINUTES_PER_DAY + minute) * MINUTE);
    // Open: a session that opens the evening before belongs to tomorrow.
    for (const day of [today, today + 1]) {
      const minute = wall - day * MINUTES_PER_DAY;
      for (const r of this.rangesOf(day))
        if (minute >= r.start && minute < r.end)
          return this.remember(
            { day, open: true, from: at(day, r.start), to: at(day, r.end) },
            time,
          );
    }
    // Closed: the next session's day, until that session opens.
    for (let day = today; day <= today + MAX_LOOKAHEAD_DAYS; day++) {
      const minute = wall - day * MINUTES_PER_DAY;
      const next = this.rangesOf(day).find((r) => r.start > minute);
      if (next)
        return this.remember({ day, open: false, from: time, to: at(day, next.start) }, time);
    }
    return { day: today, open: false };
  }

  /** Keeps the interval only when it really contains `time` (guards against DST edge cases). */
  private remember(
    spot: { day: number; open: boolean; from: number; to: number },
    time: number,
  ): { readonly day: number; readonly open: boolean } {
    if (spot.from <= time && time < spot.to) this.last = spot;
    return spot;
  }

  /**
   * Bucket of `time` for session-based calculations: the trading day (`'session'` / `'day'`), its week
   * (weeks start on Monday) or its month. Equal keys mean the same period.
   */
  periodKey(time: number, period: SessionPeriod): number {
    const day = this.sessionDay(time);
    if (period === 'week') return Math.floor((day + 3) / 7);
    if (period === 'month') {
      const d = new Date(day * DAY_MS);
      return d.getUTCFullYear() * 12 + d.getUTCMonth();
    }
    return day;
  }

  /** Open and close instants of a trading day's sessions (several with a lunch break), in time order. */
  sessionsOf(day: number): { readonly open: number; readonly close: number }[] {
    return this.rangesOf(day).map((r) => ({
      open: this.instantOf((day * MINUTES_PER_DAY + r.start) * MINUTE),
      close: this.instantOf((day * MINUTES_PER_DAY + r.end) * MINUTE),
    }));
  }

  /** The UTC instant of a wall-clock time in the exchange zone (the later one when a DST change repeats it). */
  private instantOf(wall: number): number {
    const first = wall - this.clock.offset(wall);
    return wall - this.clock.offset(first);
  }
}

/** Validates a session description and returns a `TradingSession`. Throws `ChartError` when invalid. */
export function createTradingSession(spec: TradingSessionSpec): TradingSession {
  return new TradingSession(spec);
}
