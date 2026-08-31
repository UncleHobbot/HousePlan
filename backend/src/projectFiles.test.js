import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProjectFiles } from './projectFiles.ts';

const temporaryDirectories = [];

async function temporaryDataDir() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'houseplan-project-files-'));
  temporaryDirectories.push(directory);
  return directory;
}

function completeProject() {
  const object = {
    id: 1,
    name: 'Стул',
    category: 'chair',
    widthCm: 50,
    depthCm: 50,
    heightCm: 90,
    color: '#334455',
    images: ['chair.jpg'],
    clearances: { front: 60, back: 0, left: 10, right: 10 },
    source: { vendor: 'Магазин', url: 'https://example.com/chair', priceCad: 120, confidence: 'retailer' },
  };
  return {
    formatVersion: 1,
    name: 'Дом',
    floors: [{
      id: 1,
      name: '1-й этаж',
      ceilingHeightCm: 260,
      shell: {
        contour: {
          points: [
            { id: 1, x: 0, y: 0 }, { id: 2, x: 600, y: 0 },
            { id: 3, x: 600, y: 400 }, { id: 4, x: 0, y: 400 },
          ],
          thicknesses: { 1: 20, 2: 20, 3: 20, 4: 20 },
          locks: [{ aId: 1, bId: 2, length: 600 }],
          closed: true,
        },
        openings: [{
          id: 1, kind: 'window', wallPointId: 1, offsetCm: 50, widthCm: 100,
          sillCm: 90, topCm: 220, attributes: [],
        }],
      },
      rooms: [{
        id: 1,
        name: 'Гостиная',
        contour: {
          points: [
            { id: 5, x: 50, y: 50 }, { id: 6, x: 550, y: 50 },
            { id: 7, x: 550, y: 350 }, { id: 8, x: 50, y: 350 },
          ],
          thicknesses: { 5: 10, 6: 10, 7: 10, 8: 10 },
          locks: [],
          closed: true,
        },
        openings: [{
          id: 2, kind: 'innerDoor', wallPointId: 5, offsetCm: 30, widthCm: 80,
          heightCm: 200, opensTo: 'left', attributes: [],
        }],
        zones: [{
          id: 1,
          kind: 'stairs',
          name: 'Лестница',
          points: [{ id: 9, x: 80, y: 50 }, { id: 10, x: 180, y: 50 }, { id: 11, x: 180, y: 150 }, { id: 12, x: 80, y: 150 }],
          supportWallPointId: 5,
          spansFloors: { fromFloorId: 1, toFloorId: 1 },
          clearances: { front: 0, back: 0, left: 0, right: 0 },
          attributes: [],
        }],
        placements: [{ objectId: 1, roomId: 1, x: 250, y: 200, rotationDeg: 90 }],
      }],
    }],
    objects: [object],
    snapshots: [{
      id: 1,
      name: 'Вариант',
      note: 'До ремонта',
      placements: [{ object: structuredClone(object), roomId: 999, x: 200, y: 180, rotationDeg: 0 }],
      storeroomObjects: [],
    }],
    counters: {},
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

test('read возвращает корректный проект v1 и непрозрачный токен содержимого', async () => {
  const dataDir = await temporaryDataDir();
  const project = {
    formatVersion: 1,
    name: 'Дом',
    floors: [],
    objects: [],
    snapshots: [],
    counters: {},
  };
  await fs.mkdir(path.join(dataDir, 'проекты', project.name), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'проекты', project.name, 'план.json'), JSON.stringify(project), 'utf8');

  const result = await createProjectFiles(dataDir).read(project.name);

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.project, {
    ...project,
    counters: { floor: 0, room: 0, point: 0, opening: 0, zone: 0, object: 0, snapshot: 0 },
  });
  assert.match(result.value.token, /^[a-f0-9]{64}$/);
});

