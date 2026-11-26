import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';

export interface Measurement {
  readonly group: string;
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  /** Loose upper (or lower, for throughput) limit the test asserts; catches regressions, not micro-changes. */
  readonly budget?: string;
}

const results: Measurement[] = [];

export function record(m: Measurement): number {
  results.push(m);
  return m.value;
}

/** Median wall time in ms of `runs` executions (after one warm-up when `warmup` is true). */
export function timeMedian(fn: () => void, runs = 5, warmup = true): number {
  if (warmup) fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return percentile(samples, 50);
}

export function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  if (!sorted.length) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

/** Forces garbage collection (requires --expose-gc) and returns retained bytes (JS heap + typed-array buffers). */
export function retainedBytes(): number {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error('run benchmarks with --expose-gc (pnpm bench does)');
  for (let i = 0; i < 3; i++) gc();
  const usage = process.memoryUsage();
  return usage.heapUsed + usage.arrayBuffers;
}

/** Writes results as Markdown and JSON into benchmarks/results/ and returns the Markdown table. */
export function writeReport(file: string): string {
  const env = `Node ${process.version} · ${process.platform}/${process.arch} · ${cpus()[0]?.model.trim() ?? 'unknown CPU'} · ${Math.round(totalmem() / 2 ** 30)} GB RAM`;
  const rows = results.map(
    (r) => `| ${r.group} | ${r.name} | ${format(r.value)} ${r.unit} | ${r.budget ?? ''} |`,
  );
  const markdown = [
    `Environment: ${env}. Canvas calls go to a no-op context, so frame times are the engine's CPU work`,
    '(geometry, scales, labels), not pixel rasterisation; see the playground Performance page for real canvas timings.',
    '',
    '| Group | Measurement | Result | Budget |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  // Benchmarks run from the repository root (see vitest.bench.config.ts).
  const dir = join(process.cwd(), 'benchmarks', 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${file}.md`), markdown);
  writeFileSync(
    join(dir, `${file}.json`),
    JSON.stringify({ env, date: new Date().toISOString(), results }, null, 2),
  );
  return markdown;
}

function format(value: number): string {
  if (Math.abs(value) >= 100) return Math.round(value).toLocaleString('en-US');
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
