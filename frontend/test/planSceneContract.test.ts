import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyProject, type Floor } from '@houseplan/shared';
import { createEditorSession, type EditorPlan } from '../src/editor/editorSession.ts';
import { buildEditableScene, buildFloorScene } from '../src/planScene/index.ts';

function floorWithShell(): Floor {
  return {
    id: 1,
    name: '1-й этаж',
    ceilingHeightCm: 260,
    shell: {
      contour: {
        points: [
          { id: 1, x: 0, y: 0 },
          { id: 2, x: 600, y: 0 },
          { id: 3, x: 600, y: 400 },
          { id: 4, x: 0, y: 400 },
        ],
        thicknesses: { 1: 30 },
        locks: [],
        closed: true,
      },
      openings: [],
    },
    rooms: [],
  };
}

function createTestEditor(plan: EditorPlan) {
  return createEditorSession({
    source: { plan, revision: 1 },
    commit: ({ plan: next, expectedRevision }) => ({
      ok: true,
      revision: expectedRevision + 1,
      plan: next,
    }),
    loadSolver: async () => ({
      pin: () => ({ ok: false, reason: 'unused', conflicts: [] }),
      dispose() {},
    }),
  });
}

function closedContour() {
  return {
    points: [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 300, y: 0 },
      { id: 3, x: 300, y: 200 },
      { id: 4, x: 0, y: 200 },
    ],
    thicknesses: {},
    locks: [],
    closed: true,
  };
}

function closedShellPlan(): Extract<EditorPlan, { kind: 'shell' }> {
  return {
    kind: 'shell',
    name: 'Оболочка этажа',
    contour: closedContour(),
    openings: [],
    openingKinds: ['window', 'entryDoor'],
  };
}

function closedRoomPlan(): Extract<EditorPlan, { kind: 'room' }> {
  return {
    kind: 'room',
    name: 'Гостиная',
    contour: closedContour(),
    openings: [],
    openingKinds: ['innerDoor'],
    zones: [],
    floors: [],
    floorId: 1,
  };
}

test('сцена этажа рисует толщину оболочки наружу раньше линии контура', () => {
  const project = emptyProject('Дом');
  project.floors.push(floorWithShell());

  const scene = buildFloorScene({
    project,
    floorId: 1,
    selectedObjectId: null,
  });

  assert.deepEqual(scene.diagnostics, []);
  assert.equal(Object.isFrozen(scene), true);
  assert.equal(Object.isFrozen(scene.marks), true);
  assert.equal(Object.isFrozen(scene.marks[0]), true);
  assert.deepEqual(scene.marks.map(({ kind, role }) => ({ kind, role })), [
    { kind: 'path', role: 'wall-thickness' },
    { kind: 'path', role: 'shell-wall' },
  ]);
  assert.deepEqual(scene.marks[0], {
    key: 'shell-thickness-1',
    kind: 'path',
    role: 'wall-thickness',
    points: [
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: -30 },
      { x: 0, y: -30 },
    ],
    closed: true,
  });
  assert.deepEqual(scene.marks[1], {
    key: 'shell-contour',
    kind: 'path',
    role: 'shell-wall',
    points: [
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: 400 },
      { x: 0, y: 400 },
    ],
    closed: true,
  });
  assert.ok(scene.extent.some((point) => point.x === 600 && point.y === -30));
});

test('повреждённый элемент даёт диагностику и не скрывает остальную сцену', () => {
  const project = emptyProject('Дом');
  const floor = floorWithShell();
  floor.shell.openings.push({
    id: 7,
    kind: 'window',
    wallPointId: 999,
    offsetCm: 10,
    widthCm: 100,
    sillCm: 90,
    topCm: 220,
    attributes: [],
  });
  project.floors.push(floor);

  const scene = buildFloorScene({ project, floorId: 1, selectedObjectId: null });

  assert.deepEqual(scene.diagnostics, [{ code: 'opening-detached', openingId: 7 }]);
  assert.ok(scene.marks.some((mark) => mark.role === 'shell-wall'));
  assert.equal(scene.marks.some((mark) => mark.key === 'opening-7'), false);
});

