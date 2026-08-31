import { useEffect, useMemo, useRef, useState } from 'react';
import {
  canSlide,
  chainInfo,
  crossings,
  makeOpening,
  deletePoint,
  lockLabel,
  NO_CLEARANCE,
  pointDeletionPreview,
  rebaseOpenings,
  rebaseZones,
  slidePoint,
  ZONE_KIND_LABELS,
  type Contour,
  type Opening,
  type OpeningKind,
  type Point,
  type SizeLock,
  type Zone,
  type ZoneKind,
} from '@houseplan/shared';
import { createContourDimensionPinner, type ContourDimensionPinner } from './constraints/pinContourDimension';
import { PLANEGCS_WASM_URL } from './constraints/planegcsWasm';
import { PARTITION_THICKNESS_CM } from './editorConstants';
import { projectOntoWall, reduceDimensionSelection, snapPoint } from './editorMachine';
import { contourCentroid, OPENING_LABELS } from '../planScene';
import type { Banner, CanvasPointerEvent, EditablePlan, RoomEditorProps, ZoneDraft } from './editorTypes';

const INITIAL_BANNER: Banner = {
  kind: 'info',
  text: 'Кликайте по полю — ставьте углы; клик в первую точку замыкает контур.',
};

export function useEditorSession({ plan, onChange }: Pick<RoomEditorProps, 'plan' | 'onChange'>) {
  const counters = plan.counters;
  /** Черновой идентификатор; постоянный ID подтвердит или перевыдаст projectSession. */
  function nextId(kind: 'point' | 'opening' | 'zone'): number {
    const base = Math.max(idSeq.current[kind] ?? 0, counters[kind] ?? 0);
    idSeq.current[kind] = base + 1;
    return base + 1;
  }
  const idSeq = useRef<Partial<Record<'point' | 'opening' | 'zone', number>>>({});
  const contour = plan.contour;
  const points = contour.points;
  const zones = plan.kind === 'room' ? plan.zones : [];
  const [banner, setBanner] = useState<Banner | null>(INITIAL_BANNER);
  const [selection, setSelection] = useState({ aId: null, bId: null } as { aId: number | null; bId: number | null });
  const [snap, setSnap] = useState(true);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [inputInvalid, setInputInvalid] = useState(false);
  const [inputValue, setInputValueState] = useState('');
  const [solving, setSolving] = useState(false);
  const [zoneMode, setZoneMode] = useState<'none' | 'polygon' | 'partition'>('none');
  const [zoneKind, setZoneKind] = useState<ZoneKind>('partition');
  const [zoneDraft, setZoneDraft] = useState<ZoneDraft | null>(null);
  const [openingKind, setOpeningKind] = useState<OpeningKind>(plan.openingKinds[0]);
  const [openingMode, setOpeningMode] = useState<OpeningKind | null>(null);
  const slideRef = useRef<number | null>(null);
  const zoneDragRef = useRef<{ zoneId: number; pointId: number } | null>(null);
  const pinnerRef = useRef<ContourDimensionPinner | null>(null);

  function say(kind: Banner['kind'], text: string) {
    setBanner({ kind, text });
  }

  function emit(change: Partial<Pick<EditablePlan, 'contour' | 'openings'>> & { zones?: Zone[] }) {
    if (plan.kind === 'room') {
      onChange({ ...plan, ...change, zones: change.zones ?? plan.zones } as EditablePlan);
    } else {
      onChange({ ...plan, contour: change.contour ?? plan.contour, openings: change.openings ?? plan.openings });
    }
  }

  function applyContour(next: Contour) {
    emit({
      contour: next,
      zones: rebaseZones(contour.points, next.points, zones),
      openings: rebaseOpenings(contour.points, next.points, plan.openings),
    });
  }

  function updateZones(next: Zone[]) {
    if (plan.kind === 'room') emit({ zones: next });
  }

  useEffect(() => {
    let cancelled = false;
    createContourDimensionPinner(PLANEGCS_WASM_URL)
      .then((pinner) => {
        if (cancelled) pinner.dispose();
        else pinnerRef.current = pinner;
      })
      .catch((error: unknown) => {
        if (!cancelled) say('bad', `Не удалось запустить пересчёт размеров: ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      cancelled = true;
      pinnerRef.current?.dispose();
      pinnerRef.current = null;
    };
  }, []);

  useEffect(() => {
    function finishDragging() {
      slideRef.current = null;
      zoneDragRef.current = null;
    }
    window.addEventListener('mouseup', finishDragging);
    return () => window.removeEventListener('mouseup', finishDragging);
  }, []);

  useEffect(() => {
    if (selection.aId === null || selection.bId === null) return;
    const info = chainInfo(contour, selection.aId, selection.bId);
    if (info.ok) setInputValueState(String(info.length));
  }, [selection.aId, selection.bId, contour]);

  const selectionInfo = useMemo(() => {
    if (selection.aId !== null && selection.bId !== null) {
      const info = chainInfo(contour, selection.aId, selection.bId);
      if (info.ok) {
        return {
          canPin: true,
          description: `Участок А${selection.aId} → А${selection.bId}: сейчас ${info.length} см. Точка А${selection.aId} останется на месте.`,
        };
      }
      return { canPin: false, description: info.reason };
    }
    if (selection.aId !== null) {
      return { canPin: false, description: `Точка А выбрана: А${selection.aId}. Теперь выберите точку Б.` };
    }
    return { canPin: false, description: 'Выберите две точки контура: сначала та, что останется на месте (А), затем Б.' };
  }, [selection, contour]);

  const crossingPairs = contour.closed ? crossings(points) : [];
  const crossedWalls = new Set(crossingPairs.flat());
  const hasDiagonals = points.some((point, index) => {
    if (index === points.length - 1) return false;
    const next = points[index + 1];
    return point.x !== next.x && point.y !== next.y;
  });

  function resetSelection() {
    setSelection((current) => reduceDimensionSelection(current, { type: 'reset' }));
  }

  function selectPoint(pointId: number) {
    setSelection((current) => {
      const next = reduceDimensionSelection(current, { type: 'pointClicked', pointId });
      if (next.aId === null) say('info', 'Выбор точек сброшен.');
      else if (next.bId === null) say('info', `Точка А${pointId} выбрана (останется на месте). Теперь выберите точку Б.`);
      return next;
    });
  }

  function splitWall(wallIndex: number, position?: { x: number; y: number }) {
    const start = points[wallIndex];
    const end = points[(wallIndex + 1) % points.length];
    const coords = position ? projectOntoWall(position, start, end) : {
      x: Math.round((start.x + end.x) / 2),
      y: Math.round((start.y + end.y) / 2),
    };
    const pointId = nextId('point');
    const nextPoints = [...points];
    nextPoints.splice(wallIndex + 1, 0, { id: pointId, ...coords });
    const thicknesses = { ...contour.thicknesses, [pointId]: contour.thicknesses[start.id] ?? 10 };
    applyContour({ ...contour, points: nextPoints, thicknesses });
    resetSelection();
    return { pointId, coords, wallDir: unitDirection(start, end) };
  }

  function anchorFromEvent(event: CanvasPointerEvent) {
    const target = event.target;
    if (target.kind === 'point') {
      const index = points.findIndex((item) => item.id === target.pointId);
      if (index < 0) return null;
      const point = points[index];
      return { pointId: point.id, coords: { x: point.x, y: point.y }, wallDir: unitDirection(point, points[(index + 1) % points.length]) };
    }
    if (target.kind === 'wall') return splitWall(target.wallIndex, event.position);
    return null;
  }

  function unitDirection(start: Point, end: Point) {
    const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    return { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  }

  function closeZoneDraft() {
    if (!zoneDraft || zoneDraft.points.length < 3) {
      say('bad', 'В зоне меньше трёх вершин.');
      return;
    }
    const zone: Zone = {
      id: nextId('zone'),
      kind: zoneDraft.kind,
      name: ZONE_KIND_LABELS[zoneDraft.kind],
      points: zoneDraft.points,
      supportWallPointId: zoneDraft.anchorId,
      clearances: { ...NO_CLEARANCE },
      attributes: [],
    };
    updateZones([...zones, zone]);
    setZoneDraft(null);
    setZoneMode('none');
    say('ok', `${zone.name} готова: привязана к своей точке стены и поедет вместе с ней при пересчёте размеров.`);
  }

  function handleZoneClick(event: CanvasPointerEvent) {
    if (zoneMode === 'partition') {
      if (!zoneDraft) {
        const anchor = anchorFromEvent(event);
        if (!anchor) return say('info', 'Кликните по стене — простенок вырастет из неё.');
        setZoneDraft({
          kind: zoneKind === 'decorativeWall' ? 'decorativeWall' : 'partition',
          anchorId: anchor.pointId,
          points: [{ id: nextId('point'), ...anchor.coords }],
          wallDir: anchor.wallDir,
        });
        return say('info', 'Теперь кликните второй конец простенка.');
      }
      const anchor = zoneDraft.points[0];
      const direction = zoneDraft.wallDir;
      if (!direction) return;
      let nx = -direction.y;
      let ny = direction.x;
      const center = contourCentroid(points);
      if (nx * (center.x - anchor.x) + ny * (center.y - anchor.y) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const length = (event.position.x - anchor.x) * nx + (event.position.y - anchor.y) * ny;
      if (length < 20) return say('bad', 'Простенок слишком короткий.');
      const ids = [1, 2, 3, 4].map(() => nextId('point'));
      const corners: Point[] = [
        { id: ids[0], x: anchor.x, y: anchor.y },
        { id: ids[1], x: Math.round(anchor.x + nx * length), y: Math.round(anchor.y + ny * length) },
        { id: ids[2], x: Math.round(anchor.x + nx * length + direction.x * PARTITION_THICKNESS_CM), y: Math.round(anchor.y + ny * length + direction.y * PARTITION_THICKNESS_CM) },
        { id: ids[3], x: Math.round(anchor.x + direction.x * PARTITION_THICKNESS_CM), y: Math.round(anchor.y + direction.y * PARTITION_THICKNESS_CM) },
      ];
      const zone: Zone = {
        id: nextId('zone'),
        kind: zoneDraft.kind,
        name: ZONE_KIND_LABELS[zoneDraft.kind],
        points: corners,
        fromPointId: zoneDraft.anchorId,
        clearances: { ...NO_CLEARANCE },
        attributes: [],
      };
      updateZones([...zones, zone]);
      setZoneDraft(null);
      setZoneMode('none');
      return say('ok', `${zone.name} готов: приклеен к своей точке и поедет вместе с ней при пересчёте размеров.`);
    }

    if (!zoneDraft) {
      const anchor = anchorFromEvent(event);
      if (!anchor) return say('info', 'Кликните по стене (зона приляжет к ней) или по точке контура.');
      setZoneDraft({ kind: zoneKind, anchorId: anchor.pointId, points: [{ id: nextId('point'), ...anchor.coords }], wallDir: null });
      return say('info', 'Кликайте вершины зоны; клик рядом с первой точкой замыкает.');
    }
    const first = zoneDraft.points[0];
    if (zoneDraft.points.length >= 3 && Math.hypot(event.position.x - first.x, event.position.y - first.y) < 14) {
      closeZoneDraft();
      return;
    }
    const position = snapPoint(event.position, points, contour.closed, snap);
    setZoneDraft({ ...zoneDraft, points: [...zoneDraft.points, { id: nextId('point'), ...position }] });
  }

  function placeOpening(event: CanvasPointerEvent) {
    if (openingMode === null || event.target.kind !== 'wall') {
      say('info', 'Кликните по стене — проём встанет в это место.');
      return;
    }
    const start = points[event.target.wallIndex];
    const end = points[(event.target.wallIndex + 1) % points.length];
    const direction = unitDirection(start, end);
    const along = (event.position.x - start.x) * direction.x + (event.position.y - start.y) * direction.y;
    const opening = makeOpening(contour, openingMode, start.id, along, nextId('opening'));
    if (!opening) return;
    emit({ openings: [...plan.openings, opening] });
    setOpeningMode(null);
    say('ok', `${OPENING_LABELS[opening.kind]}: ${opening.offsetCm} см от угла, ширина ${opening.widthCm} см.`);
  }

  function onCanvasClick(event: CanvasPointerEvent) {
    if (contour.closed && openingMode !== null) return placeOpening(event);
    if (contour.closed && zoneMode !== 'none') return handleZoneClick(event);
    if (contour.closed) {
      if (event.target.kind === 'point') return selectPoint(event.target.pointId);
      if (event.target.kind === 'wall') {
        splitWall(event.target.wallIndex);
        say('info', 'Стена разрезана на две — каждой части можно прибить свой размер.');
        return;
      }
      resetSelection();
      return;
    }

    const first = points[0];
    if (points.length >= 3 && first && (event.target.kind === 'point' && event.target.pointId === first.id)) {
      if (crossings(points).length > 0) {
        say('bad', 'Контур пересекает сам себя. Перед замыканием передвиньте точки так, чтобы линии не пересекались.');
        return;
      }
      applyContour({ ...contour, closed: true });
      say('ok', 'Контур замкнут! Выберите две точки и прибейте размер.');
      return;
    }
    const position = snapPoint(event.position, points, contour.closed, snap);
    applyContour({ ...contour, points: [...points, { id: nextId('point'), ...position }] });
    say('info', 'Точка поставлена. Клик в первую точку замыкает контур.');
  }

  function onCanvasPointerDown(event: CanvasPointerEvent) {
    if (!contour.closed || zoneMode !== 'none' || openingMode !== null) return;
    if (event.target.kind === 'point') {
      const movable = canSlide(contour, event.target.pointId);
      if (movable.ok) {
        slideRef.current = event.target.pointId;
        say('info', 'Тяните точку вдоль стены.');
      } else say('info', movable.reason);
    } else if (event.target.kind === 'zoneVertex') {
      zoneDragRef.current = { zoneId: event.target.zoneId, pointId: event.target.pointId };
    }
  }

  /** Правый клик: удалить точку (стены сливаются) или стену (удаляется её точка). */
  function onCanvasContextMenu(event: CanvasPointerEvent) {
    if (!contour.closed || zoneMode !== 'none' || openingMode !== null) return;
    let pointId: number;
    if (event.target.kind === 'point') pointId = event.target.pointId;
    else if (event.target.kind === 'wall') pointId = points[event.target.wallIndex].id;
    else return;
    const preview = pointDeletionPreview(contour, pointId);
    if (!preview.ok) return say('info', preview.reason ?? 'Эту точку удалить нельзя.');
    const details: string[] = [];
    if (preview.locks.length > 0) {
      details.push(`замки: ${preview.locks.map(lockLabel).join(', ')}`);
    }
    if (preview.openingWallPointIds.length > 0) {
      details.push(`проёмы на этой стене: ${plan.openings.filter((o) => preview.openingWallPointIds.includes(o.wallPointId)).map((o) => OPENING_LABELS[o.kind]).join(', ') || '—'}`);
    }
    const extra = details.length > 0 ? ` Вместе с ней удалятся: ${details.join('; ')}.` : '';
    if (!window.confirm(`Удалить точку А${pointId}? Две соседние стены сольются в одну.${extra}`)) return;
    applyContour(deletePoint(contour, pointId));
    emit({ openings: plan.openings.filter((o) => !preview.openingWallPointIds.includes(o.wallPointId)) });
    resetSelection();
    say('info', 'Точка удалена — стены соединились в одну.');
  }

  function onPointerMove(position: { x: number; y: number }) {
    setPointer(position);
    if (slideRef.current !== null) {
      applyContour(slidePoint(contour, slideRef.current, position.x, position.y));
      return;
    }
    if (zoneDragRef.current) {
      const dragging = zoneDragRef.current;
      const next = snapPoint(position, points, contour.closed, snap);
      updateZones(zones.map((zone) => zone.id === dragging.zoneId
        ? { ...zone, points: zone.points.map((point) => point.id === dragging.pointId ? { ...point, ...next } : point) }
        : zone));
    }
  }

  function pinDimension() {
    if (selection.aId === null || selection.bId === null) return;
    const target = Number.parseInt(inputValue, 10);
    if (!Number.isFinite(target)) {
      setInputInvalid(true);
      return;
    }
    const pinner = pinnerRef.current;
    if (!pinner) {
      say('info', 'Решатель размеров ещё загружается. Попробуйте ещё раз через секунду.');
      return;
    }
    setSolving(true);
    try {
      const result = pinner.pinContourDimension(contour, selection.aId, selection.bId, target);
      if (result.ok) {
        applyContour(result.contour);
        setInputInvalid(false);
        say('ok', `Размер прибит: ${result.label}. Точка А${selection.aId} на месте, остальное подстроилось.`);
      } else {
        setInputInvalid(true);
        const conflicts = result.conflicts.length ? ` Замки-конфликтники: ${result.conflicts.map((conflict) => `«${conflict}»`).join(', ')}. Снимите один из них.` : '';
        say('bad', result.reason + conflicts);
      }
    } finally {
      setSolving(false);
    }
  }

  return {
    banner,
    selection,
    selectionInfo,
    snap,
    setSnap,
    pointer,
    inputInvalid,
    inputValue,
    setInputValue(value: string) { setInputValueState(value); setInputInvalid(false); },
    solving,
    zoneMode,
    zoneKind,
    setZoneKind,
    zoneDraft,
    openingKind,
    setOpeningKind,
    openingMode,
    crossingPairs,
    crossedWalls,
    hasDiagonals,
    onCanvasClick,
    onCanvasPointerDown,
    onCanvasContextMenu,
    onPointerMove,
    onPointerLeave() { setPointer(null); },
    pinDimension,
    resetSelection,
    removeLock(lock: SizeLock) {
      applyContour({ ...contour, locks: contour.locks.filter((item) => item.aId !== lock.aId || item.bId !== lock.bId) });
      say('info', `Замок «А${lock.aId}–А${lock.bId} = ${lock.length}» снят.`);
    },
    startOpening() { setOpeningMode(openingKind); say('info', 'Кликните по стене — проём встанет в это место.'); },
    cancelOpening() { setOpeningMode(null); },
    changeOpening(opening: Opening) { emit({ openings: plan.openings.map((item) => item.id === opening.id ? opening : item) }); },
    deleteOpening(openingId: number) { emit({ openings: plan.openings.filter((item) => item.id !== openingId) }); say('info', 'Проём удалён.'); },
    startPolygon() { setZoneMode('polygon'); say('info', 'Кликните по стене или точке контура — зона приляжет к ней.'); },
    startPartition() { setZoneMode('partition'); say('info', 'Кликните по стене — простенок вырастет из неё.'); },
    closeZoneDraft,
    cancelZoneDraft() { setZoneDraft(null); setZoneMode('none'); say('info', 'Рисование зоны отменено.'); },
    changeZone(zone: Zone) { updateZones(zones.map((item) => item.id === zone.id ? zone : item)); },
    deleteZone(zoneId: number) { updateZones(zones.filter((item) => item.id !== zoneId)); say('info', 'Зона удалена.'); },
  };
}
