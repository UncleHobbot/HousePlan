// Объекты на плане: прямоугольник с поворотом, допуски-расширения,
// конфликты допусков (подсветка, не запрет — тела не проверяются).

import type { Cm, Floor, Placement, SceneObject, Zone } from './index.js';

export type Poly = Array<{ x: number; y: number }>;

/** Угол поворота в радианах: 0° — «перед» вдоль оси X, положительный — по часовой. */
function rotate(corner: { x: number; y: number }, placement: { x: Cm; y: Cm; rotationDeg: number }): { x: number; y: number } {
  const rad = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // + 0 превращает −0 из округления в обычный ноль
  return {
    x: Math.round(placement.x + corner.x * cos - corner.y * sin) + 0,
    y: Math.round(placement.y + corner.x * sin + corner.y * cos) + 0,
  };
}

/** Тело объекта: прямоугольник Ш×Г, повёрнутый на угол размещения. */
export function bodyPolygon(object: SceneObject, placement: Placement): Poly {
  const hw = object.widthCm / 2;
  const hd = object.depthCm / 2;
  const local = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ];
  return local.map((c) => rotate(c, placement));
}

/**
 * Допуск: прямоугольник тела, расширенный отступами по сторонам.
 * «Перед» — сторона +Y в локальных координатах объекта.
 */
export function clearancePolygon(object: SceneObject, placement: Placement): Poly {
  const cl = object.clearances ?? { front: 0, back: 0, left: 0, right: 0 };
  const x0 = -(object.widthCm / 2 + cl.left);
  const x1 = object.widthCm / 2 + cl.right;
  const y0 = -(object.depthCm / 2 + cl.back);
  const y1 = object.depthCm / 2 + cl.front;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ].map((c) => rotate(c, placement));
}

export function pointInPolygon(p: { x: number; y: number }, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const cross = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 0) + xi;
    if (cross) inside = !inside;
  }
  return inside;
}

function segmentsCross(
  a1: { x: number; y: number }, a2: { x: number; y: number },
  b1: { x: number; y: number }, b2: { x: number; y: number },
): boolean {
  function orient(p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }): number {
    const v = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return v < 0 ? -1 : v > 0 ? 1 : 0;
  }
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);
  return o1 !== o2 && o3 !== o4;
}

export function polygonsIntersect(a: Poly, b: Poly): boolean {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i], a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j], b2 = b[(j + 1) % b.length];
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  if (pointInPolygon(a[0], b)) return true;
  if (pointInPolygon(b[0], a)) return true;
  return false;
}

/** В каком помещении этажа лежит точка (для расстановки и переносов). */
export function roomAt(floor: Floor, x: Cm, y: Cm): number | null {
  for (const room of floor.rooms) {
    if (room.contour.closed && pointInPolygon({ x, y }, room.contour.points)) return room.id;
  }
  return null;
}

/**
 * Объекты с горящим допуском: допуск объекта наехал на тело другого объекта
 * или на служебную зону. Тела между собой не проверяются.
 */
export function conflictObjectIds(objects: SceneObject[], floor: Floor, zones: Zone[]): Set<number> {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const result = new Set<number>();
  for (const room of floor.rooms) {
    for (const pa of room.placements) {
      const oa = byId.get(pa.objectId);
      if (!oa) continue;
      const ca = clearancePolygon(oa, pa);
      let conflict = false;
      for (const rb of floor.rooms) {
        if (conflict) break;
        for (const pb of rb.placements) {
          if (pb.objectId === pa.objectId) continue;
          const ob = byId.get(pb.objectId);
          if (!ob) continue;
          if (polygonsIntersect(ca, bodyPolygon(ob, pb))) {
            conflict = true;
            break;
          }
        }
      }
      if (!conflict) {
        for (const z of zones) {
          if (polygonsIntersect(ca, z.points)) {
            conflict = true;
            break;
          }
        }
      }
      if (conflict) result.add(pa.objectId);
    }
  }
  return result;
}
