// Проёмы: положение на стене и поведение «доля стены».
// Проём хранит сантиметры от угла стены, но при изменении длины стены
// смещение пересчитывается пропорционально — проём не вылезает за край.

import type { Cm, Contour, Opening, OpeningKind, Point } from './index.js';

export const OPENING_DEFAULTS: Record<OpeningKind, { width: number; sill?: number; top?: number; height?: number }> = {
  window: { width: 120, sill: 90, top: 220 },
  entryDoor: { width: 100, height: 200 },
  innerDoor: { width: 90, height: 200 },
};

export interface Wall {
  a: Point;
  b: Point;
}

/** Стена, начинающаяся в точке с этим идентификатором. */
export function wallByPoint(points: Point[], wallPointId: number): Wall | null {
  const i = points.findIndex((p) => p.id === wallPointId);
  if (i < 0) return null;
  return { a: points[i], b: points[(i + 1) % points.length] };
}

export interface OpeningSegment {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/** Координаты проёма на стене — для отрисовки и агентных сценариев. */
export function openingSegment(
  points: Point[],
  wallPointId: number,
  offsetCm: Cm,
  widthCm: Cm,
): OpeningSegment | null {
  const wall = wallByPoint(points, wallPointId);
  if (!wall) return null;
  const vx = wall.b.x - wall.a.x;
  const vy = wall.b.y - wall.a.y;
  const len = Math.hypot(vx, vy);
  if (len === 0) return null;
  const ux = vx / len;
  const uy = vy / len;
  const offset = Math.max(0, Math.min(offsetCm, len - widthCm));
  const start = { x: Math.round(wall.a.x + ux * offset), y: Math.round(wall.a.y + uy * offset) };
  const end = { x: Math.round(start.x + ux * widthCm), y: Math.round(start.y + uy * widthCm) };
  return { start, end };
}

/**
 * Создать проём на стене: смещение центрируется по точке клика
 * и не вылезает за край стены (дефолты ширины и высот — по типу проёма).
 */
export function makeOpening(
  contour: Contour,
  kind: OpeningKind,
  wallPointId: number,
  alongCm: Cm,
  id: number,
): Opening | null {
  const wall = wallByPoint(contour.points, wallPointId);
  if (!wall) return null;
  const defaults = OPENING_DEFAULTS[kind];
  const length = Math.abs(wall.b.x - wall.a.x) + Math.abs(wall.b.y - wall.a.y);
  const along = Math.round(alongCm - defaults.width / 2);
  const offset = Math.max(0, Math.min(along, Math.max(0, length - defaults.width)));
  return {
    id,
    kind,
    wallPointId,
    offsetCm: offset,
    widthCm: defaults.width,
    sillCm: defaults.sill,
    topCm: defaults.top,
    heightCm: defaults.height,
    attributes: [],
  };
}

/**
 * Сохраняем долю стены: проём остаётся на своей доле и не вылезает за край.
 * Возвращает те же проёмы с пересчитанным смещением.
 */
export function rebaseOpenings<T extends { wallPointId: number; offsetCm: Cm; widthCm: Cm }>(
  oldPoints: Point[],
  newPoints: Point[],
  openings: T[],
): T[] {
  return openings.map((o) => {
    const oldWall = wallByPoint(oldPoints, o.wallPointId);
    const newWall = wallByPoint(newPoints, o.wallPointId);
    if (!oldWall || !newWall) return o;
    const oldLen = Math.hypot(oldWall.b.x - oldWall.a.x, oldWall.b.y - oldWall.a.y);
    const newLen = Math.hypot(newWall.b.x - newWall.a.x, newWall.b.y - newWall.a.y);
    if (oldLen === 0 || oldLen === newLen) return o;
    const offset = Math.max(0, Math.min(o.offsetCm, oldLen - o.widthCm));
    const ratio = offset / oldLen;
    const newOffset = Math.max(0, Math.min(Math.round(ratio * newLen), Math.max(0, newLen - o.widthCm)));
    return { ...o, offsetCm: newOffset };
  });
}
