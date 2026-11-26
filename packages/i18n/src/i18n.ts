import { EventEmitter } from '@market-chart/core';
import type { ChartApi, Unsubscribe } from '@market-chart/core';
import { ar } from './locales/ar.js';
import { en } from './locales/en.js';
import type { TranslationKey } from './locales/en.js';
import { fa } from './locales/fa.js';
import { I18nError } from './types.js';
import type {
  Direction,
  LocaleDefinition,
  LocaleInfo,
  Message,
  Messages,
  PluralMessage,
} from './types.js';

/** Built-in languages. */
export const englishLocale: LocaleDefinition = {
  code: 'en',
  name: 'English',
  englishName: 'English',
  direction: 'ltr',
  formatLocale: 'en-US',
  messages: en,
};
export const persianLocale: LocaleDefinition = {
  code: 'fa',
  name: 'فارسی',
  englishName: 'Persian',
  direction: 'rtl',
  formatLocale: 'fa-IR',
  messages: fa,
};
export const arabicLocale: LocaleDefinition = {
  code: 'ar',
  name: 'العربية',
  englishName: 'Arabic',
  direction: 'rtl',
  formatLocale: 'ar-u-nu-arab',
  messages: ar,
};
export const builtInLocales: readonly LocaleDefinition[] = [
  englishLocale,
  persianLocale,
  arabicLocale,
];

/** Interpolation values: numbers are formatted for the locale (e.g. Persian digits). */
export type TranslationValues = Readonly<Record<string, string | number>>;

/** Built-in keys autocomplete; applications can use their own keys too. */
export type AnyTranslationKey = TranslationKey | (string & {});

export type Numerals = 'native' | 'latn';

export interface I18nOptions {
  /** Initial language; `'auto'` uses the browser language when supported (resolved lazily, never on import). */
  readonly locale?: string | 'auto';
  /** Language used for missing translations (default `en`). */
  readonly fallbackLocale?: string;
  /** Extra languages (or replacements for built-in ones). */
  readonly locales?: readonly LocaleDefinition[];
  /** Per-language overrides of individual texts: `{ fa: { 'menu.resetView': '…' } }`. */
  readonly overrides?: Readonly<Record<string, Messages>>;
  /** `auto` follows the language (default). */
  readonly direction?: Direction | 'auto';
  /** Digits in formatted numbers: the language's own (`native`, default) or Latin. */
  readonly numerals?: Numerals;
  /** Called once per missing key and language (development aid). */
  readonly onMissing?: (key: string, locale: string) => void;
}

export interface I18nEvents {
  /** Any change that affects translated text, direction or formatting. */
  change: { readonly locale: string; readonly direction: Direction };
  localeChange: { readonly locale: string };
  directionChange: { readonly direction: Direction };
}

const PLACEHOLDER = /\{(\w+)\}/g;

function isPlural(message: Message): message is PluralMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    typeof (message as PluralMessage).other === 'string'
  );
}

/**
 * Translation runtime: language registry, lookup with English fallback, `{name}` interpolation, plural forms
 * through `Intl.PluralRules`, text direction and locale-aware number/date formatting.
 *
 * Independent of the chart engine and of React: subscribe with `on('change')`, or read `version` (it increases
 * on every change) to bind it to any UI framework without unnecessary rerenders.
 */
export class I18n {
  private readonly definitions = new Map<string, LocaleDefinition>();
  private readonly overrides = new Map<string, Record<string, Message>>();
  private readonly emitter = new EventEmitter<I18nEvents>();
  private readonly missing = new Set<string>();
  private readonly onMissing?: (key: string, locale: string) => void;
  private readonly fallback: string;
  private _locale: string;
  private _directionPreference: Direction | 'auto';
  private _numerals: Numerals;
  private _version = 0;
  private plural = new Map<string, Intl.PluralRules>();
  private numberFormats = new Map<string, Intl.NumberFormat>();