test('сцена этажа собирает зоны, контуры, проёмы и подписи в общем порядке', () => {
  const project = emptyProject('Дом');
  const floor = floorWithShell();
  floor.shell.openings.push({
    id: 1,
    kind: 'window',
    wallPointId: 1,
    offsetCm: 100,
    widthCm: 120,
    sillCm: 90,
    topCm: 220,
    attributes: [],
  });
  floor.shell.openings.push({
    id: 2,
    kind: 'entryDoor',
    wallPointId: 2,
    offsetCm: 50,
    widthCm: 90,
    heightCm: 210,
    opensTo: 'right',
    attributes: [],
  });
  floor.rooms.push({
    id: 1,
    name: 'Гостиная',
    contour: {
      points: [
        { id: 11, x: 50, y: 50 },
        { id: 12, x: 350, y: 50 },
        { id: 13, x: 350, y: 300 },
        { id: 14, x: 50, y: 300 },
      ],
      thicknesses: {},
      locks: [],
      closed: true,
    },
    openings: [],
    zones: [{
      id: 1,
      kind: 'fireplace',
      name: 'Камин',
      points: [
        { id: 21, x: 70, y: 70 },
        { id: 22, x: 130, y: 70 },
        { id: 23, x: 100, y: 120 },
      ],
      clearances: { front: 0, back: 0, left: 0, right: 0 },
      attributes: [],
    }],
    placements: [],
  });
  project.floors.push(floor);

  const scene = buildFloorScene({ project, floorId: 1, selectedObjectId: null });

  assert.deepEqual(scene.marks.map(({ role }) => role), [
    'zone',
    'wall-thickness',
    'shell-wall',
    'room-wall',
    'window',
    'door',
    'door-swing',
    'zone-label',
  ]);
  assert.deepEqual(scene.marks.find((mark) => mark.role === 'window'), {
    key: 'opening-1',
    kind: 'path',
    role: 'window',
    points: [{ x: 100, y: 0 }, { x: 220, y: 0 }],
    closed: false,
  });
  assert.deepEqual(scene.marks.find((mark) => mark.role === 'zone-label'), {
    key: 'zone-label-1',
    kind: 'label',
    role: 'zone-label',
    at: { x: 100, y: 87 },
    text: 'Камин',
    zoneKind: 'fireplace',
  });
  assert.equal(scene.marks.find((mark) => mark.role === 'door-swing')?.kind, 'path');
});

test('сцена этажа строит тело, допуск и цель мыши размещённого объекта', () => {
  const project = emptyProject('Дом');
  const floor = floorWithShell();
  floor.rooms.push({
    id: 1,
    name: 'Гостиная',
    contour: {
      points: [
        { id: 11, x: 0, y: 0 },
        { id: 12, x: 600, y: 0 },
        { id: 13, x: 600, y: 400 },
        { id: 14, x: 0, y: 400 },
      ],
      thicknesses: {},
      locks: [],
      closed: true,
    },
    openings: [],
    zones: [],
    placements: [{ objectId: 1, roomId: 1, x: 200, y: 150, rotationDeg: 0 }],
  });
  project.floors.push(floor);
  project.objects.push({
    id: 1,
    name: 'Стол',
    category: 'table',
    widthCm: 100,
    depthCm: 50,
    heightCm: 75,
    color: '#123456',
    clearances: { front: 20, back: 10, left: 5, right: 15 },
  });
  project.snapshots.push({
    id: 1,
    name: 'До перестановки',
    placements: [{
      object: structuredClone(project.objects[0]),
      roomId: 1,
      x: 100,
      y: 100,
      rotationDeg: 0,
    }],
    storeroomObjects: [],
  });

  const scene = buildFloorScene({ project, floorId: 1, selectedObjectId: 1, compareSnapshotId: 1 });
  const objectMarks = scene.marks.filter((mark) => 'target' in mark && mark.target?.kind === 'object');

  assert.deepEqual(objectMarks, [
    {
      key: 'object-clearance-1',
      kind: 'path',
      role: 'clearance',
      points: [
        { x: 145, y: 115 },
        { x: 265, y: 115 },
        { x: 265, y: 195 },
        { x: 145, y: 195 },
      ],
      closed: true,
      target: { kind: 'object', objectId: 1 },
    },
    {
      key: 'object-body-1',
      kind: 'path',
      role: 'object',
      points: [
        { x: 150, y: 125 },
        { x: 250, y: 125 },
        { x: 250, y: 175 },
        { x: 150, y: 175 },
      ],
      closed: true,
      target: { kind: 'object', objectId: 1 },
      tint: '#123456',
      states: ['selected', 'comparison'],
    },
    {
      key: 'object-front-1',
      kind: 'path',
      role: 'object-front',
      points: [{ x: 250, y: 175 }, { x: 150, y: 175 }],
      closed: false,
      target: { kind: 'object', objectId: 1 },
    },
    {
      key: 'object-label-1',
      kind: 'label',
      role: 'object-label',
      at: { x: 200, y: 150 },
      text: 'Стол',
      target: { kind: 'object', objectId: 1 },
    },
  ]);
  assert.ok(scene.extent.some((point) => point.x === 265 && point.y === 195));
});

