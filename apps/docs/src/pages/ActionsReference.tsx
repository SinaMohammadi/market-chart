import { useMemo, useState } from 'react';
import { createI18n } from '@market-chart/i18n';
import { builtInActions, formatShortcut } from '@market-chart/ui';
import { Code } from '../components/Code';

const i18n = createI18n();
const actions = builtInActions();
const label = (l: unknown): string =>
  typeof l === 'string' ? (i18n.has(l) ? i18n.t(l) : l) : 'dynamic';

const REGISTER = `ui.contextMenu.register({
  id: 'app.copy-close',
  label: 'Copy close',             // or a translation key
  icon: 'copy',
  targets: ['candlestick'],        // where it appears in context menus
  category: 'point',
  shortcut: 'Alt+C',
  run: (ctx) => copy(ctx.target!.point!.close),
});

ui.actions.register({ id: 'app.alerts', label: 'Alerts', icon: 'bell', locations: ['header'], section: 'right', run: openAlerts });
ui.actions.override('header.screenshot', { shortcut: 'Mod+Shift+S' });
ui.contextMenu.setHidden('point.inspect', true);`;

/** Generated from `builtInActions()`: the same registry the menus, header and sidebar read. */
export default function ActionsReference() {
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState<string>('all');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return actions.filter(
      (a) =>
        (location === 'all' || (a.locations ?? ['contextMenu']).includes(location as 'header')) &&
        (!q || `${a.id} ${label(a.label)}`.toLowerCase().includes(q)),
    );
  }, [query, location]);
  return (
    <>
      <p>
        {actions.length} built-in actions. Menus, toolbars, shortcuts and the settings dialog all
        read one registry, so an action registered once appears everywhere it is placed. Actions
        that need something your application provides (<code>requires</code>) are hidden until you
        provide it.
      </p>
      <Code code={REGISTER} language="ts" title="your own actions" />
      <div className="filters">
        <input
          type="search"
          placeholder="Filter actions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter actions"
        />
        <div className="tabs" role="tablist" aria-label="Location">
          {['all', 'contextMenu', 'header', 'sidebar'].map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              className="tab"
              aria-selected={location === l}
              onClick={() => setLocation(l)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Id</th>
              <th>Label</th>
              <th>Where</th>
              <th>Targets</th>
              <th>Shortcut</th>
              <th>Requires</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} id={a.id}>
                <td>
                  <code>{a.id}</code>
                </td>
                <td>{label(a.label)}</td>
                <td className="small">{(a.locations ?? ['contextMenu']).join(', ')}</td>
                <td className="small">{(a.targets ?? []).join(', ') || '—'}</td>
                <td>{a.shortcut ? <kbd>{formatShortcut(a.shortcut)}</kbd> : '—'}</td>
                <td className="small">{(a.requires ?? []).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
