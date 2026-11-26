/**
 * Installs a no-op Canvas 2D context for DOM environments without canvas support (e.g. jsdom),
 * so charts can be created and exercised in unit tests. Real browsers are left untouched.
 *
 * Returns a function that restores the original `getContext`.
 */
export function installCanvasMock(): () => void {
  const proto = (globalThis as { HTMLCanvasElement?: { prototype: HTMLCanvasElement } })
    .HTMLCanvasElement?.prototype;
  if (!proto) return () => undefined;
  const original = proto.getContext;
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  const isJsdom = /jsdom/i.test(
    (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? '',
  );
  proto.getContext = function getContext(
    this: HTMLCanvasElement,
    type: string,
    ...rest: unknown[]
  ) {
    let real: unknown = null;
    // jsdom has no canvas: asking it only logs a "not implemented" error, so skip straight to the fake.
    if (!isJsdom) {
      try {
        real = (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } catch {
        real = null;
      }
    }
    if (real || type !== '2d') return real;
    // One context per canvas, like real browsers (tests can then read what the chart drew).
    let context = contexts.get(this);
    if (!context) {
      context = createFakeContext(this);
      contexts.set(this, context);
    }
    return context;
  } as typeof proto.getContext;
  return () => {
    proto.getContext = original;
  };
}

/** A recording Canvas 2D stand-in: every method is a no-op, `measureText` estimates widths. */
/** Text drawn on a fake context (see `drawnTexts`). */
export interface DrawnText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly textAlign: string;
  readonly direction: string;
}

const TEXTS = Symbol.for('market-chart.fake-context.texts');

/** Texts drawn with `fillText` on a fake context since the last `clearDrawnTexts` (newest last). */
export function drawnTexts(context: CanvasRenderingContext2D): readonly DrawnText[] {
  return ((context as unknown as Record<symbol, DrawnText[]>)[TEXTS] ?? []).slice();
}

export function clearDrawnTexts(context: CanvasRenderingContext2D): void {
  const texts = (context as unknown as Record<symbol, DrawnText[]>)[TEXTS];
  if (texts) texts.length = 0;
}

export function createFakeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const texts: DrawnText[] = [];
  const state: Record<string | symbol, unknown> = {
    [TEXTS]: texts,
    direction: 'inherit',
    canvas,
    font: '10px sans-serif',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  const methods: Record<string, (...args: never[]) => unknown> = {
    measureText: (text: string) => ({ width: String(text).length * 6 }) as TextMetrics,
    fillText: (text: string, x: number, y: number) => {
      // Bounded, so long-running tests and benchmarks do not accumulate memory.
      if (texts.length > 5000) texts.splice(0, 2500);
      texts.push({
        text: String(text),
        x,
        y,
        textAlign: String(state['textAlign']),
        direction: String(state['direction']),
      });
    },
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    getLineDash: () => [],
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'string' && key in methods) return methods[key];
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
