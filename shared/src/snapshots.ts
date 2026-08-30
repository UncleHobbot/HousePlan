// Снэпшоты: слепок расстановки всего дома, возврат и сравнение вариантов.
// Снэпшот хранит копии (не ссылки): удалённый объект остаётся в старых
// вариантах. Стены и зоны в снэпшот не входят — они всегда текущие.

import type { Cm, Project, SceneObject, Snapshot, SnapshotPlacement } from './index.js';

/** Живой план в виде расстановок — для снэпшотов и сравнения. */
export function livePlacements(project: Project): SnapshotPlacement[] {
  const placements: SnapshotPlacement[] = [];
  for (const floor of project.floors) {
    for (const room of floor.rooms) {
      for (const placement of room.placements) {
        const object = project.objects.find((o) => o.id === placement.objectId);
        if (!object) continue;
        placements.push({
          object: structuredClone(object),
          roomId: room.id,
          x: placement.x,
          y: placement.y,
          rotationDeg: placement.rotationDeg,
        });
      }
    }
  }
  return placements;
}

/** Слепок живого плана: расстановки всех этажей + то, что лежало на складе. */
export function createSnapshot(project: Project, id: number, name: string, note?: string): Snapshot {
  const placements = livePlacements(project);
  const placedIds = new Set(placements.map((p) => p.object.id));
  const storeroomObjects = project.objects
    .filter((o) => !placedIds.has(o.id))
    .map((o) => structuredClone(o));
  return { id, name, note, placements, storeroomObjects };
}

/** Вернуть вариант: живой план и склад заменяются содержимым снэпшота. */
export function applySnapshot(project: Project, snapshot: Snapshot): Project {
  const restored = structuredClone(project);
  const objects = new Map<number, SceneObject>();
  const restoredPlacements: Array<{
    objectId: number; roomId: number; x: Cm; y: Cm; rotationDeg: number;
  }> = [];
  const roomIds = new Set(restored.floors.flatMap((f) => f.rooms.map((r) => r.id)));
  for (const placement of snapshot.placements) {
    objects.set(placement.object.id, structuredClone(placement.object));
    // если комнаты с таким идентификатором больше нет — объект уходит на склад
    if (roomIds.has(placement.roomId)) {
      restoredPlacements.push({
        objectId: placement.object.id,
        roomId: placement.roomId,
        x: placement.x,
        y: placement.y,
        rotationDeg: placement.rotationDeg,
      });
    }
  }
  for (const object of snapshot.storeroomObjects) {
    objects.set(object.id, structuredClone(object));
  }
  restored.objects = [...objects.values()];
  for (const floor of restored.floors) {
    for (const room of floor.rooms) {
      room.placements = restoredPlacements.filter((p) => p.roomId === room.id);
    }
  }
  // счётчики не должны откатиться под слепками
  const maxId = Math.max(0, ...restored.objects.map((o) => o.id));
  restored.counters.object = Math.max(restored.counters.object ?? 0, maxId);
  return restored;
}

export interface SnapshotDiff {
  /** объект есть в обоих вариантах, но стоит по-разному */
  moved: Array<{ object: SceneObject; from: SnapshotPlacement; to: SnapshotPlacement }>;
  /** есть во втором варианте, не было в первом */
  added: SnapshotPlacement[];
  /** был в первом варианте, во втором исчез */
  removed: SnapshotPlacement[];
}

/** Сравнение расстановок по идентификаторам объектов. */
export function diffPlacements(a: SnapshotPlacement[], b: SnapshotPlacement[]): SnapshotDiff {
  const byId = new Map(b.map((p) => [p.object.id, p]));
  const moved: SnapshotDiff['moved'] = [];
  const added: SnapshotPlacement[] = [];
  const removed: SnapshotPlacement[] = [];
  const seen = new Set<number>();
  for (const pa of a) {
    seen.add(pa.object.id);
    const pb = byId.get(pa.object.id);
    if (!pb) {
      removed.push(pa);
      continue;
    }
    if (pa.roomId !== pb.roomId || pa.x !== pb.x || pa.y !== pb.y || pa.rotationDeg !== pb.rotationDeg) {
      moved.push({ object: pa.object, from: pa, to: pb });
    }
  }
  for (const pb of b) {
    if (!seen.has(pb.object.id)) added.push(pb);
  }
  return { moved, added, removed };
}
