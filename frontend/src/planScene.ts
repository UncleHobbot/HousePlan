// Единые правила отрисовки плана: цвета, подписи, полосы толщины стен.
// Используются и редактором помещения (RoomCanvas), и обзором этажа
// (FloorView) — чтобы один домен не рисовался двумя разными способами.

import type { Contour, OpeningKind, Point, ZoneKind } from '@houseplan/shared';
import { ZONE_KIND_LABELS } from '@houseplan/shared';

export const ZONE_COLORS: Record<ZoneKind, string> = {
  stairs: '#7c3aed',
  builtInWardrobe: '#0d9488',
  fireplace: '#ea580c',
  decorativeWall: '#db2777',
  partition: '#dc2626',
  other: '#ca8a04',
};

export const OPENING_COLORS: Record<OpeningKind, string> = {
  window: '#2563eb',
  entryDoor: '#b45309',
  innerDoor: '#b45309',
};

export const OPENING_LABELS: Record<OpeningKind, string> = {
  window: 'Окно',
  entryDoor: 'Входная дверь',
  innerDoor: 'Дверь',
};

/** Цвет и подпись типа зоны — подпись берётся из глоссария (shared). */
export function zoneStyle(kind: ZoneKind): { color: string; label: string } {
  return { color: ZONE_COLORS[kind] ?? ZONE_COLORS.other, label: ZONE_KIND_LABELS[kind] };
}

export function openingStyle(kind: OpeningKind): { color: string; label: string } {
  return { color: OPENING_COLORS[kind], label: OPENING_LABELS[kind] };
}

export function withAlpha(color: string, alpha: number): string {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) return color;
  const [, red, green, blue] = match;
  return `rgba(${Number.parseInt(red, 16)}, ${Number.parseInt(green, 16)}, ${Number.parseInt(blue, 16)}, ${alpha})`;
}

/** Центр описанного прямоугольника контура. */
export function contourCentroid(points: Point[]): { x: number; y: number } {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / Math.max(1, points.length),
    y: points.reduce((sum, point) => sum + point.y, 0) / Math.max(1, points.length),
  };
}

/**
 * Полосы толщины стен: по одной замкнутой полосе на каждую стену с
 * ненулевой толщиной, наружу от линии контура (ADR 0004).
 * Возвращает координаты в сантиметрах модели.
 */
export function wallThicknessBands(contour: Contour): Array<Array<{ x: number; y: number }>> {
  const points = contour.points;
  const n = points.length;
  if (!contour.closed || n < 3) return [];
  const bands: Array<Array<{ x: number; y: number }>> = [];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const thickness = contour.thicknesses[a.id] ?? 0;
    if (!thickness) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (dy / length) * thickness;
    const ny = (-dx / length) * thickness;
    bands.push([
      { x: a.x, y: a.y },
      { x: b.x, y: b.y },
      { x: Math.round(b.x + nx), y: Math.round(b.y + ny) },
      { x: Math.round(a.x + nx), y: Math.round(a.y + ny) },
    ]);
  }
  return bands;
}
