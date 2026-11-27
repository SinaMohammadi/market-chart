import type { InteractionOptions } from '../options/chart-options.js';
import type { ChartInputHandler, ChartPointerEvent } from './input-handler.js';

export type HitRegion = 'pane' | 'priceAxis' | 'timeAxis' | 'separator' | 'none';
export type AxisSide = 'left' | 'right';

export interface HitResult {
  readonly region: HitRegion;
  /** Pane index; for `separator`, the pane above the separator. -1 when not applicable. */
  readonly pane: number;
  /** Which price axis was hit (region `priceAxis`). */
  readonly side?: AxisSide;
}

/** The narrow surface the controller needs from the chart. Keeps input handling testable and decoupled. */
export interface InteractionHost {
  /** Coordinates are CSS px relative to the chart's top-left corner. */
  hitTest(x: number, y: number): HitResult;
  interactionOptions(): InteractionOptions;
  /** Horizontal scroll in CSS px (positive reveals history). */
  scrollTime(dx: number): void;
  /** Multiplies bar spacing around chart x `anchorX`. */
  zoomTime(anchorX: number, factor: number): void;
  /** Multiplies bar spacing keeping the right edge fixed. */
  scaleTimeFromRight(factor: number): void;
  /** Zooms around the centre of the pane area. */
  zoomTimeCentre(factor: number): void;
  scrollBars(count: number): void;
  scrollToStart(): void;
  scrollToEnd(): void;
  resetTime(): void;
  /** Stretches a price scale; disables its auto-scale. */
  scalePrice(pane: number, side: AxisSide, factor: number): void;
  /** Pans the pane's manually scaled price scales. Returns true when something moved. */
  panPrice(pane: number, dy: number): boolean;
  resetPrice(pane: number, side: AxisSide): void;
  /** Moves the separator below pane `pane` by `dy` CSS px. */
  resizePane(pane: number, dy: number): void;
  setCrosshair(x: number, y: number): void;
  clearCrosshair(): void;
  click(x: number, y: number): void;
  /** Plugin input handlers, highest priority first. */
  inputHandlers(): readonly ChartInputHandler[];
  /** Pane and pane-relative coordinates of a chart point. */
  describePoint(
    x: number,
    y: number,
  ): { region: HitRegion; pane: number | null; paneX: number; paneY: number };
  /**
   * Context-menu request at chart point (x, y). Returns true when someone handles it (the browser menu is
   * then suppressed). Optional, so hosts without a context menu keep the native one.
   */
  contextMenu?(request: ContextMenuRequest): boolean;
}

