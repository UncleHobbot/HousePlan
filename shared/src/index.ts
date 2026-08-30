// Модель данных HousePlan — зеркало docs/модель-данных.md.
// Все длины — целые сантиметры. Осей стен нет: линии контуров — внутренние грани.

export * from './geometry.js';
export * from './objects.js';
export * from './openings.js';
export * from './snapshots.js';
export * from './zones.js';

/** Карточка объекта от ассистента (AutoClaw) — формат папки `_import/`. */
export interface AssistantCard {
  name?: string;
  category?: string;
  size?: { w?: number; d?: number; h?: number };
  color?: string;
  images?: string[];
  clearance?: { front?: number; back?: number };
  source?: {
    vendor?: string;
    url?: string;
    price_cad?: number;
    confidence?: string;
  };
}

/** Версия формата файла плана (внешний контракт — ADR 0005). */
export const FORMAT_VERSION = 1;

export type Cm = number;

export interface Attr {
  name: string;
  value: string;
}

/** Точка контура. Идентификатор стабилен при разрезании стен. */
export interface Point {
  id: number;
  x: Cm;
  y: Cm;
}

/** Прибитый размер участка — цепочка стен от точки aId до точки bId вперёд по обходу. */
export interface SizeLock {
  aId: number;
  bId: number;
  length: Cm;
}

export interface Contour {
  points: Point[];
  /** толщина стены, начинающейся в точке с этим идентификатором (рисунок, не размеры) */
  thicknesses: Record<number, Cm>;
  locks: SizeLock[];
  /** контур замкнут (клик по первой точке); помещение существует только замкнутым */
  closed: boolean;
}

export type OpeningKind = 'window' | 'entryDoor' | 'innerDoor';

export interface Opening {
  id: number;
  kind: OpeningKind;
  /** стена проёма: идентификатор начальной точки стены */
  wallPointId: number;
  /** сантиметры от угла стены; ведёт себя как доля длины стены */
  offsetCm: Cm;
  widthCm: Cm;
  /** у окна: подоконник и верх (по умолчанию 90 и 220) */
  sillCm?: Cm;
  topCm?: Cm;
  /** у двери: высота (по умолчанию 200) */
  heightCm?: Cm;
  /** сторона открывания — только у двери */
  opensTo?: 'left' | 'right';
  attributes: Attr[];
}

export interface Clearance4 {
  front: Cm;
  back: Cm;
  left: Cm;
  right: Cm;
}

export const NO_CLEARANCE: Clearance4 = { front: 0, back: 0, left: 0, right: 0 };

export type ZoneKind =
  | 'stairs'
  | 'builtInWardrobe'
  | 'fireplace'
  | 'decorativeWall'
  | 'partition'
  | 'other';

export interface Zone {
  id: number;
  kind: ZoneKind;
  name: string;
  /** многоугольник из прямых отрезков (замкнутый, без самопересечений) */
  points: Point[];
  /** пристенная зона: идентификатор начальной точки опорной стены помещения */
  supportWallPointId?: number;
  /** простенок: идентификатор точки контура, из которой растёт */
  fromPointId?: number;
  /** сквозная зона: диапазон этажей, на которых видна проекция */
  spansFloors?: { fromFloorId: number; toFloorId: number };
  clearances: Clearance4;
  attributes: Attr[];
}

export type ObjectCategory =
  | 'sofa'
  | 'armchair'
  | 'table'
  | 'chair'
  | 'bed'
  | 'wardrobe'
  | 'light'
  | 'appliance'
  | 'other';

/** Источник объекта, заполненный импортом (AutoClaw) */
export interface ObjectSource {
  vendor: string;
  url: string;
  priceCad?: number;
  /** retailer — размеры сняты с карточки товара; estimated — оценка по фото */
  confidence: 'retailer' | 'estimated';
}

/** Объект — предмет мебели или прибор. Живёт в складе проекта. */
export interface SceneObject {
  id: number;
  name: string;
  category: ObjectCategory;
  widthCm: Cm;
  depthCm: Cm;
  heightCm: Cm;
  color?: string;
  /** имя файла в папке картинки/ проекта */
  skinImage?: string;
  images?: string[];
  clearances: Clearance4;
  source?: ObjectSource;
  /** импортный объект, ещё не подтверждённый человеком */
  unconfirmedImport?: boolean;
}

