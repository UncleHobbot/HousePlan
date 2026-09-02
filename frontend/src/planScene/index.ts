import {
  bodyPolygon,
  canSlide,
  clearancePolygon,
  conflictObjectIds,
  diffPlacements,
  livePlacements,
  lockedWalls,
  openingSegment,
  pointAverage,
  projectedZonesForFloor,
  type Contour,
  type Opening,
  type Project,
  type Zone,
  type ZoneKind,
} from '@houseplan/shared';
import type { EditorSessionSnapshot } from '../editor/editorSession.js';

export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

export type SceneRole =
  | 'zone'
  | 'wall-thickness'
  | 'shell-wall'
  | 'room-wall'
  | 'wall'
  | 'wall-locked'
  | 'wall-crossed'
  | 'wall-diagonal'
  | 'window'
  | 'door'
  | 'door-swing'
  | 'object'
  | 'object-front'
  | 'clearance'
  | 'clearance-conflict'
  | 'zone-label'
  | 'object-label'
  | 'zone-point'
  | 'point'
  | 'draft'
  | 'draft-preview'
  | 'draft-point'
  | 'wall-length'
  | 'point-label'
  | 'contour-preview';

export type SceneTarget =
  | { readonly kind: 'object'; readonly objectId: number }
  | { readonly kind: 'wall'; readonly wallIndex: number }
  | { readonly kind: 'point'; readonly pointId: number }
  | { readonly kind: 'zoneVertex'; readonly zoneId: number; readonly pointId: number };

export type SceneState =
  | 'selected'
  | 'comparison'
  | 'selected-a'
  | 'selected-b'
  | 'movable'
  | 'immovable'
  | 'locked';

export interface ScenePathMark {
  readonly key: string;
  readonly kind: 'path';
  readonly role: SceneRole;
  readonly points: readonly ScenePoint[];
  readonly closed: boolean;
  readonly target?: SceneTarget;
  readonly tint?: string;
  readonly states?: readonly SceneState[];
  readonly zoneKind?: ZoneKind;
}

export interface SceneLabelMark {
  readonly key: string;
  readonly kind: 'label';
  readonly role: SceneRole;
  readonly at: ScenePoint;
  readonly text: string;
  readonly target?: SceneTarget;
  readonly states?: readonly SceneState[];
  readonly zoneKind?: ZoneKind;
}

export interface SceneMarkerMark {
  readonly key: string;
  readonly kind: 'marker';
  readonly role: SceneRole;
  readonly at: ScenePoint;
  readonly target?: SceneTarget;
  readonly states?: readonly SceneState[];
  readonly zoneKind?: ZoneKind;
}

export type SceneMark = ScenePathMark | SceneLabelMark | SceneMarkerMark;

export type SceneDiagnostic =
  | { readonly code: 'floor-not-found'; readonly floorId: number }
  | { readonly code: 'opening-detached'; readonly openingId: number }
  | { readonly code: 'object-not-found'; readonly objectId: number };

export interface PlanScene {
  readonly extent: readonly ScenePoint[];
  readonly marks: readonly SceneMark[];
  readonly diagnostics: readonly SceneDiagnostic[];
}

export interface FloorSceneInput {
  readonly project: Project;
  readonly floorId: number;
  readonly selectedObjectId: number | null;
  readonly compareSnapshotId?: number;
}

function toScenePoint({ x, y }: ScenePoint): ScenePoint {
  return { x, y };
}

function markExtent(mark: SceneMark): readonly ScenePoint[] {
  if (mark.role === 'contour-preview' || mark.role === 'draft-preview') return [];
  return mark.kind === 'path' ? mark.points : [mark.at];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((child) => deepFreeze(child));
  }
  return value;
}

function finishScene(scene: PlanScene): PlanScene {
  return deepFreeze(scene);
}

function wallThicknessBands(contour: Contour): ScenePoint[][] {
  const points = contour.points;
  const count = points.length;
  if (!contour.closed || count < 3) return [];
  const signedDoubleArea = points.reduce((area, current, index) => {
    const next = points[(index + 1) % count];
    return area + current.x * next.y - next.x * current.y;
  }, 0);
  const outwardNormalSign = signedDoubleArea >= 0 ? 1 : -1;
  return points.flatMap((start, index) => {
    const end = points[(index + 1) % count];
    const thickness = contour.thicknesses[start.id] ?? 0;
    if (!thickness) return [];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const normalX = (dy / length) * thickness * outwardNormalSign;
    const normalY = (-dx / length) * thickness * outwardNormalSign;
    return [[
      toScenePoint(start),
      toScenePoint(end),
      { x: Math.round(end.x + normalX), y: Math.round(end.y + normalY) },
      { x: Math.round(start.x + normalX), y: Math.round(start.y + normalY) },
    ]];
  });
}

