import { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import { I18n } from '@market-chart/i18n';
import type { AnyTranslationKey, Direction, TranslationValues } from '@market-chart/i18n';

/** Translations of the nearest `<ChartProvider>` (null outside one). */
export const I18nContext = createContext<I18n | null>(null);

let fallback: I18n | null = null;

/** True on a server (no DOM). Read on each call, never at import time. */
const onServer = (): boolean =>
  typeof (globalThis as { document?: unknown }).document === 'undefined';

/**
 * The provider's `I18n`, or an English instance without a provider. In the browser that instance is shared
 * (created on first use, never at import time). On the server every component gets its own: a module-level
 * instance would be shared by all requests, so a `setLocale`/`extend` made while rendering one user's page
 * would leak into everyone else's.
 */
export function useI18n(): I18n {
  const fromContext = useContext(I18nContext);
  const [own] = useState<I18n | null>(() => (fromContext || !onServer() ? null : new I18n()));
  if (fromContext) return fromContext;
  if (own) return own;
  if (onServer()) return new I18n();
  fallback ??= new I18n();
  return fallback;
}

/** Re-renders the calling component when the language, direction or texts change (and only then). */
function useI18nVersion(i18n: I18n): number {
  return useSyncExternalStore(
    (onChange) => i18n.on('change', onChange),
    () => i18n.version,
    () => i18n.version,
  );
}

export interface TranslationApi {
  readonly t: (key: AnyTranslationKey, values?: TranslationValues) => string;
  readonly locale: string;
  readonly direction: Direction;
  readonly i18n: I18n;
}

/** `const { t } = useTranslation()`: typed keys, interpolation and plurals in the current language. */
export function useTranslation(): TranslationApi {
  const i18n = useI18n();
  const version = useI18nVersion(i18n);
  return useMemo(
    () => ({
      t: (key, values) => i18n.t(key, values),
      locale: i18n.locale,
      direction: i18n.direction,
      i18n,
    }),
    // `version` changes whenever translations do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18n, version],
  );
}

/** `[locale, setLocale]` of the nearest provider. */
export function useLocale(): readonly [string, (locale: string) => void] {
  const i18n = useI18n();
  useI18nVersion(i18n);
  return [i18n.locale, (locale) => i18n.setLocale(locale)];
}

/** `[direction, setDirection]`; `setDirection('auto')` follows the language again. */
export function useDirection(): readonly [Direction, (direction: Direction | 'auto') => void] {
  const i18n = useI18n();
  useI18nVersion(i18n);
  return [i18n.direction, (direction) => i18n.setDirection(direction)];
}
