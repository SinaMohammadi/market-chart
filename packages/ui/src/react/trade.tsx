import { useEffect, useId, useState } from 'react';
import type { ChartUi } from '../chart-ui.js';
import type { TicketField } from '../types.js';
import { PRICE_BUTTON_GAP, PRICE_BUTTON_SIZE } from '../types.js';
import { Dialog } from './dialog.js';
import { useOrderTicket, usePriceButton } from './feature-hooks.js';
import { useThemeName } from './hooks.js';
import { Icon } from './icon.js';
import { useUiStyles } from './styles.js';

/**
 * The "+" button next to the crosshair's price label (price-actions feature). Clicking it opens the
 * price-action menu at that price. Render it inside the element that contains the chart (ChartInterface
 * does); it is positioned in chart coordinates.
 */
export function PriceActionButton({ ui }: { ui: ChartUi }) {
  useUiStyles();
  const state = usePriceButton(ui);
  const actions = ui.priceActions;
  if (!state || !actions) return null;
  const size = PRICE_BUTTON_SIZE;
  return (
    <button
      type="button"
      className="mc-ui-btn mc-ui-price-btn"
      aria-label={ui.i18n.t('price.button', { price: state.price.formatted })}
      title={ui.i18n.t('price.button', { price: state.price.formatted })}
      style={{ top: state.y, left: state.axisX - size - PRICE_BUTTON_GAP }}
      onPointerEnter={() => actions.hold(true)}
      onPointerLeave={() => actions.hold(false)}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const opened = actions.openMenu(
          ui.direction === 'rtl' ? r.right : r.left,
          r.bottom + 2,
          state.price,
          { source: e.detail === 0 ? 'keyboard' : 'mouse' },
        );
        if (opened) actions.hold(false);
      }}
    >
      <Icon name="plus" />
    </button>
  );
}

/** Delay before the confirm button reacts (protects against double-clicks on the review button). */
const CONFIRM_DELAY_MS = 400;

function FieldControl({
  ui,
  field,
  id,
  error,
}: {
  ui: ChartUi;
  field: TicketField;
  id: string;
  error: string | undefined;
}) {
  const ticket = ui.orderTicket!;
  const state = ticket.state;
  const t = ui.i18n.t.bind(ui.i18n);
  const label = ui.translate(field.label);
  const describedBy = error ? `${id}-error` : undefined;
  const disabled = state.status === 'submitting';
  if (field.kind === 'side') {
    return (
      <div className="mc-ui-ticket-sides" role="group" aria-label={label}>
        {(['buy', 'sell'] as const).map((side) => (
          <button
            key={side}
            type="button"
            className="mc-ui-btn mc-ui-side-btn"
            data-side={side}
            aria-pressed={state.values[field.id] === side}
            disabled={disabled}
            onClick={() => ticket.setValue(field.id, side)}
          >
            {t(side === 'buy' ? 'order.buy' : 'order.sell')}
          </button>
        ))}
      </div>
    );
  }
  if (field.kind === 'select') {
    return (
      <select
        id={id}
        className="mc-ui-field"
        value={String(state.values[field.id] ?? '')}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(e) => ticket.setValue(field.id, e.target.value)}
      >
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {ui.translate(o.label, o.labelValues)}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === 'text') {
    return (
      <input
        id={id}
        className="mc-ui-field"
        type="text"
        maxLength={field.maxLength ?? 200}
        value={String(state.values[field.id] ?? '')}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(e) => ticket.setValue(field.id, e.target.value)}
      />
    );
  }
  return (
    <div className="mc-ui-stepper">
      <button
        type="button"
        className="mc-ui-btn"
        aria-label={t('order.decrease', { name: label })}
        disabled={disabled}
        onClick={() => ticket.step(field.id, -1)}
      >
        −
      </button>
      <input
        id={id}
        className="mc-ui-field"
        type="text"
        inputMode="decimal"
        dir="ltr"
        autoComplete="off"
        value={state.text[field.id] ?? ''}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(e) => ticket.setValue(field.id, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            ticket.step(field.id, e.key === 'ArrowUp' ? 1 : -1);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            void ticket.submit();
          }
        }}
      />
      <button
        type="button"
        className="mc-ui-btn"
        aria-label={t('order.increase', { name: label })}
        disabled={disabled}
        onClick={() => ticket.step(field.id, 1)}
      >
        +
      </button>
    </div>
  );
}

