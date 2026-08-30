import { useEffect, useRef, useState } from 'react';
import type { Contour, Floor, Opening, OpeningKind, Point, Zone, ZoneKind } from '@houseplan/shared';
import {
  canSlide,
  chainInfo,
  crossings,
  lockLabel,
  lockedWalls,
  NO_CLEARANCE,
  openingSegment,
  rebaseOpenings,
  rebaseZones,
  slidePoint,
  tryLock,
  ZONE_KIND_LABELS,
} from '@houseplan/shared';

const GRID = 25;
const PARTITION_THICKNESS = 15;

const OPENING_LABELS: Record<OpeningKind, string> = {
  window: 'Окно',
  entryDoor: 'Входная дверь',
  innerDoor: 'Дверь',
};

const OPENING_DEFAULTS: Record<OpeningKind, { width: number; sill?: number; top?: number; height?: number }> = {
  window: { width: 120, sill: 90, top: 220 },
  entryDoor: { width: 100, height: 200 },
  innerDoor: { width: 90, height: 200 },
};

const OPENING_COLORS: Record<OpeningKind, string> = {
  window: '#2563eb',
  entryDoor: '#b45309',
  innerDoor: '#b45309',
};

const ZONE_COLORS: Record<ZoneKind, string> = {
  stairs: '#7c3aed',
  builtInWardrobe: '#0d9488',
  fireplace: '#ea580c',
  decorativeWall: '#db2777',
  partition: '#dc2626',
  other: '#ca8a04',
};

interface Banner {
  kind: 'info' | 'ok' | 'bad';
  text: string;
}

interface ZoneDraft {
  kind: ZoneKind;
  /** точка контура-привязки (растёт из неё / лежит на опорной стене) */
  anchorId: number;
  /** вершины; первая совпадает с точкой привязки */
  points: Point[];
  /** направление опорной стены — для простенка */
  wallDir: { x: number; y: number } | null;
}

/**
 * Редактор помещения: рисование контура на глаз, прибивание размеров,
 * служебные зоны и простенки. Поведение перенесено из подтверждённого
 * черновика (prototype/editor-draft) и решений задач карты.
 */
