import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorSession } from './editorSession.ts';

function shellPlan() {
  return {
    kind: 'shell',
    name: 'Оболочка',
    contour: { points: [], thicknesses: {}, locks: [], closed: false },
    openings: [],
    openingKinds: ['window', 'entryDoor'],
  };
}

function closedShellPlan() {
  const plan = shellPlan();
  plan.contour = {
    points: [
      { id: 1, x: 0, y: 0 },
      { id: 5, x: 150, y: 0 },
      { id: 2, x: 300, y: 0 },
      { id: 3, x: 300, y: 200 },
      { id: 4, x: 0, y: 200 },
    ],
    thicknesses: { 1: 10, 5: 10, 2: 10, 3: 10, 4: 10 },
    locks: [],
    closed: true,
  };
  return plan;
}

function roomPlan() {
  const shell = closedShellPlan();
  return {
    ...shell,
    kind: 'room',
    name: 'Комната',
    openingKinds: ['innerDoor'],
    zones: [],
    floors: [{ id: 1, name: '1-й этаж' }],
    floorId: 1,
  };
}

function createSession(plan = shellPlan(), solver) {
  let revision = 1;
  const commits = [];
  const session = createEditorSession({
    source: { plan, revision },
    commit(change) {
      commits.push(change);
      revision += 1;
      return { ok: true, revision, plan: change.plan };
    },
    loadSolver: async () => solver ?? ({
      pin: () => ({ ok: false, reason: 'unused', conflicts: [] }),
      dispose() {},
    }),
  });
  return { session, commits };
}

test('переключение инструмента отменяет прежний режим, не создавая commit', () => {
  const { session, commits } = createSession();

  session.dispatch({ type: 'toolSelected', tool: { kind: 'opening', openingKind: 'window' } });
  assert.equal(session.getSnapshot().tool.kind, 'opening');
  session.dispatch({ type: 'toolSelected', tool: { kind: 'polygonZone', zoneKind: 'stairs', zoneName: 'Лестница' } });

  assert.equal(session.getSnapshot().tool.kind, 'polygonZone');
  assert.equal(session.getSnapshot().tool.draft, null);
  assert.equal(commits.length, 0);
});

test('прибивание размера использует адаптер решателя и создаёт один commit', async () => {
  let calls = 0;
  const solver = {
    pin(contour, aId, bId, target) {
      calls += 1;
      return { ok: true, contour: { ...contour, locks: [...contour.locks, { aId, bId, length: target }] }, label: `${target} см` };
    },
    dispose() {},
  };
  const { session, commits } = createSession(closedShellPlan(), solver);
  await Promise.resolve();
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 0, y: 0 }, target: { kind: 'point', pointId: 1 } } });
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 300, y: 0 }, target: { kind: 'point', pointId: 2 } } });
  session.dispatch({ type: 'dimensionValueChanged', value: '450' });
  session.dispatch({ type: 'dimensionPinRequested' });

  assert.equal(calls, 1);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].action, 'dimension-pinned');
  assert.equal(session.getSnapshot().plan.contour.locks[0].length, 450);
});

test('каждая точка и замыкание контура являются отдельными завершёнными действиями', () => {
  const { session, commits } = createSession();

  session.dispatch({ type: 'canvasClicked', event: { position: { x: 0, y: 0 }, target: { kind: 'canvas' } } });
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 300, y: 0 }, target: { kind: 'canvas' } } });
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 300, y: 200 }, target: { kind: 'canvas' } } });
  const firstId = session.getSnapshot().plan.contour.points[0].id;
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 0, y: 0 }, target: { kind: 'point', pointId: firstId } } });

  assert.deepEqual(commits.map((item) => item.action), [
    'point-added',
    'point-added',
    'point-added',
    'contour-closed',
  ]);
  assert.equal(session.getSnapshot().plan.contour.closed, true);
  assert.equal(session.getSnapshot().tool.kind, 'select');
});

test('несколько движений точки дают preview и один commit при завершении жеста', () => {
  const { session, commits } = createSession(closedShellPlan());

  session.dispatch({ type: 'pointerPressed', event: { position: { x: 150, y: 0 }, target: { kind: 'point', pointId: 5 } } });
  session.dispatch({ type: 'pointerMoved', position: { x: 180, y: 40 } });
  session.dispatch({ type: 'pointerMoved', position: { x: 220, y: 80 } });
  assert.equal(commits.length, 0);
  assert.equal(session.getSnapshot().plan.contour.points[1].x, 220);

  session.dispatch({ type: 'pointerReleased' });
  assert.equal(commits.length, 1);
  assert.equal(commits[0].action, 'point-moved');
});

