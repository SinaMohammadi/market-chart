/** Logical layers of a chart. `main` holds data, `overlay` holds cheap, frequently changing content. */
export type SurfaceLayer = 'main' | 'overlay';

/**
 * A drawable surface produced by a render backend. Sizes are CSS pixels; `pixelRatio`
 * is the device pixel ratio used for the backing store.
 */
export interface RenderSurface {
  readonly element: HTMLElement;
  readonly pixelRatio: number;
  readonly bitmapWidth: number;
  readonly bitmapHeight: number;
  resize(width: number, height: number, pixelRatio: number): void;
  destroy(): void;
}

export interface Canvas2DSurface extends RenderSurface {
  readonly context: CanvasRenderingContext2D;
}

/**
 * Factory for surfaces. Backends are replaceable; Canvas 2D is the reference implementation.
 * Painters are registered per backend id, so a WebGL backend can ship its own painters without
 * changing the public API.
 */
export interface RenderBackend<S extends RenderSurface = RenderSurface> {
  readonly id: string;
  createSurface(container: HTMLElement, layer: SurfaceLayer): S;
}
