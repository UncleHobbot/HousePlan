import { useRef, useState } from 'react';
import type { Floor, SceneObject, Zone } from '@houseplan/shared';
import {
  bodyPolygon,
  clearancePolygon,
  conflictObjectIds,
  openingSegment,
  roomAt,
} from '@houseplan/shared';

const ZONE_COLORS: Record<string, string> = {
  stairs: '#7c3aed',
  builtInWardrobe: '#0d9488',
  fireplace: '#ea580c',
  decorativeWall: '#db2777',
  partition: '#dc2626',
  other: '#ca8a04',
};

/**
 * План этажа с расстановкой: объекты перетаскиваются мышью, при выборе —
 * поворот и возврат на склад. Допуски подсвечиваются при конфликте.
 */
export function FloorView({
  floor,
  objects,
  projectedZones,
  onChangeFloor,
}: {
  floor: Floor;
  objects: SceneObject[];
  projectedZones?: Zone[];
  onChangeFloor: (floor: Floor) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ objectId: number; dx: number; dy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const zones = [...floor.rooms.flatMap((r) => r.zones), ...(projectedZones ?? [])];
  const conflicts = conflictObjectIds(objects, floor, zones);
  const byId = new Map(objects.map((o) => [o.id, o]));

  const placements = floor.rooms.flatMap((r) =>
    r.placements.map((p) => ({ ...p, roomName: r.name })),
  );

  // границы: контуры + объекты
  const contours = [floor.shell.contour, ...floor.rooms.map((r) => r.contour)].filter(
    (c) => c.closed && c.points.length >= 3,
  );
  const bodyPoints = floor.rooms.flatMap((r) =>
    r.placements.flatMap((p) => {
      const o = byId.get(p.objectId);
      return o ? bodyPolygon(o, p) : [];
    }),
  );
  const xs = [...contours.flatMap((c) => c.points.map((p) => p.x)), ...bodyPoints.map((p) => p.x)];
  const ys = [...contours.flatMap((c) => c.points.map((p) => p.y)), ...bodyPoints.map((p) => p.y)];
  if (xs.length === 0) return <p className="muted">Этаж пуст.</p>;
  const minX = Math.min(...xs) - 60;
  const maxX = Math.max(...xs) + 60;
  const minY = Math.min(...ys) - 60;
  const maxY = Math.max(...ys) + 60;
  const k = Math.min(860 / (maxX - minX), 560 / (maxY - minY));
  const X = (x: number) => (x - minX) * k;
  const Y = (y: number) => (y - minY) * k;
  const invX = (px: number) => px / k + minX;
  const invY = (py: number) => py / k + minY;

  const polyStr = (poly: { x: number; y: number }[]) => poly.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ');

  function svgPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: invX(((e.clientX - rect.left) / rect.width) * 960),
      y: invY(((e.clientY - rect.top) / rect.height) * 560),
    };
  }

  function movePlacement(objectId: number, x: number, y: number) {
    const targetRoom = roomAt(floor, x, y);
    const current = floor.rooms.find((r) => r.placements.some((p) => p.objectId === objectId));
    const roomId = targetRoom ?? current?.id;
    if (roomId === undefined) return;
    const rotation = current?.placements.find((p) => p.objectId === objectId)?.rotationDeg ?? 0;
    onChangeFloor({
      ...floor,
      rooms: floor.rooms.map((r) => {
        const without = r.placements.filter((p) => p.objectId !== objectId);
        if (r.id === roomId) {
          return { ...r, placements: [...without, { objectId, roomId, x: Math.round(x), y: Math.round(y), rotationDeg: rotation }] };
        }
        return { ...r, placements: without };
      }),
    });
  }

  function rotateSelected(delta: number) {
    if (selected === null) return;
    onChangeFloor({
      ...floor,
      rooms: floor.rooms.map((r) => ({
        ...r,
        placements: r.placements.map((p) =>
          p.objectId === selected ? { ...p, rotationDeg: ((p.rotationDeg + delta) % 360 + 360) % 360 } : p,
        ),
      })),
    });
  }

  function removeFromPlan() {
    if (selected === null) return;
    onChangeFloor({
      ...floor,
      rooms: floor.rooms.map((r) => ({ ...r, placements: r.placements.filter((p) => p.objectId !== selected) })),
    });
    setSelected(null);
  }

  function onMouseDownOnObject(e: React.MouseEvent, objectId: number, x: number, y: number) {
    const raw = svgPoint(e);
    dragRef.current = { objectId, dx: raw.x - x, dy: raw.y - y };
    setSelected(objectId);
    e.stopPropagation();
  }

  function svgClickDropHandler(e: React.DragEvent) {
    e.preventDefault();
    const objectId = Number(e.dataTransfer.getData('text/objectid'));
    if (!objectId) return;
    const p = svgPoint(e);
    const roomId = roomAt(floor, p.x, p.y);
    if (roomId === null) {
      return;
    }
    onChangeFloor({
      ...floor,
      rooms: floor.rooms.map((r) =>
        r.id === roomId
          ? {
              ...r,
              placements: [
                ...r.placements.filter((placement) => placement.objectId !== objectId),
                { objectId, roomId, x: Math.round(p.x), y: Math.round(p.y), rotationDeg: 0 },
              ],
            }
          : { ...r, placements: r.placements.filter((pl) => pl.objectId !== objectId) },
      ),
    });
  }

  return (
    <div>
      {selected !== null && (
        <div className="row">
          <span className="muted">
            Выбрано: <b>{byId.get(selected)?.name ?? '?'}</b>
            {conflicts.has(selected) && <b className="bad-text"> · допуск пересекает чужое тело или зону</b>}
          </span>
          <button onClick={() => rotateSelected(-15)}>⟲ −15°</button>
          <button onClick={() => rotateSelected(15)}>⟳ +15°</button>
          <button onClick={removeFromPlan}>Убрать на склад</button>
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox="0 0 960 560"
        className="plan"
        onMouseMove={(e) => {
          const raw = svgPoint(e);
          setMouse(raw);
          if (dragRef.current) {
            const d = dragRef.current;
            movePlacement(d.objectId, raw.x - d.dx, raw.y - d.dy);
          }
        }}
        onMouseUp={() => {
          dragRef.current = null;
        }}
        onMouseLeave={() => {
          dragRef.current = null;
        }}
        onClick={() => setSelected(null)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={svgClickDropHandler}
      >
        {/* сетки нет: обзор этажа */}

        {/* зоны */}
        {zones.map((z, zoneIndex) => {
          const color = ZONE_COLORS[z.kind] ?? '#ca8a04';
          const d = z.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${X(p.x)} ${Y(p.y)}`).join(' ') + ' Z';
          const cx = z.points.reduce((a, p) => a + p.x, 0) / z.points.length;
          const cy = z.points.reduce((a, p) => a + p.y, 0) / z.points.length;
          return (
            <g key={`${z.id}-${zoneIndex}`}>
              <path d={d} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={2} />
              <text x={X(cx) + 4} y={Y(cy) - 4} fontSize={12} fill={color} fontWeight={700}>
                {z.name}
              </text>
            </g>
          );
        })}

        {/* проёмы */}
        {contours.map((c, ci) => {
          const openings = ci === 0 ? floor.shell.openings : floor.rooms[ci - 1]?.openings ?? [];
          return openings.map((o) => {
            const seg = openingSegment(c.points, o.wallPointId, o.offsetCm, o.widthCm);
            if (!seg) return null;
            const color = o.kind === 'window' ? '#2563eb' : '#b45309';
            return (
              <line
                key={o.id}
                x1={X(seg.start.x)} y1={Y(seg.start.y)} x2={X(seg.end.x)} y2={Y(seg.end.y)}
                stroke={color} strokeWidth={7} strokeLinecap="butt"
              />
            );
          });
        })}

        {/* контуры */}
        {contours.map((c, i) => (
          <path
            key={i}
            d={c.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${X(p.x)} ${Y(p.y)}`).join(' ') + ' Z'}
            fill="none"
            stroke={i === 0 ? '#334155' : '#94a3b8'}
            strokeWidth={2}
          />
        ))}

        {/* объекты: допуск + тело + метка «перед» */}
        {placements.map((p) => {
          const obj = byId.get(p.objectId);
          if (!obj) return null;
          const body = bodyPolygon(obj, p);
          const cl = clearancePolygon(obj, p);
          const conflict = conflicts.has(p.objectId);
          const isSelected = selected === p.objectId;
          return (
            <g
              key={p.objectId}
              onMouseDown={(e) => onMouseDownOnObject(e, p.objectId, p.x, p.y)}
              style={{ cursor: 'move' }}
            >
              <polygon points={polyStr(cl)} fill={conflict ? '#dc2626' : '#2563eb'} fillOpacity={0.14} stroke={conflict ? '#dc2626' : '#93c5fd'} strokeWidth={1} strokeDasharray="4 3" />
              <polygon points={polyStr(body)} fill={obj.color || '#0e7490'} fillOpacity={0.75} stroke={isSelected ? '#16a34a' : '#0f172a'} strokeWidth={isSelected ? 2.5 : 1} />
              <line x1={X(body[2].x)} y1={Y(body[2].y)} x2={X(body[3].x)} y2={Y(body[3].y)} stroke="#ffffff" strokeWidth={3} />
              <text x={X(p.x)} y={Y(p.y) + 4} fontSize={11} textAnchor="middle" fill="#0f172a" fontWeight={700}>
                {obj.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
