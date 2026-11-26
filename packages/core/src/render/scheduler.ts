/** Bit flags describing what must be redrawn in the next frame. */
export const Invalidate = {
  None: 0,
  Overlay: 1,
  Main: 2,
  Layout: 4,
  All: 7,
} as const;

export type InvalidateMask = number;

type FrameRequest = (callback: () => void) => unknown;
type FrameCancel = (handle: unknown) => void;

function defaultRequest(): { request: FrameRequest; cancel: FrameCancel } {
  const g = globalThis as {
    requestAnimationFrame?: (cb: () => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };
  if (
    typeof g.requestAnimationFrame === 'function' &&
    typeof g.cancelAnimationFrame === 'function'
  ) {
    const raf = g.requestAnimationFrame.bind(globalThis);
    const caf = g.cancelAnimationFrame.bind(globalThis);
    return { request: (cb) => raf(cb), cancel: (handle) => caf(handle as number) };
  }
  return {
    request: (cb) => setTimeout(cb, 16),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

/** Coalesces invalidations into at most one render per animation frame. */
export class FrameScheduler {
  private mask: InvalidateMask = Invalidate.None;
  private handle: unknown = null;
  private destroyed = false;
  private readonly render: (mask: InvalidateMask) => void;
  private readonly request: FrameRequest;
  private readonly cancel: FrameCancel;

  constructor(render: (mask: InvalidateMask) => void, frame = defaultRequest()) {
    this.render = render;
    this.request = frame.request;
    this.cancel = frame.cancel;
  }

  invalidate(mask: InvalidateMask): void {
    if (this.destroyed || mask === Invalidate.None) return;
    this.mask |= mask;
    if (this.handle === null) this.handle = this.request(() => this.run());
  }

  /** Renders pending work synchronously (used by tests and screenshots). */
  flush(): void {
    if (this.handle !== null) {
      this.cancel(this.handle);
      this.handle = null;
    }
    this.run();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.handle !== null) this.cancel(this.handle);
    this.handle = null;
    this.mask = Invalidate.None;
  }

  private run(): void {
    this.handle = null;
    const mask = this.mask;
    this.mask = Invalidate.None;
    if (!this.destroyed && mask !== Invalidate.None) this.render(mask);
  }
}
