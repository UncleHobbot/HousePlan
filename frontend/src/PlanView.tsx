import type { Contour, Floor, Opening } from '@houseplan/shared';
import { openingSegment } from '@houseplan/shared';

/**
 * Просмотр этажа: оболочка и помещения как многоугольники, проёмы на стенах.
 * Толщина стен рисуется полосой наружу от линии контура (ADR 0004).
 */
export function PlanView({ floor }: { floor: Floor }) {
  const shell = floor.shell;
  const all = [shell.contour, ...floor.rooms.map((r) => r.contour)].filter((c) => c.points.length >= 3);

  const xs = all.flatMap((c) => c.points.map((p) => p.x));
  const ys = all.flatMap((c) => c.points.map((p) => p.y));
  if (xs.length === 0) return <p className="muted">Контур пуст.</p>;
  const minX = Math.min(...xs) - 60;
  const maxX = Math.max(...xs) + 60;
  const minY = Math.min(...ys) - 60;
  const maxY = Math.max(...ys) + 60;
  const k = Math.min(960 / (maxX - minX), 560 / (maxY - minY));
  const X = (x: number) => (x - minX) * k;
  const Y = (y: number) => (y - minY) * k;

  return (
    <svg viewBox="0 0 960 560" className="plan">
      {all.map((contour, index) => (
        <Polygon key={index} contour={contour} shell={index === 0} X={X} Y={Y} />
      ))}
      {all[0] && <Openings contour={all[0]} openings={shell.openings} X={X} Y={Y} k={k} />}
      {floor.rooms.map((r) => (
        <Openings key={r.id} contour={r.contour} openings={r.openings} X={X} Y={Y} k={k} />
      ))}
    </svg>
  );
}

function Openings({
  contour,
  openings,
  X,
  Y,
  k,
}: {
  contour: Contour;
  openings: Opening[];
  X: (x: number) => number;
  Y: (y: number) => number;
  k: number;
}) {
  return (
    <>
      {openings.map((o) => {
        const seg = openingSegment(contour.points, o.wallPointId, o.offsetCm, o.widthCm);
        if (!seg) return null;
        const color = o.kind === 'window' ? '#2563eb' : '#b45309';
        return (
          <line
            key={o.id}
            x1={X(seg.start.x)} y1={Y(seg.start.y)} x2={X(seg.end.x)} y2={Y(seg.end.y)}
            stroke={color} strokeWidth={7} strokeLinecap="butt"
          />
        );
      })}
    </>
  );
}

function Polygon({
  contour,
  shell,
  X,
  Y,
}: {
  contour: Contour;
  shell: boolean;
  X: (x: number) => number;
  Y: (y: number) => number;
}) {
  const n = contour.points.length;
  const d =
    contour.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${X(p.x)} ${Y(p.y)}`)
      .join(' ') + (contour.closed ? ' Z' : '');

  // полосы толщины: для каждой стены — прямоугольник наружу (упрощённо, без скосов)
  const strips = contour.points.map((p, i) => {
    const q = contour.points[(i + 1) % n];
    const t = contour.thicknesses[p.id] ?? 0;
    if (t === 0 || (!contour.closed && i === n - 1)) return null;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    // наружная нормаль (влево от направления обхода)
    const nx = (dy / len) * t;
    const ny = (-dx / len) * t;
    return {
      d: `M ${X(p.x)} ${Y(p.y)} L ${X(q.x)} ${Y(q.y)} L ${X(q.x + nx)} ${Y(q.y + ny)} L ${X(p.x + nx)} ${Y(p.y + ny)} Z`,
    };
  });

  return (
    <g>
      {strips.map((s, i) =>
        s ? <path key={'t' + i} d={s.d} fill="#94a3b855" stroke="none" /> : null,
      )}
      <path d={d} fill="none" stroke={shell ? '#334155' : '#94a3b8'} strokeWidth={2} />
      {contour.points.map((p) => (
        <circle key={p.id} cx={X(p.x)} cy={Y(p.y)} r={3} fill="#0e7490" />
      ))}
    </g>
  );
}
