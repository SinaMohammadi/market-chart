import { Example } from '../components/Example';
import ChartTypes from '../demos/ChartTypes';
import chartTypesSource from '../demos/ChartTypes.tsx?raw';
import Drawings from '../demos/Drawings';
import drawingsSource from '../demos/Drawings.tsx?raw';
import FullInterface from '../demos/FullInterface';
import fullInterfaceSource from '../demos/FullInterface.tsx?raw';
import IndicatorPreview from '../demos/IndicatorPreview';
import indicatorPreviewSource from '../demos/IndicatorPreview.tsx?raw';
import Languages from '../demos/Languages';
import languagesSource from '../demos/Languages.tsx?raw';
import LegendMarkers from '../demos/LegendMarkers';
import legendMarkersSource from '../demos/LegendMarkers.tsx?raw';
import Persistence from '../demos/Persistence';
import persistenceSource from '../demos/Persistence.tsx?raw';
import QuickStart from '../demos/QuickStart';
import quickStartSource from '../demos/QuickStart.tsx?raw';
import Realtime from '../demos/Realtime';
import realtimeSource from '../demos/Realtime.tsx?raw';
import SeriesTypes from '../demos/SeriesTypes';
import seriesTypesSource from '../demos/SeriesTypes.tsx?raw';
import SymbolDropdown from '../demos/SymbolDropdown';
import symbolDropdownSource from '../demos/SymbolDropdown.tsx?raw';
import SymbolSearchModal from '../demos/SymbolSearchModal';
import symbolSearchModalSource from '../demos/SymbolSearchModal.tsx?raw';
import CustomSymbolSelector from '../demos/CustomSymbolSelector';
import customSymbolSelectorSource from '../demos/CustomSymbolSelector.tsx?raw';
import PriceActions from '../demos/PriceActions';
import priceActionsSource from '../demos/PriceActions.tsx?raw';
import OrderTicketDemo from '../demos/OrderTicketDemo';
import orderTicketDemoSource from '../demos/OrderTicketDemo.tsx?raw';
import TradingObjects from '../demos/TradingObjects';
import tradingObjectsSource from '../demos/TradingObjects.tsx?raw';
import CustomMarkers from '../demos/CustomMarkers';
import customMarkersSource from '../demos/CustomMarkers.tsx?raw';
import TradingRtl from '../demos/TradingRtl';
import tradingRtlSource from '../demos/TradingRtl.tsx?raw';
import simulatedSource from '../demos/simulated.ts?raw';
import hookSource from '../demos/useTradingChart.ts?raw';

const hook = { file: 'useTradingChart.ts', code: hookSource };
const simulated = { file: 'simulated.ts', code: simulatedSource };

