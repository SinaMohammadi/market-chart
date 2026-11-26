import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChartApi } from '@market-chart/core';
import { I18n } from '@market-chart/i18n';
import type { Direction, I18nOptions } from '@market-chart/i18n';
import { ChartRegisterContext, ChartRegistryContext } from './context.js';
import { I18nContext } from './i18n.js';
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect.js';

export interface ChartProviderProps {
  children?: ReactNode;
  /**
   * Language of every chart and chart UI below (`'auto'`: the browser's, on the client). Changing it
   * re-labels everything in place; charts are not recreated.
   */
  locale?: string;
  /** Text direction; omitted or `'auto'` follows the language (Persian and Arabic are RTL). */
  direction?: Direction | 'auto';
  /** Your own `I18n` instance (custom languages, overrides); `locale`/`direction` are applied to it. */
  i18n?: I18n;
  /** Options for the instance created when `i18n` is not given. */
  i18nOptions?: Omit<I18nOptions, 'locale' | 'direction'>;
}

/**
 * Lets components outside a `<Chart>` (toolbars, legends, side panels) access charts by id:
 * `<Chart chartId="main" />` registers itself; `useChart('main')` reads it anywhere below the provider.
 */
export function ChartProvider({
  children,
  locale,
  direction,
  i18n: external,
  i18nOptions,
}: ChartProviderProps) {
  // Created once; 'auto' (browser language) is resolved after hydration so server and client markup match.
  const [own] = useState(() =>
    external
      ? null
      : new I18n({
          ...i18nOptions,
          locale: locale === 'auto' || locale === undefined ? undefined : locale,
        }),
  );
  const i18n = external ?? own!;
  useIsomorphicLayoutEffect(() => {
    if (locale !== undefined) i18n.setLocale(locale);
  }, [i18n, locale]);
  useIsomorphicLayoutEffect(() => {
    i18n.setDirection(direction ?? 'auto');
  }, [i18n, direction]);
  const [charts, setCharts] = useState<ReadonlyMap<string, ChartApi>>(() => new Map());
  const register = useCallback((id: string, chart: ChartApi) => {
    setCharts((prev) => {
      if (prev.get(id) === chart) return prev;
      if (prev.has(id))
        console.warn(
          `[market-chart] two charts registered with chartId "${id}"; the latest one wins`,
        );
      const next = new Map(prev);
      next.set(id, chart);
      return next;
    });
    return () => {
      setCharts((prev) => {
        if (prev.get(id) !== chart) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    };
  }, []);
  return (
    <I18nContext.Provider value={i18n}>
      <ChartRegisterContext.Provider value={register}>
        <ChartRegistryContext.Provider value={charts}>{children}</ChartRegistryContext.Provider>
      </ChartRegisterContext.Provider>
    </I18nContext.Provider>
  );
}