function contourThicknessMarks(contour: Contour, prefix: string): ScenePathMark[] {
  const wallIds = contour.points
    .filter((wallPoint) => (contour.thicknesses[wallPoint.id] ?? 0) > 0)
    .map((wallPoint) => wallPoint.id);
  return wallThicknessBands(contour).map((points, index) => ({
    key: `${prefix}-thickness-${wallIds[index] ?? index}`,
    kind: 'path',
    role: 'wall-thickness',
    points: points.map(toScenePoint),
    closed: true,
  }));
}

function doorArc(hinge: ScenePoint, other: ScenePoint, centroid: ScenePoint, width: number): ScenePoint[] {
  let dx = other.x - hinge.x;
  let dy = other.y - hinge.y;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  let nx = -dy;
  let ny = dx;
  if (nx * (centroid.x - hinge.x) + ny * (centroid.y - hinge.y) < 0) {
    nx = -nx;
    ny = -ny;
  }
  const start = Math.atan2(dy, dx);
  let end = Math.atan2(ny, nx);
  while (end - start > Math.PI) end -= Math.PI * 2;
  while (end - start < -Math.PI) end += Math.PI * 2;
  return Array.from({ length: 13 }, (_, index) => {
    const angle = start + ((end - start) * index) / 12;
    return { x: hinge.x + Math.cos(angle) * width, y: hinge.y + Math.sin(angle) * width };
  });
}

function buildZoneMarks(zones: readonly Zone[]): {
  paths: ScenePathMark[];
  labels: SceneLabelMark[];
} {
  return {
    paths: zones.map((zone) => ({
      key: `zone-${zone.id}`,
      kind: 'path',
      role: 'zone',
      points: zone.points.map(toScenePoint),
      closed: true,
      zoneKind: zone.kind,
    })),
    labels: zones.map((zone) => {
      const center = pointAverage(zone.points);
      return {
        key: `zone-label-${zone.id}`,
        kind: 'label',
        role: 'zone-label',
        at: { x: Math.round(center.x), y: Math.round(center.y) },
        text: `${zone.name}${zone.spansFloors ? ' ⭥' : ''}`,
        zoneKind: zone.kind,
      };
    }),
  };
}

function buildOpeningMarks(
  sources: readonly { contour: Contour; openings: readonly Opening[] }[],
  diagnostics: SceneDiagnostic[],
): ScenePathMark[] {
  return sources.flatMap(({ contour, openings }) => openings.flatMap((opening) => {
    const segment = openingSegment(contour.points, opening.wallPointId, opening.offsetCm, opening.widthCm);
    if (!segment) {
      diagnostics.push({ code: 'opening-detached', openingId: opening.id });
      return [];
    }
    const openingMark: ScenePathMark = {
      key: `opening-${opening.id}`,
      kind: 'path',
      role: opening.kind === 'window' ? 'window' : 'door',
      points: [toScenePoint(segment.start), toScenePoint(segment.end)],
      closed: false,
    };
    if (opening.kind === 'window') return [openingMark];
    const hinge = opening.opensTo === 'left' ? segment.start : segment.end;
    const other = opening.opensTo === 'left' ? segment.end : segment.start;
    return [openingMark, {
      key: `door-swing-${opening.id}`,
      kind: 'path' as const,
      role: 'door-swing' as const,
      points: [
        toScenePoint(hinge),
        toScenePoint(other),
        ...doorArc(hinge, other, pointAverage(contour.points), opening.widthCm),
      ],
      closed: false,
    }];
  }));
}