test('read возвращает все вложенные ошибки с устойчивыми кодами и JSON-путями', async () => {
  const dataDir = await temporaryDataDir();
  const project = {
    formatVersion: 1,
    name: 'Дом',
    floors: [{
      id: 1,
      name: 42,
      ceilingHeightCm: 260,
      shell: { contour: { points: [], thicknesses: {}, locks: [], closed: false }, openings: [] },
      rooms: [],
      extra: true,
    }],
    objects: [],
    snapshots: [],
    counters: {},
  };
  await fs.mkdir(path.join(dataDir, 'проекты', project.name), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'проекты', project.name, 'план.json'), JSON.stringify(project), 'utf8');

  const result = await createProjectFiles(dataDir).read(project.name);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-project');
  assert.deepEqual(result.error.issues, [
    { code: 'invalid-type', path: '/floors/0/name' },
    { code: 'unknown-field', path: '/floors/0' },
  ]);
});

test('read проверяет структуру зон, объектов и снэпшотов до самых листьев', async () => {
  const dataDir = await temporaryDataDir();
  const project = completeProject();
  project.floors[0].rooms[0].zones[0].points[0].x = 'восемьдесят';
  project.objects[0].category = 'desk';
  project.snapshots[0].placements[0].object.clearances.front = 1.5;
  await fs.mkdir(path.join(dataDir, 'проекты', project.name), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'проекты', project.name, 'план.json'), JSON.stringify(project), 'utf8');

  const result = await createProjectFiles(dataDir).read(project.name);

  assert.equal(result.ok, false);
  assert.deepEqual(result.error.issues, [
    { code: 'invalid-type', path: '/floors/0/rooms/0/zones/0/points/0/x' },
    { code: 'invalid-value', path: '/objects/0/category' },
    { code: 'invalid-type', path: '/snapshots/0/placements/0/object/clearances/front' },
  ]);
});

test('read отклоняет дубликаты ID, сломанные ссылки и повторное размещение объекта', async () => {
  const dataDir = await temporaryDataDir();
  const project = completeProject();
  project.objects.push(structuredClone(project.objects[0]));
  project.floors[0].shell.contour.locks[0].aId = 999;
  project.floors[0].rooms[0].openings[0].wallPointId = 999;
  project.floors[0].rooms[0].zones[0].spansFloors.toFloorId = 999;
  project.floors[0].rooms[0].placements.push({ objectId: 1, roomId: 1, x: 300, y: 200, rotationDeg: 0 });
  await fs.mkdir(path.join(dataDir, 'проекты', project.name), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'проекты', project.name, 'план.json'), JSON.stringify(project), 'utf8');

  const result = await createProjectFiles(dataDir).read(project.name);

  assert.equal(result.ok, false);
  const issues = result.error.issues;
  assert.ok(issues.some((issue) => issue.code === 'duplicate-id' && issue.path === '/objects/1/id'));
  assert.ok(issues.some((issue) => issue.code === 'missing-reference' && issue.path === '/floors/0/shell/contour/locks/0/aId'));
  assert.ok(issues.some((issue) => issue.code === 'missing-reference' && issue.path === '/floors/0/rooms/0/openings/0/wallPointId'));
  assert.ok(issues.some((issue) => issue.code === 'missing-reference' && issue.path === '/floors/0/rooms/0/zones/0/spansFloors/toFloorId'));
  assert.ok(issues.some((issue) => issue.code === 'duplicate-placement' && issue.path === '/floors/0/rooms/0/placements/1/objectId'));
});

test('read исполняет геометрические правила замкнутых контуров, проёмов и зон', async () => {
  const dataDir = await temporaryDataDir();
  const project = completeProject();
  project.floors[0].shell.openings[0].kind = 'innerDoor';
  project.floors[0].shell.openings[0].offsetCm = 550;
  project.floors[0].rooms[0].contour.points = [
    { id: 5, x: 50, y: 50 }, { id: 7, x: 550, y: 350 },
    { id: 6, x: 550, y: 50 }, { id: 8, x: 50, y: 350 },
  ];
  project.floors[0].rooms[0].zones[0].points = project.floors[0].rooms[0].zones[0].points.slice(0, 2);
  await fs.mkdir(path.join(dataDir, 'проекты', project.name), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'проекты', project.name, 'план.json'), JSON.stringify(project), 'utf8');

  const result = await createProjectFiles(dataDir).read(project.name);

  assert.equal(result.ok, false);
  const issues = result.error.issues;
  assert.ok(issues.some((issue) => issue.code === 'invalid-opening-kind' && issue.path === '/floors/0/shell/openings/0/kind'));
  assert.ok(issues.some((issue) => issue.code === 'opening-outside-wall' && issue.path === '/floors/0/shell/openings/0'));
  assert.ok(issues.some((issue) => issue.code === 'self-intersection' && issue.path === '/floors/0/rooms/0/contour/points'));
  assert.ok(issues.some((issue) => issue.code === 'zone-too-few-points' && issue.path === '/floors/0/rooms/0/zones/0/points'));
});

