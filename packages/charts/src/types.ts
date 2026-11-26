import type { OhlcBar } from '@market-chart/core';

/** An executed trade. `side` is the aggressor: `buy` lifted the ask, `sell` hit the bid. */
export interface Trade {
  readonly time: number;
  readonly price: number;
  readonly size: number;
  readonly side: 'buy' | 'sell';
}

/** A tick-free price observation (for range bars). */
export interface PriceTick {
  readonly time: number;
  readonly price: number;
  readonly size?: number;
}

/** Order-book snapshot: `[price, size]` levels. */
export interface OrderBookSnapshot {
  readonly time: number;
  readonly bids: readonly (readonly [number, number])[];
  readonly asks: readonly (readonly [number, number])[];
}

/** Volume traded at one price of a footprint bar. `bid` = sold into the bid, `ask` = bought at the ask. */
export interface FootprintLevel {
  readonly price: number;
  readonly bid: number;
  readonly ask: number;
}

export interface FootprintBar extends OhlcBar {
  readonly volume: number;
  /** Buy (ask) volume minus sell (bid) volume. */
  readonly delta: number;
  /** Levels sorted by price, ascending. */
  readonly levels: readonly FootprintLevel[];
}

export class ChartsError extends Error {
  constructor(message: string) {
    super(`[market-chart/charts] ${message}`);
    this.name = 'ChartsError';
  }
}

/** Returns `time`, or 1 ms after `previous` when needed to keep times strictly increasing. */
export function nextTime(time: number, previous: number): number {
  return time > previous ? time : previous + 1;
}

export function assertSorted(items: readonly { time: number }[], what: string): void {
  for (let i = 1; i < items.length; i++) {
    if (!(items[i]!.time >= items[i - 1]!.time))
      throw new ChartsError(`${what} must be sorted by time (index ${i})`);
  }
}

export function assertPositive(value: number, name: string): void {
  if (!(typeof value === 'number' && Number.isFinite(value) && value > 0))
    throw new ChartsError(`${name} must be a positive number`);
}
