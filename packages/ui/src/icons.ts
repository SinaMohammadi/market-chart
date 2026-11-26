/**
 * Icon set used by the built-in actions: SVG path data on a 24×24 grid, stroked with `currentColor` (so icons
 * follow the theme and high-contrast modes). Applications can add or replace icons with `registerIcon`.
 */
const ICONS: Record<string, string> = {
  reset: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  indicator: 'M3 17l5-6 4 4 8-9M3 21h18',
  pencil: 'M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3',
  crosshair: 'M12 3v18M3 12h18',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4M6 8h4M14 8h4',
  candles: 'M7 4v4M7 16v4M5 8h4v8H5zM17 3v5M17 15v6M15 8h4v7h-4z',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  theme: 'M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  paste: 'M8 4h8v3H8zM6 6H5v15h14V6h-1M9 12h6M9 16h4',
  duplicate: 'M8 8h12v12H8zM4 16V4h12M14 11v6M11 14h6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 21h4',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  palette:
    'M12 21a9 9 0 1 1 9-9c0 2-2 3-4 3h-2a2 2 0 0 0-1 4 1 1 0 0 1-2 2zM7.5 11h.01M10 7h.01M15 7h.01',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off':
    'M3 3l18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c6 0 10 6 10 6a18 18 0 0 1-3 3.4M6.5 7.5C3.8 9.3 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.5-1.1',
  front: 'M8 8h12v12H8zM4 4h10v3M4 4v10h3',
  back: 'M4 4h12v12H4zM20 10v10H10',
  group: 'M4 4h7v7H4zM13 13h7v7h-7zM11 7h4v4M13 13H9V9',
  ungroup: 'M4 4h7v7H4zM13 13h7v7h-7z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  scale: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  auto: 'M4 20L12 4l8 16M7.5 13h9',
  invert: 'M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  folder: 'M3 6h6l2 2h10v11H3z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  camera: 'M4 8h4l2-3h4l2 3h4v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  cursor: 'M5 3l14 8-6 2-2 6z',
  'tool-line': 'M4 20L20 4M4 20h.01M20 4h.01',
  'tool-ray': 'M5 19L20 4M5 19a1 1 0 1 0 0 .01',
  'tool-hline': 'M3 12h18M7 12h.01',
  'tool-vline': 'M12 3v18M12 7v.01',
  arrow: 'M4 20L19 5M11 5h8v8',
  rect: 'M4 6h16v12H4z',
  circle: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  channel: 'M3 15L15 3M9 21L21 9',
  fib: 'M3 5h18M3 10h18M3 14h18M3 19h18',
  pitchfork: 'M4 20l7-8M11 12l9-6M11 12l9 2M11 12l9 8',
  gann: 'M4 20L20 4M4 20l16-8M4 20l8-16',
  pattern: 'M3 17l4-8 4 6 4-10 6 12',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  note: 'M4 4h16v12H9l-5 4z',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  'position-long': 'M4 13h16M4 13V5h16v8M4 13v6h16v-6',
  'position-short': 'M4 11h16M4 11v8h16v-8M4 11V5h16v6',
  compare: 'M4 17l5-5 4 3 7-8M4 12l5-2 4 1 7-4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  tree: 'M4 4h6v4H4zM14 10h6v4h-6zM14 18h6v4h-6zM7 8v12h7M7 12h7',
  database: 'M4 6c0-2 16-2 16 0v12c0 2-16 2-16 0zM4 6c0 2 16 2 16 0M4 12c0 2 16 2 16 0',
  chevron: 'M9 6l6 6-6 6',
  check: 'M5 12l5 5L20 7',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  collapse: 'M15 6l-6 6 6 6',
  expand: 'M9 6l6 6-6 6',
  dot: 'M12 12h.01',
};

/** Icons whose shape points in the reading direction and is mirrored in RTL. */
const DIRECTIONAL = new Set(['chevron', 'collapse', 'expand', 'undo', 'redo', 'arrow', 'note']);

/** Longest accepted path data for `registerIcon` (the built-in icons are under 200 characters). */
export const MAX_ICON_PATH_LENGTH = 8192;

export function iconPath(name: string | undefined): string {
  // Own entries only: names such as `constructor` or `__proto__` must not return Object members.
  return (
    (name && Object.prototype.hasOwnProperty.call(ICONS, name) && ICONS[name]) || ICONS['dot']!
  );
}

export function isDirectionalIcon(name: string | undefined): boolean {
  return !!name && DIRECTIONAL.has(name);
}

export function registerIcon(name: string, path: string): void {
  if (
    typeof name !== 'string' ||
    !/^[A-Za-z0-9_.-]{1,60}$/.test(name) ||
    name === '__proto__' ||
    name === 'constructor' ||
    name === 'prototype'
  )
    throw new Error(`[market-chart/ui] invalid icon name "${String(name)}"`);
  if (
    typeof path !== 'string' ||
    path.length > MAX_ICON_PATH_LENGTH ||
    !/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(path)
  ) {
    throw new Error(`[market-chart/ui] icon "${name}" must be SVG path data`);
  }
  ICONS[name] = path;
}

export function iconNames(): string[] {
  return Object.keys(ICONS);
}
