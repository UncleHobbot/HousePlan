import test from 'node:test';
import assert from 'node:assert/strict';
import type { Contour } from '../src/index.js';
import {
  canSlide,
  chainInfo,
  crossings,
  removeLock,
  slidePoint,
  tryLock,
  lockedWalls,
} from '../src/geometry.js';

let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) fail++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
}

function rect(): Contour {
  const pts = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 600, y: 0 },
    { id: 3, x: 600, y: 300 },
    { id: 4, x: 0, y: 300 },
  ];
  return { points: pts, thicknesses: {}, locks: [], closed: true };
}

function closureDelta(c: Contour): { dx: number; dy: number } {
  const n = c.points.length;
  let dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = c.points[i], b = c.points[(i + 1) % n];
    dx += b.x - a.x;
    dy += b.y - a.y;
  }
  return { dx, dy };
}

function wallLen(c: Contour, i: number): number {
  const n = c.points.length;
  const a = c.points[i], b = c.points[(i + 1) % n];
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
}

test('прибивание низа=500 тянет верх (прямоугольник жёсткий)', () => {
  const r = tryLock(rect(), 1, 2, 500);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(wallLen(r.contour, 2), 500);
    assert.deepEqual(r.contour.points[0], { id: 1, x: 0, y: 0 });
    assert.equal(r.contour.points[1].x, 500);
  }
});

test('вторая ось прибивается независимо', () => {
  let c = rect();
  c = (tryLock(c, 1, 2, 500) as { ok: true; contour: Contour }).contour;
  const r = tryLock(c, 2, 3, 300);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(wallLen(r.contour, 3), 300);
});

test('противоречие отвергается и называется замок', () => {
  let c = rect();
  c = (tryLock(c, 1, 2, 500) as { ok: true; contour: Contour }).contour;
  const r = tryLock(c, 1, 2, 400);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.reason, /противоречит/);
    assert.ok(r.conflicts.some((l) => l.includes('500')), r.conflicts.join(', '));
  }
});

test('Г-образная комната: замыкание и минимум длин', () => {
  const pts = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 600, y: 0 },
    { id: 3, x: 600, y: 350 },
    { id: 4, x: 250, y: 350 },
    { id: 5, x: 250, y: 600 },
    { id: 6, x: 0, y: 600 },
  ];
  const g: Contour = { points: pts, thicknesses: {}, locks: [], closed: true };
  const r = tryLock(g, 1, 2, 500);
  assert.equal(r.ok, true);
  if (r.ok) {
    const { dx, dy } = closureDelta(r.contour);
    assert.deepEqual({ dx, dy }, { dx: 0, dy: 0 });
    const n = r.contour.points.length;
    for (let i = 0; i < n; i++) assert.ok(wallLen(r.contour, i) >= 10, `стена ${i} короче 10`);
  }
});

test('разрез стены, два замка, противоречие называет оба', () => {
  const pts = [
    { id: 1, x: 0, y: 0 },
    { id: 5, x: 250, y: 0 },
    { id: 2, x: 600, y: 0 },
    { id: 3, x: 600, y: 300 },
    { id: 4, x: 0, y: 300 },
  ];
  let c: Contour = { points: pts, thicknesses: {}, locks: [], closed: true };
  const r1 = tryLock(c, 1, 5, 100);
  assert.equal(r1.ok, true);
  c = (r1 as { ok: true; contour: Contour }).contour;
  const r2 = tryLock(c, 5, 2, 150);
  assert.equal(r2.ok, true);
  c = (r2 as { ok: true; contour: Contour }).contour;
  const r3 = tryLock(c, 1, 2, 300);
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.equal(r3.conflicts.length, 2);
});

test('самопересечение «бантиком» находится', () => {
  const pts = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 300, y: 300 },
    { id: 3, x: 300, y: 0 },
    { id: 4, x: 0, y: 300 },
  ];
  assert.ok(crossings(pts).length > 0);
});

test('участок через угол отвергается', () => {
  const r = chainInfo(rect(), 2, 4);
  assert.equal(r.ok, false);
});

test('скольжение точки по прямой стене', () => {
  const pts = [
    { id: 1, x: 0, y: 0 },
    { id: 5, x: 250, y: 0 },
    { id: 2, x: 600, y: 0 },
    { id: 3, x: 600, y: 300 },
    { id: 4, x: 0, y: 300 },
  ];
  const c: Contour = { points: pts, thicknesses: {}, locks: [], closed: true };
  assert.equal(canSlide(c, 5).ok, true);
  assert.equal(canSlide(c, 3).ok, false);
  const moved = slidePoint(c, 5, 400, 50);
  assert.equal(moved.points[1].x, 400);
  assert.equal(moved.points[1].y, 0, 'точка осталась на линии стены');
});

test('точка между двумя замками не скользит', () => {
  const pts = [
    { id: 1, x: 0, y: 0 },
    { id: 5, x: 100, y: 0 },
    { id: 2, x: 250, y: 0 },
    { id: 3, x: 250, y: 300 },
    { id: 4, x: 0, y: 300 },
  ];
  const c: Contour = {
    points: pts,
    thicknesses: {},
    locks: [
      { aId: 1, bId: 5, length: 100 },
      { aId: 5, bId: 2, length: 150 },
    ],
    closed: true,
  };
  assert.equal(canSlide(c, 5).ok, false);
  assert.deepEqual([...lockedWalls(c)].sort(), [0, 1]);
});

test('снятие замка возвращает свободу', () => {
  const pts = [
    { id: 1, x: 0, y: 0 },
    { id: 5, x: 100, y: 0 },
    { id: 2, x: 250, y: 0 },
    { id: 3, x: 250, y: 300 },
    { id: 4, x: 0, y: 300 },
  ];
  const c: Contour = {
    points: pts,
    thicknesses: {},
    locks: [{ aId: 1, bId: 5, length: 100 }],
    closed: true,
  };
  assert.equal(canSlide(c, 5).ok, false);
  const unlocked = removeLock(c, 1, 5);
  assert.equal(canSlide(unlocked, 5).ok, true);
});

test('огромный размер без замков возможен, при зажатой стене — отказ', () => {
  // без замков: комната раздувается, но контур сходится — это законно
  const pts = [
    { id: 1, x: 0, y: 0 },
    { id: 5, x: 250, y: 0 },
    { id: 2, x: 600, y: 0 },
    { id: 3, x: 600, y: 300 },
    { id: 4, x: 0, y: 300 },
  ];
  const c: Contour = { points: pts, thicknesses: {}, locks: [], closed: true };
  const huge = tryLock(c, 1, 2, 100000);
  assert.equal(huge.ok, true);
  if (huge.ok) {
    const { dx, dy } = closureDelta(huge.contour);
    assert.deepEqual({ dx, dy }, { dx: 0, dy: 0 });
  }
  // с замком на половине: огромный размер противоречит замку — отказ
  const locked = tryLock(c, 1, 5, 100);
  assert.equal(locked.ok, true);
  if (locked.ok) {
    const r = tryLock(locked.contour, 1, 2, 100000);
    assert.equal(r.ok, false);
  }
});

test('свободным стенам не хватает места — отказ «не помещается»', () => {
  const lpts = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 600, y: 0 },
    { id: 3, x: 600, y: 350 },
    { id: 4, x: 250, y: 350 },
    { id: 5, x: 250, y: 600 },
    { id: 6, x: 0, y: 600 },
  ];
  const l: Contour = { points: lpts, thicknesses: {}, locks: [], closed: true };
  const r = tryLock(l, 1, 2, 20);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /не помещается/);
});
