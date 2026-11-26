import type { Unsubscribe } from '@market-chart/core';

/** Interval such as `1s`, `1m`, `5m`, `1h`, `4h`, `1D`, `1W`, `1M`. */
export type Timeframe = string;

export interface Candle {
  /** Bar open time, UTC milliseconds. */
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
}

/** A realtime candle: the forming bar (same time as the last bar), a new bar, or a correction of an older bar. */
export type CandleUpdate = Candle;

export interface TimeRange {
  /** Inclusive, UTC ms. */
  readonly from: number;
  readonly to: number;
}

export interface SymbolInfo {
  readonly symbol: string;
  readonly name?: string;
  readonly description?: string;
  readonly exchange?: string;
  readonly type?: 'crypto' | 'stock' | 'forex' | 'futures' | 'index' | 'commodity' | (string & {});
  readonly currency?: string;
  /** Decimals of prices; used for the series' price format. */
  readonly pricePrecision?: number;
  /** Smallest price increment. */
  readonly minMove?: number;
  /** IANA time zone of the exchange, informational. */
  readonly timezone?: string;
  /** `24x7` or trading hours such as `0930-1600:23456` (UTC, weekdays 1 = Monday … 7 = Sunday). */
  readonly session?: string;
  readonly timeframes?: readonly Timeframe[];
  /** Earliest available bar (UTC ms); history loading stops there. */
  readonly historyStart?: number;
  /**
   * Latest available bar (UTC ms) for data that does not reach the present (imported files, backtests,
   * delisted symbols). The first history request ends there instead of at the current time.
   */
  readonly historyEnd?: number;
}

/** The provider contract. Every method is implemented by adapters or by the application. */
export interface Datafeed {
  searchSymbols?(query: string): Promise<SymbolInfo[]>;
  resolveSymbol(symbol: string): Promise<SymbolInfo>;
  getHistoricalData(symbol: string, interval: Timeframe, range: TimeRange): Promise<Candle[]>;
  subscribe(
    symbol: string,
    interval: Timeframe,
    callback: (candle: CandleUpdate) => void,
  ): Unsubscribe;
  unsubscribe?(subscriptionId: string): void;
  /** Releases connections (optional). */
  destroy?(): void;
}

export class DatafeedError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(`[market-chart/datafeed] ${message}`);
    this.name = 'DatafeedError';
  }
}