  constructor(options: I18nOptions = {}) {
    for (const definition of [...builtInLocales, ...(options.locales ?? [])])
      this.addDefinition(definition);
    for (const [code, messages] of Object.entries(options.overrides ?? {}))
      this.override(code, messages, false);
    this.fallback = options.fallbackLocale ?? 'en';
    if (!this.definitions.has(this.fallback))
      throw new I18nError(`fallback language "${this.fallback}" is not registered`);
    this.onMissing = options.onMissing;
    this._directionPreference = options.direction ?? 'auto';
    this._numerals = options.numerals ?? 'native';
    const requested = options.locale ?? this.fallback;
    this._locale =
      requested === 'auto'
        ? detectLocale(this.codes(), this.fallback)
        : (this.resolve(requested) ?? this.fallback);
  }

  /** Current language code (one of the registered codes). */
  get locale(): string {
    return this._locale;
  }

  /** Effective text direction (the language's unless overridden). */
  get direction(): Direction {
    return this._directionPreference === 'auto'
      ? this.info(this._locale).direction
      : this._directionPreference;
  }

  get directionPreference(): Direction | 'auto' {
    return this._directionPreference;
  }

  get numerals(): Numerals {
    return this._numerals;
  }

  get fallbackLocale(): string {
    return this.fallback;
  }

  /** Increases on every change; cheap snapshot for `useSyncExternalStore` and memoisation. */
  get version(): number {
    return this._version;
  }

  /** BCP 47 tag for `Intl` and the chart engine (e.g. `fa-IR`), with Latin digits when `numerals` is `latn`. */
  get formatLocale(): string {
    const base = this.definitions.get(this._locale)?.formatLocale ?? this._locale;
    return this._numerals === 'latn' ? withNumberingSystem(base, 'latn') : base;
  }

