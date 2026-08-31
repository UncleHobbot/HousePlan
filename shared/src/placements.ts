// Размещение объектов: «объект не дублируется» — по всему дому существует
// ровно одно размещение каждого объекта (решение в CONTEXT.md).
// Все операции возвращают новый проект и сами снимают прежнее размещение.

import type { Cm, Floor, Placement, Project, Room } from './index.js';
import { pointAverage } from './geometry.js';
import { pointInPolygon } from './objects.js';

export interface LocatedObject {
  floor: Floor;
  room: Room;
  placement: Placement;
}

/** Где объект стоит сейчас: null — лежит на складе. */
export function locateObject(project: Project, objectId: number): LocatedObject | null {
  for (const floor of project.floors) {
    for (const room of floor.rooms) {
      for (const placement of room.placements) {
        if (placement.objectId === objectId) {
          return { floor, room, placement };
        }
      }
    }
  }
  return null;
}

function bboxArea(room: Room): number {
  const xs = room.contour.points.map((p) => p.x);
  const ys = room.contour.points.map((p) => p.y);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

/** Самое большое замкнутое помещение этажа. */
export function largestRoom(floor: Floor): Room | null {
  const closed = floor.rooms.filter((room) => room.contour.closed);
  if (closed.length === 0) return null;
  return closed.reduce((biggest, room) => (bboxArea(room) > bboxArea(biggest) ? room : biggest));
}

/** Среднее координат вершин помещения — точка по умолчанию для «На план». */
export function roomCentroid(room: Room): { x: Cm; y: Cm } {
  const center = pointAverage(room.contour.points);
  const x = Math.round(center.x);
  const y = Math.round(center.y);
  return { x, y };
}

/**
 * Поставить объект на план. Прежнее размещение исчезает — даже на другом
 * этаже (объект не дублируется). Без roomId выбирается самое большое
 * замкнутое помещение. Возвращает null, если на этаже нет помещений.
 */
export function placeObject(
  project: Project,
  objectId: number,
  floorId: number,
  at: { x: Cm; y: Cm },
  roomId?: number,
  rotationDeg = 0,
): Project | null {
  const floor = project.floors.find((f) => f.id === floorId);
  if (!floor) return null;
  const explicit = roomId !== undefined ? floor.rooms.find((r) => r.id === roomId && r.contour.closed) : undefined;
  const room = explicit ?? largestRoom(floor);
  if (!room) return null;
  const placement: Placement = {
    objectId,
    roomId: room.id,
    x: Math.round(at.x),
    y: Math.round(at.y),
    rotationDeg: ((rotationDeg % 360) + 360) % 360,
  };
  return {
    ...project,
    floors: project.floors.map((f) => ({
      ...f,
      rooms: f.rooms.map((r) => ({
        ...r,
        placements: [
          ...r.placements.filter((p) => p.objectId !== objectId),
          ...(r.id === room.id ? [placement] : []),
        ],
      })),
    })),
  };
}

/** Убрать объект с плана — на склад. */
export function unplaceObject(project: Project, objectId: number): Project {
  return {
    ...project,
    floors: project.floors.map((f) => ({
      ...f,
      rooms: f.rooms.map((r) => ({
        ...r,
        placements: r.placements.filter((p) => p.objectId !== objectId),
      })),
    })),
  };
}

/** Удалить объект: со склада и с плана. Слепки в снэпшотах не трогаются. */
export function deleteObject(project: Project, objectId: number): Project {
  const withoutPlacement = unplaceObject(project, objectId);
  return {
    ...withoutPlacement,
    objects: withoutPlacement.objects.filter((o) => o.id !== objectId),
  };
}

/** Повернуть размещённый объект на дельту (градусы, по часовой). */
export function rotateObject(project: Project, objectId: number, deltaDeg: number): Project | null {
  const located = locateObject(project, objectId);
  if (!located) return null;
  const rotation = ((located.placement.rotationDeg + deltaDeg) % 360 + 360) % 360;
  return {
    ...project,
    floors: project.floors.map((f) => ({
      ...f,
      rooms: f.rooms.map((r) => ({
        ...r,
        placements: r.placements.map((p) =>
          p.objectId === objectId ? { ...p, rotationDeg: rotation } : p,
        ),
      })),
    })),
  };
}

/** Помещение, содержащее точку (среди замкнутых контуров). */
export function roomAtPoint(floor: Floor, x: Cm, y: Cm): Room | null {
  for (const room of floor.rooms) {
    if (room.contour.closed && pointInPolygon({ x, y }, room.contour.points)) return room;
  }
  return null;
}
