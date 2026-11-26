import { TradingChart } from './trading-chart';

/** The page itself is a Server Component; the interactive chart is a client component below it. */
export default function ChartPage() {
  return (
    <>
      <h1>Interactive chart</h1>
      <p className="lead">
        Full client-side chart: a synthetic datafeed with realtime updates and history paging,
        indicators, and a layout saved to localStorage (reload the page to see it restored).
      </p>
      <TradingChart />
    </>
  );
}
