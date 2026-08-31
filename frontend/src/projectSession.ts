import type {
  Contour,
  Floor,
  Opening,
  Project,
  Room,
  SceneObject,
  Zone,
} from '@houseplan/shared';
import {
  addFloor,
  allocateId,
  applySnapshot,
  createSnapshot,
  deleteObject,
  largestRoom,
  placeObject,
  rebaseCounters,
  roomCentroid,
  rotateObject,
  unplaceObject,
} from '@houseplan/shared';

const HISTORY_LIMIT = 50;

export type ProjectIntent =
  | { type: 'projectLoaded'; project: Project }
  | { type: 'projectRenamed'; project: Project }
  | { type: 'importAccepted'; project: Project }
  | { type: 'saveAcknowledged'; revision: number }
  | { type: 'saveRejected'; revision: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'floorAdded'; neighbourFloorId?: number }
  | { type: 'floorDeleted'; floorId: number }
  | { type: 'floorRenamed'; floorId: number; name: string }
  | { type: 'roomCreated'; floorId: number }
  | { type: 'roomDeleted'; floorId: number; roomId: number }
  | { type: 'roomRenamed'; floorId: number; roomId: number; name: string }
  | { type: 'shellEdited'; floorId: number; contour: Contour; openings: Opening[] }
  | { type: 'roomEdited'; floorId: number; roomId: number; contour: Contour; openings: Opening[]; zones: Zone[] }
  | { type: 'snapshotCreated'; name: string; note?: string }
  | { type: 'snapshotRestored'; snapshotId: number }
  | { type: 'snapshotDeleted'; snapshotId: number }
  | { type: 'objectCreated'; object: Omit<SceneObject, 'id'> }
  | { type: 'objectUpdated'; object: SceneObject }
  | { type: 'objectCloned'; objectId: number }
  | { type: 'objectDeleted'; objectId: number }
  | { type: 'objectPlacedInLargestRoom'; objectId: number; floorId: number }
  | { type: 'objectPlaced'; objectId: number; floorId: number; roomId: number; x: number; y: number; rotationDeg?: number }
  | { type: 'objectRotated'; objectId: number; deltaDeg: number }
  | { type: 'objectUnplaced'; objectId: number }
  | { type: 'placementMoveStarted'; objectId: number }
  | { type: 'placementMovePreviewed'; objectId: number; floorId: number; roomId: number; x: number; y: number; rotationDeg: number }
  | { type: 'gestureCommitted' }
  | { type: 'gestureCancelled' };

export type ProjectSessionFailureCode =
  | 'project-not-loaded'
  | 'floor-not-found'
  | 'room-not-found'
  | 'object-not-found'
  | 'snapshot-not-found'
  | 'placement-not-found'
  | 'placement-rejected'
  | 'gesture-active'
  | 'gesture-not-active'
  | 'gesture-mismatch'
  | 'invalid-revision'
  | 'nothing-to-undo'
  | 'nothing-to-redo'
  | 'no-change';

export type ProjectSessionResult =
  | { ok: true; revision: number; createdId?: number }
  | { ok: false; revision: number; code: ProjectSessionFailureCode };

export interface ProjectSessionSnapshot {
  /** Глубоко замороженный снимок: изменять его вне сессии нельзя. */
  readonly project: Project | null;
  readonly revision: number;
  readonly savedRevision: number;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly gestureActive: boolean;
}

export interface ProjectSession {
  getSnapshot(): ProjectSessionSnapshot;
  dispatch(intent: ProjectIntent): ProjectSessionResult;
  subscribe(listener: () => void): () => void;
}

interface GestureState {
  objectId: number;
  baseProject: Project;
}

