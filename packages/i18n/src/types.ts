export type Direction = 'ltr' | 'rtl';

/** Plural forms selected with `Intl.PluralRules` (`other` is required; `{count}` is interpolated). */
export interface PluralMessage {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

/** A translation: text with `{name}` placeholders, or plural forms. */
export type Message = string | PluralMessage;

export type Messages = Readonly<Record<string, Message>>;

/** A language that can be registered with `I18n.register`. */
export interface LocaleDefinition {
  /** BCP 47 language code, e.g. `en`, `fa`, `ar`, `de`. */
  readonly code: string;
  /** Name in the language itself (shown in language selectors). */
  readonly name: string;
  /** Name in English. */
  readonly englishName: string;
  readonly direction: Direction;
  /** Locale used for `Intl` formatting when the code alone is not specific enough (e.g. `fa-IR`). */
  readonly formatLocale?: string;
  readonly messages: Messages;
}

export interface LocaleInfo {
  readonly code: string;
  readonly name: string;
  readonly englishName: string;
  readonly direction: Direction;
}

export class I18nError extends Error {
  constructor(message: string) {
    super(`[market-chart/i18n] ${message}`);
    this.name = 'I18nError';
  }
}
