import { StaticChart } from '@market-chart/react/ssr';
import { dailyBars, instruments } from './data';

/**
 * A Server Component: every chart here is rendered to SVG on the server. No chart JavaScript is sent to the
 * browser for this page (`@market-chart/react/ssr` does not import the canvas engine).
 */
export default function MarketOverview() {
  return (
    <>
      <h1>Market overview</h1>
      <p className="lead">
        Server-rendered with &lt;StaticChart&gt;: meaningful HTML, no hydration, no client
        JavaScript for the charts.
      </p>
      <div className="grid">
        {instruments.map((instrument) => {
          const bars = dailyBars(instrument.seed, instrument.startPrice);
          const first = bars[0]!.close;
          const last = bars[bars.length - 1]!.close;
          const change = ((last - first) / first) * 100;
          const data = bars.map((b) => ({ time: b.time, value: b.close }));
          return (
            <section className="tile" key={instrument.symbol}>
              <h2>
                <span>
                  {instrument.symbol}{' '}
                  <small style={{ color: 'var(--muted)' }}>{instrument.name}</small>
                </span>
                <span className={change >= 0 ? 'up' : 'down'}>
                  {change >= 0 ? '+' : ''}
                  {change.toFixed(2)}%
                </span>
              </h2>
              <StaticChart
                type="area"
                data={data}
                height={110}
                theme="dark"
                color={change >= 0 ? '#26a69a' : '#ef5350'}
                title={`${instrument.symbol} closing price, last ${bars.length} days (synthetic)`}
                showLastValue
                priceFormat={{
                  type: 'price',
                  precision: instrument.startPrice < 10 ? 4 : 2,
                  minMove: instrument.startPrice < 10 ? 0.0001 : 0.01,
                }}
              />
            </section>
          );
        })}
      </div>
    </>
  );
}
