import { EventEmitter, roundToTick } from '@market-chart/core';
import type { Unsubscribe } from '@market-chart/core';
import type { ChartUi } from './chart-ui.js';
import type { ChartUiFeature } from './extensions.js';
import { tickSizeOf } from './price-actions.js';
import type {
  Choice,
  OrderSide,
  OrderSubmitResult,
  OrderTicketSubmission,
  PriceContext,
  TicketField,
  TicketValues,
  TradingCapability,
} from './types.js';
import { safeText } from './util.js';

export type OrderTicketStatus = 'idle' | 'confirming' | 'submitting' | 'accepted' | 'rejected';

export interface OrderTicketState {
  readonly open: boolean;
  readonly side: OrderSide;
  readonly type: string;
  /** Field values (numbers for price/number fields). */
  readonly values: TicketValues;
  /** Raw text of number fields as typed (so "1." or "۱۲" can be edited). */
  readonly text: Readonly<Record<string, string>>;
  /** Translated validation messages by field id (shown after the first submit attempt or edit). */
  readonly errors: Readonly<Record<string, string>>;
  readonly status: OrderTicketStatus;
  /** The application's (or the error's) message for accepted/rejected, as plain text. */
  readonly message: string | null;
  readonly context: PriceContext | null;
  /** The application's simulated label, when set (shown on the ticket). */
  readonly simulated: string | null;
}

export interface OrderTicketEvents {
  change: { readonly state: OrderTicketState };
  /** After the application answered a submission. */
  result: { readonly submission: OrderTicketSubmission; readonly result: OrderSubmitResult };
}

const DEFAULT_TYPES: readonly Choice[] = [
  { value: 'limit', label: 'order.type.limit' },
  { value: 'stop', label: 'order.type.stop' },
];

const CLOSED: OrderTicketState = {
  open: false,
  side: 'buy',
  type: 'limit',
  values: {},
  text: {},
  errors: {},
  status: 'idle',
  message: null,
  context: null,
  simulated: null,
};

/** Fields used when the application declares none: side, type, price, quantity. */
export function defaultTicketFields(trading: TradingCapability): TicketField[] {
  return [
    { id: 'side', label: 'order.side', kind: 'side', required: true },
    {
      id: 'type',
      label: 'order.type',
      kind: 'select',
      options: trading.orderTypes?.length ? trading.orderTypes : DEFAULT_TYPES,
      required: true,
    },
    {
      id: 'price',
      label: 'order.price',
      kind: 'price',
      required: true,
      visible: (values) => values['type'] !== 'market',
    },
    {
      id: 'quantity',
      label: 'order.quantity',
      kind: 'number',
      required: true,
      min: 0,
      validate: (value) =>
        typeof value === 'number' && value <= 0 ? 'order.error.positive' : null,
    },
  ];
}

const DIGITS: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {};
  for (let i = 0; i < 10; i++) {
    map[String.fromCharCode(0x06f0 + i)] = String(i); // Persian
    map[String.fromCharCode(0x0660 + i)] = String(i); // Arabic-Indic
  }
  map[String.fromCharCode(0x066b)] = '.'; // Arabic decimal separator
  map[String.fromCharCode(0x066c)] = ''; // Arabic thousands separator
  map[String.fromCharCode(0x2212)] = '-'; // minus sign
  return map;
})();

/**
 * Parses a number typed in any of the supported scripts (Latin, Persian or Arabic-Indic digits, Arabic
 * decimal separator, Unicode minus). Thousands separators (",", "_", spaces) are ignored. NaN when invalid.
 */
