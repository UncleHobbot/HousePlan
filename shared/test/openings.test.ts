import test from 'node:test';
import assert from 'node:assert/strict';
import type { Point } from '../src/index.js';
import { openingSegment, rebaseOpenings } from '../src/openings.js';

const wall = [
  { id: 1, x: 0, y: 0 },
  { id: 2, x: 600, y: 0 },
];

test('проём считается от угла стены', () => {
  const s = openingSegment(wall, 1, 100, 120);
  assert.ok(s);
  assert.deepEqual(s.start, { x: 100, y: 0 });
  assert.deepEqual(s.end, { x: 220, y: 0 });
});

test('проём не вылезает за край стены', () => {
  const s = openingSegment(wall, 1, 550, 120);
  assert.ok(s);
  assert.equal(s.end.x, 600);
});

test('при уменьшении стены проём остаётся на своей доле', () => {
  const oldPoints = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 600, y: 0 },
  ];
  const newPoints = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 300, y: 0 },
  ];
  const [o] = rebaseOpenings(oldPoints, newPoints, [
    { wallPointId: 1, offsetCm: 100, widthCm: 120 },
  ]);
  // доля была 100/600 = 1/6 → на новой стене 50 от угла
  assert.equal(o.offsetCm, 50);
});

test('проём не вылезает при сжатии стены до ширины проёма', () => {
  const oldPoints = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 600, y: 0 },
  ];
  const newPoints = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 300, y: 0 },
  ];
  const [o] = rebaseOpenings(oldPoints, newPoints, [
    { wallPointId: 1, offsetCm: 450, widthCm: 200 },
  ]);
  // влезает ровно впритык к краю: 300 − 200 = 100
  assert.equal(o.offsetCm, 100);
});

test('пустая стена и вертикальная стена обрабатываются', () => {
  assert.equal(openingSegment(wall, 99, 10, 10), null);
  const vertical: Point[] = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 0, y: 400 },
  ];
  const s = openingSegment(vertical, 1, 50, 80);
  assert.ok(s);
  assert.deepEqual(s.start, { x: 0, y: 50 });
});
