export interface AxisLabel {
  /** Desired centre y (CSS px, pane-relative). */
  readonly y: number;
  readonly text: string;
  readonly background: string;
  readonly color: string;
}

export interface PlacedLabel extends AxisLabel {
  /** Final top edge after collision resolution. */
  readonly top: number;
}

/**
 * Places labels of equal `height` inside [0, limit] without overlaps, keeping each as close as possible
 * to its desired centre `y`: labels are sorted, pushed down past their predecessor, then the stack is pushed
 * back up if it overflows the bottom. O(n log n).
 *
 * Generic over the label type, so plugins can stack their own labels (order and alert labels, for example)
 * exactly like the engine stacks its axis labels. The input is not modified; each result is a copy of its
 * label with `top` added.
 */
export function layoutLabels<T extends { readonly y: number }>(
  labels: readonly T[],
  height: number,
  limit: number,
  gap = 1,
): (T & { readonly top: number })[] {
  if (labels.length === 0) return [];
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  const tops = sorted.map((l) => l.y - height / 2);
  for (let i = 1; i < tops.length; i++) tops[i] = Math.max(tops[i]!, tops[i - 1]! + height + gap);
  const overflow = tops[tops.length - 1]! + height - limit;
  if (overflow > 0) {
    tops[tops.length - 1]! -= overflow;
    for (let i = tops.length - 2; i >= 0; i--)
      tops[i] = Math.min(tops[i]!, tops[i + 1]! - height - gap);
  }
  return sorted.map((label, i) => ({ ...label, top: tops[i]! }));
}
