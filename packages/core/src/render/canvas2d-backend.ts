import type { Canvas2DSurface, RenderBackend, SurfaceLayer } from './backend.js';
import { ChartError } from '../utils/errors.js';

class CanvasSurface implements Canvas2DSurface {
  readonly element: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  private _pixelRatio = 1;

  constructor(container: HTMLElement, layer: SurfaceLayer) {
    const canvas = container.ownerDocument.createElement('canvas');
    canvas.setAttribute('data-layer', layer);
    const style = canvas.style;
    style.position = 'absolute';
    style.left = '0';
    style.top = '0';
    style.display = 'block';
    style.userSelect = 'none';
    style.setProperty('-webkit-tap-highlight-color', 'transparent');
    if (layer === 'overlay') style.touchAction = 'none';
    else style.pointerEvents = 'none';
    const context = canvas.getContext('2d', { alpha: layer === 'overlay' });
    if (!context) throw new ChartError('Canvas 2D is not supported in this environment');
    this.element = canvas;
    this.context = context;
    container.appendChild(canvas);
  }

  get pixelRatio(): number {
    return this._pixelRatio;
  }

  get bitmapWidth(): number {
    return this.element.width;
  }

  get bitmapHeight(): number {
    return this.element.height;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const bw = Math.max(1, Math.round(width * pixelRatio));
    const bh = Math.max(1, Math.round(height * pixelRatio));
    this._pixelRatio = pixelRatio;
    if (this.element.width !== bw) this.element.width = bw;
    if (this.element.height !== bh) this.element.height = bh;
    this.element.style.width = `${width}px`;
    this.element.style.height = `${height}px`;
  }

  destroy(): void {
    // Release the backing store early; some browsers keep it alive until GC otherwise.
    this.element.width = 0;
    this.element.height = 0;
    this.element.remove();
  }
}

export const canvas2dBackend: RenderBackend<Canvas2DSurface> = {
  id: 'canvas2d',
  createSurface: (container, layer) => new CanvasSurface(container, layer),
};
