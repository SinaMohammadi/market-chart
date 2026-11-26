import { ProgressiveChart } from '@market-chart/react';
import { hourlyBars, instruments } from '../data';

/**
 * A Server Component using the client `<ProgressiveChart>`: the server sends an SVG picture (fast first paint,
 * indexable); the canvas engine loads and takes over when the chart becomes visible or is touched.
 */
export default function ProgressivePage() {
  const alpha = instruments[0];
  const beta = instruments[1];
  return (
    <>
      <h1>Progressive enhancement</h1>
      <p className="lead">
        Static SVG from the server, interactive canvas on the client. The first chart activates when
        visible, the second on the first pointer or keyboard focus.
      </p>
      <div className="panel">
        <ProgressiveChart
          type="candlestick"
          data={hourlyBars(alpha.seed, alpha.startPrice)}
          height={360}
          theme="dark"
          title={`${alpha.symbol} hourly candles (synthetic)`}
          activate="visible"
        />
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <ProgressiveChart
          type="area"
          data={hourlyBars(beta.seed, beta.startPrice).map((b) => ({
            time: b.time,
            value: b.close,
          }))}
          height={240}
          theme="dark"
          title={`${beta.symbol} hourly closes (synthetic) — hover or focus to interact`}
          activate="interaction"
        />
      </div>
    </>
  );
}
