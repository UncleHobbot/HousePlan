import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  acceptCard,
  chainInfo,
  crossings,
  emptyProject,
  FORMAT_VERSION,
  rebaseCounters,
  wallByPoint,
  type AssistantCard,
  type OpeningKind,
  type Project,
  type SceneObject,
} from '@houseplan/shared';
import { z } from 'zod';

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function isSafeFileSegment(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith('.') &&
    !value.endsWith('.') &&
    !value.endsWith(' ') &&
    !/[\/\\:?*"<>|\u0000-\u001f]/.test(value) &&
    !value.includes('..') &&
    !WINDOWS_RESERVED_NAME.test(value)
  );
}

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

export interface ImportAcceptance {
  document: ProjectDocument;
  object: SceneObject;
}

export type ImportListEntry =
  | { file: string; status: 'ready'; card: AssistantCard }
  | { file: string; status: 'invalid'; error: ProjectFileFailure };

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
const safeImageNameSchema = z.string().refine(isSafeFileSegment);
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
const assistantCardSchema = z.strictObject({
  name: z.string().optional(),
  category: z.string().optional(),
  size: z.strictObject({
    w: z.number().finite().positive().optional(),
    d: z.number().finite().positive().optional(),
    h: z.number().finite().positive().optional(),
  }).optional(),
  color: z.string().optional(),
  images: z.array(safeImageNameSchema).optional(),
  clearance: z.strictObject({
    front: z.number().finite().nonnegative().optional(),
    back: z.number().finite().nonnegative().optional(),
  }).optional(),
  source: z.strictObject({
    vendor: z.string().optional(),
    url: z.url().optional(),
    price_cad: z.number().finite().nonnegative().optional(),
    confidence: z.enum(['retailer', 'estimated']).optional(),
  }).optional(),
});
const renameJournalSchema = z.strictObject({
  kind: z.literal('rename-project'),
  from: z.string(),
  to: z.string(),
  beforeToken: z.string().regex(/^[a-f0-9]{64}$/),
  afterRaw: z.string(),
});
const importJournalSchema = z.strictObject({
  kind: z.literal('accept-import'),
  file: z.string(),
  projectName: z.string(),
  cardToken: z.string().regex(/^[a-f0-9]{64}$/),
  beforeToken: z.string().regex(/^[a-f0-9]{64}$/),
  afterRaw: z.string(),
  object: sceneObjectSchema,
  assets: z.array(z.strictObject({
    name: safeImageNameSchema,
    token: z.string().regex(/^[a-f0-9]{64}$/),
  })),
});
const transactionSchema = z.discriminatedUnion('kind', [renameJournalSchema, importJournalSchema]);
const importReceiptSchema = z.strictObject({
  projectName: z.string(),
  cardToken: z.string().regex(/^[a-f0-9]{64}$/),
  object: sceneObjectSchema,
});

function withNormalizedCounters(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const source = 'counters' in value && typeof value.counters === 'object' && value.counters !== null && !Array.isArray(value.counters)
    ? value.counters as Record<string, unknown>
    : {};
  const counters: Record<string, unknown> = { ...source };
  for (const kind of counterKinds) {
    const counter = source[kind];
    if (typeof counter === 'number' && Number.isFinite(counter) && Number.isInteger(counter) && counter >= 0) {
      counters[kind] = counter;
    } else {
      delete counters[kind];
    }
  }
  return { ...value, counters };
}

function projectDirectory(projectsDirectory: string, name: string): string | null {
  if (!isSafeFileSegment(name)) return null;
  return path.join(projectsDirectory, name);
}

function contentToken(raw: string | Uint8Array): string {
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

function structuralIssues(issues: z.core.$ZodIssue[]): ProjectFileIssue[] {
  const result: ProjectFileIssue[] = [];
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        result.push({ code: 'unknown-field', path: issuePath([...issue.path, key]) });
        if (result.length === 100) return result;
      }
    } else {
      result.push({ code: issueCode(issue), path: issuePath(issue.path) });
      if (result.length === 100) return result;
    }
  }
  return result;
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
      if (opening.kind === 'window') {
        if (opening.heightCm !== undefined) addIssue('invalid-opening-field', `${openingPath}/heightCm`);
        if (opening.opensTo !== undefined) addIssue('invalid-opening-field', `${openingPath}/opensTo`);
      } else {
        if (opening.sillCm !== undefined) addIssue('invalid-opening-field', `${openingPath}/sillCm`);
        if (opening.topCm !== undefined) addIssue('invalid-opening-field', `${openingPath}/topCm`);
      }
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
      if (!room.contour.closed) addIssue('room-contour-open', `${roomPath}/contour/closed`);
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
        issues: structuralIssues(parsed.error.issues),
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

