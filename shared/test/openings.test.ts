import test from 'node:test';
import assert from 'node:assert/strict';
import type { Point } from '../src/index.js';
import type { Contour } from '../src/index.js';
import { makeOpening, openingSegment, rebaseOpenings } from '../src/openings.js';

function rect(): Contour {
  return {
    points: [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 600, y: 0 },
      { id: 3, x: 600, y: 300 },
      { id: 4, x: 0, y: 300 },
    ],
    thicknesses: {}, locks: [], closed: true,
  };
}

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

test('проём на диагональной стене откладывается в сантиметрах вдоль стены', () => {
  const diagonal: Point[] = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 300, y: 400 },
  ];
  const segment = openingSegment(diagonal, 1, 100, 50);
  assert.ok(segment);
  assert.deepEqual(segment.start, { x: 60, y: 80 });
  assert.deepEqual(segment.end, { x: 90, y: 120 });
});

test('makeOpening: дефолты и центрирование по точке клика', () => {
  const c: Contour = {
    points: [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 600, y: 0 },
      { id: 3, x: 600, y: 300 },
      { id: 4, x: 0, y: 300 },
    ],
    thicknesses: {}, locks: [], closed: true,
  };
  const opening = makeOpening(c, 'window', 1, 300, 7);
  assert.ok(opening);
  assert.equal(opening.widthCm, 120, 'окно 120 по умолчанию');
  assert.equal(opening.offsetCm, 240, 'центр клика (300) минус полширины');
  assert.equal(opening.sillCm, 90);
  assert.equal(opening.topCm, 220);
  assert.equal(opening.heightCm, undefined);
  assert.equal(opening.attributes.length, 0);
});

test('makeOpening: входная дверь с дефолтами двери', () => {
  const opening = makeOpening(rect(), 'entryDoor', 1, 50, 9);
  assert.ok(opening);
  assert.equal(opening.widthCm, 100);
  assert.equal(opening.heightCm, 200);
  assert.equal(opening.offsetCm, 0, 'не вылезает за начало стены');
});

test('makeOpening: не вылезает за край стены', () => {
  const opening = makeOpening(rect(), 'window', 1, 590, 11);
  assert.ok(opening);
  assert.equal(opening.offsetCm, 480, '600 − 120 = максимум');
});

test('makeOpening: проём не вылезает за край диагональной стены', () => {
  const diagonal: Contour = {
    points: [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 300, y: 400 },
      { id: 3, x: 0, y: 400 },
    ],
    thicknesses: {}, locks: [], closed: true,
  };

  const opening = makeOpening(diagonal, 'window', 1, 490, 12);

  assert.ok(opening);
  assert.equal(opening.offsetCm, 380, 'длина стены 500 см, максимум 500 − 120');
  assert.equal(opening.offsetCm + opening.widthCm, 500);
});
