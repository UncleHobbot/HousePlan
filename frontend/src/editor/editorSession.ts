import type {
  Contour,
  Floor,
  Opening,
  OpeningKind,
  Point,
  SizeLock,
  Zone,
  ZoneKind,
} from '@houseplan/shared';
import { canSlide, chainInfo, crossings, deletePoint, makeOpening, NO_CLEARANCE, pointAverage, pointDeletionPreview, rebaseOpenings, rebaseZones, slidePoint } from '@houseplan/shared';
import { projectOntoWall, reduceDimensionSelection, snapPoint } from './editorMachine';
import { PARTITION_THICKNESS_CM } from './editorConstants';

export type EditorPlan =
  | {
      kind: 'shell';
      name: string;
      contour: Contour;
      openings: Opening[];
      openingKinds: Extract<OpeningKind, 'window' | 'entryDoor'>[];
    }
  | {
      kind: 'room';
      name: string;
      contour: Contour;
      openings: Opening[];
      openingKinds: Extract<OpeningKind, 'innerDoor'>[];
      zones: Zone[];
      floors: Floor[];
      floorId: number;
    };

export type EditorTool =
  | { kind: 'drawContour' }
  | { kind: 'select' }
  | { kind: 'opening'; openingKind: OpeningKind }
  | { kind: 'polygonZone'; zoneKind: ZoneKind; zoneName: string; draft: EditorZoneDraft | null }
  | { kind: 'partition'; zoneKind: ZoneKind; zoneName: string; draft: EditorZoneDraft | null };

export interface EditorZoneDraft {
  anchorId: number;
  points: Point[];
  wallDir: { x: number; y: number } | null;
  basePlan: EditorPlan;
}

export interface EditorCommitRequest {
  plan: EditorPlan;
  expectedRevision: number;
  action: EditorAction;
}

export type EditorAction =
  | 'point-added'
  | 'contour-closed'
  | 'wall-split'
  | 'point-deleted'
  | 'point-moved'
  | 'dimension-pinned'
  | 'lock-removed'
  | 'opening-added'
  | 'opening-changed'
  | 'opening-deleted'
  | 'zone-added'
  | 'zone-changed'
  | 'zone-deleted'
  | 'zone-vertex-moved';

export type EditorCommitResult =
  | { ok: true; revision: number; plan: EditorPlan }
  | { ok: false; revision: number; code: string; plan?: EditorPlan };

export interface EditorDimensionSolver {
  pin(
    contour: Contour,
    aId: number,
    bId: number,
    target: number,
  ): { ok: true; contour: Contour; label: string } | { ok: false; reason: string; conflicts: string[] };
  dispose(): void;
}

export interface EditorSessionDependencies {
  source: { plan: EditorPlan; revision: number };
  commit(request: EditorCommitRequest): EditorCommitResult;
  loadSolver(): Promise<EditorDimensionSolver>;
}

export interface EditorSessionSnapshot {
  readonly plan: EditorPlan;
  readonly revision: number;
  readonly tool: EditorTool;
  readonly canvas: {
    pointer: { x: number; y: number } | null;
    selection: { aId: number | null; bId: number | null };
    snap: boolean;
    crossedWalls: readonly number[];
    cursor: 'default' | 'crosshair';
  };
  readonly dimension: {
    value: string;
    invalid: boolean;
    solver: 'loading' | 'ready' | 'failed';
    canPin: boolean;
    description: { code: string; data?: Record<string, unknown> };
  };
  readonly preferences: { openingKind: OpeningKind; zoneKind: ZoneKind };
  readonly capabilities: { hasUncommittedDraft: boolean };
}

