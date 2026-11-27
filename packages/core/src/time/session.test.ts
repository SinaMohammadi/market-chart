import { describe, expect, it } from 'vitest';
import { createTradingSession, dateOfDay, resolveSessionTimeZone } from './session.js';

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const at = (iso: string) => Date.parse(iso);

describe('TradingSession', () => {
  const nyse = createTradingSession({
    hours: '0930-1600:12345',
    timeZone: 'America/New_York',
    holidays: ['2024-07-04'],
    specialHours: { '2024-07-03': '0930-1300' },
  });

  it('opens and closes at exchange wall-clock times across both DST changes', () => {
    // Winter (UTC-5): 09:30 New York = 14:30 UTC.
    expect(nyse.isOpen(at('2024-01-08T14:29:00Z'))).toBe(false);
    expect(nyse.isOpen(at('2024-01-08T14:30:00Z'))).toBe(true);
    expect(nyse.isOpen(at('2024-01-08T20:59:00Z'))).toBe(true);
    expect(nyse.isOpen(at('2024-01-08T21:00:00Z'))).toBe(false);
    // Summer (UTC-4) after the March change: 09:30 New York = 13:30 UTC.
    expect(nyse.isOpen(at('2024-03-11T13:30:00Z'))).toBe(true);
    expect(nyse.isOpen(at('2024-03-11T13:29:00Z'))).toBe(false);
    // Back to winter after the November change.
    expect(nyse.isOpen(at('2024-11-04T13:30:00Z'))).toBe(false);
    expect(nyse.isOpen(at('2024-11-04T14:30:00Z'))).toBe(true);
    expect(nyse.tradingDay(at('2024-11-04T15:00:00Z'))).toBe(day('2024-11-04'));
  });

  it('skips weekends and holidays, and uses special hours', () => {
    expect(nyse.isOpen(at('2024-01-06T15:00:00Z'))).toBe(false); // Saturday
    expect(nyse.isTradingDay(day('2024-07-04'))).toBe(false);
    expect(nyse.isOpen(at('2024-07-04T15:00:00Z'))).toBe(false);
    // Half day: closes at 13:00 New York (17:00 UTC in summer).
    expect(nyse.isOpen(at('2024-07-03T16:59:00Z'))).toBe(true);
    expect(nyse.isOpen(at('2024-07-03T17:00:00Z'))).toBe(false);
    expect(nyse.sessionsOf(day('2024-07-03'))).toEqual([
      { open: at('2024-07-03T13:30:00Z'), close: at('2024-07-03T17:00:00Z') },
    ]);
  });

  it('groups closed times with the session they lead into', () => {
    // Pre-market and the previous evening belong to the next session; a daily bar stamped at midnight
    // UTC (the evening before in New York) belongs to its own date.
    expect(nyse.sessionDay(at('2024-01-08T12:00:00Z'))).toBe(day('2024-01-08'));
    expect(nyse.sessionDay(at('2024-01-08T00:00:00Z'))).toBe(day('2024-01-08'));
    // Friday after the close and the weekend lead into Monday; the holiday is skipped.
    expect(nyse.sessionDay(at('2024-01-05T22:00:00Z'))).toBe(day('2024-01-08'));
    expect(nyse.sessionDay(at('2024-07-03T18:00:00Z'))).toBe(day('2024-07-05'));
    // Week keys start on Monday; month keys follow the trading day's date.
    expect(nyse.periodKey(at('2024-01-08T15:00:00Z'), 'week')).toBe(
      nyse.periodKey(at('2024-01-12T15:00:00Z'), 'week'),
    );
    expect(nyse.periodKey(at('2024-01-12T15:00:00Z'), 'week')).not.toBe(
      nyse.periodKey(at('2024-01-15T15:00:00Z'), 'week'),
    );
    expect(nyse.periodKey(at('2024-01-31T15:00:00Z'), 'month')).toBe(2024 * 12);
  });

  it('assigns overnight sessions to the day they end on (futures)', () => {
    const cme = createTradingSession({ hours: '1700-1600:12345', timeZone: 'America/Chicago' });
    // Winter (UTC-6): Sunday 17:00 Chicago = 23:00 UTC starts Monday's session.
    expect(cme.isOpen(at('2024-01-07T22:30:00Z'))).toBe(false);
    expect(cme.tradingDay(at('2024-01-07T23:30:00Z'))).toBe(day('2024-01-08'));
    expect(cme.tradingDay(at('2024-01-08T21:59:00Z'))).toBe(day('2024-01-08'));
    // The daily break 16:00-17:00 Chicago (22:00-23:00 UTC), then Tuesday's session.
    expect(cme.isOpen(at('2024-01-08T22:30:00Z'))).toBe(false);
    expect(cme.tradingDay(at('2024-01-08T23:30:00Z'))).toBe(day('2024-01-09'));
    // Friday's session ends Friday 16:00; nothing on Saturday.
    expect(cme.isOpen(at('2024-01-13T15:00:00Z'))).toBe(false);
  });

  it('supports lunch breaks, several groups and 24x7', () => {
    const tokyo = createTradingSession({
      hours: '0900-1130,1230-1500:12345',
      timeZone: 'Asia/Tokyo',
    });
    expect(tokyo.isOpen(at('2024-01-08T01:00:00Z'))).toBe(true); // 10:00 Tokyo
    expect(tokyo.isOpen(at('2024-01-08T03:00:00Z'))).toBe(false); // 12:00 lunch
    expect(tokyo.sessionsOf(day('2024-01-08'))).toHaveLength(2);
    const mixed = createTradingSession({ hours: '0930-1600:12345|1000-1400:6' });
    expect(mixed.isOpen(at('2024-01-06T11:00:00Z'))).toBe(true);
    expect(mixed.isOpen(at('2024-01-06T15:00:00Z'))).toBe(false);
    const crypto = createTradingSession({ hours: '24x7' });
    expect(crypto.continuous).toBe(true);
    expect(crypto.tradingDay(at('2024-01-06T23:59:59Z'))).toBe(day('2024-01-06'));
    expect(createTradingSession({ hours: '0000-2400' }).isOpen(at('2024-01-06T23:59:00Z'))).toBe(
      true,
    );
  });

  it('rejects invalid descriptions with clear errors', () => {
    const bad = [
      { hours: '' },
      { hours: '930-1600' },
      { hours: '0930-1600:89' },
      { hours: '2500-0100' },
      { hours: '0930-0930' },
      { hours: '0900-1200,1100-1300' },
      { hours: '0930-1600', timeZone: 'Mars/Olympus' },
      { hours: '0930-1600', holidays: ['2024-02-30'] },
      { hours: '0930-1600', specialHours: { '2024-01-02': 'noon' } },
      { hours: 'x'.repeat(400) },
    ];
    for (const spec of bad)
      expect(() => createTradingSession(spec), spec.hours).toThrow(/trading session/);
  });

  it('re-reads the hours in a chosen time zone (exchange, chart, computer or application)', () => {
    const crypto = createTradingSession({ hours: '24x7' });
    // In UTC the day starts at 00:00 UTC; in Tehran (UTC+3:30) at 20:30 UTC the evening before.
    const tehran = crypto.withTimeZone('Asia/Tehran');
    expect(tehran.timeZone).toBe('Asia/Tehran');
    expect(crypto.sessionDay(at('2024-01-07T21:00:00Z'))).toBe(day('2024-01-07'));
    expect(tehran.sessionDay(at('2024-01-07T21:00:00Z'))).toBe(day('2024-01-08'));
    expect(crypto.withTimeZone('UTC')).toBe(crypto);
    // Holidays and special hours are kept.
    const ny = nyse.withTimeZone('Europe/London');
    expect(ny.isTradingDay(day('2024-07-04'))).toBe(false);
    expect(ny.isOpen(at('2024-01-08T09:30:00Z'))).toBe(true); // 09:30 London
    const zones = {
      exchange: 'America/New_York',
      chart: 'Europe/Berlin',
      application: 'Asia/Tehran',
    };
    expect(resolveSessionTimeZone('exchange', zones)).toBe('America/New_York');
    expect(resolveSessionTimeZone('chart', zones)).toBe('Europe/Berlin');
    expect(resolveSessionTimeZone('local', zones)).toBe('local');
    expect(resolveSessionTimeZone('application', zones)).toBe('Asia/Tehran');
    // Unknown choices fall back to the exchange's zone, then UTC.
    expect(resolveSessionTimeZone('application', { exchange: 'Asia/Tokyo' })).toBe('Asia/Tokyo');
    expect(resolveSessionTimeZone('chart', {})).toBe('UTC');
  });

  it('answers the same with its interval cache as without, across DST changes', () => {
    for (const spec of [
      { hours: '0930-1600:12345', timeZone: 'America/New_York', holidays: ['2024-03-11'] },
      { hours: '1700-1600:12345', timeZone: 'America/Chicago' },
      { hours: '0000-0300,2200-2400', timeZone: 'Europe/London' },
    ]) {
      const cached = createTradingSession(spec);
      // Every 7 minutes around both 2024 changes (March and October/November).
      for (const [start, end] of [
        ['2024-03-06T00:00:00Z', '2024-03-15T00:00:00Z'],
        ['2024-10-24T00:00:00Z', '2024-11-07T00:00:00Z'],
      ] as const) {
        for (let t = Date.parse(start); t < Date.parse(end); t += 7 * 60_000) {
          const fresh = createTradingSession(spec);
          expect(cached.sessionDay(t), `${spec.timeZone} ${new Date(t).toISOString()}`).toBe(
            fresh.sessionDay(t),
          );
          expect(cached.isOpen(t)).toBe(createTradingSession(spec).isOpen(t));
        }
      }
    }
  });

  it('formats day numbers as dates', () => {
    expect(dateOfDay(day('2024-02-29'))).toBe('2024-02-29');
  });
});
