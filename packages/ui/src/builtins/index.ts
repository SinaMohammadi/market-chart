import type { UiActionDefinition } from '../types.js';
import { chartActions } from './chart.js';
import { axisActions, drawingActions, indicatorActions, pointActions } from './targets.js';
import { headerActions, sidebarActions } from './toolbar.js';

export { toolAction } from './toolbar.js';

/** Every built-in action. Actions needing a missing capability are hidden automatically. */
export function builtInActions(): UiActionDefinition[] {
  return [
    ...chartActions(),
    ...pointActions(),
    ...drawingActions(),
    ...indicatorActions(),
    ...axisActions(),
    ...headerActions(),
    ...sidebarActions(),
  ];
}
