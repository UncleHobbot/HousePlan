import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyProject } from '@houseplan/shared';
import { createProjectSession } from './projectSession.ts';

function projectWithRoom() {
  const project = emptyProject('Дом');
  project.floors.push({
    id: 1,
    name: '1-й этаж',
    ceilingHeightCm: 260,
    shell: { contour: { points: [], thicknesses: {}, locks: [], closed: false }, openings: [] },
    rooms: [{
      id: 1,
      name: 'Гостиная',
      contour: {
        points: [
          { id: 1, x: 0, y: 0 },
          { id: 2, x: 400, y: 0 },
          { id: 3, x: 400, y: 300 },
          { id: 4, x: 0, y: 300 },
        ],
        thicknesses: {},
        locks: [],
        closed: true,
      },
      openings: [],
      zones: [],
      placements: [],
    }],
  });
  project.objects.push({
    id: 1,
    name: 'Стол',
    category: 'table',
    widthCm: 120,
    depthCm: 80,
    heightCm: 75,
    clearances: { front: 0, back: 0, left: 0, right: 0 },
  });
  return project;
}

test('одно намерение создаёт одну запись истории, undo и redo идут через тот же интерфейс', () => {
  const session = createProjectSession();
  session.dispatch({ type: 'projectLoaded', project: projectWithRoom() });
  const changed = session.dispatch({ type: 'floorRenamed', floorId: 1, name: 'Первый' });

  assert.equal(changed.ok, true);
  assert.equal(session.getSnapshot().project.floors[0].name, 'Первый');
  assert.equal(session.getSnapshot().canUndo, true);
  assert.equal(session.dispatch({ type: 'undo' }).ok, true);
  assert.equal(session.getSnapshot().project.floors[0].name, '1-й этаж');
  assert.equal(session.dispatch({ type: 'redo' }).ok, true);
  assert.equal(session.getSnapshot().project.floors[0].name, 'Первый');
});

test('отказ не меняет проект, ревизию, dirty и историю', () => {
  const session = createProjectSession();
  session.dispatch({ type: 'projectLoaded', project: projectWithRoom() });
  const before = session.getSnapshot();

  const result = session.dispatch({ type: 'roomDeleted', floorId: 1, roomId: 999 });

  assert.deepEqual(result, { ok: false, revision: before.revision, code: 'room-not-found' });
  assert.equal(session.getSnapshot(), before);
  assert.equal(session.getSnapshot().dirty, false);
  assert.equal(session.getSnapshot().canUndo, false);
});

test('подтверждение старого сохранения не очищает более новую правку', () => {
  const session = createProjectSession();
  session.dispatch({ type: 'projectLoaded', project: projectWithRoom() });
  const first = session.dispatch({ type: 'floorRenamed', floorId: 1, name: 'Первый' });
  session.dispatch({ type: 'roomRenamed', floorId: 1, roomId: 1, name: 'Зал' });

  session.dispatch({ type: 'saveAcknowledged', revision: first.revision });
  assert.equal(session.getSnapshot().dirty, true);
  session.dispatch({ type: 'saveAcknowledged', revision: session.getSnapshot().revision });
  assert.equal(session.getSnapshot().dirty, false);
});

test('принятый импорт сохранён, но его отмена становится новой несохранённой правкой', () => {
  const session = createProjectSession();
  const initial = projectWithRoom();
  session.dispatch({ type: 'projectLoaded', project: initial });
  const imported = structuredClone(initial);
  imported.objects.push({ ...initial.objects[0], id: 2, name: 'Кресло' });

  session.dispatch({ type: 'importAccepted', project: imported });
  assert.equal(session.getSnapshot().dirty, false);
  assert.equal(session.getSnapshot().canUndo, true);
  session.dispatch({ type: 'undo' });
  assert.equal(session.getSnapshot().project.objects.length, 1);
  assert.equal(session.getSnapshot().dirty, true);
});

