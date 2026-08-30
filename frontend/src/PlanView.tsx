import type { Contour, Floor } from '@houseplan/shared';

/**
 * Просмотр этажа: оболочка и помещения как многоугольники.
 * Толщина стен рисуется полосой наружу от линии контура (ADR 0004).
 */
export function PlanView({ floor }: { floor: Floor }) {
  const all = [
    floor.shell.contour,
    ...floor.rooms.map((r) => r.contour),
  ].filter((c) => c.points.length >= 3);

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
    <svg viewBox={`0 0 960 560`} className="plan">
      {all.map((contour, index) => (
        <Polygon key={index} contour={contour} shell={index === 0} X={X} Y={Y} />
      ))}
    </svg>
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
      .join(' ') + ' Z';

  // полосы толщины: для каждой стены — прямоугольник наружу (упрощённо, без скосов)
  const strips = contour.points.map((p, i) => {
    const q = contour.points[(i + 1) % n];
    const t = contour.thicknesses[p.id] ?? 0;
    if (t === 0) return null;
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
      <path d={d} fill="none" stroke={shell ? '#334155' : '#94a3b8'} strokeWidth={2} />
      {strips.map((s, i) =>
        s ? <path key={i} d={s.d} fill="#94a3b855" stroke="none" /> : null,
      )}
      {contour.points.map((p) => (
        <circle key={p.id} cx={X(p.x)} cy={Y(p.y)} r={3} fill="#0e7490" />
      ))}
    </g>
  );
}