export function parseTicketNumber(input: string | number | null | undefined): number {
  if (typeof input === 'number') return input;
  if (input === null || input === undefined) return Number.NaN;
  let text = '';
  for (const ch of String(input)) text += DIGITS[ch] ?? ch;
  text = text.replace(/[\s,_]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return Number.NaN;
  return Number(text);
}

/** Validates ticket values; returns messages (translation keys or text) by field id. */
export function validateTicket(
  fields: readonly TicketField[],
  values: TicketValues,
  tick = 0,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (field.visible && !field.visible(values)) continue;
    const value = values[field.id] ?? null;
    const empty = value === null || value === '';
    if (empty) {
      if (field.required) errors[field.id] = 'order.error.required';
      continue;
    }
    if (field.kind === 'price' || field.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors[field.id] = 'order.error.number';
        continue;
      }
      if (field.min !== undefined && value < field.min) {
        errors[field.id] = 'order.error.min';
        continue;
      }
      if (field.max !== undefined && value > field.max) {
        errors[field.id] = 'order.error.max';
        continue;
      }
      if (field.kind === 'price' && tick > 0 && roundToTick(value, tick) !== value) {
        errors[field.id] = 'order.error.tick';
        continue;
      }
    } else if (field.kind === 'side') {
      if (value !== 'buy' && value !== 'sell') {
        errors[field.id] = 'order.error.invalid';
        continue;
      }
    } else if (field.kind === 'select') {
      if (!field.options?.some((o) => o.value === value)) {
        errors[field.id] = 'order.error.invalid';
        continue;
      }
    } else if (typeof value !== 'string' || value.length > (field.maxLength ?? 200)) {
      errors[field.id] = 'order.error.invalid';
      continue;
    }
    try {
      const custom = field.validate?.(value, values);
      if (custom) errors[field.id] = custom;
    } catch {
      errors[field.id] = 'order.error.invalid';
    }
  }
  return errors;
}

/**
 * Headless order ticket: fields declared by the application, validation, the confirmation step, and one
 * `submit` call per explicit confirmation (`idle → confirming → submitting → accepted | rejected`). It never
 * retries and refuses a second submission while one is pending. The React dialog and `useOrderTicket`
 * render this state.
 */
export class OrderTicket {
  private readonly ui: ChartUi;
  private readonly emitter = new EventEmitter<OrderTicketEvents>();
  private _state: OrderTicketState = CLOSED;
  private touched = false;
  private pending: Promise<void> | null = null;
  private generation = 0;

  constructor(ui: ChartUi) {
    this.ui = ui;
  }

  get state(): OrderTicketState {
    return this._state;
  }

  /** True while the application's `submit` has not answered. */
  get submitting(): boolean {
    return this.pending !== null;
  }

