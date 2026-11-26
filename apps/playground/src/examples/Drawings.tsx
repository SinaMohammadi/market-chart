import { useEffect, useState } from 'react';
import { CandlestickSeries, Chart } from '@market-chart/react';
import type { ChartApi } from '@market-chart/core';
import { getDrawingManager } from '@market-chart/drawing-tools';
import type { DrawingManager, DrawingsSnapshot, MagnetMode } from '@market-chart/drawing-tools';
import { useDrawingToolbar } from '@market-chart/drawing-tools/react';
import { syntheticBars } from '../data';

const CATEGORY_LABELS: Record<string, string> = {
  lines: 'Lines',
  shapes: 'Shapes',
  annotations: 'Text',
  measure: 'Measure',
  fibonacci: 'Fibonacci',
  gann: 'Gann',
  patterns: 'Patterns',
};

/** A toolbar rendered by the app from the headless `useDrawingToolbar` state. */
function Toolbar({ chart }: { chart: ChartApi | null }) {
  const state = useDrawingToolbar(chart);
  const m = state.manager;
  if (!m) return null;
  const selected = state.selection.length > 0;
  return (
    <div className="toolbar" style={{ alignItems: 'stretch' }}>
      <button aria-pressed={state.activeTool === null} onClick={() => m.setActiveTool(null)}>
        Cursor
      </button>
      {state.groups.map((group) => {
        const active = group.tools.find((t) => t.type === state.activeTool);
        return (
          <select
            key={group.category}
            value={active?.type ?? ''}
            aria-label={CATEGORY_LABELS[group.category]}
            style={active ? { borderColor: 'var(--accent)', color: '#fff' } : undefined}
            onChange={(e) => m.setActiveTool(e.target.value || null)}
          >
            <option value="">{CATEGORY_LABELS[group.category]}</option>
            {group.tools.map((t) => (
              <option key={t.type} value={t.type}>
                {t.name}
              </option>
            ))}
          </select>
        );
      })}
      <select
        value={state.magnet}
        aria-label="Magnet"
        onChange={(e) => m.setMagnet(e.target.value as MagnetMode)}
      >
        <option value="off">Magnet: off</option>
        <option value="weak">Magnet: weak</option>
        <option value="strong">Magnet: strong</option>
      </select>
      <button disabled={!state.canUndo} onClick={() => m.undo()}>
        Undo
      </button>
      <button disabled={!state.canRedo} onClick={() => m.redo()}>
        Redo
      </button>
      <button disabled={!selected} onClick={() => m.deleteSelected()}>
        Delete
      </button>
      <button
        disabled={!selected}
        onClick={() => m.setLocked(!state.selection.every((id) => m.get(id)?.locked))}
      >
        Lock
      </button>
      <button disabled={state.selection.length < 2} onClick={() => m.group()}>
        Group
      </button>
      <button disabled={!selected} onClick={() => m.bringToFront()}>
        Front
      </button>
      <button disabled={!selected} onClick={() => m.sendToBack()}>
        Back
      </button>
    </div>
  );
}

/** Inline editor shown when a text tool asks for text (`textEdit` event). */
function TextEditor({ manager }: { manager: DrawingManager | null }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  useEffect(() => {
    if (!manager) return;
    return manager.on('textEdit', ({ id }) => {
      setEditing(id);
      setValue(manager.get(id)?.text ?? '');
    });
  }, [manager]);
  if (!manager || !editing) return null;
  const apply = () => {
    if (manager.get(editing)) manager.setText(editing, value);
    setEditing(null);
  };
  return (
    <div className="toolbar">
      <span className="desc" style={{ margin: 0 }}>
        Text:
      </span>
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
        style={{
          background: '#1b1f29',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '5px 8px',
          minWidth: 260,
        }}
      />
      <button onClick={apply}>Apply</button>
      <button onClick={() => setEditing(null)}>Cancel</button>
    </div>
  );
}

export function DrawingsExample() {
  const bars = syntheticBars('BTCUSDT', 800);
  const [chart, setChart] = useState<ChartApi | null>(null);
  const manager = chart ? getDrawingManager(chart, { magnet: 'weak' }) : null;
  const [saved, setSaved] = useState<DrawingsSnapshot | null>(null);
  const [report, setReport] = useState('');

  // A few starter drawings so the example is not empty.
  useEffect(() => {
    if (!manager || manager.list().length) return;
    const t = (i: number) => bars[bars.length - i]!.time;
    const p = (i: number) => bars[bars.length - i]!.close;
    manager.add({
      type: 'fib-retracement',
      points: [
        { time: t(90), price: p(90) },
        { time: t(40), price: p(40) },
      ],
    });
    manager.add({
      type: 'trend-line',
      points: [
        { time: t(120), price: p(120) },
        { time: t(60), price: p(60) },
      ],
      style: { lineColor: '#ff9800' },
    });
    manager.add({
      type: 'long-position',
      points: [
        { time: t(25), price: p(25) },
        { time: t(5), price: p(25) * 1.03 },
        { time: t(5), price: p(25) * 0.985 },
      ],
    });
    manager.add({
      type: 'callout',
      points: [
        { time: t(70), price: p(70) },
        { time: t(78), price: p(70) * 1.03 },
      ],
      text: 'Double-click to edit',
    });
  }, [manager, bars]);

  return (
    <>
      <Toolbar chart={chart} />
      <TextEditor manager={manager} />
      <div className="card" style={{ marginBottom: 10 }}>
        <Chart height={560} ref={setChart}>
          <CandlestickSeries data={bars} />
        </Chart>
      </div>
      <div className="toolbar">
        <button disabled={!manager} onClick={() => manager && setSaved(manager.serialize())}>
          Save drawings
        </button>
        <button
          disabled={!manager || !saved}
          onClick={() => {
            if (!manager || !saved) return;
            const result = manager.load(saved);
            setReport(
              `Loaded ${result.loaded} drawing(s)${result.errors.length ? `, skipped ${result.errors.length}` : ''}.`,
            );
          }}
        >
          Load saved
        </button>
        <button disabled={!manager} onClick={() => manager?.clear()}>
          Clear all
        </button>
        <span className="desc" style={{ margin: 0 }}>
          {report ||
            'Pick a tool, then click (or drag) on the chart. Shift-click adds to the selection; Ctrl+Z / Ctrl+Shift+Z, Ctrl+C / Ctrl+V, Delete and Esc work when the chart has focus.'}
        </span>
      </div>
    </>
  );
}
