import test from 'node:test';
import assert from 'node:assert/strict';
import type { Contour, SceneObject } from '../src/index.js';
import {
  bodyPolygon,
  clearancePolygon,
  conflictObjectIds,
  pointInPolygon,
  polygonsIntersect,
  roomAt,
} from '../src/objects.js';

const NO_CL = { front: 0, back: 0, left: 0, right: 0 };

function object(over: Partial<SceneObject>): SceneObject {
  return {
    id: 1,
    name: 'Диван',
    category: 'sofa',
    widthCm: 200,
    depthCm: 90,
    heightCm: 80,
    clearances: { ...NO_CL },
    ...over,
  };
}

function roomRect(): Contour {
  return {
    points: [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 600, y: 0 },
      { id: 3, x: 600, y: 400 },
      { id: 4, x: 0, y: 400 },
    ],
    thicknesses: {},
    locks: [],
    closed: true,
  };
}

function floorWith(rooms: Array<{ id: number; placements: Array<{ objectId: number; x: number; y: number; rotationDeg: number }> }>) {
  return {
    id: 1,
    name: '1-й этаж',
    ceilingHeightCm: 260,
    shell: { contour: { points: [], thicknesses: {}, locks: [], closed: false }, openings: [] },
    rooms: rooms.map((r) => ({
      id: r.id,
      name: 'Комната ' + r.id,
      contour: roomRect(),
      openings: [],
      zones: [],
      placements: r.placements,
    })),
  };
}

test('тело объекта — повёрнутый прямоугольник', () => {
  const o = object({});
  const poly = bodyPolygon(o, { objectId: 1, roomId: 1, x: 100, y: 100, rotationDeg: 0 });
  assert.deepEqual(poly, [
    { x: 0, y: 55 }, { x: 200, y: 55 }, { x: 200, y: 145 }, { x: 0, y: 145 },
  ]);
  const turned = bodyPolygon(o, { objectId: 1, roomId: 1, x: 100, y: 100, rotationDeg: 90 });
  // поворот на 90° по часовой: ширина ложится на ось Y
  assert.deepEqual(turned, [
    { x: 145, y: 0 }, { x: 145, y: 200 }, { x: 55, y: 200 }, { x: 55, y: 0 },
  ]);
});

test('допуск расширяет тело: перед — проход, спинка — вплотную к стене', () => {
  const o = object({ clearances: { front: 70, back: 0, left: 5, right: 5 } });
  const cl = clearancePolygon(o, { objectId: 1, roomId: 1, x: 100, y: 100, rotationDeg: 0 });
  // тело: x 0..200, y 55..145; допуск: x −5..205, y 55..215
  assert.deepEqual(cl, [
    { x: -5, y: 55 }, { x: 205, y: 55 }, { x: 205, y: 215 }, { x: -5, y: 215 },
  ]);
});

test('стул в проходе перед диваном подсвечивает конфликт', () => {
  const sofa = object({ id: 1, clearances: { front: 70, back: 0, left: 0, right: 0 } });
  const chair = object({ id: 2, name: 'Стул', category: 'chair', widthCm: 45, depthCm: 45, heightCm: 90 });
  const floor = floorWith([
    { id: 1, placements: [
      { objectId: 1, x: 100, y: 100, rotationDeg: 0 },
      { objectId: 2, x: 150, y: 210, rotationDeg: 180 },
    ] },
  ]);
  const conflicts = conflictObjectIds([sofa, chair], floor, []);
  // конфликт у владельца допуска: диван подсвечен, стул (без допуска) — нет
  assert.ok(conflicts.has(1), 'диван подсвечен');
  assert.ok(!conflicts.has(2), 'стул не подсвечен');
});

test('стул за пределами допуска не конфликтует', () => {
  const sofa = object({ id: 1, clearances: { front: 70, back: 0, left: 0, right: 0 } });
  const chair = object({ id: 2, name: 'Стул', category: 'chair', widthCm: 45, depthCm: 45, heightCm: 90 });
  const floor = floorWith([
    { id: 1, placements: [
      { objectId: 1, x: 100, y: 100, rotationDeg: 0 },
      { objectId: 2, x: 450, y: 300, rotationDeg: 0 },
    ] },
  ]);
  assert.equal(conflictObjectIds([sofa, chair], floor, []).size, 0);
});

test('допуск на служебную зону — конфликт', () => {
  const sofa = object({ id: 1, clearances: { front: 70, back: 0, left: 0, right: 0 } });
  const floor = floorWith([{ id: 1, placements: [{ objectId: 1, x: 100, y: 100, rotationDeg: 0 }] }]);
  const stairs: Zone = {
    id: 1, kind: 'stairs', name: 'Лестница',
    points: [
      { id: 11, x: 80, y: 160 }, { id: 12, x: 180, y: 160 },
      { id: 13, x: 180, y: 260 }, { id: 14, x: 80, y: 260 },
    ],
    clearances: { ...NO_CL }, attributes: [],
  };
  assert.ok(conflictObjectIds([sofa], floor, [stairs]).has(1));
});

test('нахождение помещения по точке', () => {
  const floor = floorWith([{ id: 1, placements: [] }]);
  assert.equal(roomAt(floor, 300, 200), 1);
  assert.equal(roomAt(floor, 700, 200), null);
});

test('точка в полигоне и пересечение полигонов', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.ok(pointInPolygon({ x: 5, y: 5 }, square));
  assert.ok(!pointInPolygon({ x: 15, y: 5 }, square));
  const shifted = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }];
  assert.ok(polygonsIntersect(square, shifted));
  const far = [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 110 }, { x: 100, y: 110 }];
  assert.ok(!polygonsIntersect(square, far));
});