test('сцена этажа сама добавляет проекцию сквозной служебной зоны', () => {
  const project = emptyProject('Дом');
  const first = floorWithShell();
  const second = floorWithShell();
  second.id = 2;
  second.name = '2-й этаж';
  second.rooms.push({
    id: 2,
    name: 'Холл',
    contour: { points: [], thicknesses: {}, locks: [], closed: false },
    openings: [],
    zones: [{
      id: 9,
      kind: 'stairs',
      name: 'Лестница',
      points: [
        { id: 91, x: 610, y: 100 },
        { id: 92, x: 650, y: 100 },
        { id: 93, x: 650, y: 140 },
        { id: 94, x: 610, y: 140 },
      ],
      spansFloors: { fromFloorId: 1, toFloorId: 2 },
      clearances: { front: 0, back: 0, left: 0, right: 0 },
      attributes: [],
    }],
    placements: [],
  });
  project.floors.push(first, second);

  const scene = buildFloorScene({ project, floorId: 1, selectedObjectId: null });

  assert.deepEqual(scene.marks.filter((mark) => mark.key === 'zone-9' || mark.key === 'zone-label-9'), [
    {
      key: 'zone-9',
      kind: 'path',
      role: 'zone',
      points: [
        { x: 610, y: 100 },
        { x: 650, y: 100 },
        { x: 650, y: 140 },
        { x: 610, y: 140 },
      ],
      closed: true,
      zoneKind: 'stairs',
    },
    {
      key: 'zone-label-9',
      kind: 'label',
      role: 'zone-label',
      at: { x: 630, y: 120 },
      text: 'Лестница ⭥',
      zoneKind: 'stairs',
    },
  ]);
  assert.ok(scene.extent.some((point) => point.x === 650 && point.y === 140));
});

test('редактор строит отдельную цель мыши для каждой стены незамкнутого контура', () => {
  const plan: EditorPlan = {
    kind: 'shell',
    name: 'Оболочка этажа',
    contour: {
      points: [
        { id: 1, x: 10, y: 20 },
        { id: 2, x: 110, y: 20 },
        { id: 3, x: 110, y: 80 },
      ],
      thicknesses: {},
      locks: [],
      closed: false,
    },
    openings: [],
    openingKinds: ['window', 'entryDoor'],
  };
  const session = createTestEditor(plan);

  const scene = buildEditableScene(session.getSnapshot());

  assert.deepEqual(scene.diagnostics, []);
  assert.deepEqual(
    scene.marks.filter((mark) => mark.role === 'wall' || mark.role === 'wall-locked'),
    [
      {
        key: 'editor-wall-1',
        kind: 'path',
        role: 'wall',
        points: [{ x: 10, y: 20 }, { x: 110, y: 20 }],
        closed: false,
        target: { kind: 'wall', wallIndex: 0 },
      },
      {
        key: 'editor-wall-2',
        kind: 'path',
        role: 'wall',
        points: [{ x: 110, y: 20 }, { x: 110, y: 80 }],
        closed: false,
        target: { kind: 'wall', wallIndex: 1 },
      },
    ],
  );
  assert.ok(scene.extent.some((point) => point.x === 10 && point.y === 20));
  assert.ok(scene.extent.some((point) => point.x === 110 && point.y === 80));
  session.dispose();
});