export type EditorIntent =
  | { type: 'toolSelected'; tool: { kind: 'select' } | { kind: 'opening'; openingKind: OpeningKind } | { kind: 'polygonZone'; zoneKind: ZoneKind; zoneName: string } | { kind: 'partition'; zoneKind: ZoneKind; zoneName: string } }
  | { type: 'toolCancelled' }
  | { type: 'canvasClicked'; event: { position: { x: number; y: number }; target: { kind: 'canvas' } | { kind: 'point'; pointId: number } | { kind: 'wall'; wallIndex: number } | { kind: 'zoneVertex'; zoneId: number; pointId: number } } }
  | { type: 'pointerPressed'; event: { position: { x: number; y: number }; target: { kind: 'canvas' } | { kind: 'point'; pointId: number } | { kind: 'wall'; wallIndex: number } | { kind: 'zoneVertex'; zoneId: number; pointId: number } } }
  | { type: 'pointerMoved'; position: { x: number; y: number } }
  | { type: 'pointerReleased' }
  | { type: 'pointerCancelled' }
  | { type: 'deleteRequested'; pointId: number }
  | { type: 'deleteConfirmed'; pointId: number }
  | { type: 'zoneFinished' }
  | { type: 'dimensionValueChanged'; value: string }
  | { type: 'dimensionPinRequested' }
  | { type: 'selectionReset' }
  | { type: 'lockRemoved'; lock: SizeLock }
  | { type: 'snapChanged'; value: boolean }
  | { type: 'openingKindSelected'; kind: OpeningKind }
  | { type: 'zoneKindSelected'; kind: ZoneKind }
  | { type: 'pointerLeft' }
  | { type: 'openingChanged'; opening: Opening }
  | { type: 'openingDeleted'; openingId: number }
  | { type: 'zoneChanged'; zone: Zone }
  | { type: 'zoneDeleted'; zoneId: number }
  | { type: 'exitRequested' }
  | { type: 'draftDiscarded' }
  | { type: 'sourceChanged'; plan: EditorPlan; revision: number; origin: 'ownCommit' | 'external' };

export type EditorDispatchResult =
  | { ok: true; code?: string; data?: Record<string, unknown> }
  | { ok: false; code: string; data?: Record<string, unknown> }
  | { ok: false; confirmation: { kind: 'delete-point' | 'discard-draft'; data: Record<string, unknown> } };