test('движение показывает предпросмотр, но фиксируется одной операцией на mouseup', () => {
  const session = createProjectSession();
  const project = projectWithRoom();
  project.floors[0].rooms[0].placements.push({ objectId: 1, roomId: 1, x: 100, y: 100, rotationDeg: 0 });
  session.dispatch({ type: 'projectLoaded', project });
  const loadedRevision = session.getSnapshot().revision;

  session.dispatch({ type: 'placementMoveStarted', objectId: 1 });
  session.dispatch({ type: 'placementMovePreviewed', objectId: 1, floorId: 1, roomId: 1, x: 140, y: 120, rotationDeg: 0 });
  session.dispatch({ type: 'placementMovePreviewed', objectId: 1, floorId: 1, roomId: 1, x: 180, y: 160, rotationDeg: 0 });
  assert.equal(session.getSnapshot().revision, loadedRevision);
  assert.equal(session.getSnapshot().project.floors[0].rooms[0].placements[0].x, 180);

  session.dispatch({ type: 'gestureCommitted' });
  assert.equal(session.getSnapshot().revision, loadedRevision + 1);
  session.dispatch({ type: 'undo' });
  assert.equal(session.getSnapshot().project.floors[0].rooms[0].placements[0].x, 100);
});

test('отмена жеста возвращает исходное состояние без записи истории', () => {
  const session = createProjectSession();
  const project = projectWithRoom();
  project.floors[0].rooms[0].placements.push({ objectId: 1, roomId: 1, x: 100, y: 100, rotationDeg: 0 });
  session.dispatch({ type: 'projectLoaded', project });

  session.dispatch({ type: 'placementMoveStarted', objectId: 1 });
  session.dispatch({ type: 'placementMovePreviewed', objectId: 1, floorId: 1, roomId: 1, x: 200, y: 200, rotationDeg: 0 });
  session.dispatch({ type: 'gestureCancelled' });

  assert.equal(session.getSnapshot().project.floors[0].rooms[0].placements[0].x, 100);
  assert.equal(session.getSnapshot().canUndo, false);
  assert.equal(session.getSnapshot().dirty, false);
});

test('снимок проекта заморожен глубоко', () => {
  const session = createProjectSession();
  session.dispatch({ type: 'projectLoaded', project: projectWithRoom() });
  const project = session.getSnapshot().project;
  assert.equal(Object.isFrozen(project), true);
  assert.equal(Object.isFrozen(project.floors), true);
  assert.equal(Object.isFrozen(project.floors[0].rooms[0]), true);
});

test('сессия перевыдаёт постоянные ID новым элементам редактора и обновляет ссылки', () => {
  const session = createProjectSession();
  const project = projectWithRoom();
  project.floors[0].shell.contour.points.push({ id: 50, x: 0, y: 0 });
  session.dispatch({ type: 'projectLoaded', project });
  const room = session.getSnapshot().project.floors[0].rooms[0];
  const contour = structuredClone(room.contour);
  contour.points.push({ id: 50, x: 200, y: 150 });
  contour.thicknesses[50] = 10;
  const openings = [{
    id: 1,
    kind: 'innerDoor',
    wallPointId: 50,
    offsetCm: 20,
    widthCm: 80,
    heightCm: 200,
    opensTo: 'left',
    attributes: [],
  }];

  session.dispatch({
    type: 'roomEdited',
    floorId: 1,
    roomId: 1,
    expectedRevision: session.getSnapshot().revision,
    contour,
    openings,
    zones: [],
  });

  const changed = session.getSnapshot().project.floors[0].rooms[0];
  const addedPoint = changed.contour.points.at(-1);
  assert.notEqual(addedPoint.id, 50);
  assert.equal(changed.openings[0].wallPointId, addedPoint.id);
  assert.equal(changed.contour.thicknesses[addedPoint.id], 10);
});

test('результат редактора от устаревшей ревизии не перезаписывает новый проект', () => {
  const session = createProjectSession();
  session.dispatch({ type: 'projectLoaded', project: projectWithRoom() });
  const editorRevision = session.getSnapshot().revision;
  session.dispatch({ type: 'floorRenamed', floorId: 1, name: 'Изменён снаружи' });
  const current = session.getSnapshot();

  const result = session.dispatch({
    type: 'shellEdited',
    floorId: 1,
    expectedRevision: editorRevision,
    contour: current.project.floors[0].shell.contour,
    openings: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.revision, current.revision);
  assert.equal(result.code, 'stale-revision');
  assert.equal(result.project.floors[0].name, 'Изменён снаружи');
  assert.equal(session.getSnapshot().project.floors[0].name, 'Изменён снаружи');
});
