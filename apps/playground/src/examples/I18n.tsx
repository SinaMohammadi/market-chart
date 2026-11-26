import { useEffect, useMemo, useState } from 'react';
import type { ChartApi } from '@market-chart/core';
import { CandlestickSeries, Chart, ChartProvider, useTranslation } from '@market-chart/react';
import { createI18n } from '@market-chart/i18n';
import type { I18n } from '@market-chart/i18n';
import { syntheticBars } from '../data';

const bars = syntheticBars('BTCUSDT', 400);

/** A German dictionary registered by the app: two texts; the rest falls back to English. */
const GERMAN = {
  code: 'de',
  name: 'Deutsch',
  englishName: 'German',
  direction: 'ltr' as const,
  formatLocale: 'de-DE',
  messages: {
    'menu.resetView': 'Ansicht zurücksetzen',
    'timeframe.minutes': { one: '{count} Minute', other: '{count} Minuten' },
  },
};

function Samples() {
  // Only this component re-renders when the language changes; the chart is not recreated.
  const { t, locale, direction, i18n } = useTranslation();
  const [count, setCount] = useState(3);
  return (
    <div className="tile" dir={direction} lang={locale}>
      <h3>
        <span>{t('settings.language')}</span>
        <span className="badge">
          {locale} · {direction}
        </span>
      </h3>
      <ul style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.8 }}>
        <li>{t('menu.resetView')}</li>
        <li>{t('drawing.deleteConfirm', { count })}</li>
        <li>{t('timeframe.minutes', { count })}</li>
        <li>
          {t('point.copyPrice', {
            value: i18n.formatNumber(64213.5, { minimumFractionDigits: 2 }),
          })}
        </li>
        <li>{i18n.formatDate(Date.UTC(2024, 2, 20, 14, 30))}</li>
        <li>{t('app.welcome', { name: 'Sam' })}</li>
      </ul>
      <label style={{ display: 'block', marginTop: 8 }}>
        count ({t('common.items', { count })}){' '}
        <input
          type="range"
          min={0}
          max={12}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        />
      </label>
    </div>
  );
}

/**
 * Demos 1 and 3: translations with interpolation and plurals, English fallback, a custom language,
 * app-level and per-chart switching without reloading, and locale formatting of the chart axes.
 */
export function I18nExample() {
  const i18n: I18n = useMemo(() => {
    const instance = createI18n({ locales: [GERMAN] });
    // Application-specific texts in every language.
    instance.extend('en', { 'app.welcome': 'Welcome, {name}!' });
    instance.extend('fa', { 'app.welcome': '{name}، خوش آمدید!' });
    instance.extend('ar', { 'app.welcome': 'أهلًا بك يا {name}!' });
    return instance;
  }, []);
  const [locale, setLocale] = useState('en');
  const [direction, setDirection] = useState<'auto' | 'ltr' | 'rtl'>('auto');
  const [digits, setDigits] = useState(true);
  const [chart, setChart] = useState<ChartApi | null>(null);
  const [info, setInfo] = useState('');
  useEffect(() => {
    if (!chart) return;
    const update = () =>
      setInfo(
        `chart.getLocale() = ${chart.getLocale()} · chart.getDirection() = ${chart.getDirection()}`,
      );
    update();
    const offs = [chart.on('localeChange', update), chart.on('directionChange', update)];
    return () => offs.forEach((off) => off());
  }, [chart]);
  return (
    <ChartProvider i18n={i18n} locale={locale} direction={direction}>
      <div className="toolbar">
        {i18n.locales().map((l) => (
          <button key={l.code} aria-pressed={locale === l.code} onClick={() => setLocale(l.code)}>
            {l.name}
          </button>
        ))}
        <button aria-pressed={locale === 'auto'} onClick={() => setLocale('auto')}>
          Browser language
        </button>
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as 'auto')}
          aria-label="Direction"
        >
          <option value="auto">direction: auto</option>
          <option value="ltr">ltr</option>
          <option value="rtl">rtl</option>
        </select>
        <label>
          <input type="checkbox" checked={digits} onChange={(e) => setDigits(e.target.checked)} />{' '}
          local digits on the axes
        </label>
      </div>
      <div
        className="grid2"
        style={{ gridTemplateColumns: 'minmax(260px, 1fr) 2fr', alignItems: 'start' }}
      >
        <Samples />
        <div className="card">
          <Chart height={380} ref={setChart} syncLocale={digits ? 'digits' : true}>
            <CandlestickSeries data={bars} />
          </Chart>
        </div>
      </div>
      <p className="desc">
        {info}. The chart follows the provider (<code>syncLocale</code>);{' '}
        <code>chart.setLocale()</code> / <code>setDirection()</code> also work directly. Axis dates
        use the Gregorian calendar in every language, because tick positions are Gregorian. German
        shows the English fallback for untranslated texts.
      </p>
    </ChartProvider>
  );
}
