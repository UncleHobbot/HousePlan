import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chainInfo, crossings, emptyProject, FORMAT_VERSION, rebaseCounters, wallByPoint, type OpeningKind, type Project } from '@houseplan/shared';
import { z } from 'zod';

export interface ProjectFileIssue {
  code: string;
  path: string;
  details?: Record<string, unknown>;
}

export interface ProjectFileFailure {
  code: string;
  issues?: ProjectFileIssue[];
}

export type ProjectFileResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProjectFileFailure };

export interface ProjectDocument {
  project: Project;
  token: string;
}

export type ProjectListEntry =
  | { name: string; status: 'ready'; floors: number; objects: number }
  | { name: string; status: 'invalid'; error: ProjectFileFailure };

const integerSchema = z.number().finite().int();
const positiveIdSchema = integerSchema.positive();
const nonNegativeIntegerSchema = integerSchema.nonnegative();
const attributeSchema = z.strictObject({ name: z.string(), value: z.string() });
const pointSchema = z.strictObject({ id: positiveIdSchema, x: integerSchema, y: integerSchema });
const lockSchema = z.strictObject({ aId: positiveIdSchema, bId: positiveIdSchema, length: integerSchema.positive() });
const contourSchema = z.strictObject({
  points: z.array(pointSchema),
  thicknesses: z.record(z.string(), nonNegativeIntegerSchema),
  locks: z.array(lockSchema),
  closed: z.boolean(),
});
const openingSchema = z.strictObject({
  id: positiveIdSchema,
  kind: z.enum(['window', 'entryDoor', 'innerDoor']),
  wallPointId: positiveIdSchema,
  offsetCm: nonNegativeIntegerSchema,
  widthCm: integerSchema.positive(),
  sillCm: nonNegativeIntegerSchema.optional(),
  topCm: nonNegativeIntegerSchema.optional(),
  heightCm: integerSchema.positive().optional(),
  opensTo: z.enum(['left', 'right']).optional(),
  attributes: z.array(attributeSchema),
});
const clearanceSchema = z.strictObject({
  front: nonNegativeIntegerSchema,
  back: nonNegativeIntegerSchema,
  left: nonNegativeIntegerSchema,
  right: nonNegativeIntegerSchema,
});
const safeImageNameSchema = z.string().min(1).refine(
  (value) => !value.includes('/') && !value.includes('\\') && !value.includes('..'),
);
const sourceSchema = z.strictObject({
  vendor: z.string(),
  url: z.url(),
  priceCad: nonNegativeIntegerSchema.optional(),
  confidence: z.enum(['retailer', 'estimated']),
});
const sceneObjectSchema = z.strictObject({
  id: positiveIdSchema,
  name: z.string(),
  category: z.enum(['sofa', 'armchair', 'table', 'chair', 'bed', 'wardrobe', 'light', 'appliance', 'other']),
  widthCm: integerSchema.positive(),
  depthCm: integerSchema.positive(),
  heightCm: integerSchema.positive(),
  color: z.string().optional(),
  skinImage: safeImageNameSchema.optional(),
  images: z.array(safeImageNameSchema).optional(),
  clearances: clearanceSchema,
  source: sourceSchema.optional(),
  unconfirmedImport: z.boolean().optional(),
});
const placementSchema = z.strictObject({
  objectId: positiveIdSchema,
  roomId: positiveIdSchema,
  x: integerSchema,
  y: integerSchema,
  rotationDeg: integerSchema,
});
const zoneSchema = z.strictObject({
  id: positiveIdSchema,
  kind: z.enum(['stairs', 'builtInWardrobe', 'fireplace', 'decorativeWall', 'partition', 'other']),
  name: z.string(),
  points: z.array(pointSchema),
  supportWallPointId: positiveIdSchema.optional(),
  fromPointId: positiveIdSchema.optional(),
  spansFloors: z.strictObject({ fromFloorId: positiveIdSchema, toFloorId: positiveIdSchema }).optional(),
  clearances: clearanceSchema,
  attributes: z.array(attributeSchema),
});
const roomSchema = z.strictObject({
  id: positiveIdSchema,
  name: z.string(),
  contour: contourSchema,
  openings: z.array(openingSchema),
  zones: z.array(zoneSchema),
  placements: z.array(placementSchema),
});
const shellSchema = z.strictObject({
  contour: contourSchema,
  openings: z.array(openingSchema),
});
const floorSchema = z.strictObject({
  id: positiveIdSchema,
  name: z.string(),
  ceilingHeightCm: integerSchema.positive(),
  shell: shellSchema,
  rooms: z.array(roomSchema),
});
const snapshotPlacementSchema = z.strictObject({
  object: sceneObjectSchema,
  roomId: positiveIdSchema,
  x: integerSchema,
  y: integerSchema,
  rotationDeg: integerSchema,
});
const snapshotSchema = z.strictObject({
  id: positiveIdSchema,
  name: z.string(),
  note: z.string().optional(),
  placements: z.array(snapshotPlacementSchema),
  storeroomObjects: z.array(sceneObjectSchema),
});
const counterKinds = ['floor', 'room', 'point', 'opening', 'zone', 'object', 'snapshot'] as const;
const countersSchema = z.strictObject(Object.fromEntries(
  counterKinds.map((kind) => [kind, nonNegativeIntegerSchema.optional()]),
) as Record<(typeof counterKinds)[number], z.ZodOptional<typeof nonNegativeIntegerSchema>>);
const projectSchema = z.strictObject({
  formatVersion: z.literal(FORMAT_VERSION),
  name: z.string(),
  floors: z.array(floorSchema),
  objects: z.array(sceneObjectSchema),
  snapshots: z.array(snapshotSchema),
  counters: countersSchema,
});
const renameJournalSchema = z.strictObject({
  kind: z.literal('rename-project'),
  from: z.string(),
  to: z.string(),
  beforeToken: z.string().regex(/^[a-f0-9]{64}$/),
  afterRaw: z.string(),
});

