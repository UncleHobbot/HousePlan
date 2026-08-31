// Геометрия контура: прибивание размеров, замки, скольжение точек.
// Логика перенесена из подтверждённого черновика редактора (ветка
// prototype/editor-draft) и проверена автотестами (shared/test).
// Ограничение текущей версии: пересчёт работает по прямым углам и
// по прямым участкам контура; диагональная стена блокирует прибивание.

import type { Cm, Contour, Point, SizeLock } from './index.js';

const MIN = 10; // минимальная длина стены, см

/** Среднее координат набора точек; для пустого набора — начало координат. */
export function pointAverage(points: Point[]): { x: number; y: number } {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / Math.max(1, points.length),
    y: points.reduce((sum, point) => sum + point.y, 0) / Math.max(1, points.length),
  };
}

type Axis = 'H' | 'V' | 'D';

function idxOf(points: Point[], id: number): number {
  return points.findIndex((p) => p.id === id);
}

function vec(points: Point[], i: number): { dx: number; dy: number } {
  const a = points[i];
  const b = points[(i + 1) % points.length];
  return { dx: b.x - a.x, dy: b.y - a.y };
}

function axisOf(v: { dx: number; dy: number }): Axis {
  return v.dy === 0 ? 'H' : v.dx === 0 ? 'V' : 'D';
}

function signOf(v: { dx: number; dy: number }): number {
  return axisOf(v) === 'H' ? Math.sign(v.dx) : Math.sign(v.dy);
}

/** Стены участка: индексы стен от точки aId вперёд по обходу до точки bId. */
function chainWalls(points: Point[], aId: number, bId: number): number[] | null {
  const n = points.length;
  const a = idxOf(points, aId);
  const b = idxOf(points, bId);
  if (a < 0 || b < 0) return null;
  const walls: number[] = [];
  let i = a;
  while (i !== b) {
    walls.push(i);
    i = (i + 1) % n;
    if (walls.length > n) return null;
  }
  return walls;
}

/** Стены, входящие в любой замок (индекс = начальная точка стены). */
export function lockedWalls(contour: Contour): Set<number> {
  const set = new Set<number>();
  for (const lock of contour.locks) {
    const walls = chainWalls(contour.points, lock.aId, lock.bId);
    if (walls) for (const w of walls) set.add(w);
  }
  return set;
}

export function lockLabel(lock: SizeLock): string {
  return `А${lock.aId}–А${lock.bId} = ${lock.length}`;
}

export function canSlide(
  contour: Contour,
  pointId: number,
): { ok: true; axis: 'H' | 'V' } | { ok: false; reason: string } {
  const points = contour.points;
  const n = points.length;
  if (n < 3) return { ok: false, reason: 'Сначала нарисуйте контур.' };
  const i = idxOf(points, pointId);
  if (i < 0) return { ok: false, reason: 'Точка не найдена.' };
  const vp = vec(points, (i - 1 + n) % n);
  const vn = vec(points, i);
  const ap = axisOf(vp);
  const an = axisOf(vn);
  if (ap === 'D' || an === 'D' || ap !== an || signOf(vp) !== signOf(vn)) {
    return { ok: false, reason: 'Двигать можно только точки на прямой стене; углы контура неподвижны.' };
  }
  const busy = lockedWalls(contour);
  if (busy.has((i - 1 + n) % n) || busy.has(i)) {
    return { ok: false, reason: 'Эта точка держит прибитый размер — замок не двигается.' };
  }
  return { ok: true, axis: ap };
}

/** Сдвинуть точку вдоль её прямой, не подходя ближе минимума к соседям. */
export function slidePoint(contour: Contour, pointId: number, x: Cm, y: Cm): Contour {
  const can = canSlide(contour, pointId);
  if (!can.ok) return contour;
  const points = contour.points;
  const n = points.length;
  const i = idxOf(points, pointId);
  const a = points[(i - 1 + n) % n];
  const b = points[(i + 1) % n];
  let nx = Math.round(x);
  let ny = Math.round(y);
  if (can.axis === 'H') {
    ny = a.y;
    nx = Math.max(Math.min(a.x, b.x) + MIN, Math.min(Math.max(a.x, b.x) - MIN, nx));
  } else {
    nx = a.x;
    ny = Math.max(Math.min(a.y, b.y) + MIN, Math.min(Math.max(a.y, b.y) - MIN, ny));
  }
  return {
    ...contour,
    points: points.map((p) => (p.id === pointId ? { ...p, x: nx, y: ny } : p)),
  };
}

