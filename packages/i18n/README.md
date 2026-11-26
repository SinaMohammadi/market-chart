# @market-chart/i18n

Translations for market-chart: typed keys, English, Persian and Arabic built in, custom languages, English
fallback, `{name}` interpolation, plural rules, overrides, text direction and locale-aware number and date
formatting. It works without React. Its only dependency is `@market-chart/core`, and only for the event
emitter and chart types. Nothing reads `navigator` or other browser globals at import time.

## Basics

```ts
import { createI18n } from '@market-chart/i18n';

const i18n = createI18n({ locale: 'fa' });   // 'en' (default), 'fa', 'ar', a registered code, or 'auto'
i18n.t('menu.resetView');                     // "بازنشانی نمای نمودار"
i18n.t('drawing.deleteConfirm', { count: 3 }); // plural form chosen with Intl.PluralRules
i18n.direction;                               // 'rtl'
i18n.formatNumber(64213.5);                   // "۶۴٬۲۱۳٫۵"
i18n.formatDate(Date.UTC(2024, 2, 20));       // Gregorian calendar, Persian month names and digits

i18n.on('change', () => rerender());          // also 'localeChange' and 'directionChange'
i18n.setLocale('en');                         // no reload; listeners re-label in place
```

The keys of the English dictionary define the `TranslationKey` type, so `t('menu.restView')` is a type
error. `t()` also accepts any string for application keys, and an unknown key returns itself.

When a key is looked up, the first match wins: overrides, then the current language, then the fallback
language (English), then the key itself. `missingKeys('fa')` lists keys that a language does not translate.

| Option | Default | Meaning |
|---|---|---|
| `locale` | `'en'` | Starting language. `'auto'` picks the browser's language when it is supported (on the client only) |
| `fallbackLocale` | `'en'` | Used for keys that the current language does not translate |
| `locales` | — | Extra `LocaleDefinition`s to register |
| `overrides` | — | `{ [code]: messages }` that replace built-in texts |
| `direction` | `'auto'` | `'auto'` follows the language; `'ltr'` or `'rtl'` forces a direction |
| `numerals` | `'native'` | `'latn'` uses 0–9 everywhere, even in Persian and Arabic |
| `onMissing` | — | `(key, locale)` called when a key falls back |

## Custom languages, dictionaries and overrides

```ts
i18n.register({
  code: 'de',
  name: 'Deutsch',
  englishName: 'German',
  direction: 'ltr',
  formatLocale: 'de-DE',             // Intl locale for numbers and dates (default: code)
  messages: {
    'menu.resetView': 'Ansicht zurücksetzen',
    'timeframe.minutes': { one: '{count} Minute', other: '{count} Minuten' },
  },
});                                  // untranslated keys fall back to English

i18n.extend('en', { 'app.welcome': 'Welcome, {name}!' }); // add application texts to a language
i18n.override('fa', { 'menu.resetView': 'نمای اولیه' });   // replace a built-in text
i18n.clearOverrides('fa');
```

A plural message is an object keyed by `Intl.PluralRules` categories: `zero`, `one`, `two`, `few`, `many` and
`other`. Only `other` is required. Arabic uses all six. A `{count}` value is formatted with the language's
digits.

## Charts

```ts
import { syncChartLocale } from '@market-chart/i18n';

const off = syncChartLocale(chart, i18n, { localDigits: true });
```

This keeps the chart's axis locale and direction in step with the language without recreating the chart.
`localDigits` shows Persian or Arabic digits on the price and time axes. The engine API can also be used
directly: `chart.setLocale('fa-IR')`, `chart.setDirection('rtl')`, `chart.getLocale()` and
`chart.getDirection()`, with the `localeChange` and `directionChange` events.

## React

`@market-chart/react` provides the language to everything below a provider:

```tsx
<ChartProvider locale={locale} direction="auto" i18n={myI18n /* optional */}>
  <Chart syncLocale="digits">…</Chart>   {/* true: locale and direction; 'digits': also local digits */}
</ChartProvider>
```

```ts
const { t, locale, direction, i18n } = useTranslation(); // re-renders only when the language changes
const [locale, setLocale] = useLocale();
const [direction, setDirection] = useDirection();
```

The provider creates its `I18n` once, and changing `locale` re-labels in place. On the server, `'auto'`
resolves to the fallback language, so the markup does not depend on the request. The client switches after
hydration.

## Built-in languages

| Code | Name | Direction | Formatting locale | Notes |
|---|---|---|---|---|
| `en` | English | LTR | `en-US` | Source dictionary |
| `fa` | فارسی | RTL | `fa-IR` | Persian digits |
| `ar` | العربية | RTL | `ar-u-nu-arab` | Arabic-Indic digits; all six plural forms |

The dictionaries cover all built-in interface texts: menus, toolbars, settings, the 35 drawing tools and the
25 most common indicators. Other indicators show their English names.

## Limitations

- Dates on the chart axes use the Gregorian calendar in every language, because the tick positions are
  Gregorian. Month names and digits are localised.
- The time axis keeps its left-to-right time order in RTL. Labels, menus, toolbars and price-line titles are
  mirrored.

## Security

Translations are text, never HTML. Lookups use only a dictionary's own keys (`t('constructor')` returns the key)
and `{name}` placeholders take only own string or number values, so dictionaries and values loaded at runtime
cannot inject inherited functions or markup.
