import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

// ───────────────────────────── routing ─────────────────────────────

/** `#/packages/core#install` → path `/packages/core`, anchor `install`. Works on any static host. */
export interface Route {
  readonly path: string;
  readonly anchor: string | null;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [path = '/', anchor] = raw.split('#');
  return {
    path: path.startsWith('/') ? path : '/',
    anchor: anchor ? decodeURIComponent(anchor) : null,
  };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(globalThis.location?.hash ?? ''));
  useEffect(() => {
    const update = () => setRoute(parse(location.hash));
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  return route;
}

export function href(path: string, anchor?: string): string {
  return `#${path}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}

export function navigate(path: string, anchor?: string): void {
  location.hash = href(path, anchor);
}

export function Link({
  to,
  anchor,
  children,
  className,
}: {
  to: string;
  anchor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={href(to, anchor)} className={className}>
      {children}
    </a>
  );
}

/** Heading id from its text (`Context menus` → `context-menus`). */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^<>]{1,200}>/g, '')
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

// ───────────────────────────── site settings ─────────────────────────────

export type Theme = 'dark' | 'light';

interface SiteSettings {
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
  /** Language of the live examples (the documentation text is English). */
  readonly locale: string;
  readonly setLocale: (locale: string) => void;
}

const SiteContext = createContext<SiteSettings>({
  theme: 'dark',
  setTheme: () => undefined,
  locale: 'en',
  setLocale: () => undefined,
});

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice just is not remembered.
  }
};

/** Languages of the live examples. */
export const SITE_LOCALES = ['en', 'fa', 'ar'] as const;

export function storedLocale(value: string | null): string {
  return SITE_LOCALES.includes(value as (typeof SITE_LOCALES)[number]) ? value! : 'en';
}

export function SiteProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark',
  );
  // Storage is editable by the user and other scripts: only a known language is used (an unknown one made
  // `ChartProvider` throw and blanked the site).
  const [locale, setLocaleState] = useState(() => storedLocale(read('mc-docs-locale')));
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.dataset['theme'] = next;
    write('mc-docs-theme', next);
  }, []);
  const setLocale = useCallback((next: string) => {
    setLocaleState(next);
    write('mc-docs-locale', next);
  }, []);
  return (
    <SiteContext.Provider value={{ theme, setTheme, locale, setLocale }}>
      {children}
    </SiteContext.Provider>
  );
}

export const useSite = (): SiteSettings => useContext(SiteContext);

/** The site's light/dark theme, for the examples' `theme` prop (your app would use its own). */
export const useTheme = (): Theme => useContext(SiteContext).theme;
