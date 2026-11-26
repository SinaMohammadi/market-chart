/**
 * Naive, obviously-correct reference implementations used only by tests.
 * They recompute every window from scratch (O(n·k)) and share no code with the engine.
 */
import type { Bar } from '../types.js';

const N = Number.NaN;

export function refSma(xs: readonly number[], n: number): number[] {
  return xs.map((_, i) =>
    i < n - 1 ? N : xs.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n,
  );
}

/** EMA seeded with the SMA of the first n values (first finite run only). */
export function refEma(xs: readonly number[], n: number, alpha = 2 / (n + 1)): number[] {
  const out: number[] = [];
  let value = N;
  let seen: number[] = [];
  for (const x of xs) {
    if (!Number.isFinite(x)) {
      out.push(N);
      continue;
    }
    if (Number.isNaN(value)) {
      seen.push(x);
      if (seen.length === n) {
        value = seen.reduce((a, b) => a + b, 0) / n;
        seen = [];
      }
      out.push(value);
      continue;
    }
    value = alpha * x + (1 - alpha) * value;
    out.push(value);
  }
  return out;
}

export const refRma = (xs: readonly number[], n: number): number[] => refEma(xs, n, 1 / n);

export function refWma(xs: readonly number[], n: number): number[] {
  const denom = (n * (n + 1)) / 2;
  return xs.map((_, i) => {
    if (i < n - 1) return N;
    let total = 0;
    for (let k = 0; k < n; k++) total += xs[i - n + 1 + k]! * (k + 1);
    return total / denom;
  });
}

export function refStdev(xs: readonly number[], n: number): number[] {
  return xs.map((_, i) => {
    if (i < n - 1) return N;
    const w = xs.slice(i - n + 1, i + 1);
    const mean = w.reduce((a, b) => a + b, 0) / n;
    return Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  });
}

export function refHighest(xs: readonly number[], n: number): number[] {
  return xs.map((_, i) => (i < n - 1 ? N : Math.max(...xs.slice(i - n + 1, i + 1))));
}

export function refLowest(xs: readonly number[], n: number): number[] {
  return xs.map((_, i) => (i < n - 1 ? N : Math.min(...xs.slice(i - n + 1, i + 1))));
}

export function refRsi(xs: readonly number[], n: number): number[] {
  const gains = [N];
  const losses = [N];
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i]! - xs[i - 1]!;
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  const g = refRma(gains, n);
  const l = refRma(losses, n);
  return xs.map((_, i) => {
    const up = g[i]!;
    const down = l[i]!;
    if (!Number.isFinite(up) || !Number.isFinite(down)) return N;
    if (down === 0) return 100;
    if (up === 0) return 0;
    return 100 - 100 / (1 + up / down);
  });
}

export function refTrueRange(bars: readonly Bar[]): number[] {
  return bars.map((b, i) =>
    i === 0
      ? b.high - b.low
      : Math.max(
          b.high - b.low,
          Math.abs(b.high - bars[i - 1]!.close),
          Math.abs(b.low - bars[i - 1]!.close),
        ),
  );
}

export function refCci(xs: readonly number[], n: number): number[] {
  const ma = refSma(xs, n);
  return xs.map((x, i) => {
    if (i < n - 1) return N;
    const w = xs.slice(i - n + 1, i + 1);
    const dev = w.reduce((a, b) => a + Math.abs(b - ma[i]!), 0) / n;
    return dev > 0 ? (x - ma[i]!) / (0.015 * dev) : N;
  });
}

export function refObv(bars: readonly Bar[]): number[] {
  let total = 0;
  return bars.map((b, i) => {
    if (i > 0) total += Math.sign(b.close - bars[i - 1]!.close) * b.volume;
    return total;
  });
}

export function refMfi(bars: readonly Bar[], n: number): number[] {
  const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
  return bars.map((_, i) => {
    if (i < n) return N;
    let up = 0;
    let down = 0;
    for (let k = i - n + 1; k <= i; k++) {
      const flow = tp[k]! * bars[k]!.volume;
      if (tp[k]! > tp[k - 1]!) up += flow;
      else if (tp[k]! < tp[k - 1]!) down += flow;
    }
    return down === 0 ? 100 : 100 - 100 / (1 + up / down);
  });
}

export function refCmf(bars: readonly Bar[], n: number): number[] {
  const mfv = bars.map((b) =>
    b.high === b.low ? 0 : ((2 * b.close - b.low - b.high) / (b.high - b.low)) * b.volume,
  );
  return bars.map((_, i) => {
    if (i < n - 1) return N;
    let f = 0;
    let v = 0;
    for (let k = i - n + 1; k <= i; k++) {
      f += mfv[k]!;
      v += bars[k]!.volume;
    }
    return v > 0 ? f / v : N;
  });
}

export function refSessionVwap(bars: readonly Bar[]): number[] {
  let day = Number.NaN;
  let pv = 0;
  let v = 0;
  return bars.map((b) => {
    const d = Math.floor(b.time / 86_400_000);
    if (d !== day) {
      day = d;
      pv = 0;
      v = 0;
    }
    const p = (b.high + b.low + b.close) / 3;
    pv += p * b.volume;
    v += b.volume;
    return v > 0 ? pv / v : N;
  });
}

export function refAroonUp(bars: readonly Bar[], n: number): number[] {
  return bars.map((_, i) => {
    if (i < n) return N;
    let best = -Infinity;
    let since = 0;
    for (let k = i - n; k <= i; k++) {
      if (bars[k]!.high >= best) {
        best = bars[k]!.high;
        since = i - k;
      }
    }
    return (100 * (n - since)) / n;
  });
}

export function refWilliamsR(bars: readonly Bar[], n: number): number[] {
  const hh = refHighest(
    bars.map((b) => b.high),
    n,
  );
  const ll = refLowest(
    bars.map((b) => b.low),
    n,
  );
  return bars.map((b, i) => (hh[i]! > ll[i]! ? (100 * (b.close - hh[i]!)) / (hh[i]! - ll[i]!) : N));
}

/** Relative closeness that tolerates floating-point noise and treats NaN == NaN. */
export function close(a: number, b: number, tolerance = 1e-8): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Index of the first mismatch between two series, or -1. */
export function firstMismatch(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  tolerance = 1e-8,
): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (!close(a[i] ?? N, b[i] ?? N, tolerance)) return i;
  return -1;
}
