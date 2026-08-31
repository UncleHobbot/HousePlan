// Запросы над проектом, которые нужны и интерфейсу, и агентам:
// сквозные зоны, имена комнат и местоположение объектов.

import type { Project, Zone } from './index.js';

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

/** «Этаж: комната» — человекочитаемое имя помещения. */
export function roomLabel(project: Project, roomId: number): string {
  for (const floor of project.floors) {
    const room = floor.rooms.find((r) => r.id === roomId);
    if (room) return `${floor.name}: ${room.name}`;
  }
  return '?';
}

/** Где объект: имя комнаты или «на складе». */
export function objectLocation(project: Project, objectId: number): string {
  for (const floor of project.floors) {
    for (const room of floor.rooms) {
      if (room.placements.some((p) => p.objectId === objectId)) {
        return `${floor.name}: ${room.name}`;
      }
    }
  }
  return 'на складе';
}