function withNormalizedCounters(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const source = 'counters' in value && typeof value.counters === 'object' && value.counters !== null && !Array.isArray(value.counters)
    ? value.counters as Record<string, unknown>
    : {};
  const counters = Object.fromEntries(counterKinds.flatMap((kind) => {
    const counter = source[kind];
    return typeof counter === 'number' && Number.isFinite(counter) && Number.isInteger(counter) && counter >= 0
      ? [[kind, counter]]
      : [];
  }));
  return { ...value, counters };
}

function projectDirectory(projectsDirectory: string, name: string): string | null {
  if (!name || /[\/\\:?*"<>|]/.test(name) || name.includes('..')) return null;
  return path.join(projectsDirectory, name);
}

function contentToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function issuePath(parts: PropertyKey[]): string {
  if (parts.length === 0) return '/';
  return `/${parts.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function issueCode(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_type') return 'invalid-type';
  if (issue.code === 'unrecognized_keys') return 'unknown-field';
  if (issue.code === 'invalid_value' && issue.path[0] === 'formatVersion') return 'unsupported-version';
  return 'invalid-value';
}

function validateProjectSemantics(project: Project): ProjectFileIssue[] {
  const issues: ProjectFileIssue[] = [];
  const floorIds = new Set(project.floors.map((floor) => floor.id));
  const liveObjectIds = new Set(project.objects.map((object) => object.id));
  const seenIds = {
    floor: new Set<number>(),
    room: new Set<number>(),
    point: new Set<number>(),
    opening: new Set<number>(),
    zone: new Set<number>(),
    object: new Set<number>(),
    snapshot: new Set<number>(),
  };
  const placedObjectIds = new Set<number>();

  function addIssue(code: string, issuePath: string, details?: Record<string, unknown>): void {
    if (issues.length < 100) issues.push({ code, path: issuePath, ...(details ? { details } : {}) });
  }

  function unique(kind: keyof typeof seenIds, id: number, idPath: string): void {
    if (seenIds[kind].has(id)) addIssue('duplicate-id', idPath, { kind, id });
    else seenIds[kind].add(id);
  }

  function validateContour(contour: Project['floors'][number]['shell']['contour'], contourPath: string): Set<number> {
    const localPointIds = new Set<number>();
    contour.points.forEach((point, pointIndex) => {
      const idPath = `${contourPath}/points/${pointIndex}/id`;
      if (localPointIds.has(point.id)) addIssue('duplicate-id', idPath, { kind: 'point', id: point.id });
      else localPointIds.add(point.id);
      unique('point', point.id, idPath);
    });
    for (const key of Object.keys(contour.thicknesses)) {
      const pointId = Number(key);
      if (!Number.isInteger(pointId) || !localPointIds.has(pointId)) {
        addIssue('missing-reference', `${contourPath}/thicknesses/${key}`, { kind: 'point', id: key });
      }
    }
    contour.locks.forEach((lock, lockIndex) => {
      if (!localPointIds.has(lock.aId)) addIssue('missing-reference', `${contourPath}/locks/${lockIndex}/aId`, { kind: 'point', id: lock.aId });
      if (!localPointIds.has(lock.bId)) addIssue('missing-reference', `${contourPath}/locks/${lockIndex}/bId`, { kind: 'point', id: lock.bId });
      if (lock.aId === lock.bId) addIssue('same-lock-point', `${contourPath}/locks/${lockIndex}/bId`);
      if (localPointIds.has(lock.aId) && localPointIds.has(lock.bId) && lock.aId !== lock.bId) {
        const info = chainInfo(contour, lock.aId, lock.bId);
        if (!info.ok) addIssue('invalid-lock-chain', `${contourPath}/locks/${lockIndex}`);
        else if (info.length !== lock.length) addIssue('lock-length-mismatch', `${contourPath}/locks/${lockIndex}/length`, { actual: info.length });
      }
    });
    if (contour.closed) {
      if (contour.points.length < 3) addIssue('contour-too-few-points', `${contourPath}/points`);
      if (crossings(contour.points).length > 0) addIssue('self-intersection', `${contourPath}/points`);
      contour.points.forEach((point, pointIndex) => {
        const next = contour.points[(pointIndex + 1) % contour.points.length];
        if (next && Math.hypot(next.x - point.x, next.y - point.y) < 10) {
          addIssue('wall-too-short', `${contourPath}/points/${pointIndex}`);
        }
      });
    }
    return localPointIds;
  }

  function validateOpenings(
    openings: Project['floors'][number]['shell']['openings'],
    wallPointIds: Set<number>,
    openingsPath: string,
    allowedKinds: readonly OpeningKind[],
    contour: Project['floors'][number]['shell']['contour'],
  ): void {
    openings.forEach((opening, openingIndex) => {
      const openingPath = `${openingsPath}/${openingIndex}`;
      unique('opening', opening.id, `${openingsPath}/${openingIndex}/id`);
      if (!allowedKinds.includes(opening.kind)) addIssue('invalid-opening-kind', `${openingPath}/kind`);
      if (!wallPointIds.has(opening.wallPointId)) {
        addIssue('missing-reference', `${openingPath}/wallPointId`, { kind: 'point', id: opening.wallPointId });
      } else {
        const wall = wallByPoint(contour.points, opening.wallPointId);
        const wallLength = wall ? Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y) : 0;
        if (!wall || opening.offsetCm + opening.widthCm > wallLength) {
          addIssue('opening-outside-wall', openingPath, { wallLength });
        }
      }
    });
  }

  project.objects.forEach((object, objectIndex) => unique('object', object.id, `/objects/${objectIndex}/id`));
  project.snapshots.forEach((snapshot, snapshotIndex) => unique('snapshot', snapshot.id, `/snapshots/${snapshotIndex}/id`));

  project.floors.forEach((floor, floorIndex) => {
    const floorPath = `/floors/${floorIndex}`;
    unique('floor', floor.id, `${floorPath}/id`);
    const shellPointIds = validateContour(floor.shell.contour, `${floorPath}/shell/contour`);
    validateOpenings(floor.shell.openings, shellPointIds, `${floorPath}/shell/openings`, ['window', 'entryDoor'], floor.shell.contour);
    floor.rooms.forEach((room, roomIndex) => {
      const roomPath = `${floorPath}/rooms/${roomIndex}`;
      unique('room', room.id, `${roomPath}/id`);
      const roomPointIds = validateContour(room.contour, `${roomPath}/contour`);
      validateOpenings(room.openings, roomPointIds, `${roomPath}/openings`, ['innerDoor'], room.contour);
      room.zones.forEach((zone, zoneIndex) => {
        const zonePath = `${roomPath}/zones/${zoneIndex}`;
        unique('zone', zone.id, `${zonePath}/id`);
        zone.points.forEach((point, pointIndex) => unique('point', point.id, `${zonePath}/points/${pointIndex}/id`));
        if (zone.points.length < 3) addIssue('zone-too-few-points', `${zonePath}/points`);
        else if (crossings(zone.points).length > 0) addIssue('self-intersection', `${zonePath}/points`);
        if (zone.supportWallPointId !== undefined && !roomPointIds.has(zone.supportWallPointId)) {
          addIssue('missing-reference', `${zonePath}/supportWallPointId`, { kind: 'point', id: zone.supportWallPointId });
        }
        if (zone.fromPointId !== undefined && !roomPointIds.has(zone.fromPointId)) {
          addIssue('missing-reference', `${zonePath}/fromPointId`, { kind: 'point', id: zone.fromPointId });
        }
        if (zone.spansFloors && !floorIds.has(zone.spansFloors.fromFloorId)) {
          addIssue('missing-reference', `${zonePath}/spansFloors/fromFloorId`, { kind: 'floor', id: zone.spansFloors.fromFloorId });
        }
        if (zone.spansFloors && !floorIds.has(zone.spansFloors.toFloorId)) {
          addIssue('missing-reference', `${zonePath}/spansFloors/toFloorId`, { kind: 'floor', id: zone.spansFloors.toFloorId });
        }
      });
      room.placements.forEach((placement, placementIndex) => {
        const placementPath = `${roomPath}/placements/${placementIndex}`;
        if (!liveObjectIds.has(placement.objectId)) addIssue('missing-reference', `${placementPath}/objectId`, { kind: 'object', id: placement.objectId });
        if (placement.roomId !== room.id) addIssue('wrong-room-reference', `${placementPath}/roomId`, { expected: room.id });
        if (placedObjectIds.has(placement.objectId)) addIssue('duplicate-placement', `${placementPath}/objectId`, { id: placement.objectId });
        else placedObjectIds.add(placement.objectId);
      });
    });
  });

  project.snapshots.forEach((snapshot, snapshotIndex) => {
    const snapshotObjectIds = new Set<number>();
    snapshot.placements.forEach((placement, placementIndex) => {
      const id = placement.object.id;
      const idPath = `/snapshots/${snapshotIndex}/placements/${placementIndex}/object/id`;
      if (snapshotObjectIds.has(id)) addIssue('duplicate-snapshot-object', idPath, { id });
      else snapshotObjectIds.add(id);
    });
    snapshot.storeroomObjects.forEach((object, objectIndex) => {
      const idPath = `/snapshots/${snapshotIndex}/storeroomObjects/${objectIndex}/id`;
      if (snapshotObjectIds.has(object.id)) addIssue('duplicate-snapshot-object', idPath, { id: object.id });
      else snapshotObjectIds.add(object.id);
    });
  });
  return issues;
}

function decodeProject(value: unknown): ProjectFileResult<Project> {
  const parsed = projectSchema.safeParse(withNormalizedCounters(value));
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'invalid-project',
        issues: parsed.error.issues.slice(0, 100).map((issue) => ({
          code: issueCode(issue),
          path: issuePath(issue.path),
        })),
      },
    };
  }
  const project = structuredClone(parsed.data) as Project;
  const semanticIssues = validateProjectSemantics(project);
  if (semanticIssues.length > 0) {
    return { ok: false, error: { code: 'invalid-project', issues: semanticIssues } };
  }
  rebaseCounters(project);
  return { ok: true, value: project };
}

function serializeProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

async function atomicWrite(filePath: string, raw: string): Promise<void> {
  const temporaryPath = path.join(path.dirname(filePath), `.write-${process.pid}-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporaryPath, 'wx');
    try {
      await handle.writeFile(raw, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, filePath);
    try {
      const directoryHandle = await fs.open(path.dirname(filePath), 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch {
      // Windows не позволяет синхронизировать каталог; сам файл уже синхронизирован.
    }
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

export function createProjectFiles(dataDirectory: string) {
  const projectsDirectory = path.join(dataDirectory, 'проекты');
  const transactionsDirectory = path.join(dataDirectory, '_transactions');
  const journalPath = path.join(transactionsDirectory, 'project-file.json');
  let mutationQueue: Promise<void> = Promise.resolve();

  function mutate<T>(action: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(action, action);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function readStored(name: string): Promise<ProjectFileResult<ProjectDocument>> {
    const directory = projectDirectory(projectsDirectory, name);
    if (!directory) return { ok: false, error: { code: 'invalid-project-name' } };
    let raw: string;
    try {
      raw = await fs.readFile(path.join(directory, 'план.json'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, error: { code: 'project-not-found' } };
      }
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: { code: 'invalid-json', issues: [{ code: 'invalid-json', path: '/' }] } };
    }
    const decoded = decodeProject(value);
    if (!decoded.ok) return decoded;
    if (decoded.value.name !== name) {
      return {
        ok: false,
        error: {
          code: 'project-name-mismatch',
          issues: [{ code: 'project-name-mismatch', path: '/name' }],
        },
      };
    }
    return { ok: true, value: { project: decoded.value, token: contentToken(raw) } };
  }

  async function exists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async function writeJournal(journal: z.infer<typeof renameJournalSchema>): Promise<void> {
    await fs.mkdir(transactionsDirectory, { recursive: true });
    await atomicWrite(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  }

  async function recoverTransition(): Promise<ProjectFileResult<void>> {
    let raw: string;
    try {
      raw = await fs.readFile(journalPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, value: undefined };
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: { code: 'transition-conflict' } };
    }
    const parsed = renameJournalSchema.safeParse(value);
    if (!parsed.success) return { ok: false, error: { code: 'transition-conflict' } };
    const journal = parsed.data;
    const fromDirectory = projectDirectory(projectsDirectory, journal.from);
    const toDirectory = projectDirectory(projectsDirectory, journal.to);
    if (!fromDirectory || !toDirectory) return { ok: false, error: { code: 'transition-conflict' } };

    let afterValue: unknown;
    try {
      afterValue = JSON.parse(journal.afterRaw);
    } catch {
      return { ok: false, error: { code: 'transition-conflict' } };
    }
    const afterProject = decodeProject(afterValue);
    if (!afterProject.ok || afterProject.value.name !== journal.to) {
      return { ok: false, error: { code: 'transition-conflict' } };
    }

    const [fromExists, toExists] = await Promise.all([exists(fromDirectory), exists(toDirectory)]);
    if (fromExists === toExists) return { ok: false, error: { code: 'transition-conflict' } };
    const currentDirectory = fromExists ? fromDirectory : toDirectory;
    let currentRaw: string;
    try {
      currentRaw = await fs.readFile(path.join(currentDirectory, 'план.json'), 'utf8');
    } catch {
      return { ok: false, error: { code: 'transition-conflict' } };
    }
    const currentToken = contentToken(currentRaw);
    const afterToken = contentToken(journal.afterRaw);
    if (currentToken !== journal.beforeToken && currentToken !== afterToken) {
      return { ok: false, error: { code: 'transition-conflict' } };
    }
    if (fromExists) await fs.rename(fromDirectory, toDirectory);
    if (currentToken === journal.beforeToken) {
      await atomicWrite(path.join(toDirectory, 'план.json'), journal.afterRaw);
    }
    await fs.rm(journalPath, { force: true });
    return { ok: true, value: undefined };
  }

  return {
    list(): Promise<ProjectFileResult<ProjectListEntry[]>> {
      return mutate(async () => {
        const recovered = await recoverTransition();
        if (!recovered.ok) return recovered;
        await fs.mkdir(projectsDirectory, { recursive: true });
        const entries = await fs.readdir(projectsDirectory, { withFileTypes: true });
        const projects: ProjectListEntry[] = [];
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
          const result = await readStored(entry.name);
          if (result.ok) {
            projects.push({
              name: entry.name,
              status: 'ready',
              floors: result.value.project.floors.length,
              objects: result.value.project.objects.length,
            });
          } else {
            projects.push({ name: entry.name, status: 'invalid', error: result.error });
          }
        }
        projects.sort((left, right) => left.name.localeCompare(right.name, 'ru'));
        return { ok: true, value: projects };
      });
    },

    create(name: string): Promise<ProjectFileResult<ProjectDocument>> {
      return mutate(async () => {
      const recovered = await recoverTransition();
      if (!recovered.ok) return recovered;
      const normalizedName = name.trim();
      const directory = projectDirectory(projectsDirectory, normalizedName);
      if (!directory) return { ok: false, error: { code: 'invalid-project-name' } };

      const decoded = decodeProject(emptyProject(normalizedName));
      if (!decoded.ok) return decoded;
      const raw = serializeProject(decoded.value);
      const temporaryDirectory = path.join(projectsDirectory, `.create-${process.pid}-${randomUUID()}`);
      await fs.mkdir(projectsDirectory, { recursive: true });
      try {
        await fs.mkdir(temporaryDirectory);
        await fs.writeFile(path.join(temporaryDirectory, 'план.json'), raw, { encoding: 'utf8', flag: 'wx' });
        await fs.rename(temporaryDirectory, directory);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'EPERM') {
          return { ok: false, error: { code: 'project-exists' } };
        }
        throw error;
      } finally {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
      }
      return { ok: true, value: { project: decoded.value, token: contentToken(raw) } };
      });
    },

    save(
      name: string,
      value: unknown,
      options: { expectedToken: string; force?: boolean },
    ): Promise<ProjectFileResult<ProjectDocument>> {
      return mutate(async () => {
        const recovered = await recoverTransition();
        if (!recovered.ok) return recovered;
        const directory = projectDirectory(projectsDirectory, name);
        if (!directory) return { ok: false, error: { code: 'invalid-project-name' } };
        const decoded = decodeProject(value);
        if (!decoded.ok) return decoded;
        if (decoded.value.name !== name) {
          return { ok: false, error: { code: 'project-name-mismatch' } };
        }
        const planPath = path.join(directory, 'план.json');
        let currentRaw: string;
        try {
          currentRaw = await fs.readFile(planPath, 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { ok: false, error: { code: 'project-not-found' } };
          }
          throw error;
        }
        if (!options.force && contentToken(currentRaw) !== options.expectedToken) {
          return { ok: false, error: { code: 'stale-project' } };
        }
        const raw = serializeProject(decoded.value);
        await atomicWrite(planPath, raw);
        return { ok: true, value: { project: decoded.value, token: contentToken(raw) } };
      });
    },

    rename(
      name: string,
      newName: string,
      options: { expectedToken: string },
    ): Promise<ProjectFileResult<ProjectDocument>> {
      return mutate(async () => {
        const recovered = await recoverTransition();
        if (!recovered.ok) return recovered;
        const normalizedNewName = newName.trim();
        const fromDirectory = projectDirectory(projectsDirectory, name);
        const toDirectory = projectDirectory(projectsDirectory, normalizedNewName);
        if (!fromDirectory || !toDirectory) {
          return { ok: false, error: { code: 'invalid-project-name' } };
        }
        const current = await readStored(name);
        if (!current.ok) return current;
        if (current.value.token !== options.expectedToken) {
          return { ok: false, error: { code: 'stale-project' } };
        }
        if (name === normalizedNewName) return current;
        if (await exists(toDirectory)) {
          return { ok: false, error: { code: 'project-exists' } };
        }
        const renamedValue = { ...current.value.project, name: normalizedNewName };
        const decoded = decodeProject(renamedValue);
        if (!decoded.ok) return decoded;
        const afterRaw = serializeProject(decoded.value);
        await writeJournal({
          kind: 'rename-project',
          from: name,
          to: normalizedNewName,
          beforeToken: current.value.token,
          afterRaw,
        });
        await fs.rename(fromDirectory, toDirectory);
        await atomicWrite(path.join(toDirectory, 'план.json'), afterRaw);
        await fs.rm(journalPath, { force: true });
        return { ok: true, value: { project: decoded.value, token: contentToken(afterRaw) } };
      });
    },

    read(name: string): Promise<ProjectFileResult<ProjectDocument>> {
      return mutate(async () => {
        const recovered = await recoverTransition();
        if (!recovered.ok) return recovered;
        return readStored(name);
      });
    },
  };
}
