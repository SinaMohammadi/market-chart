import { afterEach, describe, expect, it } from 'vitest';
import { I18n, ar, createI18n, detectLocale, en, fa, syncChartLocale } from './index.js';
import type { ChartApi } from '@market-chart/core';

const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
afterEach(() => {
  if (nav) Object.defineProperty(globalThis, 'navigator', nav);
});

describe('dictionaries', () => {
  it('Persian and Arabic translate every English key', () => {
    expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    expect(new I18n().missingKeys('fa')).toEqual([]);
  });
});

describe('I18n', () => {
  it('translates, switches language and follows its direction', () => {
    const i18n = createI18n();
    const changes: string[] = [];
    i18n.on('change', ({ locale, direction }) => changes.push(`${locale}/${direction}`));
    expect(i18n.t('menu.resetView')).toBe('Reset chart view');
    expect(i18n.direction).toBe('ltr');
    i18n.setLocale('fa-IR');
    expect(i18n.locale).toBe('fa');
    expect(i18n.direction).toBe('rtl');
    expect(i18n.t('menu.resetView')).toBe('بازنشانی نمای نمودار');
    i18n.setLocale('ar');
    expect(i18n.t('drawing.delete')).toBe('حذف');
    expect(changes).toEqual(['fa/rtl', 'ar/rtl']);
    expect(() => i18n.setLocale('xx')).toThrow(/not registered/);
  });

  it('falls back to English, then to the key', () => {
    const missing: string[] = [];
    const i18n = createI18n({
      locale: 'de',
      locales: [
        {
          code: 'de',
          name: 'Deutsch',
          englishName: 'German',
          direction: 'ltr',
          messages: { 'common.ok': 'OK!' },
        },
      ],
      onMissing: (key, locale) => missing.push(`${locale}:${key}`),
    });
    expect(i18n.t('common.ok')).toBe('OK!');
    expect(i18n.t('common.cancel')).toBe('Cancel');
    expect(i18n.t('common.cancel')).toBe('Cancel');
    expect(i18n.t('app.unknown')).toBe('app.unknown');
    expect(missing).toEqual(['de:common.cancel', 'de:app.unknown']);
  });

  it('interpolates values with locale digits and selects plural forms', () => {
    const i18n = createI18n();
    expect(i18n.t('point.copyPrice', { value: '1,234.50' })).toBe('Copy price 1,234.50');
    expect(i18n.t('drawing.deleteConfirm', { count: 1 })).toBe('Delete 1 drawing?');
    expect(i18n.t('drawing.deleteConfirm', { count: 3 })).toBe('Delete 3 drawings?');
    i18n.setLocale('fa');
    expect(i18n.t('timeframe.minutes', { count: 15 })).toBe('۱۵ دقیقه');
    i18n.setNumerals('latn');
    expect(i18n.t('timeframe.minutes', { count: 15 })).toBe('15 دقیقه');
    i18n.setLocale('ar');
    i18n.setNumerals('native');
    expect(i18n.t('timeframe.hours', { count: 2 })).toBe('ساعتان');
    expect(i18n.t('timeframe.hours', { count: 5 })).toBe('٥ ساعات');
    expect(i18n.t('timeframe.hours', { count: 11 })).toBe('١١ ساعة');
    expect(i18n.t('common.items', { count: 0 })).toBe('لا عناصر');
  });

  it('applies overrides, extensions and custom languages', () => {
    const i18n = createI18n({ overrides: { en: { 'menu.resetView': 'Reset view' } } });
    expect(i18n.t('menu.resetView')).toBe('Reset view');
    i18n.extend('en', { 'app.greeting': 'Hello {name}' });
    expect(i18n.t('app.greeting', { name: 'Sam' })).toBe('Hello Sam');
    i18n.register({
      code: 'de',
      name: 'Deutsch',
      englishName: 'German',
      direction: 'ltr',
      messages: { 'menu.resetView': 'Ansicht zurücksetzen' },
    });
    i18n.setLocale('de');
    expect(i18n.t('menu.resetView')).toBe('Ansicht zurücksetzen');
    i18n.override('de', { 'menu.resetView': 'Zurücksetzen' });
    expect(i18n.t('menu.resetView')).toBe('Zurücksetzen');
    i18n.clearOverrides('de');
    expect(i18n.t('menu.resetView')).toBe('Ansicht zurücksetzen');
    expect(() => i18n.extend('en', { bad: 42 as never })).toThrow(/must be a string/);
    expect(() =>
      i18n.register({
        code: 'not a code',
        name: '',
        englishName: '',
        direction: 'ltr',
        messages: {},
      }),
    ).toThrow(/invalid language code/);
    expect(i18n.locales().map((l) => l.code)).toEqual(['en', 'fa', 'ar', 'de']);
  });

  it('lets the direction be forced, and formats numbers and dates for the locale', () => {
    const i18n = createI18n({ locale: 'fa' });
    expect(i18n.formatNumber(1234.5)).toBe('۱٬۲۳۴٫۵');
    expect(i18n.formatLocale).toBe('fa-IR');
    i18n.setDirection('ltr');
    expect(i18n.direction).toBe('ltr');
    i18n.setDirection('auto');
    expect(i18n.direction).toBe('rtl');
    // Gregorian calendar even for Persian (like the chart axes).
    expect(i18n.formatDate(Date.UTC(2024, 0, 15), { year: 'numeric', timeZone: 'UTC' })).toBe(
      '۲۰۲۴',
    );
    i18n.setNumerals('latn');
    expect(i18n.formatNumber(1234.5)).toBe('1,234.5');
  });

  it('detects the browser language lazily and ignores unsupported ones', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { languages: ['de-DE', 'fa-IR', 'en'] },
    });
    expect(detectLocale(['en', 'fa', 'ar'])).toBe('fa');
    expect(createI18n({ locale: 'auto' }).locale).toBe('fa');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { languages: ['ja'] },
    });
    expect(detectLocale(['en', 'fa'], 'en')).toBe('en');
  });

  it('keeps a chart in sync without recreating it', () => {
    const applied: unknown[] = [];
    let localization = { locale: 'en-US', direction: 'ltr', localizeNumbers: false };
    const chart = {
      destroyed: false,
      options: () => ({ localization }),
      applyOptions: (o: { localization: typeof localization }) => {
        applied.push(o.localization);
        localization = { ...localization, ...o.localization };
      },
    } as unknown as ChartApi;
    const i18n = createI18n();
    const off = syncChartLocale(chart, i18n, { localDigits: true });
    expect(applied).toEqual([{ locale: 'en-US', direction: 'ltr', localizeNumbers: true }]);
    i18n.setLocale('fa');
    expect(applied[1]).toEqual({ locale: 'fa-IR', direction: 'rtl', localizeNumbers: true });
    i18n.t('common.ok'); // reading does not apply anything
    expect(applied).toHaveLength(2);
    off();
    i18n.setLocale('en');
    expect(applied).toHaveLength(2);
  });
});

describe('untrusted keys and values (security)', () => {
  it('never resolves inherited Object members as messages', () => {
    const i18n = new I18n();
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
      expect(i18n.t(key as never)).toBe(key);
    expect(i18n.has('toString' as never)).toBe(false);
  });
  it('fills placeholders only from own string/number values', () => {
    const i18n = new I18n();
    i18n.override('en', { 'x.test': 'a {constructor} b {toString} c {name}' });
    expect(i18n.t('x.test' as never, { name: 'N' })).toBe('a {constructor} b {toString} c N');
    const hostile = JSON.parse('{"name": {"html": "<b>"}}') as Record<string, string>;
    expect(i18n.t('x.test' as never, hostile)).toBe('a {constructor} b {toString} c {name}');
  });
});
