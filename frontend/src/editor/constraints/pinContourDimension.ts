import {
  chainInfo,
  crossings,
  lockLabel,
  type Cm,
  type Contour,
  type SizeLock,
} from '@houseplan/shared';
import {
  make_gcs_wrapper,
  SolveStatus,
  type GcsWrapper,
  type SketchPoint,
  type SketchPrimitive,
} from '@salusoft89/planegcs';

const MIN_WALL_LENGTH_CM = 10;

export type PinContourDimensionResult =
  | { ok: true; contour: Contour; label: string }
  | { ok: false; reason: string; conflicts: string[] };

export interface ContourDimensionPinner {
  pinContourDimension(contour: Contour, aId: number, bId: number, length: Cm): PinContourDimensionResult;
  dispose(): void;
}

function pointId(id: number): string {
  return `point:${id}`;
}

function lockId(lock: SizeLock, index: number): string {
  return `lock:${index}:${lock.aId}:${lock.bId}`;
}

function conflictingLockLabels(wrapper: GcsWrapper, locks: SizeLock[]): string[] {
  const labelsByConstraintId = new Map(
    locks.map((lock, index) => [lockId(lock, index), lockLabel(lock)]),
  );
  return wrapper
    .get_gcs_conflicting_constraints()
    .flatMap((id) => {
      const label = labelsByConstraintId.get(id);
      return label === undefined ? [] : [label];
    });
}

function primitivesFor(contour: Contour, lock: SizeLock): SketchPrimitive[] {
  const primitives: SketchPrimitive[] = contour.points.map((point) => ({
    id: pointId(point.id),
    type: 'point',
    x: point.x,
    y: point.y,
    fixed: point.id === lock.aId,
  }));

  contour.points.forEach((point, index) => {
    const next = contour.points[(index + 1) % contour.points.length];
    if (point.y === next.y) {
      primitives.push({
        id: `axis:h:${point.id}`,
        type: 'horizontal_pp',
        p1_id: pointId(point.id),
        p2_id: pointId(next.id),
      });
    } else if (point.x === next.x) {
      primitives.push({
        id: `axis:v:${point.id}`,
        type: 'vertical_pp',
        p1_id: pointId(point.id),
        p2_id: pointId(next.id),
      });
    }
  });

  [...contour.locks, lock].forEach((item, index) => {
    primitives.push({
      id: lockId(item, index),
      type: 'p2p_distance',
      p1_id: pointId(item.aId),
      p2_id: pointId(item.bId),
      distance: item.length,
    });
  });

  return primitives;
}

function solvedContour(wrapper: GcsWrapper, contour: Contour, lock: SizeLock): Contour {
  const solvedPoints = new Map(
    wrapper.sketch_index
      .get_primitives()
      .filter((primitive): primitive is SketchPoint => primitive.type === 'point')
      .map((point) => [point.id, point]),
  );

  return {
    ...contour,
    points: contour.points.map((point) => {
      const solved = solvedPoints.get(pointId(point.id));
      return solved
        ? { ...point, x: Math.round(solved.x), y: Math.round(solved.y) }
        : point;
    }),
    locks: [...contour.locks, lock],
  };
}

function invalidSolutionReason(contour: Contour, anchor: { id: number; x: Cm; y: Cm }): string | null {
  const hasInvalidCoordinate = contour.points.some(
    (point) =>
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isInteger(point.x) ||
      !Number.isInteger(point.y),
  );
  if (hasInvalidCoordinate) return 'После пересчёта получились некорректные координаты.';

  const solvedAnchor = contour.points.find((point) => point.id === anchor.id);
  if (solvedAnchor?.x !== anchor.x || solvedAnchor.y !== anchor.y) {
    return 'При пересчёте сдвинулась неподвижная точка А.';
  }

  const tooShort = contour.points.some((point, index) => {
    const next = contour.points[(index + 1) % contour.points.length];
    return Math.hypot(next.x - point.x, next.y - point.y) < MIN_WALL_LENGTH_CM;
  });
  if (tooShort) return 'Пересчёт создаёт стену короче 10 см.';
  if (crossings(contour.points).length > 0) return 'Пересчёт создаёт самопересечение контура.';

  for (const lock of contour.locks) {
    const info = chainInfo(contour, lock.aId, lock.bId);
    if (!info.ok || info.length !== lock.length) {
      return 'После округления точный размер не сошёлся.';
    }
  }
  return null;
}

class PlaneGcsContourDimensionPinner implements ContourDimensionPinner {
  constructor(private readonly wrapper: GcsWrapper) {}

  pinContourDimension(contour: Contour, aId: number, bId: number, length: Cm): PinContourDimensionResult {
    const info = chainInfo(contour, aId, bId);
    if (!info.ok) return { ok: false, reason: info.reason, conflicts: [] };

    const roundedLength = Math.round(length);
    if (!(roundedLength >= MIN_WALL_LENGTH_CM)) {
      return {
        ok: false,
        reason: `Размер должен быть целым числом сантиметров, не меньше ${MIN_WALL_LENGTH_CM}.`,
        conflicts: [],
      };
    }
    if (roundedLength < info.walls.length * MIN_WALL_LENGTH_CM) {
      return {
        ok: false,
        reason: `На участке ${info.walls.length} частей, каждая должна быть не короче ${MIN_WALL_LENGTH_CM} см.`,
        conflicts: [],
      };
    }

    const lock = { aId, bId, length: roundedLength };
    const anchor = contour.points.find((point) => point.id === aId);
    if (anchor === undefined) return { ok: false, reason: 'Точка А не найдена.', conflicts: [] };
    this.wrapper.clear_data();
    this.wrapper.push_primitives_and_params(primitivesFor(contour, lock));
    const status = this.wrapper.solve();
    if (status !== SolveStatus.Success && status !== SolveStatus.Converged) {
      return {
        ok: false,
        reason: 'Этот размер противоречит уже прибитым замкам.',
        conflicts: conflictingLockLabels(this.wrapper, contour.locks),
      };
    }

    this.wrapper.apply_solution();
    const result = solvedContour(this.wrapper, contour, lock);
    const invalidReason = invalidSolutionReason(result, anchor);
    if (invalidReason !== null) return { ok: false, reason: invalidReason, conflicts: [] };

    return { ok: true, contour: result, label: lockLabel(lock) };
  }

  dispose(): void {
    this.wrapper.destroy_gcs_module();
  }
}

export async function createContourDimensionPinner(wasmUrl?: string): Promise<ContourDimensionPinner> {
  return new PlaneGcsContourDimensionPinner(await make_gcs_wrapper(wasmUrl));
}