  on<K extends keyof OrderTicketEvents>(
    event: K,
    listener: (payload: OrderTicketEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  trading(): TradingCapability | null {
    return this.ui.capabilities.trading ?? null;
  }

  /** The application's fields, or the defaults. */
  fields(): readonly TicketField[] {
    const trading = this.trading();
    if (!trading) return [];
    return trading.fields?.length ? trading.fields : defaultTicketFields(trading);
  }

  /** Fields shown for the current values. */
  visibleFields(): readonly TicketField[] {
    const values = this._state.values;
    return this.fields().filter((f) => !f.visible || safeVisible(f, values));
  }

  /** Whether the user is asked before sending (always, unless the application allows switching it off). */
  confirmationRequired(): boolean {
    const trading = this.trading();
    return !(trading?.allowSkipConfirmation && !this.ui.preferences.get().trade.confirmOrders);
  }

  tick(): number {
    const context = this._state.context;
    if (context) return context.tick;
    const series = this.ui.chart.series()[0];
    return series ? tickSizeOf(series) : 0;
  }

  /** Opens the ticket prefilled with side, type and the price the user pointed at. */
  open(
    input: {
      side?: OrderSide;
      type?: string;
      price?: PriceContext | null;
      values?: TicketValues;
    } = {},
  ): void {
    const trading = this.trading();
    if (!trading) return;
    this.generation++;
    this.touched = false;
    const side: OrderSide = input.side === 'sell' ? 'sell' : 'buy';
    const values: Record<string, string | number | null> = {};
    const text: Record<string, string> = {};
    const types = this.fields().find((f) => f.id === 'type')?.options ?? DEFAULT_TYPES;
    const type = types.some((t) => t.value === input.type)
      ? input.type!
      : (types[0]?.value ?? 'limit');
    for (const field of this.fields()) {
      let value: string | number | null = field.default ?? null;
      if (field.kind === 'side') value = side;
      else if (field.id === 'type') value = type;
      else if (field.kind === 'price') value = input.price?.price ?? field.default ?? null;
      else if (field.id === 'quantity') value = field.default ?? trading.defaultQuantity ?? 1;
      if (input.values && field.id in input.values) value = input.values[field.id] ?? null;
      values[field.id] = value;
      if (field.kind === 'price' || field.kind === 'number')
        text[field.id] = typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
    }
    this.set({
      ...CLOSED,
      open: true,
      side,
      type,
      values,
      text,
      context: input.price ?? null,
      simulated: trading.simulatedLabel ? safeText(trading.simulatedLabel, 60) : null,
      // A submission still pending from an earlier ticket keeps this one locked.
      status: this.pending ? 'submitting' : 'idle',
    });
  }

  close(): void {
    if (!this._state.open) return;
    this.generation++;
    this.set(CLOSED);
  }

  /** Changes a field (numbers are parsed from text in any supported digit script). */
  setValue(id: string, raw: string | number | null): void {
    const s = this._state;
    if (!s.open || s.status === 'submitting') return;
    const field = this.fields().find((f) => f.id === id);
    if (!field) return;
    const text = { ...s.text };
    let value: string | number | null;
    if (field.kind === 'price' || field.kind === 'number') {
      const typed = raw === null ? '' : String(raw);
      text[id] = typed.slice(0, 40);
      value = typed.trim() === '' ? null : parseTicketNumber(typed);
    } else if (raw === null) {
      value = null;
    } else {
      value = field.kind === 'text' ? safeText(raw, field.maxLength ?? 200) : String(raw);
    }
    const values = { ...s.values, [id]: value };
    this.touched = true;
    this.set({
      ...s,
      values,
      text,
      side: field.kind === 'side' && (value === 'buy' || value === 'sell') ? value : s.side,
      type: id === 'type' && typeof value === 'string' ? value : s.type,
      errors: this.translateErrors(validateTicket(this.fields(), values, this.tick())),
      // Editing after an answer starts a new order; a pending confirmation is withdrawn.
      status: 'idle',
      message: null,
    });
  }

  /** Steps a price or number field by its step (price fields: the tick size). */
  step(id: string, direction: 1 | -1): void {
    const field = this.fields().find((f) => f.id === id);
    const current = this._state.values[id];
    if (!field || typeof current !== 'number' || !Number.isFinite(current)) return;
    const step = field.kind === 'price' ? this.tick() || 0.01 : (field.step ?? 1);
    const next =
      field.kind === 'price'
        ? roundToTick(current + step * direction, step)
        : current + step * direction;
    this.setValue(id, Number(next.toPrecision(15)));
  }

  /** Validation messages for the current values (translated). */
  errors(): Readonly<Record<string, string>> {
    return this.translateErrors(validateTicket(this.fields(), this._state.values, this.tick()));
  }

  /**
   * The user pressed the submit button: validates, then asks for confirmation (when required) or sends.
   * Ignored while a submission is pending, and after an accepted order until something is changed.
   */
  async submit(): Promise<void> {
    const s = this._state;
    if (!s.open || this.pending || s.status === 'submitting' || s.status === 'accepted') return;
    const errors = this.errors();
    if (Object.keys(errors).length) {
      this.touched = true;
      this.set({ ...s, errors, status: 'idle' });
      return;
    }
    if (this.confirmationRequired() && s.status !== 'confirming') {
      this.set({ ...s, errors: {}, status: 'confirming', message: null });
      return;
    }
    await this.send();
  }

  /** Confirms a pending confirmation and sends. */
  async confirm(): Promise<void> {
    if (this._state.status !== 'confirming' || this.pending) return;
    await this.send();
  }

  /** Withdraws the confirmation step (back to editing). */
  cancelConfirm(): void {
    if (this._state.status === 'confirming') this.set({ ...this._state, status: 'idle' });
  }

  /** The submission the current values would make (null while invalid). */
  submission(): OrderTicketSubmission | null {
    const s = this._state;
    if (!s.open || Object.keys(this.errors()).length) return null;
    const tick = this.tick();
    const values: Record<string, string | number | null> = {};
    for (const field of this.visibleFields()) {
      const value = s.values[field.id] ?? null;
      values[field.id] =
        field.kind === 'price' && typeof value === 'number' ? roundToTick(value, tick) : value;
    }
    return {
      side: s.side,
      type: s.type,
      symbol: s.context?.symbol ?? this.symbol(),
      values,
      context: s.context,
    };
  }

  /** Whether errors should be shown (after an edit or a submit attempt). */
  showErrors(): boolean {
    return this.touched;
  }

  destroy(): void {
    this.generation++;
    this._state = CLOSED;
    this.emitter.clear();
  }

  // ───────────────────────── internals ─────────────────────────

  private symbol(): string | null {
    const caps = this.ui.capabilities;
    try {
      return caps.symbols?.value() ?? caps.symbol?.value() ?? null;
    } catch {
      return null;
    }
  }

  private async send(): Promise<void> {
    const trading = this.trading();
    const submission = this.submission();
    if (!trading || !submission) return;
    const generation = this.generation;
    this.set({ ...this._state, status: 'submitting', message: null });
    const run = async (): Promise<void> => {
      let result: OrderSubmitResult;
      try {
        const answer = (await trading.submit(submission)) as unknown;
        const raw = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>;
        result = {
          ok: raw['ok'] === true,
          ...(raw['message'] !== undefined ? { message: safeText(raw['message'], 300) } : {}),
        };
      } catch (error) {
        result = {
          ok: false,
          message: safeText(error instanceof Error ? error.message : error, 300),
        };
      }
      this.emitter.emit('result', { submission, result });
      const message =
        result.message || this.ui.i18n.t(result.ok ? 'order.accepted' : 'order.rejected');
      if (generation === this.generation && this._state.open) {
        this.set({ ...this._state, status: result.ok ? 'accepted' : 'rejected', message });
      } else {
        // The ticket was closed or reopened meanwhile: tell the user anyway.
        this.ui.notify(message, result.ok ? 'info' : 'error');
        if (this._state.open && this._state.status === 'submitting')
          this.set({ ...this._state, status: 'idle' });
      }
    };
    this.pending = run().finally(() => {
      this.pending = null;
    });
    await this.pending;
  }

  private translateErrors(errors: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    const fields = this.fields();
    for (const [id, key] of Object.entries(errors)) {
      const field = fields.find((f) => f.id === id);
      out[id] = this.ui.translate(key, {
        min: field?.min ?? '',
        max: field?.max ?? '',
        tick: this.tick(),
      });
    }
    return out;
  }

  private set(state: OrderTicketState): void {
    this._state = state;
    this.emitter.emit('change', { state });
  }
}

function safeVisible(field: TicketField, values: TicketValues): boolean {
  try {
    return field.visible!(values);
  } catch {
    return false;
  }
}

/**
 * The order-ticket feature: `createChartUi(chart, { capabilities: { trading }, features: [orderTicket()] })`.
 * Provides `ui.orderTicket` (opened by the built-in buy/sell price actions or from code) and, when the
 * application allows it, a setting to skip the confirmation step.
 */
export function orderTicket(): ChartUiFeature {
  return {
    id: 'orderTicket',
    install(ui) {
      const ticket = new OrderTicket(ui);
      const offs: Unsubscribe[] = [
        ui.provide({ orderTicket: ticket }),
        ui.settings.register({
          id: 'trading',
          label: 'trade.settings',
          order: 200,
          fields: () =>
            ui.capabilities.trading?.allowSkipConfirmation
              ? [
                  {
                    kind: 'toggle',
                    id: 'trade.confirmOrders',
                    label: 'trade.confirmOrders',
                    value: () => ui.preferences.get().trade.confirmOrders,
                    set: (confirmOrders) => ui.preferences.update({ trade: { confirmOrders } }),
                  },
                ]
              : [],
        }),
      ];
      return () => {
        for (const off of offs.splice(0).reverse()) off();
        ticket.destroy();
      };
    },
  };
}