export interface EditorSession {
  getSnapshot(): EditorSessionSnapshot;
  dispatch(intent: EditorIntent): EditorDispatchResult;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function createEditorSession(dependencies: EditorSessionDependencies): EditorSession {
  let plan = structuredClone(dependencies.source.plan);
  let revision = dependencies.source.revision;
  let tool: EditorTool = plan.contour.closed ? { kind: 'select' } : { kind: 'drawContour' };
  let solver: EditorDimensionSolver | null = null;
  let solverState: EditorSessionSnapshot['dimension']['solver'] = 'loading';
  let disposed = false;
  let nextDraftId = -1;
  let pointer: { x: number; y: number } | null = null;
  let selection = { aId: null, bId: null } as { aId: number | null; bId: number | null };
  let inputValue = '';
  let inputInvalid = false;
  let snapEnabled = true;
  let openingKind: OpeningKind = plan.openingKinds[0];
  let zoneKind: ZoneKind = 'partition';
  let drag:
    | { kind: 'point'; pointId: number; basePlan: EditorPlan; changed: boolean }
    | { kind: 'zoneVertex'; zoneId: number; pointId: number; basePlan: EditorPlan; changed: boolean }
    | null = null;
  const listeners = new Set<() => void>();
  let snapshot = makeSnapshot();

  dependencies.loadSolver().then((loaded) => {
    if (disposed) loaded.dispose();
    else {
      solver = loaded;
      solverState = 'ready';
      publish();
    }
  }).catch(() => {
    if (!disposed) {
      solverState = 'failed';
      publish();
    }
  });

  function makeSnapshot(): EditorSessionSnapshot {
    const crossingPairs = plan.contour.closed ? crossings(plan.contour.points) : [];
    const crossedWalls = [...new Set(crossingPairs.flat())];
    const dimensionDescription = (() => {
      if (selection.aId !== null && selection.bId !== null) {
        const info = chainInfo(plan.contour, selection.aId, selection.bId);
        return info.ok
          ? { code: 'dimension-selected', data: { aId: selection.aId, bId: selection.bId, length: info.length } }
          : { code: 'dimension-selection-invalid', data: { reason: info.reason } };
      }
      if (selection.aId !== null) return { code: 'dimension-first-point-selected', data: { aId: selection.aId } };
      return { code: 'dimension-select-points' };
    })();
    return deepFreeze({
      plan: structuredClone(plan),
      revision,
      tool: structuredClone(tool),
      canvas: {
        pointer,
        selection: { ...selection },
        snap: snapEnabled,
        crossedWalls,
        cursor: tool.kind === 'opening' || tool.kind === 'polygonZone' || tool.kind === 'partition' ? 'crosshair' : 'default',
      },
      dimension: {
        value: inputValue,
        invalid: inputInvalid,
        solver: solverState,
        canPin: dimensionDescription.code === 'dimension-selected',
        description: dimensionDescription,
      },
      preferences: { openingKind, zoneKind },
      capabilities: {
        hasUncommittedDraft: (tool.kind === 'polygonZone' || tool.kind === 'partition') && tool.draft !== null,
      },
    });
  }

  function publish(): void {
    snapshot = makeSnapshot();
    listeners.forEach((listener) => listener());
  }

  function commitPlan(next: EditorPlan, action: EditorAction): EditorDispatchResult {
    const result = dependencies.commit({ plan: next, expectedRevision: revision, action });
    if (!result.ok) {
      if (result.plan) reconcileExternalSource(result.plan, result.revision);
      else revision = result.revision;
      publish();
      return { ok: false, code: result.code };
    }
    plan = structuredClone(result.plan);
    revision = result.revision;
    reconcileSelection();
    publish();
    return { ok: true, code: action };
  }

  function reconcileSelection(): void {
    const aId = plan.contour.points.some((point) => point.id === selection.aId) ? selection.aId : null;
    selection = {
      aId,
      bId: aId !== null && plan.contour.points.some((point) => point.id === selection.bId) ? selection.bId : null,
    };
  }

  function reconcileExternalSource(sourcePlan: EditorPlan, sourceRevision: number): void {
    plan = structuredClone(sourcePlan);
    revision = sourceRevision;
    drag = null;
    reconcileSelection();
    tool = plan.contour.closed ? { kind: 'select' } : { kind: 'drawContour' };
  }

  function withContour(base: EditorPlan, contour: Contour): EditorPlan {
    const next = structuredClone(base);
    const previousPoints = next.contour.points;
    next.contour = contour;
    next.openings = rebaseOpenings(previousPoints, contour.points, next.openings);
    if (next.kind === 'room') next.zones = rebaseZones(previousPoints, contour.points, next.zones);
    return next;
  }

  function beginZoneDraft(event: Extract<EditorIntent, { type: 'canvasClicked' }>['event']): EditorDispatchResult {
    if ((tool.kind !== 'polygonZone' && tool.kind !== 'partition') || plan.kind !== 'room') {
      return { ok: false, code: 'zone-tool-not-active' };
    }
    let workingPlan: EditorPlan = plan;
    let anchorId: number;
    let coords: { x: number; y: number };
    let wallDir: { x: number; y: number } | null = null;
    if (event.target.kind === 'point') {
      if (tool.kind === 'partition') return { ok: false, code: 'partition-wall-required' };
      const pointId = event.target.pointId;
      const point = plan.contour.points.find((item) => item.id === pointId);
      if (!point) return { ok: false, code: 'point-not-found' };
      anchorId = point.id;
      coords = { x: point.x, y: point.y };
    } else if (event.target.kind === 'wall') {
      const start = plan.contour.points[event.target.wallIndex];
      const end = plan.contour.points[(event.target.wallIndex + 1) % plan.contour.points.length];
      if (!start || !end) return { ok: false, code: 'wall-not-found' };
      coords = projectOntoWall(event.position, start, end);
      anchorId = nextDraftId--;
      const points = [...plan.contour.points];
      points.splice(event.target.wallIndex + 1, 0, { id: anchorId, ...coords });
      workingPlan = withContour(plan, {
        ...plan.contour,
        points,
        thicknesses: { ...plan.contour.thicknesses, [anchorId]: plan.contour.thicknesses[start.id] ?? 10 },
      });
      const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
      wallDir = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    } else {
      return { ok: false, code: 'zone-anchor-required' };
    }
    const draft: EditorZoneDraft = {
      anchorId,
      points: [{ id: nextDraftId--, ...coords }],
      wallDir,
      basePlan: structuredClone(plan),
    };
    plan = workingPlan;
    tool = { ...tool, draft };
    publish();
    return { ok: true };
  }

  function splitWall(base: EditorPlan, wallIndex: number, position: { x: number; y: number }): { plan: EditorPlan; pointId: number; coords: { x: number; y: number } } | null {
    const start = base.contour.points[wallIndex];
    const end = base.contour.points[(wallIndex + 1) % base.contour.points.length];
    if (!start || !end) return null;
    const coords = projectOntoWall(position, start, end);
    const pointId = nextDraftId--;
    const points = [...base.contour.points];
    points.splice(wallIndex + 1, 0, { id: pointId, ...coords });
    return {
      plan: withContour(base, {
        ...base.contour,
        points,
        thicknesses: { ...base.contour.thicknesses, [pointId]: base.contour.thicknesses[start.id] ?? 10 },
      }),
      pointId,
      coords,
    };
  }

  function finishPolygonZone(): EditorDispatchResult {
    if (tool.kind !== 'polygonZone' || !tool.draft || plan.kind !== 'room') return { ok: false, code: 'zone-draft-not-active' };
    if (tool.draft.points.length < 3) return { ok: false, code: 'zone-needs-three-points' };
    const next = structuredClone(plan);
    next.zones.push({
      id: nextDraftId--,
      kind: tool.zoneKind,
      name: tool.zoneName,
      points: structuredClone(tool.draft.points),
      supportWallPointId: tool.draft.anchorId,
      clearances: { ...NO_CLEARANCE },
      attributes: [],
    });
    const result = commitPlan(next, 'zone-added');
    if (result.ok) tool = { kind: 'select' };
    publish();
    return result;
  }

  function dispatch(intent: EditorIntent): EditorDispatchResult {
    if (intent.type === 'toolSelected') {
      if ((tool.kind === 'polygonZone' || tool.kind === 'partition') && tool.draft) plan = tool.draft.basePlan;
      if (drag) plan = drag.basePlan;
      drag = null;
      if (intent.tool.kind === 'opening') openingKind = intent.tool.openingKind;
      if (intent.tool.kind === 'polygonZone' || intent.tool.kind === 'partition') zoneKind = intent.tool.zoneKind;
      tool = intent.tool.kind === 'polygonZone' || intent.tool.kind === 'partition'
        ? { ...intent.tool, draft: null }
        : intent.tool;
      publish();
      return {
        ok: true,
        code: intent.tool.kind === 'opening'
          ? 'opening-tool-selected'
          : intent.tool.kind === 'polygonZone'
            ? 'zone-tool-selected'
            : intent.tool.kind === 'partition'
              ? 'partition-tool-selected'
              : 'select-tool-selected',
      };
    }
    if (intent.type === 'toolCancelled') {
      if ((tool.kind === 'polygonZone' || tool.kind === 'partition') && tool.draft) {
        plan = tool.draft.basePlan;
      }
      tool = plan.contour.closed ? { kind: 'select' } : { kind: 'drawContour' };
      publish();
      return { ok: true, code: 'tool-cancelled' };
    }
    if (intent.type === 'canvasClicked') {
      if (tool.kind === 'polygonZone' || tool.kind === 'partition') {
        if (!tool.draft) return beginZoneDraft(intent.event);
        if (tool.kind === 'partition') {
          if (plan.kind !== 'room' || !tool.draft.wallDir) return { ok: false, code: 'partition-wall-required' };
          const anchor = tool.draft.points[0];
          const direction = tool.draft.wallDir;
          let nx = -direction.y;
          let ny = direction.x;
          const center = pointAverage(plan.contour.points);
          if (nx * (center.x - anchor.x) + ny * (center.y - anchor.y) < 0) { nx = -nx; ny = -ny; }
          const length = (intent.event.position.x - anchor.x) * nx + (intent.event.position.y - anchor.y) * ny;
          if (length < 20) return { ok: false, code: 'partition-too-short' };
          const ids = [nextDraftId--, nextDraftId--, nextDraftId--, nextDraftId--];
          const next = structuredClone(plan);
          next.zones.push({
            id: nextDraftId--,
            kind: tool.zoneKind === 'decorativeWall' ? 'decorativeWall' : 'partition',
            name: tool.zoneName,
            points: [
              { id: ids[0], x: anchor.x, y: anchor.y },
              { id: ids[1], x: Math.round(anchor.x + nx * length), y: Math.round(anchor.y + ny * length) },
              { id: ids[2], x: Math.round(anchor.x + nx * length + direction.x * PARTITION_THICKNESS_CM), y: Math.round(anchor.y + ny * length + direction.y * PARTITION_THICKNESS_CM) },
              { id: ids[3], x: Math.round(anchor.x + direction.x * PARTITION_THICKNESS_CM), y: Math.round(anchor.y + direction.y * PARTITION_THICKNESS_CM) },
            ],
            fromPointId: tool.draft.anchorId,
            clearances: { ...NO_CLEARANCE },
            attributes: [],
          });
          const result = commitPlan(next, 'zone-added');
          if (result.ok) tool = { kind: 'select' };
          publish();
          return result;
        }
        const first = tool.draft.points[0];
        if (tool.draft.points.length >= 3 && Math.hypot(intent.event.position.x - first.x, intent.event.position.y - first.y) < 14) {
          return finishPolygonZone();
        }
        const position = snapPoint(intent.event.position, plan.contour.points, true, snapshot.canvas.snap);
        tool = { ...tool, draft: { ...tool.draft, points: [...tool.draft.points, { id: nextDraftId--, ...position }] } };
        publish();
        return { ok: true };
      }
      if (tool.kind === 'select') {
        if (intent.event.target.kind === 'point') {
          selection = reduceDimensionSelection(selection, { type: 'pointClicked', pointId: intent.event.target.pointId });
          publish();
          return { ok: true };
        }
        if (intent.event.target.kind === 'canvas') {
          selection = reduceDimensionSelection(selection, { type: 'reset' });
          publish();
          return { ok: true };
        }
        if (intent.event.target.kind === 'wall') {
          const split = splitWall(plan, intent.event.target.wallIndex, intent.event.position);
          return split ? commitPlan(split.plan, 'wall-split') : { ok: false, code: 'wall-not-found' };
        }
        return { ok: false, code: 'select-target-not-supported' };
      }
      if (tool.kind === 'opening') {
        if (intent.event.target.kind !== 'wall') return { ok: false, code: 'opening-wall-required' };
        const start = plan.contour.points[intent.event.target.wallIndex];
        const end = plan.contour.points[(intent.event.target.wallIndex + 1) % plan.contour.points.length];
        if (!start || !end) return { ok: false, code: 'wall-not-found' };
        const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
        const along = ((intent.event.position.x - start.x) * (end.x - start.x) + (intent.event.position.y - start.y) * (end.y - start.y)) / length;
        const opening = makeOpening(plan.contour, tool.openingKind, start.id, along, nextDraftId--);
        if (!opening) return { ok: false, code: 'opening-rejected' };
        const next = structuredClone(plan);
        next.openings.push(opening);
        const result = commitPlan(next, 'opening-added');
        if (result.ok) tool = { kind: 'select' };
        publish();
        return result;
      }
      if (tool.kind !== 'drawContour') return { ok: false, code: 'tool-does-not-handle-canvas-click' };
      const first = plan.contour.points[0];
      if (
        plan.contour.points.length >= 3
        && first
        && intent.event.target.kind === 'point'
        && intent.event.target.pointId === first.id
      ) {
        if (crossings(plan.contour.points).length > 0) return { ok: false, code: 'contour-self-intersection' };
        const next = structuredClone(plan);
        next.contour.closed = true;
        const result = commitPlan(next, 'contour-closed');
        if (result.ok) tool = { kind: 'select' };
        publish();
        return result;
      }
      const next = structuredClone(plan);
      const position = snapPoint(intent.event.position, plan.contour.points, false, snapEnabled);
      next.contour.points.push({ id: nextDraftId--, ...position });
      return commitPlan(next, 'point-added');
    }
    if (intent.type === 'pointerPressed') {
      if (tool.kind !== 'select') return { ok: false, code: 'tool-does-not-handle-pointer' };
      if (intent.event.target.kind === 'point') {
        if (!canSlide(plan.contour, intent.event.target.pointId).ok) return { ok: false, code: 'point-cannot-slide' };
        drag = { kind: 'point', pointId: intent.event.target.pointId, basePlan: structuredClone(plan), changed: false };
        publish();
        return { ok: true };
      }
      if (intent.event.target.kind === 'zoneVertex' && plan.kind === 'room') {
        drag = { kind: 'zoneVertex', zoneId: intent.event.target.zoneId, pointId: intent.event.target.pointId, basePlan: structuredClone(plan), changed: false };
        publish();
        return { ok: true };
      }
      return { ok: false, code: 'nothing-to-drag' };
    }
    if (intent.type === 'pointerMoved') {
      pointer = intent.position;
      if (drag?.kind === 'point') {
        const dragging = drag;
        plan = withContour(
          dragging.basePlan,
          slidePoint(dragging.basePlan.contour, dragging.pointId, intent.position.x, intent.position.y),
        );
        const before = dragging.basePlan.contour.points.find((point) => point.id === dragging.pointId);
        const after = plan.contour.points.find((point) => point.id === dragging.pointId);
        dragging.changed = Boolean(before && after && (before.x !== after.x || before.y !== after.y));
      } else if (drag?.kind === 'zoneVertex' && drag.basePlan.kind === 'room') {
        const dragging = drag;
        const roomBase = dragging.basePlan;
        if (roomBase.kind !== 'room') return { ok: false, code: 'room-plan-required' };
        const next = structuredClone(roomBase);
        const position = snapPoint(intent.position, roomBase.contour.points, roomBase.contour.closed, snapEnabled);
        next.zones = next.zones.map((zone) => zone.id === dragging.zoneId
          ? { ...zone, points: zone.points.map((point) => point.id === dragging.pointId ? { ...point, ...position } : point) }
          : zone);
        plan = next;
        const before = roomBase.zones.find((zone) => zone.id === dragging.zoneId)?.points.find((point) => point.id === dragging.pointId);
        drag.changed = Boolean(before && (before.x !== position.x || before.y !== position.y));
      }
      publish();
      return { ok: true };
    }
    if (intent.type === 'pointerReleased') {
      if (!drag) return { ok: true };
      if (!drag.changed) {
        plan = drag.basePlan;
        drag = null;
        publish();
        return { ok: true };
      }
      const action = drag.kind === 'point' ? 'point-moved' : 'zone-vertex-moved';
      const next = structuredClone(plan);
      drag = null;
      return commitPlan(next, action);
    }
    if (intent.type === 'pointerCancelled') {
      if (!drag) return { ok: true };
      plan = drag.basePlan;
      drag = null;
      publish();
      return { ok: true };
    }
    if (intent.type === 'deleteRequested') {
      const preview = pointDeletionPreview(plan.contour, intent.pointId);
      if (!preview.ok) return { ok: false, code: 'point-cannot-be-deleted', data: { reason: preview.reason } };
      return {
        ok: false,
        confirmation: {
          kind: 'delete-point',
          data: {
            pointId: intent.pointId,
            lockCount: preview.locks.length,
            openingCount: plan.openings.filter((opening) => preview.openingWallPointIds.includes(opening.wallPointId)).length,
          },
        },
      };
    }
    if (intent.type === 'deleteConfirmed') {
      const preview = pointDeletionPreview(plan.contour, intent.pointId);
      if (!preview.ok) return { ok: false, code: 'point-cannot-be-deleted', data: { reason: preview.reason } };
      const next = withContour(plan, deletePoint(plan.contour, intent.pointId));
      next.openings = next.openings.filter((opening) => !preview.openingWallPointIds.includes(opening.wallPointId));
      return commitPlan(next, 'point-deleted');
    }
    if (intent.type === 'zoneFinished') {
      return finishPolygonZone();
    }
    if (intent.type === 'dimensionValueChanged') {
      inputValue = intent.value;
      inputInvalid = false;
      publish();
      return { ok: true };
    }
    if (intent.type === 'selectionReset') {
      selection = reduceDimensionSelection(selection, { type: 'reset' });
      publish();
      return { ok: true };
    }
    if (intent.type === 'dimensionPinRequested') {
      if (selection.aId === null || selection.bId === null) return { ok: false, code: 'dimension-selection-incomplete' };
      const target = Number.parseInt(inputValue, 10);
      if (!Number.isFinite(target)) {
        inputInvalid = true;
        publish();
        return { ok: false, code: 'dimension-value-invalid' };
      }
      if (!solver) return { ok: false, code: 'solver-not-ready' };
      const solved = solver.pin(plan.contour, selection.aId, selection.bId, target);
      if (!solved.ok) {
        inputInvalid = true;
        publish();
        return { ok: false, code: 'dimension-conflict', data: { reason: solved.reason, conflicts: solved.conflicts } };
      }
      inputInvalid = false;
      return commitPlan(withContour(plan, solved.contour), 'dimension-pinned');
    }
    if (intent.type === 'lockRemoved') {
      const contour = {
        ...plan.contour,
        locks: plan.contour.locks.filter((lock) => lock.aId !== intent.lock.aId || lock.bId !== intent.lock.bId),
      };
      return commitPlan(withContour(plan, contour), 'lock-removed');
    }
    if (intent.type === 'snapChanged') {
      snapEnabled = intent.value;
      publish();
      return { ok: true };
    }
    if (intent.type === 'openingKindSelected') {
      openingKind = intent.kind;
      publish();
      return { ok: true };
    }
    if (intent.type === 'zoneKindSelected') {
      zoneKind = intent.kind;
      publish();
      return { ok: true };
    }
    if (intent.type === 'pointerLeft') {
      pointer = null;
      publish();
      return { ok: true };
    }
    if (intent.type === 'openingChanged') {
      if (!plan.openings.some((opening) => opening.id === intent.opening.id)) return { ok: false, code: 'opening-not-found' };
      const next = structuredClone(plan);
      next.openings = next.openings.map((opening) => opening.id === intent.opening.id ? structuredClone(intent.opening) : opening);
      return commitPlan(next, 'opening-changed');
    }
    if (intent.type === 'openingDeleted') {
      if (!plan.openings.some((opening) => opening.id === intent.openingId)) return { ok: false, code: 'opening-not-found' };
      const next = structuredClone(plan);
      next.openings = next.openings.filter((opening) => opening.id !== intent.openingId);
      return commitPlan(next, 'opening-deleted');
    }
    if (intent.type === 'zoneChanged') {
      if (plan.kind !== 'room' || !plan.zones.some((zone) => zone.id === intent.zone.id)) return { ok: false, code: 'zone-not-found' };
      const next = structuredClone(plan);
      next.zones = next.zones.map((zone) => zone.id === intent.zone.id ? structuredClone(intent.zone) : zone);
      return commitPlan(next, 'zone-changed');
    }
    if (intent.type === 'zoneDeleted') {
      if (plan.kind !== 'room' || !plan.zones.some((zone) => zone.id === intent.zoneId)) return { ok: false, code: 'zone-not-found' };
      const next = structuredClone(plan);
      next.zones = next.zones.filter((zone) => zone.id !== intent.zoneId);
      return commitPlan(next, 'zone-deleted');
    }
    if (intent.type === 'exitRequested') {
      if (snapshot.capabilities.hasUncommittedDraft || drag) {
        return { ok: false, confirmation: { kind: 'discard-draft', data: {} } };
      }
      return { ok: true };
    }
    if (intent.type === 'draftDiscarded') {
      if ((tool.kind === 'polygonZone' || tool.kind === 'partition') && tool.draft) plan = tool.draft.basePlan;
      if (drag) plan = drag.basePlan;
      drag = null;
      tool = plan.contour.closed ? { kind: 'select' } : { kind: 'drawContour' };
      publish();
      return { ok: true };
    }
    if (intent.type !== 'sourceChanged') return { ok: false, code: 'unsupported-intent' };
    if (intent.origin === 'ownCommit' && intent.revision === revision) return { ok: true };
    plan = structuredClone(intent.plan);
    revision = intent.revision;
    if (intent.origin === 'external') {
      reconcileExternalSource(intent.plan, intent.revision);
    }
    publish();
    return { ok: true };
  }

  return {
    getSnapshot: () => snapshot,
    dispatch,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      solver?.dispose();
      solver = null;
      listeners.clear();
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((child) => deepFreeze(child));
  }
  return value;
}