async function atomicWrite(filePath: string, raw: string | Uint8Array): Promise<void> {
  const temporaryPath = path.join(path.dirname(filePath), `.write-${process.pid}-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporaryPath, 'wx');
    try {
      if (typeof raw === 'string') await handle.writeFile(raw, 'utf8');
      else await handle.writeFile(raw);
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
  const importDirectory = path.join(dataDirectory, '_import');
  const acceptedImportDirectory = path.join(importDirectory, 'принятые');
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

  async function writeJournal(journal: z.infer<typeof transactionSchema>): Promise<void> {
    await fs.mkdir(transactionsDirectory, { recursive: true });
    await atomicWrite(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  }

  function safeImportFile(file: string): boolean {
    return file.endsWith('.json') && !file.includes('/') && !file.includes('\\') && !file.includes('..');
  }

  function receiptPath(file: string): string {
    return path.join(acceptedImportDirectory, `${file}.receipt.json`);
  }

  function decodeCard(value: unknown): ProjectFileResult<AssistantCard> {
    const parsed = assistantCardSchema.safeParse(value);
    if (parsed.success) return { ok: true, value: parsed.data };
    return {
      ok: false,
      error: {
        code: 'invalid-card',
        issues: structuralIssues(parsed.error.issues),
      },
    };
  }

  async function readImportCard(file: string): Promise<ProjectFileResult<{ card: AssistantCard; raw: string }>> {
    if (!safeImportFile(file)) return { ok: false, error: { code: 'invalid-import-file' } };
    let raw: string;
    try {
      raw = await fs.readFile(path.join(importDirectory, file), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, error: { code: 'import-not-found' } };
      }
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: { code: 'invalid-json', issues: [{ code: 'invalid-json', path: '/' }] } };
    }
    const decoded = decodeCard(value);
    if (!decoded.ok) return decoded;
    return { ok: true, value: { card: decoded.value, raw } };
  }

  async function ensureImportedAsset(
    projectName: string,
    asset: z.infer<typeof importJournalSchema>['assets'][number],
  ): Promise<ProjectFileResult<void>> {
    const sourcePath = path.join(importDirectory, asset.name);
    const targetDirectory = path.join(projectsDirectory, projectName, 'картинки');
    const targetPath = path.join(targetDirectory, asset.name);
    if (await exists(targetPath)) {
      const target = await fs.readFile(targetPath);
      return contentToken(target) === asset.token
        ? { ok: true, value: undefined }
        : { ok: false, error: { code: 'asset-conflict' } };
    }
    let source: Buffer;
    try {
      source = await fs.readFile(sourcePath);
    } catch {
      return { ok: false, error: { code: 'asset-missing' } };
    }
    if (contentToken(source) !== asset.token) {
      return { ok: false, error: { code: 'asset-conflict' } };
    }
    await fs.mkdir(targetDirectory, { recursive: true });
    const temporaryPath = path.join(targetDirectory, `.asset-${process.pid}-${randomUUID()}.tmp`);
    try {
      await atomicWrite(temporaryPath, source);
      try {
        await fs.link(temporaryPath, targetPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const target = await fs.readFile(targetPath);
        if (contentToken(target) !== asset.token) {
          return { ok: false, error: { code: 'asset-conflict' } };
        }
      }
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
    return { ok: true, value: undefined };
  }

  async function recoverImportTransition(
    journal: z.infer<typeof importJournalSchema>,
  ): Promise<ProjectFileResult<void>> {
    if (!safeImportFile(journal.file) || !projectDirectory(projectsDirectory, journal.projectName)) {
      return { ok: false, error: { code: 'transition-conflict' } };
    }
    let afterValue: unknown;
    try {
      afterValue = JSON.parse(journal.afterRaw);
    } catch {
      return { ok: false, error: { code: 'transition-conflict' } };
    }
    const afterProject = decodeProject(afterValue);
    if (!afterProject.ok || afterProject.value.name !== journal.projectName) {
      return { ok: false, error: { code: 'transition-conflict' } };
    }
    const planPath = path.join(projectsDirectory, journal.projectName, 'план.json');
    let currentRaw: string;
    try {
      currentRaw = await fs.readFile(planPath, 'utf8');
    } catch {
      return { ok: false, error: { code: 'transition-conflict' } };
    }
    const currentToken = contentToken(currentRaw);
    const afterToken = contentToken(journal.afterRaw);
    if (currentToken !== journal.beforeToken && currentToken !== afterToken) {
      return { ok: false, error: { code: 'transition-conflict' } };
    }
    for (const asset of journal.assets) {
      const copied = await ensureImportedAsset(journal.projectName, asset);
      if (!copied.ok) return copied;
    }
    if (currentToken === journal.beforeToken) await atomicWrite(planPath, journal.afterRaw);

    await fs.mkdir(acceptedImportDirectory, { recursive: true });
    const sourcePath = path.join(importDirectory, journal.file);
    const archivePath = path.join(acceptedImportDirectory, journal.file);
    const [sourceExists, archiveExists] = await Promise.all([exists(sourcePath), exists(archivePath)]);
    if (sourceExists === archiveExists) return { ok: false, error: { code: 'transition-conflict' } };
    const cardPath = sourceExists ? sourcePath : archivePath;
    if (contentToken(await fs.readFile(cardPath)) !== journal.cardToken) {
      return { ok: false, error: { code: 'transition-conflict' } };
    }
    if (sourceExists) await fs.rename(sourcePath, archivePath);
    const receipt = {
      projectName: journal.projectName,
      cardToken: journal.cardToken,
      object: journal.object,
    };
    await atomicWrite(receiptPath(journal.file), `${JSON.stringify(receipt, null, 2)}\n`);
    await fs.rm(journalPath, { force: true });
    return { ok: true, value: undefined };
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
    const parsed = transactionSchema.safeParse(value);
    if (!parsed.success) return { ok: false, error: { code: 'transition-conflict' } };
    const journal = parsed.data;
    if (journal.kind === 'accept-import') return recoverImportTransition(journal);
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

    acceptImport(
      file: string,
      projectName: string,
      options: { expectedToken: string },
    ): Promise<ProjectFileResult<ImportAcceptance>> {
      return mutate(async () => {
        const recovered = await recoverTransition();
        if (!recovered.ok) return recovered;
        if (!safeImportFile(file) || !projectDirectory(projectsDirectory, projectName)) {
          return { ok: false, error: { code: 'invalid-import-file' } };
        }
        const cardResult = await readImportCard(file);
        if (!cardResult.ok && cardResult.error.code === 'import-not-found') {
          let receiptRaw: string;
          try {
            receiptRaw = await fs.readFile(receiptPath(file), 'utf8');
          } catch {
            return cardResult;
          }
          let receiptValue: unknown;
          try {
            receiptValue = JSON.parse(receiptRaw);
          } catch {
            return { ok: false, error: { code: 'transition-conflict' } };
          }
          const receipt = importReceiptSchema.safeParse(receiptValue);
          if (!receipt.success || receipt.data.projectName !== projectName) {
            return { ok: false, error: { code: 'transition-conflict' } };
          }
          const document = await readStored(projectName);
          if (!document.ok) return document;
          return { ok: true, value: { document: document.value, object: receipt.data.object as SceneObject } };
        }
        if (!cardResult.ok) return cardResult;
        const current = await readStored(projectName);
        if (!current.ok) return current;
        if (current.value.token !== options.expectedToken) {
          return { ok: false, error: { code: 'stale-project' } };
        }
        const accepted = acceptCard(current.value.project, cardResult.value.card);
        const decoded = decodeProject(accepted.project);
        if (!decoded.ok) return decoded;
        const afterRaw = serializeProject(decoded.value);
        const assets: z.infer<typeof importJournalSchema>['assets'] = [];
        for (const [imageIndex, image] of (cardResult.value.card.images ?? []).entries()) {
          try {
            const imageRaw = await fs.readFile(path.join(importDirectory, image));
            assets.push({ name: image, token: contentToken(imageRaw) });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              return {
                ok: false,
                error: {
                  code: 'asset-missing',
                  issues: [{ code: 'asset-missing', path: `/images/${imageIndex}`, details: { name: image } }],
                },
              };
            }
            throw error;
          }
        }
        await writeJournal({
          kind: 'accept-import',
          file,
          projectName,
          cardToken: contentToken(cardResult.value.raw),
          beforeToken: current.value.token,
          afterRaw,
          object: accepted.object,
          assets,
        });
        const completed = await recoverTransition();
        if (!completed.ok) return completed;
        const document = await readStored(projectName);
        if (!document.ok) return document;
        return { ok: true, value: { document: document.value, object: accepted.object } };
      });
    },

    listImports(): Promise<ProjectFileResult<ImportListEntry[]>> {
      return mutate(async () => {
        const recovered = await recoverTransition();
        if (!recovered.ok) return recovered;
        await fs.mkdir(importDirectory, { recursive: true });
        const entries = await fs.readdir(importDirectory, { withFileTypes: true });
        const cards: ImportListEntry[] = [];
        for (const entry of entries) {
          if (!entry.isFile() || !safeImportFile(entry.name)) continue;
          const card = await readImportCard(entry.name);
          if (card.ok) cards.push({ file: entry.name, status: 'ready', card: card.value.card });
          else cards.push({ file: entry.name, status: 'invalid', error: card.error });
        }
        cards.sort((left, right) => left.file.localeCompare(right.file, 'ru'));
        return { ok: true, value: cards };
      });
    },

    rejectImport(file: string): Promise<ProjectFileResult<void>> {
      return mutate(async () => {
        const recovered = await recoverTransition();
        if (!recovered.ok) return recovered;
        if (!safeImportFile(file)) return { ok: false, error: { code: 'invalid-import-file' } };
        const rejectedDirectory = path.join(importDirectory, 'отклонённые');
        const sourcePath = path.join(importDirectory, file);
        const targetPath = path.join(rejectedDirectory, file);
        const [sourceExists, targetExists] = await Promise.all([exists(sourcePath), exists(targetPath)]);
        if (sourceExists && targetExists) return { ok: false, error: { code: 'import-conflict' } };
        if (!sourceExists && targetExists) return { ok: true, value: undefined };
        if (!sourceExists) return { ok: false, error: { code: 'import-not-found' } };
        await fs.mkdir(rejectedDirectory, { recursive: true });
        await fs.rename(sourcePath, targetPath);
        return { ok: true, value: undefined };
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
