import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project, SceneObject, Zone } from '../src/index.js';
import { objectLocation, projectedZonesForFloor, roomLabel } from '../src/project.js';

const stairs = (id: number, fromFloorId: number, toFloorId: number): Zone => ({
  id,
  kind: 'stairs',
  name: 'Лестница',
  points: [],
  spansFloors: { fromFloorId, toFloorId },
  clearances: { front: 0, back: 0, left: 0, right: 0 },
  attributes: [],
});

function project(): Project {
  return {
    formatVersion: 1,
    name: 'Дом',
    floors: [
      {
        id: 1, name: 'Бейсмент', ceilingHeightCm: 260,
        shell: { contour: { points: [], thicknesses: {}, locks: [], closed: false }, openings: [] },
        rooms: [{
          id: 10, name: 'Котельная',
          contour: { points: [], thicknesses: {}, locks: [], closed: true },
          openings: [], zones: [stairs(1, 1, 3)], placements: [],
        }],
      },
      {
        id: 2, name: '1-й этаж', ceilingHeightCm: 260,
        shell: { contour: { points: [], thicknesses: {}, locks: [], closed: false }, openings: [] },
        rooms: [{
          id: 20, name: 'Салон',
          contour: { points: [], thicknesses: {}, locks: [], closed: true },
          openings: [],
          zones: [stairs(2, 2, 3)],
          placements: [{ objectId: 1, roomId: 20, x: 100, y: 100, rotationDeg: 0 }],
        }],
      },
      {
        id: 3, name: '2-й этаж', ceilingHeightCm: 260,
        shell: { contour: { points: [], thicknesses: {}, locks: [], closed: false }, openings: [] },
        rooms: [{
          id: 30, name: 'Спальня',
          contour: { points: [], thicknesses: {}, locks: [], closed: true },
          openings: [], zones: [], placements: [],
        }],
      },
    ],
    objects: [{ ...sofa }],
    snapshots: [],
    counters: {},
  };
}

const sofa: SceneObject = {
  id: 1, name: 'Диван', category: 'sofa',
  widthCm: 200, depthCm: 90, heightCm: 80,
  clearances: { front: 0, back: 0, left: 0, right: 0 },
};


test('сквозная зона видна на этажах диапазона, кроме своего', () => {
  const p = project();
  // лестница «1..3» хранится на бейсмейте (этаж 1)
  assert.equal(projectedZonesForFloor(p, 1).length, 0, 'на своём этаже — своя зона, не проекция');
  assert.equal(projectedZonesForFloor(p, 2).length, 1, 'проекция на 1-й этаж');
  // на 2-м этаже видны обе лестницы: «1..3» (со склада test data) и «2..3»
  assert.equal(projectedZonesForFloor(p, 3).length, 2, 'проекции на 2-й этаж');
});

test('диапазон «от-до» работает в обе стороны записи', () => {
  const p = project();
  // зона «2..3» хранится на 2-м этаже: видна на 2-м и 3-м, не видна на бейсмейте
  assert.equal(projectedZonesForFloor(p, 1).some((z) => z.id === 2), false);
  assert.equal(projectedZonesForFloor(p, 3).some((z) => z.id === 2), true);
});

test('roomLabel: «Этаж: комната», неизвестный id — «?»', () => {
  assert.equal(roomLabel(project(), 20), '1-й этаж: Салон');
  assert.equal(roomLabel(project(), 999), '?');
});

test('objectLocation: расставленный объект — имя комнаты, остальных — склад', () => {
  const p = project();
  assert.equal(objectLocation(p, 1), '1-й этаж: Салон');
  assert.equal(objectLocation(p, 999), 'на складе');
});
