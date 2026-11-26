import { createI18n } from '@market-chart/i18n';
import {
  DEFAULT_TRADING_COLORS,
  DEFAULT_TRADING_PREFERENCES,
  MAX_TRADING_OBJECTS,
  tradingMessagesEn,
} from '@market-chart/trading';
import {
  PRICE_TARGETS,
  SYMBOL_SELECTOR_MODES,
  builtInPriceActions,
  defaultTicketFields,
  formatShortcut,
} from '@market-chart/ui';
import { Code } from '../components/Code';

const i18n = createI18n();
const text = (key: unknown): string =>
  typeof key === 'string'
    ? i18n.has(key)
      ? i18n.t(key, { price: '{price}', type: '{type}' })
      : ((tradingMessagesEn as Record<string, string>)[key] ?? key)
    : 'dynamic (by side)';

/** Fields the overlay accepts. Each row is checked by the package's `normalize…` functions. */
const OBJECT_FIELDS: readonly (readonly [string, string, string, string])[] = [
  ['Order', 'id', 'string, 1–128 chars', 'required; no control characters'],
  ['Order', 'side', "'buy' | 'sell'", 'required'],
  [
    'Order',
    'type',
    "'limit' | 'stop' | 'market' | string",
    "default 'limit'; shown as given (24 chars)",
  ],
  ['Order', 'price', 'number', 'required, finite'],
  ['Order', 'quantity', 'number', 'required, finite, ≥ 0'],
  [
    'Order',
    'status',
    "'pending' | 'working' | 'partial' | 'filled' | 'cancelled' | 'rejected'",
    "default 'working'; filled/cancelled/rejected are not drawn",
  ],
  ['Order', 'label, color', 'string', 'plain text (60 chars); CSS colour (hex, rgb/hsl, name)'],
  ['Order', 'draggable, cancellable', 'boolean', 'per-object overrides'],
  ['Order', 'meta', 'unknown', 'passed back to callbacks, never read'],
  ['Position', 'id, side, quantity', 'as for orders', 'required'],
  ['Position', 'entryPrice', 'number', 'required, finite'],
  ['Position', 'takeProfit, stopLoss', 'number | null', 'optional lines linked to the position'],
  [
    'Position',
    'pnl, pnlValue',
    'string, number',
    'P&L text from the application (never calculated)',
  ],
  ['Alert', 'id, price', 'string, number', 'required'],
  ['Alert', 'active', 'boolean', 'inactive alerts are dimmed'],
  ['Marker', 'id, price', 'string, number', 'required'],
  [
    'Marker',
    'kind, lineStyle, axisLabel',
    "string, 'solid' | 'dashed' | 'dotted', boolean",
    'the application’s own type',
  ],
];

const USAGE = `// SIMULATED example: the library never trades; your application owns the broker.
const ui = createChartUi(chart, {
  capabilities: { trading: { submit: (ticket) => myBroker.place(ticket), simulatedLabel: 'Paper trading' } },
  features: [symbolSearch({ mode: 'both' }), priceActions({ shortcuts: true }), orderTicket()],
});
ui.priceActions!.register({
  id: 'app.measure',
  label: 'Measure from {price}',          // {price}: formatted, rounded to the tick size
  run: (ctx) => startMeasure(ctx.price!.price),
});

const overlay = createTradingOverlay(chart, {
  ui,
  onModify: (order, price) => myBroker.modify(order.id, price), // pending until it settles; snaps back on reject
  onCancel: (order) => myBroker.cancel(order.id),
});
overlay.setOrders(orders);
overlay.upsertOrder({ ...order, status: 'partial' });            // batched: many calls, one frame`;

/** Generated from the packages: built-in price actions, default ticket fields, preferences and colours. */
export default function TradingReference() {
  const actions = builtInPriceActions();
  const fields = defaultTicketFields({ submit: async () => ({ ok: false }) });
  return (
    <>
      <p>
        Symbol selection and price actions live in <code>@market-chart/ui</code> as optional
        features; orders, positions, alerts and markers are drawn by{' '}
        <code>@market-chart/trading</code>. Nothing is installed unless you list it, and{' '}
        <strong>nothing is ever sent</strong> without an explicit user action and your callback.
        Examples in this documentation are simulated.
      </p>
      <Code code={USAGE} language="ts" title="setup" />

      <h2 id="price-actions">Built-in price actions</h2>
      <p>
        Shown in the context menu on {PRICE_TARGETS.join(', ')} targets, in the menu of the + button
        and (with <code>shortcuts: true</code>) from their shortcuts at the crosshair price.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Id</th>
              <th>Label</th>
              <th>Shortcut</th>
              <th>Requires</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id}>
                <td>
                  <code>{a.id}</code>
                </td>
                <td>{text(typeof a.label === 'string' ? a.label : a.description)}</td>
                <td>{a.shortcut ? formatShortcut(a.shortcut) : ''}</td>
                <td>{a.requires?.join(', ') ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="ticket-fields">Default order-ticket fields</h2>
      <p>
        Replace them with <code>trading.fields</code> (kinds: side, select, price, number, text;
        with min, max, step, required, visible and validate).
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Id</th>
              <th>Kind</th>
              <th>Label</th>
              <th>Rules</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.id}>
                <td>
                  <code>{f.id}</code>
                </td>
                <td>{f.kind}</td>
                <td>{text(f.label)}</td>
                <td>
                  {[
                    f.required ? 'required' : '',
                    f.min !== undefined ? `min ${f.min}` : '',
                    f.options ? f.options.map((o) => o.value).join(' / ') : '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="object-fields">Order, position, alert and marker fields</h2>
      <p>
        Invalid objects are dropped from <code>set…</code> calls (and reported through{' '}
        <code>onError</code>);
        <code>upsert…</code> throws. At most {MAX_TRADING_OBJECTS.toLocaleString('en-US')} objects
        per kind.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Object</th>
              <th>Field</th>
              <th>Type</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {OBJECT_FIELDS.map(([object, field, type, notes]) => (
              <tr key={`${object}-${field}`}>
                <td>{object}</td>
                <td>
                  <code>{field}</code>
                </td>
                <td>
                  <code>{type}</code>
                </td>
                <td>{notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="preferences">User preferences and colours</h2>
      <p>
        Symbol selector modes: {SYMBOL_SELECTOR_MODES.join(', ')}. Overlay preferences (defaults
        below) are saved with the UI preferences under <code>extensions.trading</code> and shown in
        Settings › Trading.
      </p>
      <Code
        code={JSON.stringify(DEFAULT_TRADING_PREFERENCES, null, 2)}
        language="json"
        title="DEFAULT_TRADING_PREFERENCES"
      />
      <Code
        code={JSON.stringify(DEFAULT_TRADING_COLORS, null, 2)}
        language="json"
        title="DEFAULT_TRADING_COLORS"
      />
    </>
  );
}