export function RoomEditor({
  roomName,
  contour,
  zones,
  openings,
  floors,
  floorId,
  shellMode = false,
  openingKinds,
  onChangeContour,
  onChangeZones,
  onChangeOpenings,
  onDone,
}: {
  roomName: string;
  contour: Contour;
  zones: Zone[];
  openings: Opening[];
  floors: Floor[];
  floorId: number;
  /** оболочка этажа: вместо зон — окна и входные двери */
  shellMode?: boolean;
  openingKinds: OpeningKind[];
  onChangeContour: (contour: Contour) => void;
  onChangeZones: (zones: Zone[]) => void;
  onChangeOpenings: (openings: Opening[]) => void;
  onDone: () => void;
}) {
  const points = contour.points;
  const n = points.length;

  const [banner, setBanner] = useState<Banner | null>({ kind: 'info', text: 'Кликайте по полю — ставьте углы; клик в первую точку замыкает контур.' });
  const [selA, setSelA] = useState<number | null>(null);
  const [selB, setSelB] = useState<number | null>(null);
  const [snap, setSnap] = useState(true);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [slideId, setSlideId] = useState<number | null>(null);
  const [inputBad, setInputBad] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const slideRef = useRef<number | null>(null);
  const maxPointId = useRef(Math.max(0, ...points.map((p) => p.id)));
  const svgRef = useRef<SVGSVGElement | null>(null);

  // зоны
  const [zoneMode, setZoneMode] = useState<'none' | 'polygon' | 'partition'>('none');
  const [zoneKind, setZoneKind] = useState<ZoneKind>('partition');
  const [zoneDraft, setZoneDraft] = useState<ZoneDraft | null>(null);
  const [zoneVertexDrag, setZoneVertexDrag] = useState<{ zoneId: number; pointId: number } | null>(null);
  const zoneVertexDragRef = useRef<{ zoneId: number; pointId: number } | null>(null);
  const maxZonePointId = useRef(
    Math.max(0, ...zones.flatMap((z) => z.points.map((p) => p.id))),
  );
  // проёмы
  const [openingKind, setOpeningKind] = useState<OpeningKind>(openingKinds[0]);
  const [openingMode, setOpeningMode] = useState<OpeningKind | null>(null);
  const maxOpeningId = useRef(Math.max(0, ...openings.map((o) => o.id)));

  function say(kind: Banner['kind'], text: string) {
    setBanner({ kind, text });
  }

  /**
   * Меняет контур и подтягивает привязанное: зоны — за своими точками,
   * проёмы — за долей стены (не вылезают за край).
   */
  function applyContour(c: Contour) {
    onChangeContour(c);
    onChangeZones(rebaseZones(contour.points, c.points, zones));
    onChangeOpenings(rebaseOpenings(contour.points, c.points, openings));
  }

  function updateZones(zones: Zone[]) {
    onChangeZones(zones);
  }

  // ---------- преобразование координат ----------
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(0, ...xs) - 60;
  const maxX = Math.max(600, ...xs) + 60;
  const minY = Math.min(0, ...ys) - 60;
  const maxY = Math.max(440, ...ys) + 60;
  const k = Math.min(960 / (maxX - minX), 560 / (maxY - minY));
  const X = (x: number) => (x - minX) * k;
  const Y = (y: number) => (y - minY) * k;
  const invX = (px: number) => px / k + minX;
  const invY = (py: number) => py / k + minY;

  function centroid(): { x: number; y: number } {
    return {
      x: points.reduce((a, p) => a + p.x, 0) / Math.max(1, n),
      y: points.reduce((a, p) => a + p.y, 0) / Math.max(1, n),
    };
  }

  function svgPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: invX(((e.clientX - rect.left) / rect.width) * 960),
      y: invY(((e.clientY - rect.top) / rect.height) * 560),
    };
  }

  function pointAt(raw: { x: number; y: number }): Point | null {
    for (const p of points) {
      if ((X(raw.x) - X(p.x)) ** 2 + (Y(raw.y) - Y(p.y)) ** 2 < 14 * 14) return p;
    }
    return null;
  }

  function zoneVertexAt(raw: { x: number; y: number }): { zoneId: number; pointId: number } | null {
    for (const z of zones) {
      for (const p of z.points) {
        if ((X(raw.x) - X(p.x)) ** 2 + (Y(raw.y) - Y(p.y)) ** 2 < 10 * 10) {
          return { zoneId: z.id, pointId: p.id };
        }
      }
    }
    return null;
  }

  function wallAt(raw: { x: number; y: number }): number | null {
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      const ax = X(a.x), ay = Y(a.y), bx = X(b.x), by = Y(b.y);
      const vx = bx - ax, vy = by - ay;
      const wx = X(raw.x) - ax, wy = Y(raw.y) - ay;
      const l2 = vx * vx + vy * vy;
      let t = l2 ? (wx * vx + wy * vy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const dx = wx - t * vx, dy = wy - t * vy;
      if (dx * dx + dy * dy < 10 * 10) return i;
    }
    return null;
  }

  function nearFirst(raw: { x: number; y: number }): boolean {
    if (points.length < 3) return false;
    const f = points[0];
    return (X(raw.x) - X(f.x)) ** 2 + (Y(raw.y) - Y(f.y)) ** 2 < 22 * 22;
  }

  function snapPoint(raw: { x: number; y: number }): { x: number; y: number } {
    if (!snap) return { x: Math.round(raw.x), y: Math.round(raw.y) };
    let x = Math.round(raw.x / GRID) * GRID;
    let y = Math.round(raw.y / GRID) * GRID;
    const last = points[points.length - 1];
    if (last && !contour.closed) {
      if (Math.abs(raw.x - last.x) < 45 && Math.abs(raw.x - last.x) <= Math.abs(raw.y - last.y)) x = last.x;
      else if (Math.abs(raw.y - last.y) < 45) y = last.y;
    }
    return { x, y };
  }

  // ---------- события ----------
  function onMouseMove(e: React.MouseEvent) {
    const raw = svgPoint(e);
    setMouse(raw);
    if (slideRef.current !== null) {
      applyContour(slidePoint(contour, slideRef.current, raw.x, raw.y));
      return;
    }
    if (zoneVertexDragRef.current) {
      const { zoneId, pointId } = zoneVertexDragRef.current;
      const p = snapPoint(raw);
      updateZones(
        zones.map((z) =>
          z.id === zoneId
            ? { ...z, points: z.points.map((vp) => (vp.id === pointId ? { ...vp, x: p.x, y: p.y } : vp)) }
            : z,
        ),
      );
    }
  }

  useEffect(() => {
    function up() {
      if (slideRef.current !== null) {
        slideRef.current = null;
        setSlideId(null);
      }
      if (zoneVertexDragRef.current) {
        zoneVertexDragRef.current = null;
        setZoneVertexDrag(null);
      }
    }
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  function onMouseDown(e: React.MouseEvent) {
    const raw = svgPoint(e);
    if (contour.closed && zoneMode === 'none') {
      const p = pointAt(raw);
      if (p) {
        const can = canSlide(contour, p.id);
        if (can.ok) {
          slideRef.current = p.id;
          setSlideId(p.id);
          say('info', 'Тяните точку вдоль стены.');
        } else {
          say('info', can.reason);
        }
        e.preventDefault();
      }
    }
  }

  /** Привязка: клик по стене разрезает её (точка становится привязкой), клик по точке берёт её. */
  function anchorFromClick(raw: { x: number; y: number }): { pointId: number; coords: { x: number; y: number } } | null {
    const pt = pointAt(raw);
    if (pt) return { pointId: pt.id, coords: { ...pt } };
    const wall = wallAt(raw);
    if (wall !== null) {
      const a = points[wall], b = points[(wall + 1) % n];
      // проекция клика на стену
      const vx = b.x - a.x, vy = b.y - a.y;
      const l2 = vx * vx + vy * vy || 1;
      let t = ((raw.x - a.x) * vx + (raw.y - a.y) * vy) / l2;
      t = Math.max(0.05, Math.min(0.95, t));
      const mid = { x: Math.round(a.x + vx * t), y: Math.round(a.y + vy * t) };
      const newId = ++maxPointId.current;
      const pts = [...points];
      pts.splice(wall + 1, 0, { id: newId, ...mid });
      const thicknesses = { ...contour.thicknesses, [newId]: contour.thicknesses[a.id] ?? 10 };
      onChangeContour({ ...contour, points: pts, thicknesses });
      return { pointId: newId, coords: mid };
    }
    return null;
  }

  function wallDirAt(pointId: number): { x: number; y: number } {
    const i = points.findIndex((p) => p.id === pointId);
    if (i < 0) return { x: 1, y: 0 };
    const a = points[i], b = points[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  }

  function zoneClick(raw: { x: number; y: number }) {
    const centroidPt = centroid();

    if (zoneMode === 'partition') {
      if (!zoneDraft) {
        const anchor = anchorFromClick(raw);
        if (!anchor) {
          say('info', 'Кликните по стене — простенок вырастет из неё.');
          return;
        }
        setZoneDraft({
          kind: zoneKind === 'decorativeWall' ? 'decorativeWall' : 'partition',
          anchorId: anchor.pointId,
          points: [{ id: ++maxZonePointId.current, x: anchor.coords.x, y: anchor.coords.y }],
          wallDir: wallDirAt(anchor.pointId),
        });
        say('info', 'Теперь кликните второй конец простенка.');
        return;
      }
      // второй клик: прямоугольник от точки привязки вдоль стены, толщиной внутрь
      const anchor = zoneDraft.points[0];
      const u = zoneDraft.wallDir;
      if (!u) return;
      let ux = u.x, uy = u.y;
      let len = (raw.x - anchor.x) * ux + (raw.y - anchor.y) * uy;
      if (Math.abs(len) < 20) {
        say('bad', 'Простенок слишком короткий.');
        return;
      }
      if (len < 0) {
        ux = -ux; uy = -uy; len = -len;
      }
      let nx = -uy, ny = ux;
      if (nx * (centroidPt.x - anchor.x) + ny * (centroidPt.y - anchor.y) < 0) {
        nx = -nx; ny = -ny;
      }
      const cornerIds = [1, 2, 3, 4].map(() => ++maxZonePointId.current);
      const corners: Point[] = [
        { id: cornerIds[0], x: anchor.x, y: anchor.y },
        { id: cornerIds[1], x: Math.round(anchor.x + ux * len), y: Math.round(anchor.y + uy * len) },
        { id: cornerIds[2], x: Math.round(anchor.x + ux * len + nx * PARTITION_THICKNESS), y: Math.round(anchor.y + uy * len + ny * PARTITION_THICKNESS) },
        { id: cornerIds[3], x: Math.round(anchor.x + nx * PARTITION_THICKNESS), y: Math.round(anchor.y + ny * PARTITION_THICKNESS) },
      ];
      const zone: Zone = {
        id: ++maxZonePointId.current,
        kind: zoneKind === 'decorativeWall' ? 'decorativeWall' : 'partition',
        name: ZONE_KIND_LABELS[zoneKind],
        points: corners,
        fromPointId: zoneDraft.anchorId,
        clearances: { ...NO_CLEARANCE },
        attributes: [],
      };
      updateZones([...zones, zone]);
      setZoneDraft(null);
      setZoneMode('none');
      say('ok', `${zone.name} готов: приклеен к своей точке и поедет вместе с ней при пересчёте размеров.`);
      return;
    }

    // многоугольная зона
    if (!zoneDraft) {
      const anchor = anchorFromClick(raw);
      if (!anchor) {
        say('info', 'Кликните по стене (зона приляжет к ней) или по точке контура.');
        return;
      }
      setZoneDraft({
        kind: zoneKind,
        anchorId: anchor.pointId,
        points: [{ id: ++maxZonePointId.current, x: anchor.coords.x, y: anchor.coords.y }],
        wallDir: null,
      });
      say('info', 'Кликайте вершины зоны; клик рядом с первой точкой замыкает.');
      return;
    }
    if (zoneDraft.points.length >= 3) {
      const first = zoneDraft.points[0];
      if ((X(raw.x) - X(first.x)) ** 2 + (Y(raw.y) - Y(first.y)) ** 2 < 14 * 14) {
        closeZoneDraft();
        return;
      }
    }
    const p = snapPoint(raw);
    setZoneDraft({ ...zoneDraft, points: [...zoneDraft.points, { id: ++maxZonePointId.current, ...p }] });
  }

  function closeZoneDraft() {
    if (!zoneDraft || zoneDraft.points.length < 3) {
      say('bad', 'В зоне меньше трёх вершин.');
      return;
    }
    const zone: Zone = {
      id: ++maxZonePointId.current,
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

  function cancelZoneDraft() {
    setZoneDraft(null);
    setZoneMode('none');
    say('info', 'Рисование зоны отменено.');
  }

  function onClick(e: React.MouseEvent) {
    const raw = svgPoint(e);
    const pt = pointAt(raw);

    if (contour.closed && openingMode !== null) {
      const wall = wallAt(raw);
      if (wall === null) {
        say('info', 'Кликните по стене — проём встанет в это место.');
        return;
      }
      const wallStart = points[wall];
      const wallEnd = points[(wall + 1) % n];
      const defaults = OPENING_DEFAULTS[openingMode];
      const wallLen = Math.hypot(wallEnd.x - wallStart.x, wallEnd.y - wallStart.y);
      const along = Math.hypot(raw.x - wallStart.x, raw.y - wallStart.y);
      const id = ++maxOpeningId.current;
      const opening: Opening = {
        id,
        kind: openingMode,
        wallPointId: wallStart.id,
        offsetCm: Math.max(0, Math.min(Math.round(along - defaults.width / 2), Math.max(0, Math.round(wallLen) - defaults.width))),
        widthCm: defaults.width,
        sillCm: defaults.sill,
        topCm: defaults.top,
        heightCm: defaults.height,
        attributes: [],
      };
      onChangeOpenings([...openings, opening]);
      setOpeningMode(null);
      say('ok', `${OPENING_LABELS[openingMode]}: ${opening.offsetCm} см от угла, ширина ${opening.widthCm} см.`);
      return;
    }

    if (contour.closed && zoneMode !== 'none') {
      zoneClick(raw);
      return;
    }

    if (contour.closed) {
      if (pt) {
        if (selA === null) {
          setSelA(pt.id);
          setSelB(null);
          say('info', `Точка А${pt.id} выбрана (останется на месте). Теперь выберите точку Б.`);
        } else if (pt.id === selA) {
          setSelA(null);
          setSelB(null);
        } else {
          setSelB(pt.id);
        }
        return;
      }
      const zv = zoneVertexAt(raw);
      if (zv) {
        zoneVertexDragRef.current = zv;
        setZoneVertexDrag(zv);
        return;
      }
      const wall = wallAt(raw);
      if (wall !== null) {
        const a = points[wall];
        const b = points[(wall + 1) % n];
        const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
        const newId = ++maxPointId.current;
        const pts = [...points];
        pts.splice(wall + 1, 0, { id: newId, ...mid });
        const thicknesses = { ...contour.thicknesses, [newId]: contour.thicknesses[a.id] ?? 10 };
        applyContour({ ...contour, points: pts, thicknesses });
        setSelA(null);
        setSelB(null);
        say('info', 'Стена разрезана на две — каждой части можно прибить свой размер.');
        return;
      }
      setSelA(null);
      setSelB(null);
      return;
    }

    // рисование
    if (points.length >= 3 && nearFirst(raw)) {
      applyContour({ ...contour, closed: true });
      const bad = crossings(points).length > 0;
      say(
        bad ? 'bad' : 'ok',
        bad
          ? 'Контур замкнут, но пересекает сам себя — прибивание заблокировано, пока контур не исправлен.'
          : 'Контур замкнут! Выберите две точки и прибейте размер.',
      );
      return;
    }
    const p = snapPoint(raw);
    const id = ++maxPointId.current;
    applyContour({ ...contour, points: [...points, { id, ...p }] });
    say('info', 'Точка поставлена. Клик в первую точку замыкает контур.');
  }

  // ---------- приборная панель ----------
  const selInfo = (() => {
    if (selA !== null && selB !== null) {
      const info = chainInfo(contour, selA, selB);
      if (info.ok) {
        return {
          ok: true as const,
          text: `Участок А${selA} → А${selB}: сейчас ${info.length} см. Точка А${selA} останется на месте.`,
        };
      }
      return { ok: false as const, text: info.reason };
    }
    if (selA !== null) return { ok: false as const, text: `Точка А выбрана: А${selA}. Теперь выберите точку Б.` };
    return { ok: false as const, text: 'Выберите две точки контура: сначала та, что останется на месте (А), затем Б.' };
  })();

  useEffect(() => {
    if (selA !== null && selB !== null) {
      const info = chainInfo(contour, selA, selB);
      if (info.ok) setInputValue(String(info.length));
    }
  }, [selA, selB, contour]);

  function pin() {
    if (selA === null || selB === null) return;
    const target = parseInt(inputValue, 10);
    const res = tryLock(contour, selA, selB, target);
    if (res.ok) {
      applyContour(res.contour);
      setInputBad(false);
      say('ok', `Размер прибит: ${res.label}. Точка А${selA} на месте, остальное подстроилось.`);
    } else {
      setInputBad(true);
      const conflicts = res.conflicts.length ? ` Замки-конфликтники: ${res.conflicts.map((c) => `«${c}»`).join(', ')}. Снимите один из них.` : '';
      say('bad', res.reason + conflicts);
    }
  }

  const crossPairs = contour.closed ? crossings(points) : [];
  const crossSet = new Set(crossPairs.flat());
  const busy = lockedWalls(contour);
  const hasDiagonals = points.some((p, i) => {
    if (i === n - 1) return false;
    const q = points[i + 1];
    return p.x !== q.x && p.y !== q.y;
  });

  return (
    <div className="editor">
      <div className="row">
        <button onClick={onDone}>← Готово</button>
        <b>{roomName}</b>
        <label className="muted">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> прилипание
        </label>
        <span className="spacer" />
        <span className="muted">
          точек: {n} · контур: {contour.closed ? 'замкнут' : 'рисуется'}
          {crossPairs.length > 0 && <b className="bad-text"> · пересекает сам себя!</b>}
          {hasDiagonals && <b className="bad-text"> · есть диагональные стены</b>}
        </span>
      </div>
      <div className="row">
        <svg
          ref={svgRef}
          viewBox="0 0 960 560"
          className={inputBad ? 'plan bad' : 'plan'}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setMouse(null)}
          onMouseDown={onMouseDown}
          onClick={onClick}
          style={{ cursor: zoneMode !== 'none' ? 'crosshair' : 'default' }}
        >
          {snap &&
            Array.from({ length: Math.ceil(960 / (GRID * k)) + 1 }, (_, gx) => (
              <line key={'v' + gx} x1={gx * GRID * k - ((minX * k) % (GRID * k))} y1={0} x2={gx * GRID * k - ((minX * k) % (GRID * k))} y2={560} stroke="#eef2f7" />
            ))}
          {snap &&
            Array.from({ length: Math.ceil(560 / (GRID * k)) + 1 }, (_, gy) => (
              <line key={'h' + gy} x1={0} y1={gy * GRID * k - ((minY * k) % (GRID * k))} x2={960} y2={gy * GRID * k - ((minY * k) % (GRID * k))} stroke="#eef2f7" />
            ))}

          {/* зоны */}
          {zones.map((z) => {
            const color = ZONE_COLORS[z.kind];
            const d = z.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${X(p.x)} ${Y(p.y)}`).join(' ') + ' Z';
            const cx = z.points.reduce((a, p) => a + p.x, 0) / z.points.length;
            const cy = z.points.reduce((a, p) => a + p.y, 0) / z.points.length;
            return (
              <g key={z.id}>
                <path d={d} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={2} />
                <text x={X(cx) + 4} y={Y(cy) - 4} fontSize={12} fill={color} fontWeight={700}>
                  {z.name}
                  {z.spansFloors ? ' ⭥' : ''}
                </text>
                {z.points.map((p) => (
                  <circle
                    key={p.id}
                    cx={X(p.x)}
                    cy={Y(p.y)}
                    r={4}
                    fill="#fff"
                    stroke={color}
                    strokeWidth={2}
                    style={{ cursor: 'grab' }}
                  />
                ))}
              </g>
            );
          })}

          {/* черновик зоны */}
          {zoneDraft && (
            <g>
              {zoneDraft.points.map((p, i) => (
                <circle key={p.id} cx={X(p.x)} cy={Y(p.y)} r={4} fill="#fff" stroke="#0e7490" strokeWidth={2} />
              ))}
              {mouse && zoneDraft.points.length > 0 && (
                <line
                  x1={X(zoneDraft.points[zoneDraft.points.length - 1].x)}
                  y1={Y(zoneDraft.points[zoneDraft.points.length - 1].y)}
                  x2={X(mouse.x)}
                  y2={Y(mouse.y)}
                  stroke="#0e7490"
                  strokeDasharray="4 5"
                />
              )}
            </g>
          )}

          {/* стены: полосы толщины + линии */}
          {contour.closed &&
            points.map((p, i) => {
              const q = points[(i + 1) % n];
              const t = contour.thicknesses[p.id] ?? 0;
              if (t === 0) return null;
              const dx = q.x - p.x, dy = q.y - p.y;
              const len = Math.hypot(dx, dy) || 1;
              const nx = (dy / len) * t, ny = (-dx / len) * t;
              return (
                <path
                  key={'t' + p.id}
                  d={`M ${X(p.x)} ${Y(p.y)} L ${X(q.x)} ${Y(q.y)} L ${X(q.x + nx)} ${Y(q.y + ny)} L ${X(p.x + nx)} ${Y(p.y + ny)} Z`}
                  fill="#94a3b855"
                />
              );
            })}
          {points.map((p, i) => {
            if (!contour.closed && i === n - 1) return null;
            const q = points[(i + 1) % n];
            const isCross = crossSet.has(i);
            const isLocked = busy.has(i);
            const diagonal = p.x !== q.x && p.y !== q.y;
            return (
              <line
                key={'w' + p.id}
                x1={X(p.x)} y1={Y(p.y)} x2={X(q.x)} y2={Y(q.y)}
                stroke={isCross ? '#dc2626' : isLocked ? '#134e4a' : diagonal ? '#d97706' : '#64748b'}
                strokeWidth={isLocked ? 5 : 3}
                strokeLinecap="round"
                strokeDasharray={diagonal ? '8 6' : undefined}
              />
            );
          })}
          {contour.closed &&
            points.map((p, i) => {
              const q = points[(i + 1) % n];
              const isLocked = busy.has(i);
              const len = Math.round(Math.hypot(q.x - p.x, q.y - p.y));
              return (
                <text
                  key={'l' + p.id}
                  x={X((p.x + q.x) / 2) + 6}
                  y={Y((p.y + q.y) / 2) - 6}
                  fontSize={13}
                  fontWeight={isLocked ? 700 : 400}
                  fill={isLocked ? '#134e4a' : '#64748b'}
                >
                  {len}
                  {isLocked ? ' 🔒' : ''}
                </text>
              );
            })}

          {/* проёмы */}
          {contour.closed &&
            openings.map((o) => {
              const seg = openingSegment(points, o.wallPointId, o.offsetCm, o.widthCm);
              if (!seg) return null;
              const color = OPENING_COLORS[o.kind];
              const c = centroid();
              const hinge = o.opensTo === 'left' ? seg.start : seg.end;
              const other = o.opensTo === 'left' ? seg.end : seg.start;
              let dx = other.x - hinge.x, dy = other.y - hinge.y;
              const dl = Math.hypot(dx, dy) || 1;
              dx /= dl; dy /= dl;
              let nx = -dy, ny = dx;
              if (nx * (c.x - hinge.x) + ny * (c.y - hinge.y) < 0) { nx = -nx; ny = -ny; }
              const hx = X(hinge.x), hy = Y(hinge.y);
              const r = o.widthCm * k;
              const lx = hx + dx * r, ly = hy + dy * r;
              const px = hx + nx * r, py = hy + ny * r;
              const sweep = (lx - hx) * (py - hy) - (ly - hy) * (px - hx) > 0 ? 1 : 0;
              return (
                <g key={o.id}>
                  <line x1={X(seg.start.x)} y1={Y(seg.start.y)} x2={X(seg.end.x)} y2={Y(seg.end.y)} stroke={color} strokeWidth={7} strokeLinecap="butt" />
                  {o.kind !== 'window' && (
                    <path
                      d={`M ${hx} ${hy} L ${lx} ${ly} A ${r} ${r} 0 0 ${sweep} ${px} ${py}`}
                      fill="none" stroke={color} strokeWidth={1.5}
                    />
                  )}
                </g>
              );
            })}

          {/* резинка при рисовании */}
          {!contour.closed && points.length > 0 && mouse && (
            <>
              <line
                x1={X(points[n - 1].x)} y1={Y(points[n - 1].y)} x2={X(mouse.x)} y2={Y(mouse.y)}
                stroke="#94a3b8" strokeDasharray="4 5"
              />
              {points.length >= 3 && (
                <circle
                  cx={X(points[0].x)} cy={Y(points[0].y)}
                  r={nearFirst(mouse) ? 12 : 7}
                  fill="none" stroke={nearFirst(mouse) ? '#0e7490' : '#94a3b8'} strokeWidth={2}
                />
              )}
            </>
          )}

          {/* точки контура */}
          {points.map((p) => {
            const slide = canSlide(contour, p.id).ok;
            const fill = p.id === selA ? '#16a34a' : p.id === selB ? '#2563eb' : slide ? '#ffffff' : '#e2e8f0';
            return (
              <g key={p.id}>
                <circle cx={X(p.x)} cy={Y(p.y)} r={7} fill={fill} stroke="#334155" strokeWidth={2} style={{ cursor: slide ? 'grab' : 'default' }} />
                <text x={X(p.x) + 10} y={Y(p.y) - 9} fontSize={13} fontWeight={700} fill="#0f172a">
                  {'А' + p.id}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {banner && <div className={`banner ${banner.kind}`}>{banner.text}</div>}
      <div className="row">
        <div className="card grow">
          <h2>Прибить размер</h2>
          <p className="muted">{selInfo.text}</p>
          <div className="row">
            <input
              type="number"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setInputBad(false);
              }}
              disabled={!selInfo.ok}
              className={inputBad ? 'bad' : ''}
            />
            см
            <button className="primary" onClick={pin} disabled={!selInfo.ok}>
              Прибить
            </button>
            <button onClick={() => { setSelA(null); setSelB(null); }} title="Сбросить выбор">✕</button>
          </div>
        </div>
        <div className="card grow">
          <h2>Замки</h2>
          {contour.locks.length === 0 ? (
            <p className="muted">Ни один размер не прибит.</p>
          ) : (
            <ul className="locks">
              {contour.locks.map((l) => (
                <li key={`${l.aId}-${l.bId}`}>
                  <span>{lockLabel(l)}</span>
                  <button
                    onClick={() => {
                      applyContour({ ...contour, locks: contour.locks.filter((x) => x.aId !== l.aId || x.bId !== l.bId) });
                      say('info', `Замок «А${l.aId}–А${l.bId} = ${l.length}» снят.`);
                    }}
                  >
                    снять
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card grow">
          <h2>Проёмы</h2>
          {openings.length === 0 && openingMode === null && (
            <p className="muted">
              {shellMode ? 'Окон и входных дверей нет.' : 'Внутренних дверей нет.'}
            </p>
          )}
          <ul className="locks">
            {openings.map((o) => (
              <li key={o.id}>
                <span className="row">
                  {OPENING_LABELS[o.kind]}
                  <input
                    type="number"
                    style={{ width: 70 }}
                    value={o.offsetCm}
                    title="сантиметры от угла"
                    onChange={(e) =>
                      onChangeOpenings(openings.map((x) => (x.id === o.id ? { ...x, offsetCm: Number(e.target.value) } : x)))
                    }
                  /> см
                  <input
                    type="number"
                    style={{ width: 70 }}
                    value={o.widthCm}
                    title="ширина проёма"
                    onChange={(e) =>
                      onChangeOpenings(openings.map((x) => (x.id === o.id ? { ...x, widthCm: Number(e.target.value) } : x)))
                    }
                  /> шир.
                  {o.kind !== 'window' && (
                    <select
                      value={o.opensTo ?? 'left'}
                      title="сторона открывания"
                      onChange={(e) =>
                        onChangeOpenings(openings.map((x) => (x.id === o.id ? { ...x, opensTo: e.target.value as 'left' | 'right' } : x)))
                      }
                    >
                      <option value="left">←</option>
                      <option value="right">→</option>
                    </select>
                  )}
                </span>
                <button
                  onClick={() => {
                    onChangeOpenings(openings.filter((x) => x.id !== o.id));
                    say('info', 'Проём удалён.');
                  }}
                >
                  удалить
                </button>
              </li>
            ))}
          </ul>
          {openingMode === null && openingKinds.length > 0 && (
            <div className="row">
              <select value={openingKind} onChange={(e) => setOpeningKind(e.target.value as OpeningKind)}>
                {openingKinds.map((kind) => (
                  <option key={kind} value={kind}>{OPENING_LABELS[kind]}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  setOpeningMode(openingKind);
                  say('info', 'Кликните по стене — проём встанет в это место.');
                }}
              >
                Поставить проём
              </button>
            </div>
          )}
          {openingMode !== null && (
            <button onClick={() => setOpeningMode(null)}>Отмена</button>
          )}
        </div>
        {!shellMode && (
        <div className="card grow">
          <h2>Служебные зоны</h2>
          {zones.length === 0 && zoneMode === 'none' && zoneDraft === null ? (
            <p className="muted">Зон нет. Выберите тип и нарисуйте.</p>
          ) : null}
          <ul className="locks">
            {zones.map((z) => (
              <li key={z.id}>
                <span>
                  {z.name} ({ZONE_KIND_LABELS[z.kind]})
                  {z.spansFloors
                    ? ` · сквозная: ${floors.find((f) => f.id === z.spansFloors!.fromFloorId)?.name ?? '?'}…${floors.find((f) => f.id === z.spansFloors!.toFloorId)?.name ?? '?'}`
                    : ''}
                </span>
                <button
                  onClick={() => {
                    updateZones(zones.filter((x) => x.id !== z.id));
                    say('info', 'Зона удалена.');
                  }}
                >
                  удалить
                </button>
              </li>
            ))}
          </ul>
          {zoneMode === 'none' && zoneDraft === null && (
            <div className="row">
              <select value={zoneKind} onChange={(e) => setZoneKind(e.target.value as ZoneKind)}>
                {Object.entries(ZONE_KIND_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
              <button onClick={() => { setZoneMode('polygon'); say('info', 'Кликните по стене или точке контура — зона приляжет к ней.'); }}>
                + Зона
              </button>
              <button onClick={() => { setZoneMode('partition'); say('info', 'Кликните по стене — простенок вырастет из неё.'); }}>
                + Простенок
              </button>
            </div>
          )}
          {zoneMode !== 'none' && zoneDraft !== null && (
            <div className="row">
              {zoneMode === 'polygon' && (
                <button className="primary" onClick={closeZoneDraft} disabled={zoneDraft.points.length < 3}>
                  Замкнуть
                </button>
              )}
              <button onClick={cancelZoneDraft}>Отмена</button>
            </div>
          )}
          {zones.some((z) => z.kind === 'stairs') && (
            <div>
              {zones.filter((z) => z.kind === 'stairs').map((z) => (
                <div className="row" key={z.id}>
                  <span className="muted">{z.name}: сквозная</span>
                  <select
                    value={z.spansFloors?.fromFloorId ?? ''}
                    onChange={(e) => {
                      const from = Number(e.target.value);
                      updateZones(zones.map((x) => (x.id === z.id ? { ...x, spansFloors: { fromFloorId: from, toFloorId: x.spansFloors?.toFloorId ?? from } } : x)));
                    }}
                  >
                    <option value="">— нет —</option>
                    {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  …
                  <select
                    value={z.spansFloors?.toFloorId ?? ''}
                    onChange={(e) => {
                      const to = Number(e.target.value);
                      updateZones(zones.map((x) => (x.id === z.id ? { ...x, spansFloors: { fromFloorId: x.spansFloors?.fromFloorId ?? to, toFloorId: to } } : x)));
                    }}
                    disabled={!z.spansFloors}
                  >
                    {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
