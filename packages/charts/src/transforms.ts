import type { LinePoint, OhlcBar } from '@market-chart/core';
import type { PriceTick, Trade } from './types.js';
import { ChartsError, assertPositive, assertSorted, nextTime } from './types.js';

/** Heikin-Ashi candles. */
export function heikinAshi(bars: readonly OhlcBar[]): OhlcBar[] {
  const out: OhlcBar[] = [];
  let prevOpen = Number.NaN;
  let prevClose = Number.NaN;
  for (const b of bars) {
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = Number.isNaN(prevOpen) ? (b.open + b.close) / 2 : (prevOpen + prevClose) / 2;
    out.push({
      time: b.time,
      open,
      high: Math.max(b.high, open, close),
      low: Math.min(b.low, open, close),
      close,
      ...(b.volume !== undefined ? { volume: b.volume } : {}),
    });
    prevOpen = open;
    prevClose = close;
  }
  return out;
}

/** Average true range (Wilder) of the last bar, used for ATR-based box sizes. */
export function averageTrueRange(bars: readonly OhlcBar[], length = 14): number {
  if (bars.length < 2) return bars.length ? bars[0]!.high - bars[0]!.low : Number.NaN;
  let atr = Number.NaN;
  let sum = 0;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]!;
    const pc = bars[i - 1]!.close;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    if (i <= length) {
      sum += tr;
      if (i === length) atr = sum / length;
    } else atr = (atr * (length - 1) + tr) / length;
  }
  return Number.isNaN(atr) ? sum / (bars.length - 1) : atr;
}

export type BoxSize = number | { readonly atr: number };

function resolveBox(bars: readonly OhlcBar[], box: BoxSize): number {
  const size = typeof box === 'number' ? box : averageTrueRange(bars, box.atr);
  assertPositive(size, 'box size');
  return size;
}

export interface RenkoOptions {
  /** Brick size in price units, or `{ atr: length }` to use the ATR of the data. */
  readonly boxSize: BoxSize;
  /** `close` uses closes; `hl` lets highs and lows form bricks. */
  readonly source?: 'close' | 'hl';
}

/**
 * Traditional Renko: a brick is added when price moves one box beyond the last brick; a reversal needs two
 * boxes. Each brick takes the time of the bar that completed it (+1 ms per extra brick of the same bar).
 */
export function renko(bars: readonly OhlcBar[], options: RenkoOptions): OhlcBar[] {
  assertSorted(bars, 'bars');
  if (!bars.length) return [];
  const box = resolveBox(bars, options.boxSize);
  const out: OhlcBar[] = [];
  let base = Math.round(bars[0]!.close / box) * box;
  let dir = 0;
  let lastTime = -Infinity;
  const brick = (time: number, open: number, close: number): void => {
    lastTime = nextTime(time, lastTime);
    out.push({
      time: lastTime,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
    });
  };
  const feed = (time: number, price: number): void => {
    // Continuation bricks.
    while (dir >= 0 && price >= base + box) {
      brick(time, base, base + box);
      base += box;
      dir = 1;
    }
    while (dir <= 0 && price <= base - box) {
      brick(time, base, base - box);
      base -= box;
      dir = -1;
    }
    // Reversals need two boxes from the last brick's close.
    if (dir > 0 && price <= base - 2 * box) {
      base -= box;
      while (price <= base - box) {
        brick(time, base, base - box);
        base -= box;
      }
      dir = -1;
    } else if (dir < 0 && price >= base + 2 * box) {
      base += box;
      while (price >= base + box) {
        brick(time, base, base + box);
        base += box;
      }
      dir = 1;
    }
  };
  for (const b of bars) {
    if (options.source === 'hl') {
      const highFirst = b.close < b.open; // assume the extreme against the close came first
      for (const p of highFirst ? [b.high, b.low] : [b.low, b.high]) feed(b.time, p);
    } else feed(b.time, b.close);
  }
  return out;
}

/**
 * Line Break (default three-line break): a new line forms when the close exceeds the previous line's
 * extreme; reversing needs a close beyond the extreme of the last `lines` lines.
 */
export function lineBreak(
  bars: readonly OhlcBar[],
  options: { readonly lines?: number } = {},
): OhlcBar[] {
  const n = options.lines ?? 3;
  if (!Number.isInteger(n) || n < 1 || n > 10)
    throw new ChartsError('lines must be an integer between 1 and 10');
  assertSorted(bars, 'bars');
  const out: OhlcBar[] = [];
  let lastTime = -Infinity;
  const push = (time: number, open: number, close: number): void => {
    lastTime = nextTime(time, lastTime);
    out.push({
      time: lastTime,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
    });
  };
  if (!bars.length) return out;
  let reference = bars[0]!.close;
  for (const b of bars.slice(1)) {
    const last = out[out.length - 1];
    if (!last) {
      if (b.close !== reference) push(b.time, reference, b.close);
      continue;
    }
    const up = last.close > last.open;
    const recent = out.slice(-n);
    const top = Math.max(...recent.map((l) => l.high));
    const bottom = Math.min(...recent.map((l) => l.low));
    if (up) {
      if (b.close > last.close) push(b.time, last.close, b.close);
      else if (b.close < bottom) push(b.time, last.open, b.close);
    } else if (b.close < last.close) push(b.time, last.close, b.close);
    else if (b.close > top) push(b.time, last.open, b.close);
    reference = b.close;
  }
  return out;
}

