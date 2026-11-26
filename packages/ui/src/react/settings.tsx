import { Suspense, lazy, useState } from 'react';
import type { ChartUi } from '../chart-ui.js';
import { Dialog } from './dialog.js';
import { useThemeName, useUiVersion } from './hooks.js';
import type { SettingsCategory } from './settings-panel.js';

// The settings UI is the largest part of the interface and rarely opened: load it on demand.
const SettingsPanel = lazy(() => import('./settings-panel.js'));
const SettingsFooter = lazy(() =>
  import('./settings-panel.js').then((m) => ({ default: m.SettingsFooter })),
);

export interface ChartSettingsProps {
  readonly ui: ChartUi | null;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly category?: SettingsCategory | (string & {});
}

/**
 * Settings dialog: general, appearance, header, sidebar, context menu, language and keyboard shortcuts, with
 * restore defaults and export/import. Changes apply immediately and are saved through the preferences store.
 */
export function ChartSettings({
  ui,
  open,
  onClose,
  category: initial = 'general',
}: ChartSettingsProps) {
  useUiVersion(ui);
  const theme = useThemeName(ui);
  const [category, setCategory] = useState<SettingsCategory | (string & {})>(initial);
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setCategory(initial);
  }
  if (!ui) return null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={ui.i18n.t('settings.title')}
      direction={ui.direction}
      lang={ui.i18n.locale}
      theme={theme}
      closeLabel={ui.i18n.t('common.close')}
      footer={
        <Suspense fallback={null}>
          <SettingsFooter ui={ui} />
        </Suspense>
      }
    >
      <Suspense fallback={<div className="mc-ui-panel" aria-busy="true" />}>
        <SettingsPanel ui={ui} category={category} onCategory={setCategory} />
      </Suspense>
    </Dialog>
  );
}