export default function Examples() {
  return (
    <>
      <p>
        Each example runs in this page. Open the code tabs to see exactly what runs: the files are
        shown as they are in the repository (<code>apps/docs/src/demos</code>). All prices are
        synthetic.
      </p>
      <Example
        title="Complete interface"
        description="Header, sidebar, legend, context menus, settings, realtime synthetic datafeed."
        sources={[{ file: 'FullInterface.tsx', code: fullInterfaceSource }, hook]}
      >
        <FullInterface />
      </Example>
      <Example
        title="Legend and price labels"
        description="Date, time, timestamp, OHLC, change, volume and indicator values; visible high/low and previous close lines."
        sources={[{ file: 'LegendMarkers.tsx', code: legendMarkersSource }, hook]}
      >
        <LegendMarkers />
      </Example>
      <Example
        title="Candles and volume"
        sources={[{ file: 'QuickStart.tsx', code: quickStartSource }]}
      >
        <QuickStart />
      </Example>
      <Example
        title="Series types"
        sources={[{ file: 'SeriesTypes.tsx', code: seriesTypesSource }]}
      >
        <SeriesTypes />
      </Example>
      <Example
        title="Indicators in their own pane"
        sources={[{ file: 'IndicatorPreview.tsx', code: indicatorPreviewSource }]}
      >
        <IndicatorPreview type="rsi" />
      </Example>
      <Example
        title="Drawing tools without the UI package"
        sources={[{ file: 'Drawings.tsx', code: drawingsSource }]}
      >
        <Drawings />
      </Example>
      <Example title="Chart types" sources={[{ file: 'ChartTypes.tsx', code: chartTypesSource }]}>
        <ChartTypes />
      </Example>
      <Example title="Realtime datafeed" sources={[{ file: 'Realtime.tsx', code: realtimeSource }]}>
        <Realtime />
      </Example>
      <Example
        title="Persian and Arabic, right-to-left"
        sources={[{ file: 'Languages.tsx', code: languagesSource }, hook]}
      >
        <Languages />
      </Example>
      <Example
        title="Saved layouts"
        description="Change anything and reload the page."
        sources={[{ file: 'Persistence.tsx', code: persistenceSource }, hook]}
      >
        <Persistence />
      </Example>
      <h2 id="symbols-and-trading">Symbols and trading (simulated)</h2>
      <p>
        <strong>Everything below is SIMULATED.</strong> The library never trades: these examples use
        generated symbols and an in-memory broker (<code>simulated.ts</code>) that accepts, rejects
        and delays orders at random. Your application provides the real search and order handling.
      </p>
      <Example
        title="Symbol selector: header dropdown"
        description="Static list filtered locally; favorites and recent symbols saved in the preferences. Simulated symbols."
        sources={[{ file: 'SymbolDropdown.tsx', code: symbolDropdownSource }, simulated, hook]}
      >
        <SymbolDropdown />
      </Example>
      <Example
        title="Symbol search dialog"
        description='Server-like async search with latency, cancellation and errors (type "error"), group tabs, favorites, recents, compare. Simulated.'
        sources={[
          { file: 'SymbolSearchModal.tsx', code: symbolSearchModalSource },
          simulated,
          hook,
        ]}
      >
        <SymbolSearchModal />
      </Example>
      <Example
        title="Custom symbol selector"
        description="Built on the headless useSymbolSearch hook (state, keyboard and ARIA props). Simulated symbols."
        sources={[
          { file: 'CustomSymbolSelector.tsx', code: customSymbolSelectorSource },
          simulated,
          hook,
        ]}
      >
        <CustomSymbolSelector />
      </Example>
      <Example
        title="Actions at a price"
        description="Context menu and the + next to the price label: Buy limit, Sell limit, Create alert. Simulated broker."
        sources={[{ file: 'PriceActions.tsx', code: priceActionsSource }, simulated, hook]}
      >
        <PriceActions />
      </Example>
      <Example
        title="Order ticket"
        description="Application-defined fields and validation, confirmation, accept/reject with latency. Simulated broker."
        sources={[{ file: 'OrderTicketDemo.tsx', code: orderTicketDemoSource }, simulated, hook]}
      >
        <OrderTicketDemo />
      </Example>
      <Example
        title="Orders and positions on the chart"
        description="Drag to modify, cancel, take-profit and stop-loss, realtime status changes, context menu, tooltip. Simulated broker."
        sources={[{ file: 'TradingObjects.tsx', code: tradingObjectsSource }, simulated, hook]}
      >
        <TradingObjects />
      </Example>
      <Example
        title="Custom price markers"
        description="The application's own objects (liquidation price, draggable target) with a custom label format. Simulated."
        sources={[{ file: 'CustomMarkers.tsx', code: customMarkersSource }, simulated, hook]}
      >
        <CustomMarkers />
      </Example>
      <Example
        title="Trading interface in Persian (RTL)"
        description="Symbol search, price actions, order ticket and order lines, right to left. Simulated broker."
        sources={[{ file: 'TradingRtl.tsx', code: tradingRtlSource }, simulated, hook]}
      >
        <TradingRtl />
      </Example>
    </>
  );
}
