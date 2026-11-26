/**
 * Locale helpers for engine labels. No DOM: only `Intl`, so they work on servers and in workers.
 */

/**
 * The `Intl` locale used for axis labels: always the Gregorian calendar (tick boundaries are Gregorian, so a
 * Solar Hijri or Hijri month name would label the wrong position) and, unless native digits are wanted,
 * Latin digits.
 */
export function axisLocale(locale: string, nativeDigits: boolean): string {
  const IntlLocale = (
    Intl as { Locale?: new (tag: string, options?: Record<string, string>) => object }
  ).Locale;
  if (!IntlLocale) return locale;
  try {
    return String(
      new IntlLocale(
        locale,
        nativeDigits ? { calendar: 'gregory' } : { calendar: 'gregory', numberingSystem: 'latn' },
      ),
    );
  } catch {
    return locale;
  }
}

const cache = new Map<string, ((text: string) => string) | null>();
/**
 * Locales can come from user input (stored layouts, `Accept-Language` on a server), so the cache is bounded:
 * a long-running server rendering many different locale strings must not grow without limit.
 */
export const DIGIT_LOCALIZER_CACHE_SIZE = 64;

/**
 * Returns a function that rewrites ASCII digits, `.` and `,` in an already formatted label into the locale's
 * digits and decimal/group separators (e.g. `1,234.5` → `۱٬۲۳۴٫۵` for `fa`), or null when the locale uses
 * ASCII anyway. Works for every built-in format (price, volume `1.2K`, percent), so formatters stay simple.
 */
export function createDigitLocalizer(locale: string): ((text: string) => string) | null {
  if (cache.has(locale)) return cache.get(locale)!;
  let result: ((text: string) => string) | null = null;
  try {
    const plain = new Intl.NumberFormat(locale, { useGrouping: false });
    const digits = Array.from({ length: 10 }, (_, d) => plain.format(d));
    const part = (value: number, type: string, fallback: string): string =>
      new Intl.NumberFormat(locale, { minimumFractionDigits: 1, useGrouping: true })
        .formatToParts(value)
        .find((p) => p.type === type)?.value ?? fallback;
    const decimal = part(1.5, 'decimal', '.');
    const group = part(1234567.5, 'group', ',');
    const ascii = digits.every((d, i) => d === String(i)) && decimal === '.' && group === ',';
    if (!ascii) {
      const map: Record<string, string> = { '.': decimal, ',': group };
      digits.forEach((d, i) => (map[String(i)] = d));
      result = (text) => text.replace(/[0-9.,]/g, (c) => map[c] ?? c);
    }
  } catch {
    result = null;
  }
  if (cache.size >= DIGIT_LOCALIZER_CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(locale, result);
  return result;
}

/** Number of cached localizers (for tests and diagnostics). */
export function digitLocalizerCacheSize(): number {
  return cache.size;
}
