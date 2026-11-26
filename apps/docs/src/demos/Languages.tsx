import { useState } from 'react';
import { CandlestickSeries, Chart, ChartProvider } from '@market-chart/react';
import { ChartInterface } from '@market-chart/ui/react';
import { syntheticBars } from '../data';
import { useTheme } from '../site';
import { useTradingChart } from './useTradingChart';

const bars = syntheticBars('EURUSD', 400);
const LANGUAGES = [
  ['en', 'English'],
  ['fa', 'فارسی'],
  ['ar', 'العربية'],
] as const;

function TranslatedChart() {
  const theme = useTheme();
  const { setChart, ui } = useTradingChart();
  return (
    <ChartInterface ui={ui} height={460}>
      <Chart ref={setChart} theme={theme} height="100%" syncLocale="digits">
        <CandlestickSeries data={bars} />
      </Chart>
    </ChartInterface>
  );
}

/**
 * The whole interface follows the provider's language without recreating the chart. Persian and Arabic are
 * right-to-left: header, sidebar, menus and dialogs mirror, and the axes use the language's digits.
 */
export default function Languages() {
  const [locale, setLocale] = useState<string>('fa');
  return (
    <ChartProvider locale={locale}>
      <div className="demo-toolbar" role="group" aria-label="Language">
        {LANGUAGES.map(([code, name]) => (
          <button
            key={code}
            type="button"
            aria-pressed={locale === code}
            onClick={() => setLocale(code)}
          >
            {name}
          </button>
        ))}
      </div>
      <TranslatedChart />
    </ChartProvider>
  );
}