export function buildFloorScene(input: FloorSceneInput): PlanScene {
  const floor = input.project.floors.find((item) => item.id === input.floorId);
  if (!floor) {
    return finishScene({
      extent: [],
      marks: [],
      diagnostics: [{ code: 'floor-not-found', floorId: input.floorId }],
    });
  }

  const diagnostics: SceneDiagnostic[] = [];
  const zones = [
    ...floor.rooms.flatMap((room) => room.zones),
    ...projectedZonesForFloor(input.project, floor.id),
  ];
  const conflicts = conflictObjectIds(input.project.objects, floor, zones);
  const comparedObjectIds = new Set<number>();
  const comparedSnapshot = input.compareSnapshotId === undefined
    ? undefined
    : input.project.snapshots.find((snapshot) => snapshot.id === input.compareSnapshotId);
  if (comparedSnapshot) {
    const comparison = diffPlacements(comparedSnapshot.placements, livePlacements(input.project));
    comparison.moved.forEach(({ object }) => comparedObjectIds.add(object.id));
    comparison.added.forEach(({ object }) => comparedObjectIds.add(object.id));
  }
  const objectsById = new Map(input.project.objects.map((object) => [object.id, object]));
  const placements = floor.rooms.flatMap((room) => room.placements);
  const zoneMarks = buildZoneMarks(zones);
  const clearanceMarks: ScenePathMark[] = placements.flatMap((placement) => {
    const object = objectsById.get(placement.objectId);
    if (!object) {
      diagnostics.push({ code: 'object-not-found', objectId: placement.objectId });
      return [];
    }
    return [{
      key: `object-clearance-${object.id}`,
      kind: 'path' as const,
      role: conflicts.has(object.id) ? 'clearance-conflict' as const : 'clearance' as const,
      points: clearancePolygon(object, placement).map(toScenePoint),
      closed: true,
      target: { kind: 'object' as const, objectId: object.id },
    }];
  });
  const thicknessMarks = [
    ...contourThicknessMarks(floor.shell.contour, 'shell'),
    ...floor.rooms.flatMap((room) => contourThicknessMarks(room.contour, `room-${room.id}`)),
  ];
  const shellMark: ScenePathMark = {
    key: 'shell-contour',
    kind: 'path',
    role: 'shell-wall',
    points: floor.shell.contour.points.map(toScenePoint),
    closed: floor.shell.contour.closed,
  };
  const roomMarks: ScenePathMark[] = floor.rooms.map((room) => ({
    key: `room-contour-${room.id}`,
    kind: 'path',
    role: 'room-wall',
    points: room.contour.points.map(toScenePoint),
    closed: room.contour.closed,
  }));
  const openingMarks = buildOpeningMarks([
    { contour: floor.shell.contour, openings: floor.shell.openings },
    ...floor.rooms.map((room) => ({ contour: room.contour, openings: room.openings })),
  ], diagnostics);
  const objectPaths: ScenePathMark[] = placements.flatMap((placement) => {
    const object = objectsById.get(placement.objectId);
    if (!object) return [];
    const body = bodyPolygon(object, placement).map(toScenePoint);
    const states: SceneState[] = [];
    if (input.selectedObjectId === object.id) states.push('selected');
    if (comparedObjectIds.has(object.id)) states.push('comparison');
    return [{
      key: `object-body-${object.id}`,
      kind: 'path' as const,
      role: 'object' as const,
      points: body,
      closed: true,
      target: { kind: 'object' as const, objectId: object.id },
      ...(object.color ? { tint: object.color } : {}),
      ...(states.length > 0 ? { states } : {}),
    }, {
      key: `object-front-${object.id}`,
      kind: 'path' as const,
      role: 'object-front' as const,
      points: [body[2], body[3]],
      closed: false,
      target: { kind: 'object' as const, objectId: object.id },
    }];
  });
  const objectLabels: SceneLabelMark[] = placements.flatMap((placement) => {
    const object = objectsById.get(placement.objectId);
    if (!object) return [];
    return [{
      key: `object-label-${object.id}`,
      kind: 'label' as const,
      role: 'object-label' as const,
      at: toScenePoint(placement),
      text: object.name,
      target: { kind: 'object' as const, objectId: object.id },
    }];
  });
  const marks: SceneMark[] = [
    ...zoneMarks.paths,
    ...clearanceMarks,
    ...thicknessMarks,
    shellMark,
    ...roomMarks,
    ...openingMarks,
    ...objectPaths,
    ...zoneMarks.labels,
    ...objectLabels,
  ];

  return finishScene({
    extent: marks.flatMap(markExtent),
    marks,
    diagnostics,
  });
}