test('клик без движения и отменённый drag не создают commit', () => {
  const { session, commits } = createSession(closedShellPlan());

  session.dispatch({ type: 'pointerPressed', event: { position: { x: 150, y: 0 }, target: { kind: 'point', pointId: 5 } } });
  session.dispatch({ type: 'pointerReleased' });
  assert.equal(commits.length, 0);

  session.dispatch({ type: 'pointerPressed', event: { position: { x: 150, y: 0 }, target: { kind: 'point', pointId: 5 } } });
  session.dispatch({ type: 'pointerMoved', position: { x: 220, y: 80 } });
  assert.equal(session.getSnapshot().plan.contour.points[1].x, 220);
  session.dispatch({ type: 'pointerCancelled' });

  assert.equal(commits.length, 0);
  assert.equal(session.getSnapshot().plan.contour.points[1].x, 150);
});

test('подтверждённое удаление точки атомарно удаляет связанный проём', () => {
  const plan = closedShellPlan();
  plan.openings.push({
    id: 10,
    kind: 'window',
    wallPointId: 1,
    offsetCm: 20,
    widthCm: 80,
    sillCm: 90,
    topCm: 220,
    attributes: [],
  });
  const { session, commits } = createSession(plan);
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 0, y: 0 }, target: { kind: 'point', pointId: 1 } } });

  const request = session.dispatch({ type: 'deleteRequested', pointId: 1 });
  assert.equal(request.ok, false);
  assert.equal(request.confirmation.data.openingCount, 1);
  assert.equal(commits.length, 0);

  session.dispatch({ type: 'deleteConfirmed', pointId: 1 });
  assert.equal(commits.length, 1);
  assert.equal(commits[0].action, 'point-deleted');
  assert.equal(session.getSnapshot().plan.openings.length, 0);
  assert.deepEqual(session.getSnapshot().canvas.selection, { aId: null, bId: null });
});

test('зона и разрез опорной стены фиксируются одним commit только после завершения', () => {
  const { session, commits } = createSession(roomPlan());
  const initialPointCount = session.getSnapshot().plan.contour.points.length;
  session.dispatch({ type: 'toolSelected', tool: { kind: 'polygonZone', zoneKind: 'stairs', zoneName: 'Лестница' } });

  session.dispatch({ type: 'canvasClicked', event: { position: { x: 80, y: 0 }, target: { kind: 'wall', wallIndex: 0 } } });
  assert.equal(commits.length, 0);
  assert.equal(session.getSnapshot().plan.contour.points.length, initialPointCount + 1);
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 120, y: 80 }, target: { kind: 'canvas' } } });
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 40, y: 80 }, target: { kind: 'canvas' } } });
  session.dispatch({ type: 'zoneFinished' });

  assert.equal(commits.length, 1);
  assert.equal(commits[0].action, 'zone-added');
  assert.equal(session.getSnapshot().plan.zones.length, 1);
  assert.equal(session.getSnapshot().tool.kind, 'select');
});

test('переключение инструмента отменяет черновой разрез стены', () => {
  const { session, commits } = createSession(roomPlan());
  const initialPointCount = session.getSnapshot().plan.contour.points.length;
  session.dispatch({ type: 'toolSelected', tool: { kind: 'polygonZone', zoneKind: 'stairs', zoneName: 'Лестница' } });
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 80, y: 0 }, target: { kind: 'wall', wallIndex: 0 } } });

  session.dispatch({ type: 'toolSelected', tool: { kind: 'opening', openingKind: 'innerDoor' } });

  assert.equal(session.getSnapshot().plan.contour.points.length, initialPointCount);
  assert.equal(session.getSnapshot().tool.kind, 'opening');
  assert.equal(commits.length, 0);
});

test('внешнее изменение отменяет несовместимый черновик и сохраняет настройки', () => {
  const { session, commits } = createSession(roomPlan());
  session.dispatch({ type: 'snapChanged', value: false });
  session.dispatch({ type: 'zoneKindSelected', kind: 'stairs' });
  session.dispatch({ type: 'toolSelected', tool: { kind: 'polygonZone', zoneKind: 'stairs', zoneName: 'Лестница' } });
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 80, y: 0 }, target: { kind: 'wall', wallIndex: 0 } } });
  const external = roomPlan();
  external.name = 'Внешняя версия';

  session.dispatch({ type: 'sourceChanged', plan: external, revision: 7, origin: 'external' });

  assert.equal(session.getSnapshot().plan.name, 'Внешняя версия');
  assert.equal(session.getSnapshot().revision, 7);
  assert.equal(session.getSnapshot().tool.kind, 'select');
  assert.equal(session.getSnapshot().canvas.snap, false);
  assert.equal(session.getSnapshot().preferences.zoneKind, 'stairs');
  assert.equal(commits.length, 0);
});

test('повтор собственного источника той же ревизии не затирает активный черновик', () => {
  const source = roomPlan();
  const { session, commits } = createSession(source);
  session.dispatch({ type: 'toolSelected', tool: { kind: 'polygonZone', zoneKind: 'stairs', zoneName: 'Лестница' } });
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 80, y: 0 }, target: { kind: 'wall', wallIndex: 0 } } });
  const draftPointCount = session.getSnapshot().plan.contour.points.length;

  session.dispatch({ type: 'sourceChanged', plan: source, revision: 1, origin: 'ownCommit' });

  assert.equal(session.getSnapshot().plan.contour.points.length, draftPointCount);
  assert.equal(session.getSnapshot().tool.kind, 'polygonZone');
  assert.notEqual(session.getSnapshot().tool.draft, null);
  assert.equal(commits.length, 0);
});

