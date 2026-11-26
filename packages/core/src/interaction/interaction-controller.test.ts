import { describe, expect, it, vi } from 'vitest';
import { defaultChartOptions } from '../options/chart-options.js';
import type { InteractionOptions } from '../options/chart-options.js';
import { InteractionController } from './interaction-controller.js';
import type { ChartInputHandler } from './input-handler.js';
import type {
  HitResult,
  InteractionEnvironment,
  InteractionHost,
} from './interaction-controller.js';

/** Minimal element: an EventTarget with the few DOM members the controller uses. Works in Node. */
function fakeElement(): HTMLElement {
  const target = new EventTarget() as EventTarget & Record<string, unknown>;
  Object.assign(target, {
    style: { cursor: '' },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 300,
      width: 500,
      height: 300,
    }),
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    hasPointerCapture: () => false,
  });
  return target as unknown as HTMLElement;
}

function fakeEnv() {
  let time = 0;
  const timers: { at: number; cb: () => void; id: number }[] = [];
  const frames: { cb: () => void; id: number }[] = [];
  let ids = 0;
  const env: InteractionEnvironment = {
    now: () => time,
    setTimeout: (cb, ms) => {
      const id = ++ids;
      timers.push({ at: time + ms, cb, id });
      return id;
    },
    clearTimeout: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    requestFrame: (cb) => {
      const id = ++ids;
      frames.push({ cb, id });
      return id;
    },
    cancelFrame: (h) => {
      const i = frames.findIndex((f) => f.id === h);
      if (i >= 0) frames.splice(i, 1);
    },
  };
  return {
    env,
    advance(ms: number) {
      time += ms;
      for (const t of timers.filter((t) => t.at <= time)) {
        timers.splice(timers.indexOf(t), 1);
        t.cb();
      }
    },
    /** Runs animation frames, 16 ms apart, until none are pending (or `max`). */
    runFrames(max = 1000) {
      let n = 0;
      while (frames.length && n++ < max) {
        time += 16;
        frames.shift()!.cb();
      }
      return n;
    },
  };
}

function fakeHost(
  hit: (x: number, y: number) => HitResult,
  options: Partial<InteractionOptions> = {},
  handlers: ChartInputHandler[] = [],
) {
  const host = {
    inputHandlers: () => handlers,
    describePoint: (x: number, y: number) => ({
      region: hit(x, y).region,
      pane: 0,
      paneX: x,
      paneY: y,
    }),
    hitTest: vi.fn(hit),
    interactionOptions: () => ({ ...defaultChartOptions.interaction, ...options }),
    scrollTime: vi.fn(),
    zoomTime: vi.fn(),
    scaleTimeFromRight: vi.fn(),
    zoomTimeCentre: vi.fn(),
    scrollBars: vi.fn(),
    scrollToStart: vi.fn(),
    scrollToEnd: vi.fn(),
    resetTime: vi.fn(),
    scalePrice: vi.fn(),
    panPrice: vi.fn(() => false),
    resetPrice: vi.fn(),
    resizePane: vi.fn(),
    setCrosshair: vi.fn(),
    clearCrosshair: vi.fn(),
    click: vi.fn(),
  };
  return host as typeof host & InteractionHost;
}

function pointer(
  type: string,
  init: { x: number; y: number; id?: number; pointerType?: string },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    clientX: init.x,
    clientY: init.y,
    pointerId: init.id ?? 1,
    pointerType: init.pointerType ?? 'mouse',
    button: 0,
  });
  return event;
}

function key(k: string, extra: Record<string, unknown> = {}): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, {
    key: k,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extra,
  });
  return event;
}

const paneHit = (): HitResult => ({ region: 'pane', pane: 0 });

