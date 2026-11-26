/**
 * `@market-chart/i18n` — typed translations, locales with text direction, pluralisation, interpolation and
 * locale-aware formatting. Independent of React and of the chart engine (only the engine's event emitter and
 * types are used). Nothing reads `navigator` or other browser globals at import time.
 */
export type {
  Direction,
  LocaleDefinition,
  LocaleInfo,
  Message,
  Messages,
  PluralMessage,
} from './types.js';
export { I18nError } from './types.js';
export { en } from './locales/en.js';
export type { TranslationKey } from './locales/en.js';
export { fa } from './locales/fa.js';
export { ar } from './locales/ar.js';
export {
  I18n,
  arabicLocale,
  builtInLocales,
  createI18n,
  detectLocale,
  englishLocale,
  persianLocale,
  syncChartLocale,
} from './i18n.js';
export type {
  AnyTranslationKey,
  I18nEvents,
  I18nOptions,
  Numerals,
  TranslationValues,
} from './i18n.js';
