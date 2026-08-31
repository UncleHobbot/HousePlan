import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project, SceneObject, Zone } from '../src/index.js';
import { addFloor, objectLocation, projectedZonesForFloor, roomLabel } from '../src/project.js';

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

test('roomLabel: «Этаж: помещение», неизвестный id — «?»', () => {
  assert.equal(roomLabel(project(), 20), '1-й этаж: Салон');
  assert.equal(roomLabel(project(), 999), '?');
});

test('objectLocation: расставленный объект — имя помещения, остальные — на складе', () => {
  const p = project();
  assert.equal(objectLocation(p, 1), '1-й этаж: Салон');
  assert.equal(objectLocation(p, 999), 'на складе');
});

test('addFloor копирует оболочку соседнего этажа с независимыми идентификаторами', () => {
  const p = project();
  const source = p.floors[1];
  source.shell = {
    contour: {
      points: [
        { id: 101, x: 0, y: 0 },
        { id: 102, x: 500, y: 0 },
        { id: 103, x: 500, y: 400 },
      ],
      thicknesses: { 101: 15, 102: 20, 103: 25 },
      locks: [{ aId: 101, bId: 103, length: 900 }],
      closed: true,
    },
    openings: [{
      id: 50,
      kind: 'window',
      wallPointId: 102,
      offsetCm: 100,
      widthCm: 120,
      attributes: [],
    }],
  };
  p.counters = { floor: 0, point: 0, opening: 0 };

  const added = addFloor(p, source.id);

  assert.equal(p.floors.at(-1), added);
  assert.equal(added.name, '4-й этаж');
  assert.deepEqual(
    added.shell.contour.points.map(({ x, y }) => ({ x, y })),
    source.shell.contour.points.map(({ x, y }) => ({ x, y })),
  );
  const sourcePointIds = new Set(source.shell.contour.points.map(({ id }) => id));
  assert.ok(added.shell.contour.points.every(({ id }) => !sourcePointIds.has(id)));
  assert.notEqual(added.shell.openings[0].id, source.shell.openings[0].id);

  const copiedPointIds = added.shell.contour.points.map(({ id }) => id);
  assert.deepEqual(Object.keys(added.shell.contour.thicknesses).map(Number), copiedPointIds);
  assert.deepEqual(
    added.shell.contour.locks[0],
    { aId: copiedPointIds[0], bId: copiedPointIds[2], length: 900 },
  );
  assert.equal(added.shell.openings[0].wallPointId, copiedPointIds[1]);

  added.shell.contour.points[0].x = 999;
  added.shell.openings[0].attributes.push({ name: 'Штора', value: 'Да' });
  assert.equal(source.shell.contour.points[0].x, 0, 'геометрия этажей не связана');
  assert.deepEqual(source.shell.openings[0].attributes, [], 'проёмы этажей не связаны');
});