export function buildEditableScene(editorState: EditorSessionSnapshot): PlanScene {
  const points = editorState.plan.contour.points;
  const zones = editorState.plan.kind === 'room' ? editorState.plan.zones : [];
  const wallCount = editorState.plan.contour.closed ? points.length : Math.max(0, points.length - 1);
  const busyWalls = lockedWalls(editorState.plan.contour);
  const thicknessMarks = contourThicknessMarks(editorState.plan.contour, 'editor');
  const wallMarks: ScenePathMark[] = Array.from({ length: wallCount }, (_, wallIndex) => ({
    key: `editor-wall-${points[wallIndex].id}`,
    kind: 'path',
    role: editorState.canvas.crossedWalls.includes(wallIndex)
      ? 'wall-crossed'
      : busyWalls.has(wallIndex)
        ? 'wall-locked'
        : points[wallIndex].x !== points[(wallIndex + 1) % points.length].x &&
            points[wallIndex].y !== points[(wallIndex + 1) % points.length].y
          ? 'wall-diagonal'
          : 'wall',
    points: [toScenePoint(points[wallIndex]), toScenePoint(points[(wallIndex + 1) % points.length])],
    closed: false,
    target: { kind: 'wall', wallIndex },
  }));
  const wallLabels: SceneLabelMark[] = editorState.plan.contour.closed ? Array.from({ length: wallCount }, (_, wallIndex) => {
    const start = points[wallIndex];
    const end = points[(wallIndex + 1) % points.length];
    const locked = busyWalls.has(wallIndex);
    return {
      key: `wall-length-${start.id}`,
      kind: 'label',
      role: 'wall-length',
      at: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      text: `${Math.round(Math.hypot(end.x - start.x, end.y - start.y))}${locked ? ' 🔒' : ''}`,
      ...(locked ? { states: ['locked' as const] } : {}),
    };
  }) : [];
  const diagnostics: SceneDiagnostic[] = [];
  const openingMarks = editorState.plan.contour.closed
    ? buildOpeningMarks([{ contour: editorState.plan.contour, openings: editorState.plan.openings }], diagnostics)
    : [];
  const zoneMarks = buildZoneMarks(zones);
  const zonePoints: SceneMarkerMark[] = zones.flatMap((zone) => zone.points.map((zonePoint) => ({
    key: `zone-point-${zonePoint.id}`,
    kind: 'marker' as const,
    role: 'zone-point' as const,
    at: toScenePoint(zonePoint),
    zoneKind: zone.kind,
    target: { kind: 'zoneVertex' as const, zoneId: zone.id, pointId: zonePoint.id },
  })));
  const pointMarks: SceneMarkerMark[] = points.map((contourPoint) => {
    const states: SceneState[] = editorState.canvas.selection.aId === contourPoint.id
      ? ['selected-a']
      : editorState.canvas.selection.bId === contourPoint.id
        ? ['selected-b']
        : canSlide(editorState.plan.contour, contourPoint.id).ok
          ? ['movable']
          : ['immovable'];
    return {
      key: `point-${contourPoint.id}`,
      kind: 'marker',
      role: 'point',
      at: toScenePoint(contourPoint),
      target: { kind: 'point', pointId: contourPoint.id },
      states,
    };
  });
  const pointLabels: SceneLabelMark[] = points.map((contourPoint) => ({
    key: `point-label-${contourPoint.id}`,
    kind: 'label',
    role: 'point-label',
    at: toScenePoint(contourPoint),
    text: `А${contourPoint.id}`,
  }));
  const contourPreview: ScenePathMark[] = !editorState.plan.contour.closed && points.length > 0 && editorState.canvas.pointer
    ? [{
      key: 'contour-preview',
      kind: 'path',
      role: 'contour-preview',
      points: [toScenePoint(points.at(-1)!), toScenePoint(editorState.canvas.pointer)],
      closed: false,
    }]
    : [];
  const draft = editorState.tool.kind === 'polygonZone' || editorState.tool.kind === 'partition'
    ? editorState.tool.draft
    : null;
  const draftMarks: SceneMark[] = [];
  if (draft) {
    if (draft.points.length > 1) {
      draftMarks.push({
        key: 'draft-zone',
        kind: 'path',
        role: 'draft',
        points: draft.points.map(toScenePoint),
        closed: false,
      });
    }
    const lastDraftPoint = draft.points.at(-1);
    if (lastDraftPoint && editorState.canvas.pointer) {
      draftMarks.push({
        key: 'draft-preview',
        kind: 'path',
        role: 'draft-preview',
        points: [toScenePoint(lastDraftPoint), toScenePoint(editorState.canvas.pointer)],
        closed: false,
      });
    }
    draftMarks.push(...draft.points.map((draftPoint, index) => ({
      key: `draft-point-${index}`,
      kind: 'marker' as const,
      role: 'draft-point' as const,
      at: toScenePoint(draftPoint),
    })));
  }
  const marks: SceneMark[] = [
    ...zoneMarks.paths,
    ...thicknessMarks,
    ...wallMarks,
    ...openingMarks,
    ...wallLabels,
    ...zoneMarks.labels,
    ...pointLabels,
    ...zonePoints,
    ...pointMarks,
    ...contourPreview,
    ...draftMarks,
  ];
  return finishScene({
    extent: marks.flatMap(markExtent),
    marks,
    diagnostics,
  });
}
