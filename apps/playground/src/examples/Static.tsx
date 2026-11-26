import { ProgressiveChart } from '@market-chart/react';
import { StaticChart } from '@market-chart/react/ssr';
import { syntheticAssets } from '@market-chart/testing';
import { dailyBars } from '../data';

/**
 * `StaticChart` comes from the server-safe entry: it renders plain SVG from props, so the same markup
 * is produced by `renderToString` on the server and on the client (no hydration mismatch).
 */
export function StaticExample() {
  return (
    <>
      <div className="card" style={{ marginBottom: 12, padding: 8 }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>
          ProgressiveChart <span className="badge">SVG first, canvas on first hover or focus</span>
        </h3>
        <ProgressiveChart
          type="candlestick"
          data={dailyBars('ETHUSDT', 400)}
          height={280}
          theme="dark"
          title="ETHUSDT synthetic daily candles"
          activate="interaction"
        />
      </div>
      <div className="grid2">
        {Object.values(syntheticAssets).map((asset) => {
          const bars = dailyBars(asset.symbol, 180);
          const first = bars[0]!.close;
          const last = bars[bars.length - 1]!.close;
          const change = ((last - first) / first) * 100;
          const color = change >= 0 ? '#26a69a' : '#ef5350';
          return (
            <div className="tile" key={asset.symbol}>
              <h3>
                <span>
                  {asset.symbol}
                  <span className="badge">synthetic</span>
                </span>
                <span className={change >= 0 ? 'up' : 'down'}>{change.toFixed(2)}%</span>
              </h3>
              <StaticChart
                type="area"
                data={bars.map((b) => ({ time: b.time, value: b.close }))}
                height={90}
                color={color}
                theme="dark"
                title={`${asset.symbol} synthetic daily closes`}
                priceFormat={{ type: 'price', precision: asset.precision }}
                showLastValue
              />
            </div>
          );
        })}
        <div className="tile">
          <h3>
            <span>
              BTCUSDT candles<span className="badge">synthetic</span>
            </span>
          </h3>
          <StaticChart
            type="candlestick"
            data={dailyBars('BTCUSDT', 60)}
            height={90}
            theme="dark"
            showLastValue
          />
        </div>
      </div>
    </>
  );
}
