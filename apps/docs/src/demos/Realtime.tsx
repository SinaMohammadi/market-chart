import { useMemo, useState } from 'react';
import { Chart } from '@market-chart/react';
import { createSyntheticDatafeed } from '@market-chart/datafeed';
import { DatafeedSeries } from '@market-chart/datafeed/react';
import type { DatafeedState } from '@market-chart/datafeed/react';
import { useTheme } from '../site';

/**
 * History, realtime ticks and paging from a datafeed. The synthetic feed is offline and deterministic; a REST,
 * WebSocket or SSE adapter plugs in the same way. Scroll left to load older bars.
 */
export default function Realtime() {
  const theme = useTheme();
  const datafeed = useMemo(() => createSyntheticDatafeed({ latencyMs: 150 }), []);
  const [interval, setTimeframe] = useState('1m');
  const [state, setState] = useState<DatafeedState | null>(null);
  return (
    <>
      <div className="demo-toolbar" role="group" aria-label="Interval">
        {['1m', '5m', '1h'].map((i) => (
          <button
            key={i}
            type="button"
            aria-pressed={interval === i}
            onClick={() => setTimeframe(i)}
          >
            {i}
          </button>
        ))}
        <span className="demo-note">
          status: <b>{state?.status ?? 'idle'}</b>
          {state?.series ? ` · ${state.series.length()} bars loaded` : ''}
        </span>
      </div>
      <Chart height={360} theme={theme}>
        <DatafeedSeries
          datafeed={datafeed}
          symbol="SYN:BTCUSD"
          interval={interval}
          onStateChange={setState}
        />
      </Chart>
    </>
  );
}
