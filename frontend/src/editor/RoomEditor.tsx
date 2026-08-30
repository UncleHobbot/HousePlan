import { useEffect, useRef, useState } from 'react';
import type { Contour, Point } from '@houseplan/shared';
import {
  canSlide,
  chainInfo,
  crossings,
  lockLabel,
  lockedWalls,
  slidePoint,
  tryLock,
} from '@houseplan/shared';

const GRID = 25;

interface Banner {
  kind: 'info' | 'ok' | 'bad';
  text: string;
}

/**
 * Редактор одного помещения: рисование контура на глаз, прибивание размеров,
 * разрез стен, скольжение точек. Поведение перенесено из подтверждённого
 * черновика (prototype/editor-draft).
 */
export function RoomEditor({
  roomName,
  contour,
  onChangeContour,
  onDone,
}: {
  roomName: string;
  contour: Contour;
  onChangeContour: (contour: Contour) => void;
  onDone: () => void;
}) {
  const points = contour.points;
  const drawing = !contour.closed;
  const n = points.length;

  const [banner, setBanner] = useState<Banner | null>({ kind: 'info', text: 'Кликайте по полю — ставьте углы; клик в первую точку замыкает контур.' });
  const [selA, setSelA] = useState<number | null>(null);
  const [selB, setSelB] = useState<number | null>(null);
  const [snap, setSnap] = useState(true);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [slideId, setSlideId] = useState<number | null>(null);
  const [inputBad, setInputBad] = useState(false);
  const slideRef = useRef<number | null>(null);
  const maxPointId = useRef(Math.max(0, ...points.map((p) => p.id)));
  const svgRef = useRef<SVGSVGElement | null>(null);

  function say(kind: Banner['kind'], text: string) {
    setBanner({ kind, text });
  }

  function setContour(contour: Contour) {
    onChangeContour(contour);
  }

  // ---------- преобразование координат (вписываем содержимое в поле) ----------
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
      setContour(slidePoint(contour, slideRef.current, raw.x, raw.y));
    }
  }

  useEffect(() => {
    function up() {
      if (slideRef.current !== null) {
        slideRef.current = null;
        setSlideId(null);
      }
    }
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  function onMouseDown(e: React.MouseEvent) {
    const raw = svgPoint(e);
    if (contour.closed) {
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

  function onClick(e: React.MouseEvent) {
    const raw = svgPoint(e);
    const pt = pointAt(raw);

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
      const wall = wallAt(raw);
      if (wall !== null) {
        const a = points[wall];
        const b = points[(wall + 1) % n];
        const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
        const newId = ++maxPointId.current;
        const pts = [...points];
        pts.splice(wall + 1, 0, { id: newId, x: mid.x, y: mid.y });
        const thicknesses = { ...contour.thicknesses, [newId]: contour.thicknesses[a.id] ?? 10 };
        setContour({ ...contour, points: pts, thicknesses });
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
      setContour({ ...contour, closed: true });
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
    setContour({ ...contour, points: [...points, { id, x: p.x, y: p.y }] });
    say('info', 'Точка поставлена. Клик в первую точку замыкает контур.');
  }

  // ---------- прибивание ----------
  const selInfo = (() => {
    if (selA !== null && selB !== null) {
      const info = chainInfo(contour, selA, selB);
      if (info.ok) {
        return {
          ok: true as const,
          text: `Участок А${selA} → А${selB}: сейчас ${info.length} см. Точка А${selA} останется на месте.`,
          length: info.length,
        };
      }
      return { ok: false as const, text: info.reason };
    }
    if (selA !== null) return { ok: false as const, text: `Точка А выбрана: А${selA}. Теперь выберите точку Б.` };
    return { ok: false as const, text: 'Выберите две точки контура: сначала та, что останется на месте (А), затем Б.' };
  })();

  function pin() {
    if (selA === null || selB === null) return;
    const target = parseInt(inputValue, 10);
    const res = tryLock(contour, selA, selB, target);
    if (res.ok) {
      setContour(res.contour);
      setInputBad(false);
      say('ok', `Размер прибит: ${res.label}. Точка А${selA} на месте, остальное подстроилось.`);
    } else {
      setInputBad(true);
      const conflicts = res.conflicts.length ? ` Замки-конфликтники: ${res.conflicts.map((c) => `«${c}»`).join(', ')}. Снимите один из них.` : '';
      say('bad', res.reason + conflicts);
    }
  }

  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (selA !== null && selB !== null) {
      const info = chainInfo(contour, selA, selB);
      if (info.ok) setInputValue(String(info.length));
    }
  }, [selA, selB, contour]);

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
        >
          {snap &&
            Array.from({ length: Math.ceil(960 / (GRID * k)) + 1 }, (_, gx) => (
              <line key={'v' + gx} x1={gx * GRID * k - ((minX * k) % (GRID * k))} y1={0} x2={gx * GRID * k - ((minX * k) % (GRID * k))} y2={560} stroke="#eef2f7" />
            ))}
          {snap &&
            Array.from({ length: Math.ceil(560 / (GRID * k)) + 1 }, (_, gy) => (
              <line key={'h' + gy} x1={0} y1={gy * GRID * k - ((minY * k) % (GRID * k))} x2={960} y2={gy * GRID * k - ((minY * k) % (GRID * k))} stroke="#eef2f7" />
            ))}

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

          {/* точки */}
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
          <p className="muted" id="sel-info">{selInfo.ok ? selInfo.text : selInfo.text}</p>
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
                      setContour({ ...contour, locks: contour.locks.filter((x) => x.aId !== l.aId || x.bId !== l.bId) });
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
      </div>
    </div>
  );
}