/**
 * Range bars from a price stream: each bar closes when its high–low range reaches `range`; the next bar opens
 * at the previous close. Exact for tick input; for OHLC input the path open → (high/low by direction) → close
 * is assumed, which is an approximation.
 */
export function rangeBars(
  input: readonly PriceTick[] | readonly OhlcBar[],
  options: { readonly range: number },
): OhlcBar[] {
  assertPositive(options.range, 'range');
  assertSorted(input, 'input');
  const ticks: PriceTick[] = [];
  for (const item of input) {
    if ('price' in item) ticks.push(item);
    else {
      const b = item as OhlcBar;
      const path =
        b.close >= b.open ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close];
      for (const p of path) ticks.push({ time: b.time, price: p, size: 0 });
    }
  }
  const out: OhlcBar[] = [];
  let lastTime = -Infinity;
  let bar: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null = null;
  const close = (): void => {
    if (!bar) return;
    lastTime = nextTime(bar.time, lastTime);
    out.push({ ...bar, time: lastTime });
  };
  const r = options.range;
  for (const t of ticks) {
    let price = t.price;
    if (!bar) bar = { time: t.time, open: price, high: price, low: price, close: price, volume: 0 };
    // A large jump fills several complete bars.
    while (price > bar.low + r || price < bar.high - r) {
      const up: boolean = price > bar.low + r;
      const edge: number = up ? bar.low + r : bar.high - r;
      bar.high = Math.max(bar.high, edge);
      bar.low = Math.min(bar.low, edge);
      bar.close = edge;
      close();
      bar = { time: t.time, open: edge, high: edge, low: edge, close: edge, volume: 0 };
    }
    bar.high = Math.max(bar.high, price);
    bar.low = Math.min(bar.low, price);
    bar.close = price;
    bar.volume += t.size ?? 0;
    price = bar.close;
  }
  if (bar) close();
  return out;
}

/** Bars of `count` trades each (the last bar may be partial). */
export function tickBars(trades: readonly Trade[], options: { readonly count: number }): OhlcBar[] {
  if (!Number.isInteger(options.count) || options.count < 1)
    throw new ChartsError('count must be a positive integer');
  assertSorted(trades, 'trades');
  const out: OhlcBar[] = [];
  let lastTime = -Infinity;
  for (let i = 0; i < trades.length; i += options.count) {
    const chunk = trades.slice(i, i + options.count);
    const first = chunk[0]!;
    lastTime = nextTime(first.time, lastTime);
    out.push({
      time: lastTime,
      open: first.price,
      high: Math.max(...chunk.map((t) => t.price)),
      low: Math.min(...chunk.map((t) => t.price)),
      close: chunk[chunk.length - 1]!.price,
      volume: chunk.reduce((s, t) => s + t.size, 0),
    });
  }
  return out;
}

/** Spread of two instruments' closes at common times: difference `a − b` or ratio `a / b`. */
export function spread(
  a: readonly (OhlcBar | LinePoint)[],
  b: readonly (OhlcBar | LinePoint)[],
  mode: 'difference' | 'ratio' = 'difference',
): LinePoint[] {
  const value = (p: OhlcBar | LinePoint): number => ('close' in p ? p.close : p.value);
  const other = new Map(b.map((p) => [p.time, value(p)]));
  const out: LinePoint[] = [];
  for (const p of a) {
    const vb = other.get(p.time);
    if (vb === undefined) continue;
    const va = value(p);
    if (mode === 'ratio') {
      if (vb !== 0) out.push({ time: p.time, value: va / vb });
    } else out.push({ time: p.time, value: va - vb });
  }
  return out;
}

export interface KagiColumn {
  readonly time: number;
  readonly start: number;
  readonly end: number;
  /** Line thickness at the start of the column. */
  readonly yangAtStart: boolean;
  /** Price where the line switches between yang (thick) and yin (thin) inside this column, if it does. */
  readonly switchPrice: number | null;
}

export interface KagiOptions {
  /** Reversal amount in price units, or a fraction of price with `mode: 'percent'` (e.g. 0.02 = 2 %). */
  readonly reversal: BoxSize;
  readonly mode?: 'absolute' | 'percent';
}

/**
 * Kagi columns from closes. A new column starts when price reverses by the reversal amount. The line becomes
 * yang (thick) when it rises above the previous shoulder (prior column high) and yin (thin) when it falls
 * below the previous waist (prior column low).
 */
