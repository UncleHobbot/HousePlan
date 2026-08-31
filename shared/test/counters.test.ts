import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../src/index.js';
import { allocateId, emptyProject, rebaseCounters } from '../src/index.js';

function project(): Project {
  return {
    formatVersion: 1,
    name: 'Дом',
    floors: [{
      id: 1, name: '1-й этаж', ceilingHeightCm: 260,
      shell: { contour: { points: [], thicknesses: {}, locks: [], closed: false }, openings: [] },
      rooms: [{
        id: 10, name: 'Салон',
        contour: {
          points: [
            { id: 100, x: 0, y: 0 }, { id: 101, x: 600, y: 0 },
            { id: 102, x: 600, y: 400 }, { id: 103, x: 0, y: 400 },
          ],
          thicknesses: {}, locks: [], closed: true,
        },
        openings: [{ id: 50, kind: 'window', wallPointId: 100, offsetCm: 100, widthCm: 120, attributes: [] }],
        zones: [],
        placements: [],
      }],
    }],
    objects: [],
    snapshots: [],
    counters: { floor: 1, room: 10, point: 103, opening: 50 },
  };
}

test('allocateId выдаёт следующий номер и увеличивает счётчик', () => {
  const p = emptyProject('Дом');
  assert.equal(allocateId(p, 'object'), 1);
  assert.equal(allocateId(p, 'object'), 2);
  assert.equal(allocateId(p, 'floor'), 1);
  assert.equal(p.counters.object, 2);
  assert.equal(p.counters.floor, 1);
});

test('rebaseCounters поднимает счётчики под существующими идентификаторами', () => {
  const p = project();
  // счётчик точки сброшен (как после отмены или возврата варианта)
  p.counters.point = 5;
  rebaseCounters(p);
  assert.ok((p.counters.point ?? 0) >= 103, 'счётчик точек выше максимума');
  assert.ok((p.counters.opening ?? 0) >= 50);
  // новый id не конфликтует с существующими
  const id = allocateId(p, 'point');
  const all = p.floors[0].rooms[0].contour.points.map((point) => point.id);
  assert.ok(!all.includes(id));
});

test('rebaseCounters не понижает счётчики', () => {
  const p = emptyProject('Дом');
  p.counters.object = 10;
  rebaseCounters(p);
  assert.equal(p.counters.object, 10);
});

test('allocateId после rebase не конфликтует со слепками снэпшота', () => {
  const p = project();
  // В снэпшоте лежат копии объектов, которых в живом плане уже нет.
  p.snapshots.push({
    id: 1,
    name: 'До перестановки',
    placements: [{
      object: {
        id: 7,
        name: 'Стол',
        category: 'table',
        widthCm: 120,
        depthCm: 70,
        heightCm: 75,
        clearances: { front: 0, back: 0, left: 0, right: 0 },
      },
      roomId: 10,
      x: 10,
      y: 20,
      rotationDeg: 0,
    }],
    storeroomObjects: [{
      id: 8,
      name: 'Стул',
      category: 'chair',
      widthCm: 45,
      depthCm: 45,
      heightCm: 90,
      clearances: { front: 0, back: 0, left: 0, right: 0 },
    }],
  });
  p.counters.object = 3;
  p.counters.snapshot = 1;
  rebaseCounters(p);
  const id = allocateId(p, 'object');
  assert.ok(id > 8, 'новый id выше объектов из расстановки и склада снэпшота');
});