/** Где объект стоит сейчас (живой план). Координаты — система координат этажа. */
export interface Placement {
  objectId: number;
  roomId: number;
  x: Cm;
  y: Cm;
  /** градусы, 0° — «перед» вдоль оси X, по часовой стрелке */
  rotationDeg: number;
}

export interface Room {
  id: number;
  name: string;
  contour: Contour;
  /** внутренние двери */
  openings: Opening[];
  zones: Zone[];
  placements: Placement[];
}

export interface Floor {
  id: number;
  name: string;
  /** высота потолка, по умолчанию 260 см */
  ceilingHeightCm: Cm;
  /** внешняя оболочка этажа: её стены — окна и входные двери */
  shell: { contour: Contour; openings: Opening[] };
  rooms: Room[];
}

export interface SnapshotPlacement {
  /** слепок свойств объекта, не ссылка */
  object: SceneObject;
  roomId: number;
  x: Cm;
  y: Cm;
  rotationDeg: number;
}

export interface Snapshot {
  id: number;
  name: string;
  note?: string;
  placements: SnapshotPlacement[];
  /** слепок склада на момент снэпшота */
  storeroomObjects: SceneObject[];
}

export interface Project {
  formatVersion: number;
  name: string;
  floors: Floor[];
  /** склад проекта */
  objects: SceneObject[];
  snapshots: Snapshot[];
  /** счётчики идентификаторов (по каждому виду сущностей) */
  counters: ProjectCounters;
}

export type IdKind = 'floor' | 'room' | 'point' | 'opening' | 'zone' | 'object' | 'snapshot';

export type ProjectCounters = Partial<Record<IdKind, number>>;

/** Пустой проект с именем */
export function emptyProject(name: string): Project {
  return {
    formatVersion: FORMAT_VERSION,
    name,
    floors: [],
    objects: [],
    snapshots: [],
    counters: {},
  };
}

/**
 * Выдать следующий идентификатор вида kind, увеличив счётчик проекта.
 * Вызывать внутри копии проекта, которую собираетесь сохранить.
 */
export function allocateId(project: Project, kind: IdKind): number {
  const value = (project.counters[kind] ?? 0) + 1;
  project.counters[kind] = value;
  return value;
}

/**
 * Поднять счётчики выше максимальных существующих идентификаторов.
 * Единственный владелец инварианта: вызывать после загрузки, отмены,
 * возврата варианта, переименования и приёма импорта.
 */
export function rebaseCounters(project: Project): void {
  const ids: Record<IdKind, number[]> = {
    floor: [], room: [], point: [], opening: [], zone: [], object: [], snapshot: [],
  };
  for (const floor of project.floors) {
    ids.floor.push(floor.id);
    ids.point.push(...floor.shell.contour.points.map((point) => point.id));
    ids.opening.push(...floor.shell.openings.map((opening) => opening.id));
    for (const room of floor.rooms) {
      ids.room.push(room.id);
      ids.point.push(...room.contour.points.map((point) => point.id));
      ids.opening.push(...room.openings.map((opening) => opening.id));
      ids.zone.push(...room.zones.map((zone) => zone.id));
      ids.point.push(...room.zones.flatMap((zone) => zone.points.map((point) => point.id)));
    }
  }
  ids.object.push(...project.objects.map((object) => object.id));
  ids.snapshot.push(...project.snapshots.map((snapshot) => snapshot.id));
  for (const kind of Object.keys(ids) as IdKind[]) {
    project.counters[kind] = Math.max(project.counters[kind] ?? 0, 0, ...ids[kind]);
  }
}

/** Прямоугольная комната по умолчанию — заготовка при добавлении помещения */
export function defaultRoom(project: Project, id: number, name: string, originX: Cm, originY: Cm): Room {
  const w = 400;
  const h = 300;
  const pts: Point[] = [
    { id: allocateId(project, 'point'), x: originX, y: originY },
    { id: allocateId(project, 'point'), x: originX + w, y: originY },
    { id: allocateId(project, 'point'), x: originX + w, y: originY + h },
    { id: allocateId(project, 'point'), x: originX, y: originY + h },
  ];
  const thicknesses: Record<number, Cm> = {};
  for (const p of pts) thicknesses[p.id] = 10;
  return {
    id,
    name,
    contour: { points: pts, thicknesses, locks: [], closed: true },
    openings: [],
    zones: [],
    placements: [],
  };
}
