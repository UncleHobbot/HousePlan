import test from 'node:test';
import assert from 'node:assert/strict';
import type { Contour } from '@houseplan/shared';
import { wallThicknessBands, zoneStyle, withAlpha, contourCentroid } from '../src/planScene';

function rect(): Contour {
  return {
    points: [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 600, y: 0 },
      { id: 3, x: 600, y: 400 },
      { id: 4, x: 0, y: 400 },
    ],
    thicknesses: { 1: 30 },
    locks: [],
    closed: true,
  };
}

test('полоса толщины рисуется наружу от линии контура', () => {
  const bands = wallThicknessBands(rect());
  // только у стены 1→2 задана толщина 30
  assert.equal(bands.length, 1);
  const [a, b, c, d] = bands[0];
  assert.deepEqual([a, b], [{ x: 0, y: 0 }, { x: 600, y: 0 }]);
  // нормаль наружу: вверх от верхней стены
  assert.deepEqual([c, d], [{ x: 600, y: -30 }, { x: 0, y: -30 }]);
});

test('полосы толщины идут наружу при обоих направлениях обхода контура', () => {
  const forward = rect();
  const reverse: Contour = {
    ...forward,
    points: [...forward.points].reverse(),
    thicknesses: { 2: 30 },
  };

  assert.deepEqual(wallThicknessBands(forward)[0], [
    { x: 0, y: 0 },
    { x: 600, y: 0 },
    { x: 600, y: -30 },
    { x: 0, y: -30 },
  ]);
  assert.deepEqual(wallThicknessBands(reverse)[0], [
    { x: 600, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: -30 },
    { x: 600, y: -30 },
  ]);
});

test('стены без толщины полос не дают', () => {
  const c = rect();
  c.thicknesses = {};
  assert.equal(wallThicknessBands(c).length, 0);
});

test('незамкнутый контур полос не даёт', () => {
  const c = rect();
  c.closed = false;
  assert.equal(wallThicknessBands(c).length, 0);
});

test('zoneStyle: цвет и подпись для каждого типа зоны', () => {
  const stairs = zoneStyle('stairs');
  assert.equal(stairs.color, '#7c3aed');
  assert.equal(stairs.label, 'Лестница');
  const other = zoneStyle('other');
  assert.equal(other.label, 'Зона');
});

test('withAlpha превращает hex в rgba', () => {
  assert.equal(withAlpha('#7c3aed', 0.3), 'rgba(124, 58, 237, 0.3)');
  assert.equal(withAlpha('не-цвет', 0.3), 'не-цвет');
});

test('contourCentroid — среднее координат вершин', () => {
  const center = contourCentroid(rect().points);
  assert.deepEqual(center, { x: 300, y: 200 });
});