test('редактор включает толщину стены в сцену и её границы', () => {
  const plan = closedShellPlan();
  plan.contour.thicknesses = { 1: 20 };
  const session = createTestEditor(plan);

  const scene = buildEditableScene(session.getSnapshot());

  assert.deepEqual(scene.marks.find((mark) => mark.role === 'wall-thickness'), {
    key: 'editor-thickness-1',
    kind: 'path',
    role: 'wall-thickness',
    points: [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: -20 },
      { x: 0, y: -20 },
    ],
    closed: true,
  });
  assert.ok(scene.marks.findIndex((mark) => mark.role === 'wall-thickness') < scene.marks.findIndex((mark) => mark.role === 'wall'));
  assert.ok(scene.extent.some((point) => point.x === 300 && point.y === -20));
  session.dispose();
});

test('редактор помечает каждую стену прибитого участка', () => {
  const plan = closedShellPlan();
  plan.contour.locks = [{ aId: 1, bId: 3, length: 500 }];
  const session = createTestEditor(plan);

  const scene = buildEditableScene(session.getSnapshot());

  assert.deepEqual(
    scene.marks.filter((mark) => mark.kind === 'path').map(({ role, target }) => ({ role, target })),
    [
      { role: 'wall-locked', target: { kind: 'wall', wallIndex: 0 } },
      { role: 'wall-locked', target: { kind: 'wall', wallIndex: 1 } },
      { role: 'wall', target: { kind: 'wall', wallIndex: 2 } },
      { role: 'wall', target: { kind: 'wall', wallIndex: 3 } },
    ],
  );
  assert.deepEqual(scene.marks.filter((mark) => mark.role === 'wall-length').slice(0, 2), [
    {
      key: 'wall-length-1',
      kind: 'label',
      role: 'wall-length',
      at: { x: 150, y: 0 },
      text: '300 🔒',
      states: ['locked'],
    },
    {
      key: 'wall-length-2',
      kind: 'label',
      role: 'wall-length',
      at: { x: 300, y: 100 },
      text: '200 🔒',
      states: ['locked'],
    },
  ]);
  session.dispose();
});

test('редактор строит дверной проём и дугу открывания после стен', () => {
  const plan = closedRoomPlan();
  plan.openings.push({
      id: 1,
      kind: 'innerDoor',
      wallPointId: 1,
      offsetCm: 50,
      widthCm: 90,
      heightCm: 200,
      opensTo: 'left',
      attributes: [],
  });
  const session = createTestEditor(plan);

  const scene = buildEditableScene(session.getSnapshot());
  const opening = scene.marks.find((mark) => mark.role === 'door');
  const swing = scene.marks.find((mark) => mark.role === 'door-swing');

  assert.deepEqual(opening, {
    key: 'opening-1',
    kind: 'path',
    role: 'door',
    points: [{ x: 50, y: 0 }, { x: 140, y: 0 }],
    closed: false,
  });
  assert.equal(swing?.kind, 'path');
  if (swing?.kind === 'path') {
    assert.equal(swing.points.length, 15);
    assert.deepEqual(swing.points.slice(0, 3), [
      { x: 50, y: 0 },
      { x: 140, y: 0 },
      { x: 140, y: 0 },
    ]);
    assert.ok(Math.abs(swing.points.at(-1)!.x - 50) < 1e-9);
    assert.ok(Math.abs(swing.points.at(-1)!.y - 90) < 1e-9);
  }
  assert.ok(scene.marks.findIndex((mark) => mark.role === 'wall') < scene.marks.findIndex((mark) => mark.role === 'door'));
  session.dispose();
});