/** What opened a context menu and where (chart coordinates and viewport coordinates). */
export interface ContextMenuRequest {
  readonly x: number;
  readonly y: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly source: 'mouse' | 'touch' | 'keyboard';
  readonly pointerType: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/** Timing primitives, injectable for tests. */
export interface InteractionEnvironment {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  requestFrame(callback: () => void): unknown;
  cancelFrame(handle: unknown): void;
}

export function defaultEnvironment(): InteractionEnvironment {
  const g = globalThis as {
    requestAnimationFrame?: (cb: () => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
    performance?: { now(): number };
  };
  const raf = g.requestAnimationFrame?.bind(globalThis);
  const caf = g.cancelAnimationFrame?.bind(globalThis);
  return {
    now: () => (g.performance ? g.performance.now() : Date.now()),
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    requestFrame: raf ? (cb) => raf(cb) : (cb) => setTimeout(cb, 16),
    cancelFrame: caf
      ? (h) => caf(h as number)
      : (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}

interface PointerState {
  x: number;
  y: number;
  readonly startX: number;
  readonly startY: number;
  readonly startTime: number;
  readonly type: string;
}

type DragMode =
  | { kind: 'pane'; pane: number }
  | { kind: 'priceAxis'; pane: number; side: AxisSide }
  | { kind: 'timeAxis' }
  | { kind: 'separator'; pane: number }
  | { kind: 'touchCrosshair' }
  | null;

const CLICK_TOLERANCE = 4;
const CLICK_MAX_MS = 500;
const LONG_PRESS_MS = 450;
const LONG_PRESS_TOLERANCE = 6;
/** Velocity is measured over the last part of the drag only. */
const VELOCITY_WINDOW_MS = 80;
const KINETIC_MIN_SPEED = 0.25; // px/ms
const KINETIC_STOP_SPEED = 0.02; // px/ms
const KINETIC_DECAY = 0.996; // per ms
const KEY_ZOOM = 1.2;

function wheelPixels(event: WheelEvent, delta: number): number {
  // deltaMode: 0 = pixel, 1 = line, 2 = page
  return event.deltaMode === 1 ? delta * 32 : event.deltaMode === 2 ? delta * 400 : delta;
}

/**
 * Translates pointer, wheel, touch and keyboard input into chart operations.
 * Listeners are attached exactly once and removed in `destroy()`.
 */
export class InteractionController {
  private readonly element: HTMLElement;
  private readonly host: InteractionHost;
  private readonly env: InteractionEnvironment;
  private readonly pointers = new Map<number, PointerState>();
  private drag: DragMode = null;
  private pinchDistance = 0;
  private pinchMid = { x: 0, y: 0 };
  private samples: { t: number; x: number }[] = [];
  private kineticHandle: unknown = null;
  private longPressHandle: unknown = null;
  /** A touch crosshair stays visible after the finger lifts until the next tap. */
  private stickyTouchCrosshair = false;
  /** Last hovered point (keyboard context menus open there). */
  private lastPointer: { x: number; y: number } | null = null;
  private readonly cleanups: (() => void)[] = [];
  /** Plugin handler that captured the current gesture. */
  private captured: { handler: ChartInputHandler; pointerId: number } | null = null;

  constructor(
    element: HTMLElement,
    host: InteractionHost,
    env: InteractionEnvironment = defaultEnvironment(),
  ) {
    this.element = element;
    this.host = host;
    this.env = env;
    this.listen('pointerdown', this.onPointerDown as EventListener);
    this.listen('pointermove', this.onPointerMove as EventListener);
    this.listen('pointerup', this.onPointerUp as EventListener);
    this.listen('pointercancel', this.onPointerCancel as EventListener);
    this.listen('pointerleave', this.onPointerLeave as EventListener);
    this.listen('wheel', this.onWheel as EventListener, { passive: false });
    this.listen('dblclick', this.onDoubleClick as EventListener);
    this.listen('contextmenu', this.onContextMenu as EventListener);
    this.listen('keydown', this.onKeyDown as EventListener);
  }

  destroy(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.stopKinetic();
    this.cancelLongPress();
    this.cancelCapture();
    this.pointers.clear();
    this.drag = null;
  }

  private pointerEvent(event: MouseEvent, x: number, y: number): ChartPointerEvent {
    const point = this.host.describePoint(x, y);
    return {
      x,
      y,
      region: point.region,
      pane: point.pane,
      paneX: point.paneX,
      paneY: point.paneY,
      pointerType: (event as PointerEvent).pointerType ?? 'mouse',
      button: event.button,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    };
  }

  private cancelCapture(): void {
    const captured = this.captured;
    this.captured = null;
    captured?.handler.pointerCancel?.();
  }

  private listen(type: string, handler: EventListener, options?: AddEventListenerOptions): void {
    this.element.addEventListener(type, handler, options);
    this.cleanups.push(() => this.element.removeEventListener(type, handler, options));
  }

  private local(event: MouseEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // ───────────────────────────── pointers ─────────────────────────────

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.stopKinetic();
    const { x, y } = this.local(event);
    const now = this.env.now();
    this.pointers.set(event.pointerId, {
      x,
      y,
      startX: x,
      startY: y,
      startTime: now,
      type: event.pointerType,
    });
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail for synthetic events; dragging still works while inside the element.
    }
    if (this.pointers.size === 2) {
      this.cancelLongPress();
      this.cancelCapture();
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2) return;
    if (this.pointers.size === 1) {
      const info = this.pointerEvent(event, x, y);
      for (const handler of this.host.inputHandlers()) {
        if (handler.pointerDown?.(info)) {
          this.captured = { handler, pointerId: event.pointerId };
          this.drag = null;
          this.startCapturedLongPress(event, handler);
          return;
        }
      }
    }
    const hit = this.host.hitTest(x, y);
    const options = this.host.interactionOptions();
    switch (hit.region) {
      case 'pane':
        this.drag = { kind: 'pane', pane: hit.pane };
        break;
      case 'priceAxis':
        this.drag = { kind: 'priceAxis', pane: hit.pane, side: hit.side ?? 'right' };
        break;
      case 'timeAxis':
        this.drag = { kind: 'timeAxis' };
        break;
      case 'separator':
        this.drag = options.paneResize ? { kind: 'separator', pane: hit.pane } : null;
        break;
      default:
        this.drag = null;
    }
    this.samples = [{ t: now, x }];
    const touchMenu = options.touchContextMenu && this.host.contextMenu !== undefined;
    if (
      event.pointerType === 'touch' &&
      hit.region !== 'none' &&
      hit.region !== 'separator' &&
      (touchMenu || (hit.region === 'pane' && options.touchCrosshair))
    ) {
      const rect = this.element.getBoundingClientRect();
      this.longPressHandle = this.env.setTimeout(() => {
        this.longPressHandle = null;
        const pointer = this.pointers.get(event.pointerId);
        if (!pointer || this.pointers.size !== 1) return;
        if (touchMenu) {
          this.touchMenuAt(pointer, rect);
          return;
        }
        this.drag = { kind: 'touchCrosshair' };
        this.stickyTouchCrosshair = true;
        this.host.setCrosshair(pointer.x, pointer.y);
      }, LONG_PRESS_MS);
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const { x, y } = this.local(event);
    if (event.pointerType !== 'touch') this.lastPointer = { x, y };
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) {
      // Hover (mouse/pen without buttons).
      let cursor: string | null = null;
      if (event.pointerType !== 'touch') {
        const info = this.pointerEvent(event, x, y);
        for (const handler of this.host.inputHandlers()) {
          const requested = handler.hover?.(info) ?? null;
          cursor ??= requested;
        }
      }
      if (cursor !== null) {
        if (this.element.style.cursor !== cursor) this.element.style.cursor = cursor;
      } else this.updateCursor(x, y);
      if (event.pointerType !== 'touch') this.hover(x, y);
      return;
    }
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    pointer.x = x;
    pointer.y = y;
    if (this.captured && this.captured.pointerId === event.pointerId) {
      if (
        this.longPressHandle !== null &&
        Math.hypot(x - pointer.startX, y - pointer.startY) > LONG_PRESS_TOLERANCE
      )
        this.cancelLongPress();
      this.captured.handler.pointerMove?.(this.pointerEvent(event, x, y));
      if (pointer.type === 'mouse') this.hover(x, y);
      return;
    }
    if (
      this.longPressHandle !== null &&
      Math.hypot(x - pointer.startX, y - pointer.startY) > LONG_PRESS_TOLERANCE
    ) {
      this.cancelLongPress();
    }
    if (this.pointers.size >= 2) {
      this.movePinch();
      return;
    }
    const options = this.host.interactionOptions();
    const drag = this.drag;
    if (!drag) return;
    switch (drag.kind) {
      case 'pane':
        if (this.longPressHandle !== null) return; // still deciding between pan and long-press
        if (options.dragScroll) {
          this.host.scrollTime(dx);
          this.host.panPrice(drag.pane, dy);
          this.recordSample(x);
        }
        if (pointer.type === 'mouse') this.hover(x, y);
        else if (this.stickyTouchCrosshair) {
          this.stickyTouchCrosshair = false;
          this.host.clearCrosshair();
        }
        break;
      case 'priceAxis':
        if (options.axisDragScale) this.host.scalePrice(drag.pane, drag.side, Math.exp(dy * 0.005));
        break;
      case 'timeAxis':
        if (options.axisDragScale) this.host.scaleTimeFromRight(Math.exp(dx * 0.005));
        break;
      case 'separator':
        this.host.resizePane(drag.pane, dy);
        break;
      case 'touchCrosshair':
        this.host.setCrosshair(x, y);
        break;
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.captured && this.captured.pointerId === event.pointerId) {
      const { handler } = this.captured;
      this.captured = null;
      this.cancelLongPress();
      const { x, y } = this.local(event);
      this.release(event.pointerId);
      handler.pointerUp?.(this.pointerEvent(event, x, y));
      return;
    }
    const pointer = this.pointers.get(event.pointerId);
    const drag = this.drag;
    const wasLongPress = drag?.kind === 'touchCrosshair';
    this.cancelLongPress();
    this.release(event.pointerId);
    if (!pointer) return;
    const now = this.env.now();
    const moved = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
    const isTap = moved <= CLICK_TOLERANCE && now - pointer.startTime <= CLICK_MAX_MS;
    if (this.pointers.size === 0 && isTap && !wasLongPress) {
      const hit = this.host.hitTest(pointer.x, pointer.y);
      if (pointer.type === 'touch' && this.stickyTouchCrosshair) {
        this.stickyTouchCrosshair = false;
        this.host.clearCrosshair();
      }
      if (hit.region === 'pane') this.host.click(pointer.x, pointer.y);
      return;
    }
    if (drag?.kind === 'pane' && this.pointers.size === 0)
      this.maybeStartKinetic(pointer.type, now);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.captured?.pointerId === event.pointerId) this.cancelCapture();
    this.cancelLongPress();
    this.release(event.pointerId);
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    this.lastPointer = null;
    if (event.pointerType !== 'touch' && !this.pointers.has(event.pointerId))
      this.host.clearCrosshair();
  };

  // ───────────────────────────── wheel / dblclick / keys ─────────────────────────────

  private readonly onWheel = (event: WheelEvent): void => {
    const options = this.host.interactionOptions();
    const { x, y } = this.local(event);
    const hit = this.host.hitTest(x, y);
    if (hit.region === 'none' || hit.region === 'separator') return;
    this.stopKinetic();
    const dx = wheelPixels(event, event.deltaX);
    const dy = wheelPixels(event, event.deltaY);
    if (hit.region === 'priceAxis') {
      if (!options.wheelZoom || dy === 0) return;
      event.preventDefault();
      this.host.scalePrice(hit.pane, hit.side ?? 'right', Math.exp(dy * 0.002));
      return;
    }
    const horizontal = event.shiftKey ? dy : dx;
    const vertical = event.shiftKey ? 0 : dy;
    let handled = false;
    if (options.wheelScroll && Math.abs(horizontal) > Math.abs(vertical)) {
      this.host.scrollTime(-horizontal);
      handled = true;
    } else if (options.wheelZoom && vertical !== 0) {
      // Pinch-zoom gestures on trackpads arrive as ctrl+wheel with small deltas: amplify them.
      const sensitivity = event.ctrlKey ? 0.01 : 0.002;
      this.host.zoomTime(x, Math.exp(-vertical * sensitivity));
      handled = true;
    }
    if (handled) {
      event.preventDefault();
      if (hit.region === 'pane') this.hover(x, y);
    }
  };

  private readonly onDoubleClick = (event: MouseEvent): void => {
    const { x, y } = this.local(event);
    const info = this.pointerEvent(event, x, y);
    for (const handler of this.host.inputHandlers()) {
      if (handler.doubleClick?.(info)) {
        event.preventDefault();
        return;
      }
    }
    if (!this.host.interactionOptions().axisDoubleClickReset) return;
    const hit = this.host.hitTest(x, y);
    if (hit.region === 'priceAxis') this.host.resetPrice(hit.pane, hit.side ?? 'right');
    else if (hit.region === 'timeAxis') this.host.resetTime();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    // The browser's own long-press menu on touch devices: suppress it over the chart (touch gestures are
    // handled above).
    if (this.pointers.size > 0 || this.stickyTouchCrosshair) {
      event.preventDefault();
      return;
    }
    if (!this.host.contextMenu) return;
    const { x, y } = this.local(event);
    const handled = this.host.contextMenu({
      x,
      y,
      clientX: event.clientX,
      clientY: event.clientY,
      source: 'mouse',
      pointerType: (event as PointerEvent).pointerType || 'mouse',
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
    if (handled) event.preventDefault();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const keyEvent = {
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    };
    for (const handler of this.host.inputHandlers()) {
      if (handler.keyDown?.(keyEvent)) {
        event.preventDefault();
        return;
      }
    }
    // Keyboard access to the context menu: the ContextMenu key or Shift+F10 (opens at the crosshair or the
    // centre of the main pane).
    if (
      this.host.contextMenu &&
      (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
    ) {
      const rect = this.element.getBoundingClientRect();
      const x = this.lastPointer?.x ?? rect.width / 2;
      const y = this.lastPointer?.y ?? rect.height / 3;
      const handled = this.host.contextMenu({
        x,
        y,
        clientX: rect.left + x,
        clientY: rect.top + y,
        source: 'keyboard',
        pointerType: '',
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
      if (handled) event.preventDefault();
      return;
    }
    if (!this.host.interactionOptions().keyboard || event.altKey || event.ctrlKey || event.metaKey)
      return;
    const step = event.shiftKey ? 10 : 1;
    switch (event.key) {
      case 'ArrowLeft':
        this.host.scrollBars(step);
        break;
      case 'ArrowRight':
        this.host.scrollBars(-step);
        break;
      case 'ArrowUp':
      case '+':
      case '=':
        this.host.zoomTimeCentre(KEY_ZOOM);
        break;
      case 'ArrowDown':
      case '-':
      case '_':
        this.host.zoomTimeCentre(1 / KEY_ZOOM);
        break;
      case 'Home':
        this.host.scrollToStart();
        break;
      case 'End':
        this.host.scrollToEnd();
        break;
      case 'Escape':
        this.stickyTouchCrosshair = false;
        this.host.clearCrosshair();
        break;
      default:
        return;
    }
    this.stopKinetic();
    event.preventDefault();
  };

  // ───────────────────────────── helpers ─────────────────────────────

  private hover(x: number, y: number): void {
    const hit = this.host.hitTest(x, y);
    if (hit.region === 'pane') this.host.setCrosshair(x, y);
    else this.host.clearCrosshair();
  }

  private updateCursor(x: number, y: number): void {
    const region = this.host.hitTest(x, y).region;
    const cursor =
      region === 'pane'
        ? 'crosshair'
        : region === 'priceAxis'
          ? 'ns-resize'
          : region === 'timeAxis'
            ? 'ew-resize'
            : region === 'separator' && this.host.interactionOptions().paneResize
              ? 'row-resize'
              : 'default';
    if (this.element.style.cursor !== cursor) this.element.style.cursor = cursor;
  }

  private release(pointerId: number): void {
    this.pointers.delete(pointerId);
    try {
      if (this.element.hasPointerCapture(pointerId)) this.element.releasePointerCapture(pointerId);
    } catch {
      // Ignore: capture may already be gone.
    }
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (this.pointers.size === 0) this.drag = null;
  }

  /** The gesture becomes a context-menu request at the finger: no pan, no tap on release. */
  private touchMenuAt(pointer: { x: number; y: number }, rect: DOMRect): void {
    this.drag = { kind: 'touchCrosshair' };
    this.host.contextMenu!({
      x: pointer.x,
      y: pointer.y,
      clientX: rect.left + pointer.x,
      clientY: rect.top + pointer.y,
      source: 'touch',
      pointerType: 'touch',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    });
  }

  /**
   * A touch held still on an object a plugin captured (a drawing, an order line) opens the context menu
   * when the plugin agrees (`ChartInputHandler.longPress`).
   */
  private startCapturedLongPress(event: PointerEvent, handler: ChartInputHandler): void {
    if (event.pointerType !== 'touch' || !handler.longPress) return;
    if (!this.host.interactionOptions().touchContextMenu || this.host.contextMenu === undefined)
      return;
    const rect = this.element.getBoundingClientRect();
    this.cancelLongPress();
    this.longPressHandle = this.env.setTimeout(() => {
      this.longPressHandle = null;
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer || this.pointers.size !== 1 || this.captured?.handler !== handler) return;
      let accepted = false;
      try {
        accepted = handler.longPress!(this.pointerEvent(event, pointer.x, pointer.y));
      } catch {
        accepted = false;
      }
      if (!accepted) return;
      this.cancelCapture();
      this.touchMenuAt(pointer, rect);
    }, LONG_PRESS_MS);
  }

  private cancelLongPress(): void {
    if (this.longPressHandle === null) return;
    this.env.clearTimeout(this.longPressHandle);
    this.longPressHandle = null;
  }

  private recordSample(x: number): void {
    const t = this.env.now();
    this.samples.push({ t, x });
    while (this.samples.length > 2 && t - this.samples[0]!.t > VELOCITY_WINDOW_MS)
      this.samples.shift();
  }

  private maybeStartKinetic(pointerType: string, now: number): void {
    const options = this.host.interactionOptions();
    const enabled =
      pointerType === 'touch' || pointerType === 'pen'
        ? options.kineticScroll.touch
        : options.kineticScroll.mouse;
    if (!enabled || !options.dragScroll || this.samples.length < 2) return;
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    // A pause before release means no fling.
    if (now - last.t > 50 || last.t - first.t <= 0) return;
    let velocity = (last.x - first.x) / (last.t - first.t);
    if (Math.abs(velocity) < KINETIC_MIN_SPEED) return;
    let previous = now;
    const step = (): void => {
      const t = this.env.now();
      const dt = Math.max(1, t - previous);
      previous = t;
      this.host.scrollTime(velocity * dt);
      velocity *= KINETIC_DECAY ** dt;
      this.kineticHandle =
        Math.abs(velocity) < KINETIC_STOP_SPEED ? null : this.env.requestFrame(step);
    };
    this.kineticHandle = this.env.requestFrame(step);
  }

  private stopKinetic(): void {
    if (this.kineticHandle === null) return;
    this.env.cancelFrame(this.kineticHandle);
    this.kineticHandle = null;
  }

  private pinchPoints(): [PointerState, PointerState] | null {
    const values = [...this.pointers.values()];
    return values.length >= 2 ? [values[0]!, values[1]!] : null;
  }

  private startPinch(): void {
    const points = this.pinchPoints();
    if (!points) return;
    const [a, b] = points;
    this.drag = null;
    this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private movePinch(): void {
    const points = this.pinchPoints();
    if (!points || this.pinchDistance <= 0) return;
    const [a, b] = points;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const options = this.host.interactionOptions();
    if (options.dragScroll) this.host.scrollTime(mid.x - this.pinchMid.x);
    if (options.pinchZoom && distance > 0) this.host.zoomTime(mid.x, distance / this.pinchDistance);
    this.pinchDistance = distance;
    this.pinchMid = mid;
  }
}
