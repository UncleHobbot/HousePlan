import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project, SceneObject } from '../src/index.js';
import { applySnapshot, createSnapshot, diffPlacements, livePlacements } from '../src/snapshots.js';

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
        openings: [], zones: [],
        placements: [
          { objectId: 1, roomId: 10, x: 100, y: 100, rotationDeg: 0 },
        ],
      }],
    }],
    objects: [structuredClone(sofa), structuredClone(chair)],
    snapshots: [],
    counters: { floor: 1, room: 1, point: 104, object: 2, snapshot: 0 },
  };
}

test('слепок расстановки: размещённое и склад раздельно', () => {
  const p = project();
  const snap = createSnapshot(p, 1, 'Вариант 1', 'заметка');
  assert.equal(snap.placements.length, 1);
  assert.equal(snap.placements[0].object.name, 'Диван');
  assert.equal(snap.storeroomObjects.length, 1);
  assert.equal(snap.storeroomObjects[0].name, 'Стул');
  assert.equal(snap.note, 'заметка');
});

test('слепок — копия, а не ссылка', () => {
  const p = project();
  const snap = createSnapshot(p, 1, 'Вариант');
  // двигаем диван в живом плане — снэпшот стоит на месте
  p.floors[0].rooms[0].placements[0].x = 400;
  p.objects[0].name = 'Диван другой';
  assert.equal(snap.placements[0].x, 100);
  assert.equal(snap.placements[0].object.name, 'Диван');
});

test('возврат варианта заменяет живой план и склад', () => {
  let p = project();
  p.snapshots.push(createSnapshot(p, 1, 'Было'));
  // после снэпшота: диван переехал, стул удалили, добавили кресло
  p.objects = p.objects.filter((o) => o.id !== 2);
  p.floors[0].rooms[0].placements = [];
  p.objects.push({ ...chair, id: 3, name: 'Кресло' });
  p.floors[0].rooms[0].placements.push({ objectId: 3, roomId: 10, x: 300, y: 200, rotationDeg: 90 });
  p.counters.object = 3;

  p = applySnapshot(p, p.snapshots[0]);
  // вернулся состав объектов на момент снэпшота: диван и стул, кресло исчезло
  assert.deepEqual(p.objects.map((o) => o.name).sort(), ['Диван', 'Стул']);
  assert.equal(p.floors[0].rooms[0].placements.length, 1);
  assert.equal(p.floors[0].rooms[0].placements[0].objectId, 1);
  // счётчик не откатился под слепком
  assert.ok((p.counters.object ?? 0) >= 3);
});

test('комната исчезла — объект варианта уходит на склад', () => {
  let p = project();
  p.snapshots.push(createSnapshot(p, 1, 'Было'));
  p.floors[0].rooms = []; // планировку снесли
  p = applySnapshot(p, p.snapshots[0]);
  assert.equal(p.floors[0].rooms.length, 0);
  // диван живёт на складе, не теряется
  assert.deepEqual(p.objects.map((o) => o.name).sort(), ['Диван', 'Стул']);
});

test('сравнение: переехало, добавилось, убралось', () => {
  const before = livePlacements(project());
  const afterProject = project();
  afterProject.floors[0].rooms[0].placements[0].x = 300;
  afterProject.floors[0].rooms[0].placements.push({ objectId: 2, roomId: 10, x: 400, y: 200, rotationDeg: 0 });
  afterProject.objects.push({ ...chair, id: 3, name: 'Кресло' });
  afterProject.floors[0].rooms[0].placements.push({ objectId: 3, roomId: 10, x: 500, y: 200, rotationDeg: 0 });
  const after = livePlacements(afterProject);
  const diff = diffPlacements(before, after);
  assert.equal(diff.moved.length, 1);
  assert.equal(diff.moved[0].object.name, 'Диван');
  // стул (лежал на складе) и кресло добавлены на план
  assert.equal(diff.added.length, 2);
  assert.deepEqual(diff.added.map((p) => p.object.name).sort(), ['Кресло', 'Стул']);
  assert.equal(diff.removed.length, 0);
  // в обратную сторону стул и кресло «убраны» с плана
  const reverse = diffPlacements(after, before);
  assert.equal(reverse.removed.length, 2);
  assert.equal(reverse.added.length, 0);
});