describe('InteractionController', () => {
  it('pans with a mouse drag and shows the crosshair on hover', () => {
    const el = fakeElement();
    const host = fakeHost(paneHit);
    const { env } = fakeEnv();
    new InteractionController(el, host, env);
    el.dispatchEvent(pointer('pointermove', { x: 10, y: 10 }));
    expect(host.setCrosshair).toHaveBeenCalledWith(10, 10);
    el.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
    el.dispatchEvent(pointer('pointermove', { x: 130, y: 100 }));
    expect(host.scrollTime).toHaveBeenCalledWith(30);
  });

  it('emits a click for a short press without movement', () => {
    const el = fakeElement();
    const host = fakeHost(paneHit);
    const { env } = fakeEnv();
    new InteractionController(el, host, env);
    el.dispatchEvent(pointer('pointerdown', { x: 50, y: 50 }));
    el.dispatchEvent(pointer('pointerup', { x: 50, y: 50 }));
    expect(host.click).toHaveBeenCalledWith(50, 50);
  });

  it('scales the price axis on the side that was dragged', () => {
    const el = fakeElement();
    const host = fakeHost(() => ({ region: 'priceAxis', pane: 1, side: 'left' }));
    new InteractionController(el, host, fakeEnv().env);
    el.dispatchEvent(pointer('pointerdown', { x: 5, y: 100 }));
    el.dispatchEvent(pointer('pointermove', { x: 5, y: 140 }));
    expect(host.scalePrice.mock.calls[0]!.slice(0, 2)).toEqual([1, 'left']);
  });

  it('resizes panes by dragging a separator', () => {
    const el = fakeElement();
    const host = fakeHost(() => ({ region: 'separator', pane: 0 }));
    new InteractionController(el, host, fakeEnv().env);
    el.dispatchEvent(pointer('pointerdown', { x: 100, y: 200 }));
    el.dispatchEvent(pointer('pointermove', { x: 100, y: 180 }));
    expect(host.resizePane).toHaveBeenCalledWith(0, -20);
    expect(host.scrollTime).toHaveBeenCalledTimes(0);
  });

  it('ignores separator drags when pane resizing is disabled', () => {
    const el = fakeElement();
    const host = fakeHost(() => ({ region: 'separator', pane: 0 }), { paneResize: false });
    new InteractionController(el, host, fakeEnv().env);
    el.dispatchEvent(pointer('pointerdown', { x: 100, y: 200 }));
    el.dispatchEvent(pointer('pointermove', { x: 100, y: 180 }));
    expect(host.resizePane).toHaveBeenCalledTimes(0);
  });

  it('continues scrolling after a fast touch swipe and stops on its own', () => {
    const el = fakeElement();
    const host = fakeHost(paneHit);
    const clock = fakeEnv();
    new InteractionController(el, host, clock.env);
    el.dispatchEvent(pointer('pointerdown', { x: 300, y: 100, pointerType: 'touch' }));
    for (let i = 1; i <= 5; i++) {
      clock.advance(10);
      el.dispatchEvent(pointer('pointermove', { x: 300 - i * 20, y: 100, pointerType: 'touch' }));
    }
    const duringDrag = host.scrollTime.mock.calls.length;
    el.dispatchEvent(pointer('pointerup', { x: 200, y: 100, pointerType: 'touch' }));
    const frames = clock.runFrames();
    expect(frames).toBeGreaterThan(5);
    expect(frames).toBeLessThan(1000);
    expect(host.scrollTime.mock.calls.length).toBeGreaterThan(duringDrag);
    const momentum = host.scrollTime.mock.calls
      .slice(duringDrag)
      .map((c: unknown[]) => c[0] as number);
    expect(momentum.every((dx: number) => dx < 0)).toBe(true);
    expect(Math.abs(momentum[momentum.length - 1]!)).toBeLessThan(Math.abs(momentum[0]!));
  });

  it('does not fling mouse drags by default', () => {
    const el = fakeElement();
    const host = fakeHost(paneHit);
    const clock = fakeEnv();
    new InteractionController(el, host, clock.env);
    el.dispatchEvent(pointer('pointerdown', { x: 300, y: 100 }));
    for (let i = 1; i <= 5; i++) {
      clock.advance(10);
      el.dispatchEvent(pointer('pointermove', { x: 300 - i * 20, y: 100 }));
    }
    el.dispatchEvent(pointer('pointerup', { x: 200, y: 100 }));
    expect(clock.runFrames()).toBe(0);
  });

  it('shows a touch crosshair on long press and hides it on the next tap', () => {
    const el = fakeElement();
    const host = fakeHost(paneHit);
    const clock = fakeEnv();
    new InteractionController(el, host, clock.env);
    el.dispatchEvent(pointer('pointerdown', { x: 100, y: 100, pointerType: 'touch' }));
    clock.advance(500);
    expect(host.setCrosshair).toHaveBeenCalledWith(100, 100);
    el.dispatchEvent(pointer('pointermove', { x: 140, y: 120, pointerType: 'touch' }));
    expect(host.setCrosshair).toHaveBeenLastCalledWith(140, 120);
    expect(host.scrollTime).toHaveBeenCalledTimes(0);
    el.dispatchEvent(pointer('pointerup', { x: 140, y: 120, pointerType: 'touch' }));
    expect(host.clearCrosshair).toHaveBeenCalledTimes(0);
    el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10, pointerType: 'touch', id: 2 }));
    el.dispatchEvent(pointer('pointerup', { x: 10, y: 10, pointerType: 'touch', id: 2 }));
    expect(host.clearCrosshair).toHaveBeenCalledTimes(1);
  });

  it('turns a touch long press into a context-menu request when enabled', () => {
    const el = fakeElement();
    const host = Object.assign(fakeHost(paneHit, { touchContextMenu: true }), {
      contextMenu: vi.fn(() => true),
    });
    const clock = fakeEnv();
    new InteractionController(el, host, clock.env);
    el.dispatchEvent(pointer('pointerdown', { x: 120, y: 80, pointerType: 'touch' }));
    clock.advance(500);
    expect(host.contextMenu).toHaveBeenCalledTimes(1);
    expect(host.contextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ x: 120, y: 80, clientX: 120, clientY: 80, source: 'touch' }),
    );
    expect(host.setCrosshair).toHaveBeenCalledTimes(0);
    // Releasing ends the gesture without a tap or a pan.
    el.dispatchEvent(pointer('pointerup', { x: 120, y: 80, pointerType: 'touch' }));
    expect(host.click).toHaveBeenCalledTimes(0);
    expect(host.scrollTime).toHaveBeenCalledTimes(0);
  });

  it('keeps the touch crosshair when the context-menu option is off', () => {
    const el = fakeElement();
    const host = Object.assign(fakeHost(paneHit), { contextMenu: vi.fn(() => true) });
    const clock = fakeEnv();
    new InteractionController(el, host, clock.env);
    el.dispatchEvent(pointer('pointerdown', { x: 100, y: 100, pointerType: 'touch' }));
    clock.advance(500);
    expect(host.contextMenu).toHaveBeenCalledTimes(0);
    expect(host.setCrosshair).toHaveBeenCalledWith(100, 100);
  });

  it('pans instead of long-pressing when the finger moves early', () => {
    const el = fakeElement();
    const host = fakeHost(paneHit);
    const clock = fakeEnv();
    new InteractionController(el, host, clock.env);
    el.dispatchEvent(pointer('pointerdown', { x: 100, y: 100, pointerType: 'touch' }));
    el.dispatchEvent(pointer('pointermove', { x: 120, y: 100, pointerType: 'touch' }));
    el.dispatchEvent(pointer('pointermove', { x: 130, y: 100, pointerType: 'touch' }));
    clock.advance(600);
    expect(host.setCrosshair).toHaveBeenCalledTimes(0);
    expect(host.scrollTime).toHaveBeenCalledWith(10);
  });

  it('handles keyboard navigation', () => {
    const el = fakeElement();
    const host = fakeHost(paneHit);
    new InteractionController(el, host, fakeEnv().env);
    const left = key('ArrowLeft');
    el.dispatchEvent(left);
    expect(host.scrollBars).toHaveBeenCalledWith(1);
    expect(left.defaultPrevented).toBe(true);
    el.dispatchEvent(key('ArrowRight', { shiftKey: true }));
    expect(host.scrollBars).toHaveBeenLastCalledWith(-10);
    el.dispatchEvent(key('+'));
    el.dispatchEvent(key('-'));
    expect(host.zoomTimeCentre.mock.calls.map((c: unknown[]) => (c[0] as number) > 1)).toEqual([
      true,
      false,
    ]);
    el.dispatchEvent(key('Home'));
    el.dispatchEvent(key('End'));
    el.dispatchEvent(key('Escape'));
    expect(host.scrollToStart).toHaveBeenCalledTimes(1);
    expect(host.scrollToEnd).toHaveBeenCalledTimes(1);
    expect(host.clearCrosshair).toHaveBeenCalledTimes(1);
    const other = key('a');
    el.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('ignores keys when keyboard support is disabled or modifiers are held', () => {
    const el = fakeElement();
    const host = fakeHost(paneHit, { keyboard: false });
    new InteractionController(el, host, fakeEnv().env);
    el.dispatchEvent(key('ArrowLeft'));
    const host2 = fakeHost(paneHit);
    const el2 = fakeElement();
    new InteractionController(el2, host2, fakeEnv().env);
    el2.dispatchEvent(key('ArrowLeft', { ctrlKey: true }));
    expect(host.scrollBars).toHaveBeenCalledTimes(0);
    expect(host2.scrollBars).toHaveBeenCalledTimes(0);
  });

  it('lets a plugin handler capture a gesture before panning', () => {
    const el = fakeElement();
    const calls: string[] = [];
    const handler: ChartInputHandler = {
      pointerDown: (e) => {
        calls.push(`down ${e.x}`);
        return e.x < 100;
      },
      pointerMove: (e) => {
        calls.push(`move ${e.x}`);
      },
      pointerUp: (e) => {
        calls.push(`up ${e.x}`);
      },
    };
    const host = fakeHost(paneHit, {}, [handler]);
    new InteractionController(el, host, fakeEnv().env);
    el.dispatchEvent(pointer('pointerdown', { x: 50, y: 50 }));
    el.dispatchEvent(pointer('pointermove', { x: 80, y: 50 }));
    el.dispatchEvent(pointer('pointerup', { x: 80, y: 50 }));
    expect(calls).toEqual(['down 50', 'move 80', 'up 80']);
    expect(host.scrollTime).toHaveBeenCalledTimes(0);
    expect(host.click).toHaveBeenCalledTimes(0);
    // Not captured: the chart pans as usual.
    el.dispatchEvent(pointer('pointerdown', { x: 200, y: 50, id: 2 }));
    el.dispatchEvent(pointer('pointermove', { x: 230, y: 50, id: 2 }));
    expect(host.scrollTime).toHaveBeenCalledWith(30);
  });

  it('asks handlers for hover cursors and keys first', () => {
    const el = fakeElement();
    const handler: ChartInputHandler = {
      hover: (e) => (e.x < 100 ? 'pointer' : null),
      keyDown: (e) => e.key === 'Delete',
    };
    const host = fakeHost(paneHit, {}, [handler]);
    new InteractionController(el, host, fakeEnv().env);
    el.dispatchEvent(pointer('pointermove', { x: 10, y: 10 }));
    expect(el.style.cursor).toBe('pointer');
    el.dispatchEvent(pointer('pointermove', { x: 300, y: 10 }));
    expect(el.style.cursor).toBe('crosshair');
    const del = key('Delete');
    el.dispatchEvent(del);
    expect(del.defaultPrevented).toBe(true);
  });

  it('cancels a captured gesture when a second finger arrives', () => {
    const el = fakeElement();
    let cancelled = 0;
    const handler: ChartInputHandler = {
      pointerDown: () => true,
      pointerCancel: () => {
        cancelled++;
      },
    };
    new InteractionController(el, fakeHost(paneHit, {}, [handler]), fakeEnv().env);
    el.dispatchEvent(pointer('pointerdown', { x: 10, y: 10, pointerType: 'touch', id: 1 }));
    el.dispatchEvent(pointer('pointerdown', { x: 90, y: 10, pointerType: 'touch', id: 2 }));
    expect(cancelled).toBe(1);
  });

  it('removes every listener on destroy', () => {
    const el = fakeElement();
    const host = fakeHost(paneHit);
    const controller = new InteractionController(el, host, fakeEnv().env);
    controller.destroy();
    el.dispatchEvent(pointer('pointermove', { x: 10, y: 10 }));
    el.dispatchEvent(key('ArrowLeft'));
    expect(host.setCrosshair).toHaveBeenCalledTimes(0);
    expect(host.scrollBars).toHaveBeenCalledTimes(0);
  });
});