test('read безопасно восстанавливает отсутствующие или повреждённые производные счётчики', async () => {
  const dataDir = await temporaryDataDir();
  const expectedCounters = { floor: 1, room: 1, point: 12, opening: 2, zone: 1, object: 1, snapshot: 1 };
  for (const [name, counters] of [['Без счётчиков', undefined], ['Плохие счётчики', 'сломано']]) {
    const project = completeProject();
    project.name = name;
    if (counters === undefined) delete project.counters;
    else project.counters = counters;
    await fs.mkdir(path.join(dataDir, 'проекты', project.name), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'проекты', project.name, 'план.json'), JSON.stringify(project), 'utf8');

    const result = await createProjectFiles(dataDir).read(project.name);

    assert.equal(result.ok, true);
    assert.deepEqual(result.value.project.counters, expectedCounters);
  }
});

test('create атомарно создаёт один проект и отклоняет повторное имя', async () => {
  const dataDir = await temporaryDataDir();
  const projectFiles = createProjectFiles(dataDir);

  const [first, second] = await Promise.all([
    projectFiles.create('Новый дом'),
    projectFiles.create('Новый дом'),
  ]);

  const successful = [first, second].filter((result) => result.ok);
  const rejected = [first, second].filter((result) => !result.ok);
  assert.equal(successful.length, 1);
  assert.match(successful[0].value.token, /^[a-f0-9]{64}$/);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].error.code, 'project-exists');
  const stored = JSON.parse(await fs.readFile(path.join(dataDir, 'проекты', 'Новый дом', 'план.json'), 'utf8'));
  assert.equal(stored.name, 'Новый дом');
  assert.equal(stored.formatVersion, 1);
});

test('save не затирает более новую версию и допускает явную перезапись', async () => {
  const dataDir = await temporaryDataDir();
  const projectFiles = createProjectFiles(dataDir);
  const created = await projectFiles.create('Дом');
  assert.equal(created.ok, true);
  const firstEdit = { ...created.value.project, objects: [{
    id: 1,
    name: 'Стул',
    category: 'chair',
    widthCm: 50,
    depthCm: 50,
    heightCm: 90,
    clearances: { front: 0, back: 0, left: 0, right: 0 },
  }] };
  const secondEdit = { ...created.value.project, name: 'Дом', snapshots: [] };

  const [first, stale] = await Promise.all([
    projectFiles.save('Дом', firstEdit, { expectedToken: created.value.token }),
    projectFiles.save('Дом', secondEdit, { expectedToken: created.value.token }),
  ]);

  assert.equal(first.ok, true);
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'stale-project');
  const forced = await projectFiles.save('Дом', secondEdit, { expectedToken: created.value.token, force: true });
  assert.equal(forced.ok, true);
  assert.notEqual(forced.value.token, first.value.token);
  const stored = await projectFiles.read('Дом');
  assert.equal(stored.ok, true);
  assert.deepEqual(stored.value.project.objects, []);
});

test('save проверяет имя и проект до записи и сохраняет исходный файл при отказе', async () => {
  const dataDir = await temporaryDataDir();
  const projectFiles = createProjectFiles(dataDir);
  const created = await projectFiles.create('Дом');
  assert.equal(created.ok, true);
  const planPath = path.join(dataDir, 'проекты', 'Дом', 'план.json');
  const before = await fs.readFile(planPath, 'utf8');

  const wrongName = await projectFiles.save('Дом', { ...created.value.project, name: 'Другой' }, {
    expectedToken: created.value.token,
  });
  const invalid = await projectFiles.save('Дом', { ...created.value.project, objects: [{ id: 1 }] }, {
    expectedToken: created.value.token,
  });

  assert.equal(wrongName.ok, false);
  assert.equal(wrongName.error.code, 'project-name-mismatch');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'invalid-project');
  assert.equal(await fs.readFile(planPath, 'utf8'), before);
});