test('простенок начинается только с опорной стены', () => {
  const { session, commits } = createSession(roomPlan());
  session.dispatch({ type: 'toolSelected', tool: { kind: 'partition', zoneKind: 'partition', zoneName: 'Перегородка' } });

  const result = session.dispatch({ type: 'canvasClicked', event: { position: { x: 0, y: 0 }, target: { kind: 'point', pointId: 1 } } });

  assert.deepEqual(result, { ok: false, code: 'partition-wall-required' });
  assert.equal(session.getSnapshot().tool.draft, null);
  assert.equal(commits.length, 0);
});

test('отключённое прилипание не округляет новую точку к сетке', () => {
  const { session } = createSession();
  session.dispatch({ type: 'snapChanged', value: false });

  session.dispatch({ type: 'canvasClicked', event: { position: { x: 13, y: 17 }, target: { kind: 'canvas' } } });

  assert.deepEqual(session.getSnapshot().plan.contour.points[0], { id: -1, x: 13, y: 17 });
});

test('вершина зоны прилипает к сетке и фиксируется одним commit', () => {
  const plan = roomPlan();
  plan.zones.push({
    id: 10,
    kind: 'stairs',
    name: 'Лестница',
    points: [{ id: 11, x: 10, y: 10 }, { id: 12, x: 80, y: 10 }, { id: 13, x: 40, y: 80 }],
    clearances: { front: 0, back: 0, left: 0, right: 0 },
    attributes: [],
  });
  const { session, commits } = createSession(plan);

  session.dispatch({ type: 'pointerPressed', event: { position: { x: 10, y: 10 }, target: { kind: 'zoneVertex', zoneId: 10, pointId: 11 } } });
  session.dispatch({ type: 'pointerMoved', position: { x: 37, y: 41 } });
  assert.deepEqual(session.getSnapshot().plan.zones[0].points[0], { id: 11, x: 25, y: 50 });
  session.dispatch({ type: 'pointerReleased' });

  assert.equal(commits.length, 1);
  assert.equal(commits[0].action, 'zone-vertex-moved');
});

test('конфликт решателя возвращает структурированные подробности без commit', async () => {
  const solver = {
    pin() { return { ok: false, reason: 'locked', conflicts: ['A1-A2', 'A2-A3'] }; },
    dispose() {},
  };
  const { session, commits } = createSession(closedShellPlan(), solver);
  await Promise.resolve();
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 0, y: 0 }, target: { kind: 'point', pointId: 1 } } });
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 300, y: 0 }, target: { kind: 'point', pointId: 2 } } });
  session.dispatch({ type: 'dimensionValueChanged', value: '450' });

  const result = session.dispatch({ type: 'dimensionPinRequested' });

  assert.deepEqual(result, {
    ok: false,
    code: 'dimension-conflict',
    data: { reason: 'locked', conflicts: ['A1-A2', 'A2-A3'] },
  });
  assert.equal(commits.length, 0);
});

test('снимок нельзя изменить в обход dispatch', () => {
  const { session } = createSession(closedShellPlan());
  const snapshot = session.getSnapshot();

  assert.throws(() => snapshot.plan.contour.points.push({ id: 99, x: 0, y: 0 }), TypeError);
  assert.throws(() => snapshot.canvas.crossedWalls.push(99), TypeError);
  assert.equal(session.getSnapshot().plan.contour.points.length, 5);
});

test('отказ устаревшего commit принимает актуальный источник и сбрасывает черновик', () => {
  const current = roomPlan();
  current.name = 'Актуальная версия';
  const session = createEditorSession({
    source: { plan: roomPlan(), revision: 1 },
    commit: () => ({ ok: false, revision: 7, code: 'stale-revision', plan: current }),
    loadSolver: async () => ({
      pin: () => ({ ok: false, reason: 'unused', conflicts: [] }),
      dispose() {},
    }),
  });
  session.dispatch({ type: 'toolSelected', tool: { kind: 'polygonZone', zoneKind: 'stairs', zoneName: 'Лестница' } });
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 80, y: 0 }, target: { kind: 'wall', wallIndex: 0 } } });
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 120, y: 80 }, target: { kind: 'canvas' } } });
  session.dispatch({ type: 'canvasClicked', event: { position: { x: 40, y: 80 }, target: { kind: 'canvas' } } });

  const result = session.dispatch({ type: 'zoneFinished' });

  assert.deepEqual(result, { ok: false, code: 'stale-revision' });
  assert.equal(session.getSnapshot().revision, 7);
  assert.equal(session.getSnapshot().plan.name, 'Актуальная версия');
  assert.equal(session.getSnapshot().tool.kind, 'select');
  assert.equal(session.getSnapshot().capabilities.hasUncommittedDraft, false);
});
