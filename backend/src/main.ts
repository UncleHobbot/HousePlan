import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT_VERSION, Project } from '@houseplan/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
// корень данных: на Synology это том в контейнере, в разработке — папка data/
const DATA_DIR = process.env.DATA_DIR ?? path.join(__dirname, '..', '..', 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'проекты');
const IMPORT_DIR = path.join(DATA_DIR, '_import');
const FRONTEND_DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');

async function ensureDataDirs() {
  for (const dir of [PROJECTS_DIR, IMPORT_DIR, path.join(IMPORT_DIR, 'принятые')]) {
    await fs.mkdir(dir, { recursive: true });
  }
}

function projectDir(name: string): string {
  // имя проекта = имя папки; запрещаем выход за пределы папки проектов
  // и символы, недопустимые в папках Windows
  if (!name || /[\/\\:?*"<>|]/.test(name) || name.includes('..')) {
    throw new Error('недопустимое имя проекта');
  }
  return path.join(PROJECTS_DIR, name);
}

async function readProject(name: string): Promise<Project> {
  const raw = await fs.readFile(path.join(projectDir(name), 'план.json'), 'utf8');
  const parsed = JSON.parse(raw) as Project;
  if (parsed.formatVersion !== FORMAT_VERSION) {
    throw new Error(`версия формата ${parsed.formatVersion} не поддерживается, ожидается ${FORMAT_VERSION}`);
  }
  if (!Array.isArray(parsed.floors) || !Array.isArray(parsed.objects) || !Array.isArray(parsed.snapshots)) {
    throw new Error('файл проекта повреждён');
  }
  return parsed;
}

async function writeProject(project: Project): Promise<void> {
  const dir = projectDir(project.name);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, 'план.json');
  const temporary = path.join(dir, `.план-${process.pid}-${Date.now()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(project, null, 2), 'utf8');
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

function isProject(value: unknown): value is Project {
  if (typeof value !== 'object' || value === null) return false;
  const project = value as Partial<Project>;
  return (
    project.formatVersion === FORMAT_VERSION &&
    typeof project.name === 'string' &&
    Array.isArray(project.floors) &&
    Array.isArray(project.objects) &&
    Array.isArray(project.snapshots) &&
    typeof project.counters === 'object' &&
    project.counters !== null
  );
}

const app = express();
app.use(express.json({ limit: '10mb' }));

/** Обёртка: ошибка в обработчике не должна ронять весь сервер. */
type Handler = (req: express.Request, res: express.Response) => Promise<void>;
function asyncHandler(handler: Handler): express.RequestHandler {
  return (req, res) => {
    handler(req, res).catch((error) => {
      const message = error instanceof Error ? error.message : 'внутренняя ошибка';
      if (!res.headersSent) res.status(500).json({ error: message });
    });
  };
}

app.get('/api/version', (_req, res) => {
  res.json({ formatVersion: FORMAT_VERSION });
});

app.get('/api/projects', asyncHandler(async (_req, res) => {
  await ensureDataDirs();
  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const project = await readProject(entry.name);
      projects.push({ name: project.name, floors: project.floors.length, objects: project.objects.length });
    } catch {
      // папка без корректного плана не показывается
    }
  }
  res.json(projects);
}));

app.post('/api/projects', asyncHandler(async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'укажите название проекта' });
    return;
  }
  let dir: string;
  try {
    dir = projectDir(name);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'плохое имя' });
    return;
  }
  const project: Project = {
    formatVersion: FORMAT_VERSION,
    name,
    floors: [],
    objects: [],
    snapshots: [],
    counters: {},
  };
  try {
    await fs.mkdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      res.status(409).json({ error: 'проект с таким названием уже существует' });
      return;
    }
    throw error;
  }
  await fs.writeFile(path.join(dir, 'план.json'), JSON.stringify(project, null, 2), { encoding: 'utf8', flag: 'wx' });
  res.status(201).json(project);
}));

app.get('/api/projects/:name', asyncHandler(async (req, res) => {
  try {
    res.json(await readProject(req.params.name));
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : 'не найдено' });
  }
}));

app.put('/api/projects/:name', asyncHandler(async (req, res) => {
  try {
    if (!isProject(req.body)) {
      res.status(400).json({ error: 'файл проекта не соответствует формату' });
      return;
    }
    const project = req.body;
    if (project.name !== req.params.name) {
      res.status(400).json({ error: 'имя проекта не совпадает' });
      return;
    }
    if (project.formatVersion !== FORMAT_VERSION) {
      res.status(400).json({ error: 'не поддерживаемая версия формата' });
      return;
    }
    await writeProject(project);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'ошибка сохранения' });
  }
}));

// Раздача собранного фронтенда; в разработке фронтенд работает через vite dev
app.use(express.static(FRONTEND_DIST));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

ensureDataDirs()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`HousePlan: http://localhost:${PORT} (данные: ${DATA_DIR})`);
    });
  })
  .catch((error) => {
    console.error('не удалось создать папки данных', error);
    process.exit(1);
  });
