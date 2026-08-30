import type { Point } from '@houseplan/shared';
import { GRID_CM } from './editorConstants';
import type { DimensionSelection } from './editorTypes';

export type DimensionSelectionIntent =
  | { type: 'pointClicked'; pointId: number }
  | { type: 'reset' };

export function reduceDimensionSelection(
  selection: DimensionSelection,
  intent: DimensionSelectionIntent,
): DimensionSelection {
  if (intent.type === 'reset' || intent.pointId === selection.aId) {
    return { aId: null, bId: null };
  }
  if (selection.aId === null) return { aId: intent.pointId, bId: null };
  return { aId: selection.aId, bId: intent.pointId };
}

export function snapPoint(
  raw: { x: number; y: number },
  points: Point[],
  closed: boolean,
  snap: boolean,
): { x: number; y: number } {
  if (!snap) return { x: Math.round(raw.x), y: Math.round(raw.y) };
  let x = Math.round(raw.x / GRID_CM) * GRID_CM;
  let y = Math.round(raw.y / GRID_CM) * GRID_CM;
  const last = points.at(-1);
  if (last && !closed) {
    if (Math.abs(raw.x - last.x) < 45 && Math.abs(raw.x - last.x) <= Math.abs(raw.y - last.y)) x = last.x;
    else if (Math.abs(raw.y - last.y) < 45) y = last.y;
  }
  return { x, y };
}

export function contourCentroid(points: Point[]): { x: number; y: number } {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / Math.max(1, points.length),
    y: points.reduce((sum, point) => sum + point.y, 0) / Math.max(1, points.length),
  };
}

export function projectOntoWall(raw: { x: number; y: number }, start: Point, end: Point) {
  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const lengthSquared = vx * vx + vy * vy || 1;
  const t = Math.max(0.05, Math.min(0.95, ((raw.x - start.x) * vx + (raw.y - start.y) * vy) / lengthSquared));
  return { x: Math.round(start.x + vx * t), y: Math.round(start.y + vy * t) };
}
