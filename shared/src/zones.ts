// Служебные зоны: привязка к контуру помещения и подписи типов.

import type { Point, Zone } from './index.js';

export type ZoneKind = Zone['kind'];

export const ZONE_KIND_LABELS: Record<ZoneKind, string> = {
  stairs: 'Лестница',
  builtInWardrobe: 'Встроенный шкаф',
  fireplace: 'Камин',
  decorativeWall: 'Декоративная стена',
  partition: 'Простенок',
  other: 'Зона',
};

/**
 * Зоны привязаны к точкам контура (опорная точка пристенной зоны или точка
 * роста простенка): куда уехала точка при пересчёте размеров — туда и зона.
 */
export function rebaseZones(oldPoints: Point[], newPoints: Point[], zones: Zone[]): Zone[] {
  const moved: Array<{ id: number; dx: number; dy: number }> = [];
  for (const np of newPoints) {
    const op = oldPoints.find((p) => p.id === np.id);
    if (op && (op.x !== np.x || op.y !== np.y)) {
      moved.push({ id: np.id, dx: np.x - op.x, dy: np.y - op.y });
    }
  }
  if (moved.length === 0) return zones;
  return zones.map((zone) => {
    const anchorId = zone.fromPointId ?? zone.supportWallPointId;
    if (anchorId === undefined) return zone;
    const m = moved.find((mm) => mm.id === anchorId);
    if (!m || (m.dx === 0 && m.dy === 0)) return zone;
    return {
      ...zone,
      points: zone.points.map((p) => ({ ...p, x: p.x + m.dx, y: p.y + m.dy })),
    };
  });
}