test('редактор рисует служебную зону раньше стен, а её точки оставляет сверху', () => {
  const plan = closedRoomPlan();
  plan.zones.push({
      id: 10,
      kind: 'stairs',
      name: 'Лестница',
      points: [
        { id: 11, x: 20, y: 20 },
        { id: 12, x: 80, y: 20 },
        { id: 13, x: 50, y: 70 },
      ],
      clearances: { front: 0, back: 0, left: 0, right: 0 },
      attributes: [],
  });
  const session = createTestEditor(plan);

  const scene = buildEditableScene(session.getSnapshot());
  const zoneMarks = scene.marks.filter((mark) => mark.role.startsWith('zone'));

  assert.deepEqual(zoneMarks, [
    {
      key: 'zone-10',
      kind: 'path',
      role: 'zone',
      points: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 50, y: 70 }],
      closed: true,
      zoneKind: 'stairs',
    },
    {
      key: 'zone-label-10',
      kind: 'label',
      role: 'zone-label',
      at: { x: 50, y: 37 },
      text: 'Лестница',
      zoneKind: 'stairs',
    },
    {
      key: 'zone-point-11',
      kind: 'marker',
      role: 'zone-point',
      at: { x: 20, y: 20 },
      zoneKind: 'stairs',
      target: { kind: 'zoneVertex', zoneId: 10, pointId: 11 },
    },
    {
      key: 'zone-point-12',
      kind: 'marker',
      role: 'zone-point',
      at: { x: 80, y: 20 },
      zoneKind: 'stairs',
      target: { kind: 'zoneVertex', zoneId: 10, pointId: 12 },
    },
    {
      key: 'zone-point-13',
      kind: 'marker',
      role: 'zone-point',
      at: { x: 50, y: 70 },
      zoneKind: 'stairs',
      target: { kind: 'zoneVertex', zoneId: 10, pointId: 13 },
    },
  ]);
  assert.ok(scene.marks.findIndex((mark) => mark.key === 'zone-10') < scene.marks.findIndex((mark) => mark.role === 'wall'));
  assert.ok(scene.marks.findIndex((mark) => mark.key === 'zone-point-11') > scene.marks.findIndex((mark) => mark.role === 'wall'));
  session.dispose();
});

test('редактор возвращает выбор и цель мыши для точки контура', () => {
  const plan = closedShellPlan();
  const session = createTestEditor(plan);
  session.dispatch({
    type: 'canvasClicked',
    event: { position: { x: 0, y: 0 }, target: { kind: 'point', pointId: 1 } },
  });

  const scene = buildEditableScene(session.getSnapshot());
  const points = scene.marks.filter((mark) => mark.role === 'point');

  assert.deepEqual(points[0], {
    key: 'point-1',
    kind: 'marker',
    role: 'point',
    at: { x: 0, y: 0 },
    target: { kind: 'point', pointId: 1 },
    states: ['selected-a'],
  });
  assert.deepEqual(points[1], {
    key: 'point-2',
    kind: 'marker',
    role: 'point',
    at: { x: 300, y: 0 },
    target: { kind: 'point', pointId: 2 },
    states: ['immovable'],
  });
  assert.ok(scene.marks.findIndex((mark) => mark.role === 'point') > scene.marks.findIndex((mark) => mark.role === 'wall'));
  session.dispose();
});

test('редактор кладёт активный черновик служебной зоны поверх постоянной сцены', () => {
  const plan = closedRoomPlan();
  const session = createTestEditor(plan);
  session.dispatch({
    type: 'toolSelected',
    tool: { kind: 'polygonZone', zoneKind: 'stairs', zoneName: 'Лестница' },
  });
  session.dispatch({
    type: 'canvasClicked',
    event: { position: { x: 0, y: 0 }, target: { kind: 'point', pointId: 1 } },
  });
  session.dispatch({
    type: 'canvasClicked',
    event: { position: { x: 100, y: 100 }, target: { kind: 'canvas' } },
  });
  session.dispatch({ type: 'pointerMoved', position: { x: 900, y: 900 } });

  const scene = buildEditableScene(session.getSnapshot());
  const drafts = scene.marks.filter((mark) => mark.role.startsWith('draft'));

  assert.deepEqual(drafts, [
    {
      key: 'draft-zone',
      kind: 'path',
      role: 'draft',
      points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      closed: false,
    },
    {
      key: 'draft-preview',
      kind: 'path',
      role: 'draft-preview',
      points: [{ x: 100, y: 100 }, { x: 900, y: 900 }],
      closed: false,
    },
    {
      key: 'draft-point-0',
      kind: 'marker',
      role: 'draft-point',
      at: { x: 0, y: 0 },
    },
    {
      key: 'draft-point-1',
      kind: 'marker',
      role: 'draft-point',
      at: { x: 100, y: 100 },
    },
  ]);
  assert.equal(scene.extent.some((point) => point.x === 900 || point.y === 900), false);
  assert.ok(scene.marks.findIndex((mark) => mark.role === 'draft') > scene.marks.findIndex((mark) => mark.role === 'point'));
  session.dispose();
});
