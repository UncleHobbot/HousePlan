export interface CanvasPoint {
  x: number;
  y: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  toCanvas(point: CanvasPoint): CanvasPoint;
  toWorld(point: CanvasPoint): CanvasPoint;
  flatten(points: readonly CanvasPoint[]): number[];
}

export interface ViewportOptions {
  width: number;
  height: number;
  padding: number;
  worldBounds?: WorldBounds;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function createViewport(
  points: readonly CanvasPoint[],
  options: ViewportOptions,
): Viewport {
  const { width, height, padding, worldBounds } = options;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  if (worldBounds) {
    xs.push(worldBounds.minX, worldBounds.maxX);
    ys.push(worldBounds.minY, worldBounds.maxY);
  }
  const minX = xs.length > 0 ? Math.min(...xs) : 0;
  const maxX = xs.length > 0 ? Math.max(...xs) : 0;
  const minY = ys.length > 0 ? Math.min(...ys) : 0;
  const maxY = ys.length > 0 ? Math.max(...ys) : 0;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const availableWidth = Math.max(0, width - padding * 2);
  const availableHeight = Math.max(0, height - padding * 2);
  const scaleX = spanX > 0 ? availableWidth / spanX : Number.POSITIVE_INFINITY;
  const scaleY = spanY > 0 ? availableHeight / spanY : Number.POSITIVE_INFINITY;
  const fittedScale = Math.min(scaleX, scaleY);
  const scale = Number.isFinite(fittedScale) && fittedScale > 0 ? fittedScale : 1;
  const offsetX = (width - spanX * scale) / 2 - minX * scale;
  const offsetY = (height - spanY * scale) / 2 - minY * scale;

  const toCanvas = (point: CanvasPoint): CanvasPoint => ({
    x: point.x * scale + offsetX,
    y: point.y * scale + offsetY,
  });
  const toWorld = (point: CanvasPoint): CanvasPoint => ({
    x: (point.x - offsetX) / scale,
    y: (point.y - offsetY) / scale,
  });

  return {
    width,
    height,
    scale,
    toCanvas,
    toWorld,
    flatten: (source) => source.flatMap((point) => {
      const canvasPoint = toCanvas(point);
      return [canvasPoint.x, canvasPoint.y];
    }),
  };
}