  on<K extends keyof I18nEvents>(
    event: K,
    listener: (payload: I18nEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  /** Registered languages, in registration order. */
  locales(): LocaleInfo[] {
    return [...this.definitions.values()].map(({ code, name, englishName, direction }) => ({
      code,
      name,
      englishName,
      direction,
    }));
  }

  info(code: string = this._locale): LocaleInfo {
    const d = this.definitions.get(this.resolve(code) ?? this.fallback)!;
    return { code: d.code, name: d.name, englishName: d.englishName, direction: d.direction };
  }

  /** Best registered match for a requested tag: exact code, then the language subtag (`fa-IR` → `fa`). */
  resolve(requested: string): string | null {
    if (typeof requested !== 'string' || !requested) return null;
    const lower = requested.toLowerCase();
    for (const code of this.definitions.keys()) if (code.toLowerCase() === lower) return code;
    const language = lower.split(/[-_]/)[0];
    for (const code of this.definitions.keys()) if (code.toLowerCase() === language) return code;
    return null;
  }

  setLocale(requested: string): void {
    const code =
      requested === 'auto' ? detectLocale(this.codes(), this.fallback) : this.resolve(requested);
    if (!code)
      throw new I18nError(
        `language "${requested}" is not registered (available: ${this.codes().join(', ')})`,
      );
    if (code === this._locale) return;
    const previousDirection = this.direction;
    this._locale = code;
    this.changed();
    this.emitter.emit('localeChange', { locale: code });
    if (this.direction !== previousDirection)
      this.emitter.emit('directionChange', { direction: this.direction });
  }

  /** `auto` follows the language; `ltr`/`rtl` force a direction. */
  setDirection(direction: Direction | 'auto'): void {
    if (direction !== 'auto' && direction !== 'ltr' && direction !== 'rtl')
      throw new I18nError(`invalid direction "${String(direction)}"`);
    if (direction === this._directionPreference) return;
    const previous = this.direction;
    this._directionPreference = direction;
    this.changed();
    if (this.direction !== previous)
      this.emitter.emit('directionChange', { direction: this.direction });
  }

  setNumerals(numerals: Numerals): void {
    if (numerals === this._numerals) return;
    this._numerals = numerals;
    this.numberFormats.clear();
    this.changed();
  }

  /** Adds a language, or replaces one with the same code. */
  register(definition: LocaleDefinition): void {
    this.addDefinition(definition);
    this.changed();
  }

  /** Adds or replaces texts of a language (merged over its dictionary, e.g. for app-specific keys). */
  extend(code: string, messages: Messages): void {
    const target = this.resolve(code);
    if (!target) throw new I18nError(`language "${code}" is not registered`);
    const d = this.definitions.get(target)!;
    this.definitions.set(target, {
      ...d,
      messages: { ...d.messages, ...validateMessages(messages, code) },
    });
    this.changed();
  }

  /** Overrides individual texts without touching the dictionaries (highest priority). */
  override(code: string, messages: Messages, notify = true): void {
    const current = this.overrides.get(code) ?? {};
    this.overrides.set(code, { ...current, ...validateMessages(messages, code) });
    if (notify) this.changed();
  }

  clearOverrides(code?: string): void {
    if (code) this.overrides.delete(code);
    else this.overrides.clear();
    this.changed();
  }

  has(key: AnyTranslationKey, code: string = this._locale): boolean {
    return this.lookup(key, code, false) !== undefined;
  }

  /**
   * Translates `key`: overrides, then the language, then the fallback language; the key itself as a last
   * resort. `{name}` placeholders take `values`; a numeric `count` selects the plural form.
   */
  t(key: AnyTranslationKey, values?: TranslationValues): string {
    let message = this.lookup(key, this._locale, true);
    if (message === undefined) message = this.lookup(key, this.fallback, false);
    if (message === undefined) return key;
    let text: string;
    if (isPlural(message)) {
      const count = typeof values?.['count'] === 'number' ? values['count'] : Number.NaN;
      const form = Number.isFinite(count) ? this.pluralRules().select(count) : 'other';
      text = message[form as keyof PluralMessage] ?? message.other;
    } else text = message;
    if (!values) return text;
    return text.replace(PLACEHOLDER, (match, name: string) => {
      // Own keys only: `{constructor}` or `{toString}` must not print inherited functions.
      const value = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
      if (typeof value !== 'string' && typeof value !== 'number') return match;
      return typeof value === 'number' ? this.formatNumber(value) : value;
    });
  }

  /** Locale-aware number (digits and separators follow `numerals`). */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    const key = options ? JSON.stringify(options) : '';
    let format = this.numberFormats.get(key);
    if (!format) {
      format = new Intl.NumberFormat(this.formatLocale, options);
      this.numberFormats.set(key, format);
    }
    return format.format(value);
  }

  /** Locale-aware date/time (Gregorian calendar, like the chart axes; UTC unless `timeZone` is given). */
  formatDate(
    time: number | Date,
    options: Intl.DateTimeFormatOptions = {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    },
  ): string {
    const locale = withCalendar(this.formatLocale, 'gregory');
    return new Intl.DateTimeFormat(locale, options).format(time);
  }

  /** Keys of the fallback dictionary missing in `code` (for translators). */
  missingKeys(code: string): string[] {
    const target = this.definitions.get(this.resolve(code) ?? '')?.messages ?? {};
    return Object.keys(this.definitions.get(this.fallback)!.messages).filter(
      (key) => !(key in target),
    );
  }

  private lookup(key: string, code: string, report: boolean): Message | undefined {
    const override = own(this.overrides.get(code), key);
    if (override !== undefined) return override;
    const message = own(this.definitions.get(code)?.messages, key);
    if (message === undefined && report && code !== this.fallback && this.onMissing) {
      const id = `${code}\u0000${key}`;
      if (!this.missing.has(id)) {
        this.missing.add(id);
        this.onMissing(key, code);
      }
    }
    return message;
  }

  private pluralRules(): Intl.PluralRules {
    let rules = this.plural.get(this._locale);
    if (!rules) {
      rules = new Intl.PluralRules(
        this.definitions.get(this._locale)?.formatLocale ?? this._locale,
      );
      this.plural.set(this._locale, rules);
    }
    return rules;
  }

  private codes(): string[] {
    return [...this.definitions.keys()];
  }

  private addDefinition(definition: LocaleDefinition): void {
    if (
      !definition ||
      typeof definition.code !== 'string' ||
      !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(definition.code)
    ) {
      throw new I18nError(`invalid language code "${String(definition?.code)}"`);
    }
    if (definition.direction !== 'ltr' && definition.direction !== 'rtl') {
      throw new I18nError(`language "${definition.code}" needs direction "ltr" or "rtl"`);
    }
    this.definitions.set(definition.code, {
      ...definition,
      messages: validateMessages(definition.messages, definition.code),
    });
    this.numberFormats.clear();
  }

  private changed(): void {
    this._version++;
    this.numberFormats.clear();
    this.emitter.emit('change', { locale: this._locale, direction: this.direction });
  }
}

/** A dictionary entry that the dictionary itself defines (never an inherited `toString`, `constructor`…). */
function own(
  messages: Readonly<Record<string, Message>> | undefined,
  key: string,
): Message | undefined {
  return messages && Object.prototype.hasOwnProperty.call(messages, key)
    ? messages[key]
    : undefined;
}

function validateMessages(messages: Messages, code: string): Record<string, Message> {
  if (!messages || typeof messages !== 'object')
    throw new I18nError(`messages for "${code}" must be an object`);
  const out: Record<string, Message> = {};
  for (const [key, value] of Object.entries(messages)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (typeof value === 'string' || isPlural(value)) out[key] = value;
    else
      throw new I18nError(
        `message "${key}" of "${code}" must be a string or plural forms with "other"`,
      );
  }
  return out;
}

function withNumberingSystem(locale: string, numberingSystem: string): string {
  const IntlLocale = (
    Intl as { Locale?: new (tag: string, options?: Record<string, string>) => object }
  ).Locale;
  try {
    return IntlLocale ? String(new IntlLocale(locale, { numberingSystem })) : locale;
  } catch {
    return locale;
  }
}

function withCalendar(locale: string, calendar: string): string {
  const IntlLocale = (
    Intl as { Locale?: new (tag: string, options?: Record<string, string>) => object }
  ).Locale;
  try {
    return IntlLocale ? String(new IntlLocale(locale, { calendar })) : locale;
  } catch {
    return locale;
  }
}

/**
 * Picks the best supported language from the browser's preferences (`navigator.languages`), or `fallback`.
 * Reads `navigator` only when called, never at import time; returns `fallback` on the server.
 */
export function detectLocale(supported: readonly string[], fallback = 'en'): string {
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } })
    .navigator;
  const preferences = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  for (const tag of preferences) {
    const lower = tag.toLowerCase();
    const exact = supported.find((code) => code.toLowerCase() === lower);
    if (exact) return exact;
    const language = supported.find((code) => code.toLowerCase() === lower.split('-')[0]);
    if (language) return language;
  }
  return fallback;
}

export function createI18n(options?: I18nOptions): I18n {
  return new I18n(options);
}

/**
 * Keeps a chart's axis locale and text direction in step with an `I18n` instance (no chart recreation).
 * With `localDigits`, axis prices and dates use the language's digits when `numerals` is `native`.
 */
export function syncChartLocale(
  chart: ChartApi,
  i18n: I18n,
  options: { readonly localDigits?: boolean } = {},
): Unsubscribe {
  const apply = (): void => {
    if (chart.destroyed) return;
    const localizeNumbers = options.localDigits === true && i18n.numerals === 'native';
    const current = chart.options().localization;
    if (
      current.locale !== i18n.formatLocale ||
      current.direction !== i18n.direction ||
      current.localizeNumbers !== localizeNumbers
    ) {
      chart.applyOptions({
        localization: { locale: i18n.formatLocale, direction: i18n.direction, localizeNumbers },
      });
    }
  };
  apply();
  return i18n.on('change', apply);
}
