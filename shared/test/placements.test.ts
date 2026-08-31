import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project, SceneObject } from '../src/index.js';
import {
  deleteObject,
  largestRoom,
  locateObject,
  placeObject,
  roomCentroid,
  rotateObject,
  unplaceObject,
} from '../src/placements.js';

const sofa: SceneObject = {
  id: 1, name: 'Диван', category: 'sofa',
  widthCm: 200, depthCm: 90, heightCm: 80,
  clearances: { front: 0, back: 0, left: 0, right: 0 },
};
const chair: SceneObject = {
  id: 2, name: 'Стул', category: 'chair',
  widthCm: 45, depthCm: 45, heightCm: 90,
  clearances: { front: 0, back: 0, left: 0, right: 0 },
};

function roomRect(id: number, name: string, w: number): Project['floors'][number]['rooms'][number] {
  return {
    id,
    name,
    contour: {
      points: [
        { id: id * 10, x: 0, y: 0 },
        { id: id * 10 + 1, x: w, y: 0 },
        { id: id * 10 + 2, x: w, y: 400 },
        { id: id * 10 + 3, x: 0, y: 400 },
      ],
      thicknesses: {}, locks: [], closed: true,
    },
    openings: [], zones: [], placements: [],
  };
}

function project(): Project {
  return {
    formatVersion: 1,
    name: 'Дом',
    floors: [
      {
        id: 1, name: '1-й этаж', ceilingHeightCm: 260,
        shell: { contour: { points: [], thicknesses: {}, locks: [], closed: false }, openings: [] },
        rooms: [roomRect(1, 'Салон', 600)],
      },
      {
        id: 2, name: '2-й этаж', ceilingHeightCm: 260,
        shell: { contour: { points: [], thicknesses: {}, locks: [], closed: false }, openings: [] },
        rooms: [roomRect(2, 'Спальня', 500)],
      },
    ],
    objects: [structuredClone(sofa), structuredClone(chair)],
    snapshots: [],
    counters: { floor: 2, room: 2 },
  };
}

function allPlacements(p: Project): Array<{ objectId: number; floorId: number }> {
  return p.floors.flatMap((f) =>
    f.rooms.flatMap((r) => r.placements.map((pl) => ({ objectId: pl.objectId, floorId: f.id }))),
  );
}

test('placeObject: одно размещение, прежнее исчезает даже на другом этаже', () => {
  let p = project();
  p = placeObject(p, 1, 1, { x: 100, y: 100 }, 1)!;
  assert.equal(allPlacements(p).length, 1);
  p = placeObject(p, 1, 2, { x: 200, y: 200 }, 2)!;
  const places = allPlacements(p);
  assert.equal(places.length, 1, 'дубля на первом этаже не осталось');
  assert.equal(places[0].floorId, 2);
});

test('placeObject без помещения выбирает самое большое', () => {
  const p = project();
  const placed = placeObject(p, 1, 1, { x: 100, y: 100 })!;
  assert.equal(placed.floors[0].rooms[0].id, 1, 'Салон 600 шире Спальни 500');
});

test('placeObject возвращает null, если на этаже нет помещений', () => {
  const p = project();
  p.floors[0].rooms = [];
  assert.equal(placeObject(p, 1, 1, { x: 100, y: 100 }), null);
});

test('locateObject находит этаж и помещение; на складе — null', () => {
  let p = placeObject(project(), 1, 1, { x: 100, y: 100 }, 1)!;
  const located = locateObject(p, 1);
  assert.equal(located?.floor.id, 1);
  assert.equal(located?.room.name, 'Салон');
  assert.equal(locateObject(p, 2), null, 'стул на складе');
  p = unplaceObject(p, 1);
  assert.equal(locateObject(p, 1), null);
});

test('deleteObject убирает объект и его размещение', () => {
  let p = placeObject(project(), 1, 1, { x: 100, y: 100 }, 1)!;
  p = deleteObject(p, 1);
  assert.equal(p.objects.length, 1, 'остался только стул');
  assert.equal(allPlacements(p).length, 0);
});

test('rotateObject по модулю 360', () => {
  let p = placeObject(project(), 1, 1, { x: 100, y: 100 }, 1)!;
  p = rotateObject(p, 1, 350)!;
  p = rotateObject(p, 1, 15)!;
  const placed = locateObject(p, 1)!.placement;
  assert.equal(placed.rotationDeg, 5);
  assert.equal(rotateObject(p, 99, 15), null, 'несуществующий объект — null');
});

test('largestRoom и roomCentroid', () => {
  const floor = project().floors[0];
  assert.equal(largestRoom(floor)?.id, 1);
  const c = roomCentroid(floor.rooms[0]);
  assert.deepEqual(c, { x: 300, y: 200 });
});
