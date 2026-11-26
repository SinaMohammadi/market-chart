import { useState } from 'react';
import { builtInTools } from '@market-chart/drawing-tools';
import { en } from '@market-chart/i18n';
import { iconPath, toolIcon } from '@market-chart/ui';
import Drawings from '../demos/Drawings';

const CATEGORIES = [...new Set(builtInTools.map((t) => t.category))];
const name = (type: string, fallback: string) =>
  ((en as Record<string, unknown>)[`tool.${type}`] as string | undefined) ?? fallback;

/** Generated from `builtInTools`. Choose a tool, then click on the chart to place it. */
export default function DrawingToolsReference() {
  const [tool, setTool] = useState('fib-retracement');
  return (
    <>
      <p>
        {builtInTools.length} tools in {CATEGORIES.length} categories. Every drawing is stored as
        anchors in time and price, so it stays in place when you zoom, scroll or change the
        timeframe.
      </p>
      <div className="sticky-preview">
        <Drawings key={tool} tool={tool} />
      </div>
      {CATEGORIES.map((category) => (
        <section key={category}>
          <h2 id={category}>{category}</h2>
          <div className="tool-grid">
            {builtInTools
              .filter((t) => t.category === category)
              .map((t) => (
                <button
                  key={t.type}
                  type="button"
                  className="tool-card"
                  aria-pressed={tool === t.type}
                  onClick={() => setTool(t.type)}
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path d={iconPath(toolIcon(t.type))} />
                  </svg>
                  <span>
                    <b>{name(t.type, t.name)}</b>
                    <small>
                      <code>{t.type}</code> · {t.points} {t.points === 1 ? 'point' : 'points'}
                    </small>
                  </span>
                </button>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}
