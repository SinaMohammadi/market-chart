export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  readonly left: number;
  readonly top: number;
  /** True when the menu opens towards the reading-direction start because of lack of space. */
  readonly flippedX: boolean;
  readonly flippedY: boolean;
  /** Set when the menu is taller than the viewport and must scroll. */
  readonly maxHeight: number | null;
}

const MARGIN = 4;

/**
 * Places a menu at a point, inside the viewport. In LTR it opens to the right of the point, in RTL to the left;
 * it flips when there is no room and is clamped as a last resort. Pure function: no DOM access.
 */
export function placeMenu(
  anchor: { x: number; y: number },
  menu: Size,
  viewport: Size,
  direction: 'ltr' | 'rtl',
  margin = MARGIN,
): Placement {
  let flippedX = false;
  let left: number;
  if (direction === 'rtl') {
    left = anchor.x - menu.width;
    if (left < margin && anchor.x + menu.width <= viewport.width - margin) {
      left = anchor.x;
      flippedX = true;
    }
  } else {
    left = anchor.x;
    if (left + menu.width > viewport.width - margin && anchor.x - menu.width >= margin) {
      left = anchor.x - menu.width;
      flippedX = true;
    }
  }
  left = clamp(left, margin, viewport.width - margin - menu.width);
  const vertical = placeVertical(anchor.y, anchor.y, menu.height, viewport.height, margin);
  return {
    left,
    top: vertical.top,
    flippedX,
    flippedY: vertical.flipped,
    maxHeight: vertical.maxHeight,
  };
}

/**
 * Places a submenu next to its parent item: after it in the reading direction (right in LTR, left in RTL),
 * before it when there is no room, aligned with the item's top.
 */
export function placeSubmenu(
  item: Rect,
  menu: Size,
  viewport: Size,
  direction: 'ltr' | 'rtl',
  margin = MARGIN,
): Placement {
  const after = direction === 'rtl' ? item.left - menu.width : item.left + item.width;
  const before = direction === 'rtl' ? item.left + item.width : item.left - menu.width;
  const fitsAfter = after >= margin && after + menu.width <= viewport.width - margin;
  const fitsBefore = before >= margin && before + menu.width <= viewport.width - margin;
  const left = clamp(
    fitsAfter || !fitsBefore ? after : before,
    margin,
    viewport.width - margin - menu.width,
  );
  const vertical = placeVertical(
    item.top - 4,
    item.top + item.height + 4,
    menu.height,
    viewport.height,
    margin,
  );
  return {
    left,
    top: vertical.top,
    flippedX: !fitsAfter && fitsBefore,
    flippedY: vertical.flipped,
    maxHeight: vertical.maxHeight,
  };
}

function placeVertical(
  topAnchor: number,
  bottomAnchor: number,
  height: number,
  viewportHeight: number,
  margin: number,
) {
  const available = viewportHeight - 2 * margin;
  if (height > available) return { top: margin, flipped: false, maxHeight: available };
  let top = topAnchor;
  let flipped = false;
  if (top + height > viewportHeight - margin) {
    const up = bottomAnchor - height;
    if (up >= margin) {
      top = up;
      flipped = true;
    } else top = viewportHeight - margin - height;
  }
  return { top: Math.max(margin, top), flipped, maxHeight: null };
}

function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(value, min), max);
}