test('list показывает исправные и повреждённые проекты, не меняя исходные файлы', async () => {
  const dataDir = await temporaryDataDir();
  const projectFiles = createProjectFiles(dataDir);
  const created = await projectFiles.create('Исправный');
  assert.equal(created.ok, true);
  const brokenDirectory = path.join(dataDir, 'проекты', 'Повреждённый');
  const mismatchDirectory = path.join(dataDir, 'проекты', 'Папка');
  await fs.mkdir(brokenDirectory, { recursive: true });
  await fs.writeFile(path.join(brokenDirectory, 'план.json'), '{не json', 'utf8');
  await fs.mkdir(mismatchDirectory, { recursive: true });
  await fs.writeFile(path.join(mismatchDirectory, 'план.json'), JSON.stringify({
    formatVersion: 1,
    name: 'Другое имя',
    floors: [],
    objects: [],
    snapshots: [],
    counters: {},
  }), 'utf8');
  const brokenBefore = await fs.readFile(path.join(brokenDirectory, 'план.json'), 'utf8');

  const result = await projectFiles.list();

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, [
    { name: 'Исправный', status: 'ready', floors: 0, objects: 0 },
    { name: 'Папка', status: 'invalid', error: { code: 'project-name-mismatch', issues: [{ code: 'project-name-mismatch', path: '/name' }] } },
    { name: 'Повреждённый', status: 'invalid', error: { code: 'invalid-json', issues: [{ code: 'invalid-json', path: '/' }] } },
  ]);
  assert.equal(await fs.readFile(path.join(brokenDirectory, 'план.json'), 'utf8'), brokenBefore);
});

test('rename меняет папку и внутреннее имя как один восстанавливаемый переход', async () => {
  const dataDir = await temporaryDataDir();
  const projectFiles = createProjectFiles(dataDir);
  const created = await projectFiles.create('Старое имя');
  assert.equal(created.ok, true);

  const renamed = await projectFiles.rename('Старое имя', 'Новое имя', {
    expectedToken: created.value.token,
  });

  assert.equal(renamed.ok, true);
  assert.equal(renamed.value.project.name, 'Новое имя');
  await assert.rejects(fs.access(path.join(dataDir, 'проекты', 'Старое имя')));
  const read = await projectFiles.read('Новое имя');
  assert.equal(read.ok, true);
  assert.equal(read.value.project.name, 'Новое имя');
});

test('следующая операция завершает переименование, прерванное после переноса папки', async () => {
  const dataDir = await temporaryDataDir();
  const projectFiles = createProjectFiles(dataDir);
  const created = await projectFiles.create('До сбоя');
  assert.equal(created.ok, true);
  const oldDirectory = path.join(dataDir, 'проекты', 'До сбоя');
  const newDirectory = path.join(dataDir, 'проекты', 'После сбоя');
  const beforeRaw = await fs.readFile(path.join(oldDirectory, 'план.json'), 'utf8');
  const afterProject = { ...created.value.project, name: 'После сбоя' };
  const afterRaw = `${JSON.stringify(afterProject, null, 2)}\n`;
  const transactionDirectory = path.join(dataDir, '_transactions');
  await fs.mkdir(transactionDirectory, { recursive: true });
  await fs.writeFile(path.join(transactionDirectory, 'project-file.json'), JSON.stringify({
    kind: 'rename-project',
    from: 'До сбоя',
    to: 'После сбоя',
    beforeToken: createHash('sha256').update(beforeRaw).digest('hex'),
    afterRaw,
  }), 'utf8');
  await fs.rename(oldDirectory, newDirectory);

  const listed = await createProjectFiles(dataDir).list();

  assert.equal(listed.ok, true);
  assert.deepEqual(listed.value, [{ name: 'После сбоя', status: 'ready', floors: 0, objects: 0 }]);
  assert.equal(JSON.parse(await fs.readFile(path.join(newDirectory, 'план.json'), 'utf8')).name, 'После сбоя');
  await assert.rejects(fs.access(path.join(transactionDirectory, 'project-file.json')));
});