function freezeProject(project: Project): Project {
  const seen = new WeakSet<object>();
  function freeze(value: unknown): void {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  freeze(project);
  return project;
}

function preparedProject(project: Project): Project {
  const copy = structuredClone(project);
  rebaseCounters(copy);
  return freezeProject(copy);
}

function sameProject(a: Project, b: Project): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function adoptContour(
  project: Project,
  incoming: Contour,
  existing: Contour,
): { contour: Contour; pointIds: Map<number, number> } {
  const permanentIds = new Set(existing.points.map((point) => point.id));
  const pointIds = new Map<number, number>();
  const points = incoming.points.map((point) => {
    const id = permanentIds.has(point.id) ? point.id : allocateId(project, 'point');
    pointIds.set(point.id, id);
    return { ...point, id };
  });
  const remapPoint = (id: number): number => pointIds.get(id) ?? id;
  const thicknesses: Record<number, number> = {};
  for (const [draftId, thickness] of Object.entries(incoming.thicknesses)) {
    thicknesses[remapPoint(Number(draftId))] = thickness;
  }
  return {
    contour: {
      points,
      thicknesses,
      locks: incoming.locks.map((lock) => ({
        ...lock,
        aId: remapPoint(lock.aId),
        bId: remapPoint(lock.bId),
      })),
      closed: incoming.closed,
    },
    pointIds,
  };
}

function adoptOpenings(
  project: Project,
  incoming: Opening[],
  existing: Opening[],
  pointIds: Map<number, number>,
): Opening[] {
  const permanentIds = new Set(existing.map((opening) => opening.id));
  return incoming.map((opening) => ({
    ...structuredClone(opening),
    id: permanentIds.has(opening.id) ? opening.id : allocateId(project, 'opening'),
    wallPointId: pointIds.get(opening.wallPointId) ?? opening.wallPointId,
  }));
}

function adoptShell(project: Project, incoming: Pick<Floor['shell'], 'contour' | 'openings'>, existing: Floor['shell']): Floor['shell'] {
  const adopted = adoptContour(project, incoming.contour, existing.contour);
  return {
    contour: adopted.contour,
    openings: adoptOpenings(project, incoming.openings, existing.openings, adopted.pointIds),
  };
}

function adoptRoomPlan(
  project: Project,
  incoming: Pick<Room, 'contour' | 'openings' | 'zones'>,
  existing: Room,
): Pick<Room, 'contour' | 'openings' | 'zones'> {
  const adopted = adoptContour(project, incoming.contour, existing.contour);
  const permanentZoneIds = new Set(existing.zones.map((zone) => zone.id));
  const permanentZonePointIds = new Set(existing.zones.flatMap((zone) => zone.points.map((point) => point.id)));
  const zonePointIds = new Map<number, number>();
  for (const zone of incoming.zones) {
    for (const point of zone.points) {
      if (!zonePointIds.has(point.id)) {
        zonePointIds.set(
          point.id,
          permanentZonePointIds.has(point.id) ? point.id : allocateId(project, 'point'),
        );
      }
    }
  }
  return {
    contour: adopted.contour,
    openings: adoptOpenings(project, incoming.openings, existing.openings, adopted.pointIds),
    zones: incoming.zones.map((zone) => ({
      ...structuredClone(zone),
      id: permanentZoneIds.has(zone.id) ? zone.id : allocateId(project, 'zone'),
      points: zone.points.map((point) => ({ ...point, id: zonePointIds.get(point.id)! })),
      supportWallPointId: zone.supportWallPointId === undefined
        ? undefined
        : adopted.pointIds.get(zone.supportWallPointId) ?? zone.supportWallPointId,
      fromPointId: zone.fromPointId === undefined
        ? undefined
        : adopted.pointIds.get(zone.fromPointId) ?? zone.fromPointId,
    })),
  };
}

export function createProjectSession(): ProjectSession {
  let project: Project | null = null;
  let revision = 0;
  let savedRevision = 0;
  let history: Project[] = [];
  let redo: Project[] = [];
  let gesture: GestureState | null = null;
  let snapshot = makeSnapshot();
  const listeners = new Set<() => void>();

  function makeSnapshot(): ProjectSessionSnapshot {
    return Object.freeze({
      project,
      revision,
      savedRevision,
      dirty: project !== null && revision !== savedRevision,
      canUndo: history.length > 0 && gesture === null,
      canRedo: redo.length > 0 && gesture === null,
      gestureActive: gesture !== null,
    });
  }

  function publish(): void {
    snapshot = makeSnapshot();
    listeners.forEach((listener) => listener());
  }

  function success(createdId?: number): ProjectSessionResult {
    return createdId === undefined ? { ok: true, revision } : { ok: true, revision, createdId };
  }

  function failure(code: ProjectSessionFailureCode): ProjectSessionResult {
    return { ok: false, revision, code };
  }

  function reset(next: Project): ProjectSessionResult {
    project = preparedProject(next);
    revision += 1;
    savedRevision = revision;
    history = [];
    redo = [];
    gesture = null;
    publish();
    return success();
  }

  function pushHistory(previous: Project): void {
    history.push(previous);
    if (history.length > HISTORY_LIMIT) history.shift();
    redo = [];
  }

  function commit(next: Project, createdId?: number): ProjectSessionResult {
    if (!project) return failure('project-not-loaded');
    rebaseCounters(next);
    if (sameProject(project, next)) return failure('no-change');
    pushHistory(project);
    project = freezeProject(next);
    revision += 1;
    publish();
    return success(createdId);
  }

  function editableProject(): Project | null {
    return project ? structuredClone(project) : null;
  }

  function dispatch(intent: ProjectIntent): ProjectSessionResult {
    if (intent.type === 'projectLoaded' || intent.type === 'projectRenamed') return reset(intent.project);

    if (intent.type === 'importAccepted') {
      if (!project) return reset(intent.project);
      const previous = project;
      const next = preparedProject(intent.project);
      if (sameProject(previous, next)) return failure('no-change');
      pushHistory(previous);
      project = next;
      revision += 1;
      savedRevision = revision;
      gesture = null;
      publish();
      return success();
    }

    if (!project) return failure('project-not-loaded');

    if (intent.type === 'saveAcknowledged') {
      if (intent.revision < 0 || intent.revision > revision) return failure('invalid-revision');
      const nextSavedRevision = Math.max(savedRevision, intent.revision);
      if (nextSavedRevision === savedRevision) return success();
      savedRevision = nextSavedRevision;
      publish();
      return success();
    }
    if (intent.type === 'saveRejected') {
      if (intent.revision < 0 || intent.revision > revision) return failure('invalid-revision');
      return success();
    }
    if (intent.type === 'undo') {
      if (gesture) return failure('gesture-active');
      const previous = history.pop();
      if (!previous) return failure('nothing-to-undo');
      redo.push(project);
      project = previous;
      revision += 1;
      publish();
      return success();
    }
    if (intent.type === 'redo') {
      if (gesture) return failure('gesture-active');
      const next = redo.pop();
      if (!next) return failure('nothing-to-redo');
      history.push(project);
      project = next;
      revision += 1;
      publish();
      return success();
    }
    if (intent.type === 'placementMoveStarted') {
      if (gesture) return failure('gesture-active');
      const placed = project.floors.some((floor) =>
        floor.rooms.some((room) => room.placements.some((placement) => placement.objectId === intent.objectId)),
      );
      if (!placed) return failure('placement-not-found');
      gesture = { objectId: intent.objectId, baseProject: project };
      publish();
      return success();
    }
    if (intent.type === 'placementMovePreviewed') {
      if (!gesture) return failure('gesture-not-active');
      if (gesture.objectId !== intent.objectId) return failure('gesture-mismatch');
      const next = placeObject(
        gesture.baseProject,
        intent.objectId,
        intent.floorId,
        { x: intent.x, y: intent.y },
        intent.roomId,
        intent.rotationDeg,
      );
      if (!next) return failure('placement-rejected');
      project = freezeProject(next);
      publish();
      return success();
    }
    if (intent.type === 'gestureCancelled') {
      if (!gesture) return failure('gesture-not-active');
      project = gesture.baseProject;
      gesture = null;
      publish();
      return success();
    }
    if (intent.type === 'gestureCommitted') {
      if (!gesture) return failure('gesture-not-active');
      const baseProject = gesture.baseProject;
      gesture = null;
      if (sameProject(baseProject, project)) {
        project = baseProject;
        publish();
        return failure('no-change');
      }
      pushHistory(baseProject);
      revision += 1;
      publish();
      return success();
    }

    const next = editableProject();
    if (!next) return failure('project-not-loaded');

    switch (intent.type) {
      case 'floorAdded': {
        const floor = addFloor(next, intent.neighbourFloorId);
        return commit(next, floor.id);
      }
      case 'floorDeleted': {
        const index = next.floors.findIndex((floor) => floor.id === intent.floorId);
        if (index < 0) return failure('floor-not-found');
        next.floors.splice(index, 1);
        return commit(next);
      }
      case 'floorRenamed': {
        const floor = next.floors.find((item) => item.id === intent.floorId);
        if (!floor) return failure('floor-not-found');
        floor.name = intent.name;
        return commit(next);
      }
      case 'roomCreated': {
        const floor = next.floors.find((item) => item.id === intent.floorId);
        if (!floor) return failure('floor-not-found');
        const id = allocateId(next, 'room');
        floor.rooms.push({
          id,
          name: `Помещение ${id}`,
          contour: { points: [], thicknesses: {}, locks: [], closed: false },
          openings: [],
          zones: [],
          placements: [],
        });
        return commit(next, id);
      }
      case 'roomDeleted': {
        const floor = next.floors.find((item) => item.id === intent.floorId);
        if (!floor) return failure('floor-not-found');
        const index = floor.rooms.findIndex((room) => room.id === intent.roomId);
        if (index < 0) return failure('room-not-found');
        floor.rooms.splice(index, 1);
        return commit(next);
      }
      case 'roomRenamed': {
        const floor = next.floors.find((item) => item.id === intent.floorId);
        if (!floor) return failure('floor-not-found');
        const room = floor.rooms.find((item) => item.id === intent.roomId);
        if (!room) return failure('room-not-found');
        room.name = intent.name;
        return commit(next);
      }
      case 'shellEdited': {
        const floor = next.floors.find((item) => item.id === intent.floorId);
        if (!floor) return failure('floor-not-found');
        floor.shell = adoptShell(next, intent, floor.shell);
        return commit(next);
      }
      case 'roomEdited': {
        const floor = next.floors.find((item) => item.id === intent.floorId);
        if (!floor) return failure('floor-not-found');
        const room = floor.rooms.find((item) => item.id === intent.roomId);
        if (!room) return failure('room-not-found');
        Object.assign(room, adoptRoomPlan(next, intent, room));
        return commit(next);
      }
      case 'snapshotCreated': {
        const id = allocateId(next, 'snapshot');
        next.snapshots.push(createSnapshot(next, id, intent.name, intent.note));
        return commit(next, id);
      }
      case 'snapshotRestored': {
        const item = next.snapshots.find((candidate) => candidate.id === intent.snapshotId);
        if (!item) return failure('snapshot-not-found');
        return commit(applySnapshot(next, item));
      }
      case 'snapshotDeleted': {
        const index = next.snapshots.findIndex((item) => item.id === intent.snapshotId);
        if (index < 0) return failure('snapshot-not-found');
        next.snapshots.splice(index, 1);
        return commit(next);
      }
      case 'objectCreated': {
        const id = allocateId(next, 'object');
        next.objects.push({ ...structuredClone(intent.object), id });
        return commit(next, id);
      }
      case 'objectUpdated': {
        const index = next.objects.findIndex((item) => item.id === intent.object.id);
        if (index < 0) return failure('object-not-found');
        next.objects[index] = structuredClone(intent.object);
        return commit(next);
      }
      case 'objectCloned': {
        const source = next.objects.find((item) => item.id === intent.objectId);
        if (!source) return failure('object-not-found');
        const id = allocateId(next, 'object');
        next.objects.push({ ...structuredClone(source), id, name: `${source.name} (копия)` });
        return commit(next, id);
      }
      case 'objectDeleted': {
        if (!next.objects.some((item) => item.id === intent.objectId)) return failure('object-not-found');
        return commit(deleteObject(next, intent.objectId));
      }
      case 'objectPlacedInLargestRoom': {
        const floor = next.floors.find((item) => item.id === intent.floorId);
        if (!floor) return failure('floor-not-found');
        const room = largestRoom(floor);
        if (!room) return failure('room-not-found');
        const placed = placeObject(next, intent.objectId, floor.id, roomCentroid(room), room.id);
        return placed ? commit(placed) : failure('placement-rejected');
      }
      case 'objectPlaced': {
        const placed = placeObject(
          next,
          intent.objectId,
          intent.floorId,
          { x: intent.x, y: intent.y },
          intent.roomId,
          intent.rotationDeg,
        );
        return placed ? commit(placed) : failure('placement-rejected');
      }
      case 'objectRotated': {
        if (!next.objects.some((item) => item.id === intent.objectId)) return failure('object-not-found');
        const rotated = rotateObject(next, intent.objectId, intent.deltaDeg);
        return rotated ? commit(rotated) : failure('placement-not-found');
      }
      case 'objectUnplaced': {
        const placed = next.floors.some((floor) =>
          floor.rooms.some((room) => room.placements.some((placement) => placement.objectId === intent.objectId)),
        );
        return placed ? commit(unplaceObject(next, intent.objectId)) : failure('placement-not-found');
      }
    }
  }

  return {
    getSnapshot: () => snapshot,
    dispatch,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