/** Пересечения контура с самим собой: пары индексов стен. */
export function crossings(points: Point[]): Array<[number, number]> {
  const n = points.length;
  if (n < 4) return [];
  const out: Array<[number, number]> = [];
  function orient(px: number, py: number, qx: number, qy: number, rx: number, ry: number): number {
    const v = (qx - px) * (ry - py) - (qy - py) * (rx - px);
    return v < 0 ? -1 : v > 0 ? 1 : 0;
  }
  function segmentCross(i: number, j: number): boolean {
    const a = points[i], b = points[(i + 1) % n], c = points[j], d = points[(j + 1) % n];
    const o1 = orient(a.x, a.y, b.x, b.y, c.x, c.y);
    const o2 = orient(a.x, a.y, b.x, b.y, d.x, d.y);
    const o3 = orient(c.x, c.y, d.x, d.y, a.x, a.y);
    const o4 = orient(c.x, c.y, d.x, d.y, b.x, b.y);
    return o1 !== o2 && o3 !== o4;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentCross(i, j)) out.push([i, j]);
    }
  }
  return out;
}

export type ChainInfo =
  | { ok: true; walls: number[]; axis: 'H' | 'V'; length: Cm }
  | { ok: false; reason: string };

/** Можно ли прибить участок и какова его текущая длина. */
export function chainInfo(contour: Contour, aId: number, bId: number): ChainInfo {
  const points = contour.points;
  const n = points.length;
  if (!contour.closed || n < 3) return { ok: false, reason: 'Контур не замкнут.' };
  if (aId === bId) return { ok: false, reason: 'Выберите две разные точки.' };
  const walls = chainWalls(points, aId, bId);
  if (!walls || walls.length === 0) return { ok: false, reason: 'Выберите две разные точки.' };
  const first = vec(points, walls[0]);
  const rawAxis = axisOf(first);
  if (rawAxis === 'D') return { ok: false, reason: 'Диагональная стена на участке.' };
  const axis: 'H' | 'V' = rawAxis;
  const sgn = signOf(first);
  let length = 0;
  for (const w of walls) {
    const v = vec(points, w);
    if (axisOf(v) !== axis) {
      return { ok: false, reason: 'Участок поворачивает. Прибиваются только прямые отрезки контура.' };
    }
    if (signOf(v) !== sgn) {
      return { ok: false, reason: 'Участок должен идти по прямой, без «зигзага».' };
    }
    length += Math.abs(axis === 'H' ? v.dx : v.dy);
  }
  return { ok: true, walls, axis, length };
}

export function removeLock(contour: Contour, aId: number, bId: number): Contour {
  return { ...contour, locks: contour.locks.filter((l) => l.aId !== aId || l.bId !== bId) };
}

export interface PointDeletionPreview {
  ok: boolean;
  reason?: string;
  /** индекс удаляемой точки */
  index: number;
  /** замки, исчезающие вместе с соседними стенами */
  locks: SizeLock[];
  /** стены с исчезающими проёмами: идентификаторы их начальных точек */
  openingWallPointIds: number[];
}

/**
 * Что удалится вместе с точкой: две соседние стены сливаются в одну,
 * замки на них исчезают, проёмы исчезнувшей стены удаляются.
 */
export function pointDeletionPreview(contour: Contour, pointId: number): PointDeletionPreview {
  const empty = { index: -1, locks: [] as SizeLock[], openingWallPointIds: [] as number[] };
  const points = contour.points;
  const n = points.length;
  if (!contour.closed || n < 3) {
    return { ...empty, ok: false, reason: 'Контур не замкнут.' };
  }
  const index = idxOf(points, pointId);
  if (index < 0) return { ...empty, ok: false, reason: 'Точка не найдена.' };
  if (n <= 3) {
    return { ...empty, ok: false, reason: 'В контуре должно остаться минимум три угла.' };
  }
  const prev = (index - 1 + n) % n;
  const locks = contour.locks.filter((lock) => {
    const walls = chainWalls(points, lock.aId, lock.bId);
    return walls ? walls.some((w) => w === prev || w === index) : false;
  });
  return {
    ok: true,
    index,
    locks,
    openingWallPointIds: [points[index].id],
  };
}

/** Удалить точку: соседние стены сливаются в одну, их замки исчезают. */
export function deletePoint(contour: Contour, pointId: number): Contour {
  const preview = pointDeletionPreview(contour, pointId);
  if (!preview.ok) return contour;
  const points = contour.points;
  const gone = new Set(preview.locks.map(lockLabel));
  return {
    ...contour,
    points: points.filter((_, i) => i !== preview.index),
    locks: contour.locks.filter((lock) => !gone.has(lockLabel(lock))),
  };
}
