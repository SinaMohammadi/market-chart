import type { LineStyle, PriceFormat } from '@market-chart/core';

/** Normalised input bar. `volume` is NaN when the source has no volume. */
export interface Bar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export type PriceSource = 'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4' | 'hlcc4';
export const PRICE_SOURCES: readonly PriceSource[] = [
  'open',
  'high',
  'low',
  'close',
  'hl2',
  'hlc3',
  'ohlc4',
  'hlcc4',
];

/** Declarative input description: drives defaults, validation and settings UIs. */
export type InputSpec =
  | {
      readonly type: 'int';
      readonly default: number;
      readonly min?: number;
      readonly max?: number;
      readonly label?: string;
    }
  | {
      readonly type: 'float';
      readonly default: number;
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
      readonly label?: string;
    }
  | { readonly type: 'source'; readonly default: PriceSource; readonly label?: string }
  | {
      readonly type: 'enum';
      readonly default: string;
      readonly options: readonly string[];
      readonly label?: string;
    }
  | { readonly type: 'bool'; readonly default: boolean; readonly label?: string }
  | { readonly type: 'time'; readonly default: number | null; readonly label?: string };

export type InputSchema = Readonly<Record<string, InputSpec>>;

export type ParamValue<S extends InputSpec> = S extends { type: 'int' | 'float' }
  ? number
  : S extends { type: 'source' }
    ? PriceSource
    : S extends { type: 'enum'; options: readonly (infer O)[] }
      ? O
      : S extends { type: 'bool' }
        ? boolean
        : S extends { type: 'time' }
          ? number | null
          : never;

/** Resolved, validated parameters for a schema. */
export type Params<S extends InputSchema> = { -readonly [K in keyof S]: ParamValue<S[K]> };

/**
 * - `line`: continuous line (whitespace where the value is NaN)
 * - `step`: step line (levels that change per period)
 * - `dots`: markers only (e.g. Parabolic SAR)
 * - `histogram`: columns from zero
 */
export type OutputKind = 'line' | 'step' | 'dots' | 'histogram';

/** How histogram columns are coloured: by sign, by change versus the previous value, or by bar direction. */
export type HistogramColorMode = 'sign' | 'change' | 'bar';

export interface OutputSpec {
  readonly id: string;
  readonly name: string;
  readonly kind: OutputKind;
  readonly color: string;
  /** Histogram colour for negative / falling / down values. */
  readonly colorNegative?: string;
  readonly colorMode?: HistogramColorMode;
  readonly lineWidth?: number;
  readonly lineStyle?: LineStyle;
  /** Hidden by default (user can enable it in the style). */
  readonly hidden?: boolean;
}

export interface LevelSpec {
  readonly value: number;
  readonly label?: string;
  readonly color?: string;
}

/** Fill between two outputs. With `colorNegative`, the colour depends on which output is on top. */
export interface FillSpec {
  readonly from: string;
  readonly to: string;
  readonly color: string;
  readonly colorNegative?: string;
}

export type IndicatorCategory = 'trend' | 'momentum' | 'volatility' | 'volume' | 'advanced';

/**
 * Incremental calculator. `next` consumes bars strictly in time order and returns one value per output
 * (NaN while not enough data). All mutable state must live in the object's own properties (no closures
 * over mutable variables) so the engine can snapshot it with a structural clone for realtime updates.
 */
export interface IndicatorCalculator {
  next(bar: Bar): ArrayLike<number>;
}

export interface IndicatorDefinition<S extends InputSchema = InputSchema> {
  /** Registry key, e.g. `'rsi'`. Lowercase letters, digits and dashes. */
  readonly type: string;
  readonly name: string;
  /** Legend prefix, e.g. `'RSI'`. */
  readonly shortName: string;
  readonly description?: string;
  readonly category: IndicatorCategory;
  /** `overlay` draws on the source series' pane and scale; `pane` gets its own pane. */
  readonly placement: 'overlay' | 'pane';
  readonly inputs: S;
  readonly outputs: readonly OutputSpec[];
  readonly levels?: readonly LevelSpec[];
  readonly fills?: readonly FillSpec[];
  /** Number format of a pane indicator's scale (defaults to 2 decimals). */
  readonly priceFormat?: PriceFormat;
  /** Requires volume in the source data. */
  readonly needsVolume?: boolean;
  create(params: Params<S>): IndicatorCalculator;
  /** Cross-field validation beyond the schema. Return an error message or null. */
  validate?(params: Params<S>): string | null;
  /** Plot offset in bars per output id (positive = into the future), e.g. Ichimoku displacement. */
  offsets?(params: Params<S>): Readonly<Record<string, number>>;
}

class StatefulCalculator<S> implements IndicatorCalculator {
  constructor(
    readonly state: S,
    private readonly step: (state: S, bar: Bar) => ArrayLike<number>,
  ) {}

  next(bar: Bar): ArrayLike<number> {
    return this.step(this.state, bar);
  }
}

/**
 * Builds a calculator from plain state and a pure step function:
 * `create: (p) => calc({ ma: new Sma(p.length) }, (s, bar) => [s.ma.next(bar.close)])`.
 * All mutable data lives in `state`, which the engine snapshots for realtime tick updates.
 */
export function calc<S extends object>(
  state: S,
  step: (state: S, bar: Bar) => ArrayLike<number>,
): IndicatorCalculator {
  return new StatefulCalculator(state, step);
}

/** Identity helper that infers parameter types from the input schema. */
export function defineIndicator<const S extends InputSchema>(
  definition: IndicatorDefinition<S>,
): IndicatorDefinition<S> {
  return definition;
}

export class IndicatorError extends Error {
  constructor(message: string) {
    super(`[market-chart/indicators] ${message}`);
    this.name = 'IndicatorError';
  }
}