export function kagi(bars: readonly OhlcBar[], options: KagiOptions): KagiColumn[] {
  assertSorted(bars, 'bars');
  if (bars.length === 0) return [];
  const fixed = options.mode === 'percent' ? null : resolveBox(bars, options.reversal);
  const percent = options.mode === 'percent' ? (options.reversal as number) : 0;
  if (options.mode === 'percent') assertPositive(percent, 'reversal');
  const amount = (price: number): number => fixed ?? price * percent;
  type Mutable = {
    time: number;
    start: number;
    end: number;
    yangAtStart: boolean;
    switchPrice: number | null;
  };
  const columns: Mutable[] = [];
  const anchor = bars[0]!.close;
  const anchorTime = bars[0]!.time;
  let yang = true;
  let shoulder = Number.NaN; // last up-column top
  let waist = Number.NaN; // last down-column bottom
  for (const b of bars.slice(1)) {
    const price = b.close;
    const current = columns[columns.length - 1];
    if (!current) {
      if (Math.abs(price - anchor) >= amount(anchor)) {
        yang = price > anchor;
        columns.push({
          time: anchorTime,
          start: anchor,
          end: price,
          yangAtStart: yang,
          switchPrice: null,
        });
      }
      continue;
    }
    const up = current.end > current.start;
    const extend = up ? price > current.end : price < current.end;
    const reverse = up
      ? current.end - price >= amount(current.end)
      : price - current.end >= amount(current.end);
    if (extend) current.end = price;
    else if (reverse) {
      if (up) shoulder = current.end;
      else waist = current.end;
      columns.push({
        time: b.time,
        start: current.end,
        end: price,
        yangAtStart: yang,
        switchPrice: null,
      });
    } else continue;
    // Thickness changes when the moving column breaks the previous shoulder / waist.
    const column = columns[columns.length - 1]!;
    const goingUp = column.end > column.start;
    if (goingUp && !yang && Number.isFinite(shoulder) && column.end > shoulder) {
      yang = true;
      column.switchPrice = shoulder;
    } else if (!goingUp && yang && Number.isFinite(waist) && column.end < waist) {
      yang = false;
      column.switchPrice = waist;
    }
  }
  let lastTime = -Infinity;
  return columns.map((c) => {
    lastTime = nextTime(c.time, lastTime);
    return { ...c, time: lastTime };
  });
}

export interface PointFigureColumn {
  readonly time: number;
  readonly direction: 'X' | 'O';
  /** Lowest and highest box prices of the column (box bottoms/tops). */
  readonly low: number;
  readonly high: number;
  readonly boxSize: number;
}

export interface PointFigureOptions {
  readonly boxSize: BoxSize;
  /** Boxes needed to reverse (default 3). */
  readonly reversal?: number;
  readonly source?: 'close' | 'hl';
}

/** Point & Figure columns. X columns rise box by box; a reversal needs `reversal` boxes. */
export function pointAndFigure(
  bars: readonly OhlcBar[],
  options: PointFigureOptions,
): PointFigureColumn[] {
  assertSorted(bars, 'bars');
  if (!bars.length) return [];
  const box = resolveBox(bars, options.boxSize);
  const reversal = options.reversal ?? 3;
  if (!Number.isInteger(reversal) || reversal < 1)
    throw new ChartsError('reversal must be a positive integer');
  const snapDown = (p: number): number => Math.floor(p / box + 1e-9) * box;
  const snapUp = (p: number): number => Math.ceil(p / box - 1e-9) * box;
  type Mutable = { time: number; direction: 'X' | 'O'; low: number; high: number };
  const columns: Mutable[] = [];
  const reference = snapDown(bars[0]!.close);
  const feed = (time: number, high: number, low: number): void => {
    const col = columns[columns.length - 1];
    if (!col) {
      if (snapDown(high) >= reference + box)
        columns.push({ time, direction: 'X', low: reference + box, high: snapDown(high) });
      else if (snapUp(low) <= reference - box)
        columns.push({ time, direction: 'O', low: snapUp(low), high: reference - box });
      return;
    }
    if (col.direction === 'X') {
      if (snapDown(high) > col.high) col.high = snapDown(high);
      else if (snapUp(low) <= col.high - reversal * box)
        columns.push({ time, direction: 'O', low: snapUp(low), high: col.high - box });
    } else if (snapUp(low) < col.low) col.low = snapUp(low);
    else if (snapDown(high) >= col.low + reversal * box)
      columns.push({ time, direction: 'X', low: col.low + box, high: snapDown(high) });
  };
  for (const b of bars) {
    if (options.source === 'hl') feed(b.time, b.high, b.low);
    else feed(b.time, b.close, b.close);
  }
  let lastTime = -Infinity;
  return columns.map((c) => {
    lastTime = nextTime(c.time, lastTime);
    return { ...c, time: lastTime, boxSize: box };
  });
}
