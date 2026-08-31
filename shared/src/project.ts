// Запросы и операции над проектом, которые нужны интерфейсу и агентам:
// этажи, сквозные зоны, имена помещений и местоположение объектов.

import type { Floor, Project, Zone } from './index.js';
import { allocateId, rebaseCounters } from './index.js';
import { locateObject } from './placements.js';

function copyShellWithNewIds(project: Project, source: Floor['shell']): Floor['shell'] {
  const pointIds = new Map<number, number>();
  const points = source.contour.points.map((point) => {
    const id = allocateId(project, 'point');
    pointIds.set(point.id, id);
    return { ...point, id };
  });
  const remapPointId = (oldId: number): number => {
    const id = pointIds.get(oldId);
    if (id === undefined) throw new Error(`Оболочка ссылается на отсутствующую точку ${oldId}`);
    return id;
  };
  const thicknesses: Record<number, number> = {};
  for (const point of source.contour.points) {
    const thickness = source.contour.thicknesses[point.id];
    if (thickness !== undefined) thicknesses[remapPointId(point.id)] = thickness;
  }
  return {
    contour: {
      points,
      thicknesses,
      locks: source.contour.locks.map((lock) => ({
        ...lock,
        aId: remapPointId(lock.aId),
        bId: remapPointId(lock.bId),
      })),
      closed: source.contour.closed,
    },
    openings: source.openings.map((opening) => ({
      ...structuredClone(opening),
      id: allocateId(project, 'opening'),
      wallPointId: remapPointId(opening.wallPointId),
    })),
  };
}

/**
 * Добавить независимый этаж, взяв оболочку указанного соседнего этажа за
 * отправную точку. Идентификаторы оболочки выдаются заново, поэтому дальнейшие
 * изменения этажей не затрагивают друг друга (ADR 0002).
 */
export function addFloor(project: Project, neighbourFloorId?: number): Floor {
  rebaseCounters(project);
  const neighbour = project.floors.find((floor) => floor.id === neighbourFloorId)
    ?? project.floors.at(-1);
  const floor: Floor = {
    id: allocateId(project, 'floor'),
    name: `${project.floors.length + 1}-й этаж`,
    ceilingHeightCm: 260,
    shell: neighbour
      ? copyShellWithNewIds(project, neighbour.shell)
      : { contour: { points: [], thicknesses: {}, locks: [], closed: false }, openings: [] },
    rooms: [],
  };
  project.floors.push(floor);
  return floor;
}

/**
 * Сквозные зоны, видимые на этаже floorId проекцией: зона хранится на своём
 * этаже, а на этажах диапазона «от — до» отображается сама (решение
 * «Служебные зоны», диапазон сквозности).
 */
export function projectedZonesForFloor(project: Project, floorId: number): Zone[] {
  const floorIndex = new Map(project.floors.map((floor, index) => [floor.id, index]));
  const target = floorIndex.get(floorId);
  if (target === undefined) return [];
  const result: Zone[] = [];
  project.floors.forEach((floor, sourceIndex) => {
    if (sourceIndex === target) return; // свои зоны уже на месте
    for (const room of floor.rooms) {
      for (const zone of room.zones) {
        if (!zone.spansFloors) continue;
        const from = floorIndex.get(zone.spansFloors.fromFloorId);
        const to = floorIndex.get(zone.spansFloors.toFloorId);
        if (from === undefined || to === undefined) continue;
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        if (target >= lo && target <= hi) result.push(zone);
      }
    }
  });
  return result;
}

/** «Этаж: помещение» — человекочитаемое имя помещения. */
export function roomLabel(project: Project, roomId: number): string {
  for (const floor of project.floors) {
    const room = floor.rooms.find((r) => r.id === roomId);
    if (room) return `${floor.name}: ${room.name}`;
  }
  return '?';
}

/** Где объект: имя помещения или «на складе». */
export function objectLocation(project: Project, objectId: number): string {
  const located = locateObject(project, objectId);
  return located ? `${located.floor.name}: ${located.room.name}` : 'на складе';
}