/**
 * The default order ticket (order-ticket feature). Nothing is sent until the user confirms; the application's
 * `submit` is called once, and its message is shown as plain text.
 */
export function OrderTicketDialog({ ui }: { ui: ChartUi }) {
  useUiStyles();
  const api = useOrderTicket(ui);
  const theme = useThemeName(ui);
  const base = useId().replace(/:/g, '');
  const state = api.state;
  // The confirm button appears where the review button was: it is armed only after a moment, so a
  // double-click on "Review order" cannot send the order before the user has seen the summary.
  const [armed, setArmed] = useState(false);
  const confirming = state?.status === 'confirming';
  useEffect(() => {
    setArmed(false);
    if (!confirming) return;
    const timer = setTimeout(() => setArmed(true), CONFIRM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [confirming]);
  const t = ui.i18n.t.bind(ui.i18n);
  if (!state?.open || !api.ticket) return null;
  const ticket = api.ticket;
  const symbol =
    state.context?.symbol ?? ui.capabilities.symbols?.value() ?? ui.capabilities.symbol?.value();
  const submission = ticket.submission();
  const typeField = api.fields.find((f) => f.id === 'type');
  const typeLabel = typeField?.options?.find((o) => o.value === state.type);
  const summary = submission
    ? t('order.summary', {
        side: t(state.side === 'buy' ? 'order.buy' : 'order.sell'),
        quantity: String(submission.values['quantity'] ?? ''),
        symbol: symbol ?? '',
        type: typeLabel ? ui.translate(typeLabel.label) : state.type,
        price: String(submission.values['price'] ?? ''),
      })
    : '';
  const status = state.status;
  return (
    <Dialog
      open
      title={symbol ? `${t('order.ticket')} · ${symbol}` : t('order.ticket')}
      onClose={() => api.close()}
      direction={ui.direction}
      lang={ui.i18n.locale}
      theme={theme}
      size="ticket"
      closeLabel={t('common.close')}
      footer={
        <>
          <span className="mc-ui-grow" />
          {status === 'confirming' ? (
            <>
              <button type="button" className="mc-ui-btn" onClick={() => api.cancelConfirm()}>
                {t('order.edit')}
              </button>
              <button
                type="button"
                className="mc-ui-btn mc-ui-primary"
                aria-disabled={!armed || undefined}
                onClick={() => {
                  if (armed) api.confirm();
                }}
              >
                {t('order.confirm')}
              </button>
            </>
          ) : status === 'accepted' ? (
            <>
              <button type="button" className="mc-ui-btn" onClick={() => api.close()}>
                {t('common.close')}
              </button>
              <button
                type="button"
                className="mc-ui-btn"
                onClick={() =>
                  ticket.open({ side: state.side, type: state.type, price: state.context })
                }
              >
                {t('order.newOrder')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="mc-ui-btn" onClick={() => api.close()}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="mc-ui-btn mc-ui-primary"
                disabled={status === 'submitting'}
                aria-busy={status === 'submitting' || undefined}
                onClick={() => api.submit()}
              >
                {status === 'submitting'
                  ? t('order.submitting')
                  : api.confirmationRequired
                    ? t('order.review')
                    : t('order.place')}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="mc-ui-ticket">
        {state.simulated ? <span className="mc-ui-simulated">{state.simulated}</span> : null}
        {api.fields.map((field) => {
          const id = `${base}-${field.id}`;
          const error = api.errors[field.id];
          return (
            <div key={field.id} className="mc-ui-ticket-field">
              {field.kind === 'side' ? null : (
                <label htmlFor={id}>{ui.translate(field.label)}</label>
              )}
              <FieldControl ui={ui} field={field} id={id} error={error} />
              {error ? (
                <span id={`${id}-error`} className="mc-ui-error">
                  {error}
                </span>
              ) : null}
            </div>
          );
        })}
        <div role="status" aria-live="polite">
          {status === 'confirming' ? (
            <div className="mc-ui-ticket-status">
              <div>{t('order.confirmTitle')}</div>
              <div className="mc-ui-ticket-summary">{summary}</div>
            </div>
          ) : status === 'accepted' || status === 'rejected' ? (
            <div className="mc-ui-ticket-status" data-status={status}>
              {state.message}
            </div>
          ) : status === 'submitting' ? (
            <div className="mc-ui-ticket-status">{t('order.submitting')}</div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
