export interface AxisLabel {
  /** Desired centre y (CSS px, pane-relative). */
  readonly y: number;
  readonly text: string;
  readonly background: string;
  readonly color: string;
  /** Kept first when labels are thinned (series last values 1, price lines their `axisLabelPriority`). */
  readonly priority?: number;
}

export interface PlacedLabel extends AxisLabel {
  /** Final top edge after collision resolution. */
  readonly top: number;
  /** How many labels this one stands for (1, or more when crowded labels were thinned). */
  readonly count: number;
}

export interface LabelLayoutOptions {
  /**
   * Thin crowded labels instead of stacking them all (default false). A run of labels closer together than
   * a label's height is stacked while it has at most `maxStack` labels; a longer run keeps one label per
   * label height (highest `priority` first) and the others are counted in the nearest kept label. Labels
   * that still do not fit into `limit` are dropped the same way, lowest priority first.
   */
  readonly thin?: boolean;
  /** Longest run of crowded labels that is stacked rather than thinned (default 4). */
  readonly maxStack?: number;
}

type Positioned = { readonly y: number; readonly priority?: number };
type Counted<T> = T & { count: number };

const priorityOf = (label: { readonly priority?: number }): number =>
  typeof label.priority === 'number' && Number.isFinite(label.priority) ? label.priority : 0;

/**
 * Keeps the labels in `order` (most important first) that are at least `step` apart; each other label is
 * counted in the nearest kept one. Returns the kept labels sorted by y.
 */
function keepSpaced<T extends Positioned>(
  order: readonly Counted<T>[],
  step: number,
  limit = Infinity,
): Counted<T>[] {
  const kept: Counted<T>[] = [];
  for (const label of order) {
    let nearest: Counted<T> | null = null;
    for (const k of kept)
      if (!nearest || Math.abs(k.y - label.y) < Math.abs(nearest.y - label.y)) nearest = k;
    if (nearest && (Math.abs(nearest.y - label.y) < step || kept.length >= limit))
      nearest.count += label.count;
    else kept.push({ ...label });
  }
  return kept.sort((a, b) => a.y - b.y);
}

/** Most important first; equal priorities keep their order (by y). */
function byPriority<T extends Positioned>(labels: readonly Counted<T>[]): Counted<T>[] {
  return labels
    .map((label, index) => ({ label, index }))
    .sort((a, b) => priorityOf(b.label) - priorityOf(a.label) || a.index - b.index)
    .map((e) => e.label);
}

function thinLabels<T extends Positioned>(
  sorted: readonly T[],
  height: number,
  limit: number,
  gap: number,
  maxStack: number,
): Counted<T>[] {
  const step = height + gap;
  const out: Counted<T>[] = [];
  let run: Counted<T>[] = [];
  const flush = (): void => {
    if (run.length <= maxStack) out.push(...run);
    else out.push(...keepSpaced(byPriority(run), step));
    run = [];
  };
  for (const label of sorted) {
    const prev = run[run.length - 1];
    if (prev && label.y - prev.y >= step) flush();
    run.push({ ...label, count: 1 });
  }
  flush();
  // Still more labels than fit: keep the most important ones, counting the others in their neighbours.
  const capacity = Math.max(1, Math.floor((limit + gap) / step));
  if (out.length <= capacity) return out;
  return keepSpaced(byPriority(out), 0, capacity);
}

/**
 * Places labels of equal `height` inside [0, limit] without overlaps, keeping each as close as possible
 * to its desired centre `y`: labels are sorted, pushed down past their predecessor, then the stack is pushed
 * back up if it overflows the bottom. O(n log n). With `thin`, crowded labels are thinned first (see
 * `LabelLayoutOptions`), so hundreds of labels in a small price range do not fill the whole axis.
 *
 * Generic over the label type, so plugins can stack their own labels (order and alert labels, for example)
 * exactly like the engine stacks its axis labels. The input is not modified; each result is a copy of its
 * label with `top` and `count` added.
 */
export function layoutLabels<T extends Positioned>(
  labels: readonly T[],
  height: number,
  limit: number,
  gap = 1,
  options: LabelLayoutOptions = {},
): (T & { readonly top: number; readonly count: number })[] {
  if (labels.length === 0) return [];
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  const placed: Counted<T>[] = options.thin
    ? thinLabels(sorted, height, limit, gap, Math.max(1, options.maxStack ?? 4))
    : sorted.map((label) => ({ ...label, count: 1 }));
  const tops = placed.map((l) => l.y - height / 2);
  for (let i = 1; i < tops.length; i++) tops[i] = Math.max(tops[i]!, tops[i - 1]! + height + gap);
  const overflow = tops[tops.length - 1]! + height - limit;
  if (overflow > 0) {
    tops[tops.length - 1]! -= overflow;
    for (let i = tops.length - 2; i >= 0; i--)
      tops[i] = Math.min(tops[i]!, tops[i + 1]! - height - gap);
  }
  // Thinned labels always fit, so the stack is also kept below the top edge.
  if (options.thin && tops[0]! < 0) {
    tops[0] = 0;
    for (let i = 1; i < tops.length; i++) tops[i] = Math.max(tops[i]!, tops[i - 1]! + height + gap);
  }
  return placed.map((label, i) => ({ ...label, top: tops[i]! }));
}
