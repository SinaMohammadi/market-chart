import type { Timeline } from '../model/timeline.js';
import type { TimeScale } from '../scales/time-scale.js';
import type { TradingSession } from '../time/session.js';

/** Where the visible part of the chart is outside trading hours, and where sessions open (CSS px). */
export interface SessionMarks {
  /** Closed stretches as [left, right) x ranges. */
  readonly closed: readonly { readonly from: number; readonly to: number }[];
  /** x of a vertical line where a session opens (between the previous slot and the first open one). */
  readonly breaks: readonly number[];
}

/**
 * Session marks for the visible slots. A break goes before a slot that is open when the slot before it is
 * closed or belongs to another trading day. Linear in the visible slots; the session caches its intervals.
 */
export function sessionMarks(
  session: TradingSession,
  timeline: Timeline,
  timeScale: TimeScale,
  options: { readonly breaks: boolean; readonly closed: boolean },
): SessionMarks {
  const length = timeline.length;
  if (length === 0 || timeScale.width <= 0) return { closed: [], breaks: [] };
  const range = timeScale.visibleLogicalRange();
  const first = Math.max(0, Math.floor(range.from));
  const last = Math.min(length - 1, Math.ceil(range.to));
  const half = timeScale.barSpacing / 2;
  const times = timeline.times;
  const closed: { from: number; to: number }[] = [];
  const breaks: number[] = [];
  let runStart = -1;
  let prevOpen = first > 0 ? session.isOpen(times[first - 1]!) : false;
  let prevDay = first > 0 ? session.sessionDay(times[first - 1]!) : Number.NaN;
  for (let i = first; i <= last; i++) {
    const time = times[i]!;
    const open = session.isOpen(time);
    const day = session.sessionDay(time);
    if (options.closed) {
      if (!open && runStart < 0) runStart = i;
      if (open && runStart >= 0) {
        closed.push({
          from: timeScale.indexToX(runStart) - half,
          to: timeScale.indexToX(i) - half,
        });
        runStart = -1;
      }
    }
    if (options.breaks && open && i > 0 && (!prevOpen || day !== prevDay))
      breaks.push(timeScale.indexToX(i) - half);
    prevOpen = open;
    prevDay = day;
  }
  if (runStart >= 0)
    closed.push({ from: timeScale.indexToX(runStart) - half, to: timeScale.indexToX(last) + half });
  return { closed, breaks };
}
