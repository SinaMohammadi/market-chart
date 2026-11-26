# @market-chart/drawing-tools

Interactive drawings for `@market-chart/core`: 35 tools with selection, dragging, handles, magnet snapping, undo/redo,
copy/paste, locking, grouping, z-order and validated JSON persistence.

```ts
import { createChart } from '@market-chart/core';
import { getDrawingManager } from '@market-chart/drawing-tools';

const chart = createChart(el);
chart.addSeries('candlestick').setData(bars);

const drawings = getDrawingManager(chart, { magnet: 'weak' });
drawings.setActiveTool('fib-retracement'); // the user clicks twice (or drags) on the chart
drawings.on('textEdit', ({ id }) => openEditor(id)); // text tools ask the app for text

// Programmatic use
const line = drawings.add({ type: 'trend-line', points: [{ time, price }, { time: t2, price: p2 }] });
drawings.update(line.id, { style: { lineColor: '#ff9800' } });
drawings.undo();

const saved = drawings.serialize(); // { version: 1, drawings: [...] }, plain JSON
drawings.load(saved, { resolveSeriesId: (stored) => mapping[stored] });
```

## How it works

- **Anchors in data space.** Each point is `{ time, price }`. Times snap to bar centres and can lie in the future;
  prices use the attached series' price scale. Drawings therefore follow scrolling, zooming, scale changes and
  realtime updates.
- **Built on the public chart API.** Input goes through a plugin input handler, which takes over a gesture before the
  chart would pan. Drawings render in pane layers: resting drawings on the main surface, the drawing being created
  or dragged on the overlay surface, so dragging repaints only the overlay.
- **Creation:** click-click for every tool, or press-drag-release for two-point tools. One-click tools (long/short
  position) are created with sensible defaults. Escape cancels.
- **Editing:**
  - Click to select, Shift+click to add to the selection.
  - Drag the body to move the drawing; drag a handle to move one anchor.
  - Locked drawings can be selected but not moved.
  - Grouped drawings are selected and moved together.
- **Keyboard** (chart focused): Delete/Backspace, Ctrl/⌘+Z, Ctrl/⌘+Shift+Z or Ctrl+Y, Ctrl/⌘+C, Ctrl/⌘+V, Esc.
- **Magnet:** `off`, `weak` (snaps to the nearest open/high/low/close within 15 px) or `strong` (always snaps).
- **History:** every change is one undo step, and a whole drag counts as one step. The stack holds up to 200 steps.
- **Persistence:** snapshots are versioned. Every drawing is validated on load (type, anchor count, finite numbers,
  style values, id format), and invalid entries are skipped and reported. A migration table is in place for future
  schema versions.

## Tools

| Category | Tools |
|---|---|
| Lines | Trend Line, Ray, Extended Line, Arrow, Horizontal Line, Horizontal Ray, Vertical Line |
| Shapes | Rectangle, Circle, Ellipse, Parallel Channel |
| Text | Text, Note, Callout, Price Label |
| Measure | Long Position, Short Position (with risk/reward), Price Range, Date Range, Date and Price Range |
| Fibonacci | Retracement, Trend-Based Extension, Fan, Channel, Time Zones, Arcs, Wedge |
| Gann | Gann Fan, Gann Box |
| Patterns | Pitchfork, Schiff Pitchfork, Regression Channel, Elliott Impulse (12345), Elliott Correction (ABC), Cyclic Lines |

Conventions:
- **Fibonacci retracement:** level 0 is at the second point and level 1 at the first.
- **Regression channel:** a least-squares fit of the source closes between its two points. The `levels` setting
  gives the standard-deviation multiples of the outer lines (default ±2σ).
- **Long/Short Position:** these are the risk/reward tools; they show the target, the stop and the R:R ratio.

## React (headless)

```tsx
import { useDrawingToolbar } from '@market-chart/drawing-tools/react';

function Toolbar() {
  const { manager, groups, activeTool, canUndo } = useDrawingToolbar(); // inside <Chart>, or pass the chart
  return <>{/* render your own buttons and call manager.setActiveTool(type), manager.undo() … */}</>;
}
```

## Custom tools

```ts
import { defineTool, createDefaultToolRegistry, DrawingManager, geometry, render } from '@market-chart/drawing-tools';

const crossLine = defineTool({
  type: 'cross-line',
  name: 'Cross Line',
  category: 'lines',
  points: 1,
  draw(ctx, d, view, state) {
    const x = view.timeToX(d.points[0].time);
    const y = view.priceToY(d.points[0].price);
    render.stroke(ctx, d.style, state);
    render.line(ctx, { x, y: 0 }, { x, y: view.height });
    render.line(ctx, { x: 0, y }, { x: view.width, y });
  },
  distance: (d, view, x, y) =>
    Math.min(Math.abs(x - view.timeToX(d.points[0].time)), Math.abs(y - view.priceToY(d.points[0].price))),
});

const manager = new DrawingManager(chart, { registry: createDefaultToolRegistry().register(crossLine) });
```

## Not included yet

- A toolbar inside this package. The ready-made sidebar, context menus and drawing-properties dialog are in
  [`@market-chart/ui`](../ui); `useDrawingToolbar` builds your own.
- Drawings shared across charts: each chart of a multi-chart layout has its own `DrawingManager` (and its own
  clipboard). To copy drawings to another chart, `serialize()` one manager and `load()` the snapshot into the other.
- Elliott triangle and combination waves, the modified Schiff pitchfork, and Gann square/fixed boxes.

## Security

`DrawingManager.load(snapshot, { maxDrawings })` loads at most `maxDrawings` drawings (default
`MAX_LOADED_DRAWINGS` = 5000) from an untrusted snapshot; the rest are reported in `errors`. Drawing text is drawn
on the canvas or shown as React text, never parsed as HTML.
