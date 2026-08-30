import test from 'node:test';
import assert from 'node:assert/strict';
import type { Contour } from '../src/index.js';
import {
  canSlide,
  chainInfo,
  crossings,
  removeLock,
  slidePoint,
  lockedWalls,
} from '../src/geometry.js';

function rect(): Contour {
  const pts = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 600, y: 0 },
    { id: 3, x: 600, y: 300 },
    { id: 4, x: 0, y: 300 },
  ];
  return { points: pts, thicknesses: {}, locks: [], closed: true };
}

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
