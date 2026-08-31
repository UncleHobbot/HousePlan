// Приём карточек ассистента (AutoClaw): карточка → Объект со склада.
// Формат карточки — часть контракта папки _import/ (ADR 0005, задачи #17/#18).

import type { AssistantCard, ObjectCategory, Project, SceneObject } from './index.js';
import { allocateId, rebaseCounters } from './index.js';

const CATEGORIES: ObjectCategory[] = [
  'sofa', 'armchair', 'table', 'chair', 'bed', 'wardrobe', 'light', 'appliance', 'other',
];

function toInt(value: unknown, fallback: number): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Карточка ассистента → Объект (без идентификатора; его выдаёт allocateId). */
export function cardToSceneObject(card: AssistantCard): Omit<SceneObject, 'id'> {
  const category: ObjectCategory = (CATEGORIES as string[]).includes(card.category ?? '')
    ? (card.category as ObjectCategory)
    : 'other';
  return {
    name: typeof card.name === 'string' && card.name.trim() ? card.name.trim() : 'Объект из импорта',
    category,
    widthCm: toInt(card.size?.w, 100),
    depthCm: toInt(card.size?.d, 50),
    heightCm: toInt(card.size?.h, 75),
    color: typeof card.color === 'string' ? card.color : undefined,
    images: Array.isArray(card.images) ? card.images.map(String) : [],
    clearances: {
      front: toInt(card.clearance?.front, 0),
      back: toInt(card.clearance?.back, 0),
      left: 0,
      right: 0,
    },
    source: card.source
      ? {
          vendor: String(card.source.vendor ?? ''),
          url: String(card.source.url ?? ''),
          priceCad: toInt(card.source.price_cad, 0) || undefined,
          confidence: card.source.confidence === 'estimated' ? 'estimated' : 'retailer',
        }
      : undefined,
    unconfirmedImport: true,
  };
}

/**
 * Принять карточку: объект со пометкой «не подтверждено» встаёт на склад
 * проекта. Возвращает новый проект и созданный объект.
 */
export function acceptCard(
  project: Project,
  card: AssistantCard,
): { project: Project; object: SceneObject } {
  const next = structuredClone(project);
  rebaseCounters(next);
  const id = allocateId(next, 'object');
  const object: SceneObject = { ...cardToSceneObject(card), id };
  next.objects.push(object);
  return { project: next, object };
}
