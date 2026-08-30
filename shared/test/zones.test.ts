import test from 'node:test';
import assert from 'node:assert/strict';
import type { Contour, Zone } from '../src/index.js';
import { tryLock } from '../src/geometry.js';
import { rebaseZones } from '../src/zones.js';

test('зона едет вместе со своей точкой при прибивании размера', () => {
  const points = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 600, y: 0 },
    { id: 3, x: 600, y: 300 },
    { id: 4, x: 0, y: 300 },
  ];
  const contour: Contour = { points, thicknesses: {}, locks: [], closed: true };
  // простенок растёт из точки А2, второй конец на (500, 150)
  const zone: Zone = {
    id: 1,
    kind: 'partition',
    name: 'Простенок',
    points: [
      { id: 101, x: 600, y: 0 },
      { id: 102, x: 500, y: 0 },
    ],
    fromPointId: 2,
    clearances: { front: 0, back: 0, left: 0, right: 0 },
    attributes: [],
  };
  const r = tryLock(contour, 1, 2, 500);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const rebased = rebaseZones(contour.points, r.contour.points, [zone]);
  // А2 уехала с (600,0) на (500,0): зона сместилась на тот же вектор
  assert.equal(rebased[0].points[0].x, 500);
  assert.equal(rebased[0].points[1].x, 400);
  // длина простенка сохранилась
  assert.equal(
    Math.abs(rebased[0].points[0].x - rebased[0].points[1].x),
    100,
  );
});

test('непривязанная зона не двигается', () => {
  const oldPoints = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 600, y: 0 },
  ];
  const newPoints = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 500, y: 0 },
  ];
  const zone: Zone = {
    id: 1,
    kind: 'other',
    name: 'Зона',
    points: [
      { id: 101, x: 100, y: 100 },
      { id: 102, x: 200, y: 100 },
    ],
    clearances: { front: 0, back: 0, left: 0, right: 0 },
    attributes: [],
  };
  const rebased = rebaseZones(oldPoints, newPoints, [zone]);
  assert.deepEqual(rebased[0].points, zone.points);
});
