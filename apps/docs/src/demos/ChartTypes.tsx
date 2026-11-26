import { useMemo, useState } from 'react';
import { CandlestickSeries, Chart } from '@market-chart/react';
import { heikinAshi, lineBreak, renko } from '@market-chart/charts';
import { dailyBars } from '../data';
import { useTheme } from '../site';

const bars = dailyBars('NDXLIKE', 500);
const TYPES = {
  candles: (b: typeof bars) => b,
  'heikin-ashi': heikinAshi,
  // Renko with ATR(14) bricks; Line break with three lines.
  renko: (b: typeof bars) => renko(b, { boxSize: { atr: 14 } }),
  'line break': (b: typeof bars) => lineBreak(b, { lines: 3 }),
} as const;

/** Chart types from `@market-chart/charts` are transforms of the bars, shown with the normal series. */
export default function ChartTypes() {
  const theme = useTheme();
  const [type, setType] = useState<keyof typeof TYPES>('heikin-ashi');
  const data = useMemo(() => TYPES[type](bars), [type]);
  return (
    <>
      <div className="demo-toolbar" role="group" aria-label="Chart type">
        {(Object.keys(TYPES) as (keyof typeof TYPES)[]).map((t) => (
          <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
            {t}
          </button>
        ))}
        <span className="demo-note">{data.length} bars</span>
      </div>
      <Chart height={360} theme={theme}>
        <CandlestickSeries key={type} data={data} />
      </Chart>
    </>
  );
}
