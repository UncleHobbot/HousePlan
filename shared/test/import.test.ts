import test from 'node:test';
import assert from 'node:assert/strict';
import type { AssistantCard } from '../src/index.js';
import { acceptCard, cardToSceneObject } from '../src/import.js';

test('карточка целиком превращается в объект', () => {
  const card: AssistantCard = {
    name: 'Футон Frode',
    category: 'sofa',
    size: { w: 157.4, d: 88, h: 68 },
    color: 'тёмно-серый',
    images: ['frode-1.jpg'],
    clearance: { front: 45 },
    source: {
      vendor: 'Structube',
      url: 'https://structube.com/frode',
      price_cad: 449,
      confidence: 'retailer',
    },
  };
  const object = cardToSceneObject(card);
  assert.equal(object.name, 'Футон Frode');
  assert.equal(object.category, 'sofa');
  assert.equal(object.widthCm, 157, 'сантиметры округляются до целых');
  assert.equal(object.depthCm, 88);
  assert.equal(object.heightCm, 68);
  assert.equal(object.color, 'тёмно-серый');
  assert.deepEqual(object.images, ['frode-1.jpg']);
  assert.equal(object.clearances.front, 45);
  assert.equal(object.source?.vendor, 'Structube');
  assert.equal(object.source?.priceCad, 449);
  assert.equal(object.source?.confidence, 'retailer');
  assert.equal(object.unconfirmedImport, true, 'импортный объект не подтверждён');
});

test('неизвестная категория становится «прочее», поля по умолчанию', () => {
  const object = cardToSceneObject({ category: 'унитаз' });
  assert.equal(object.category, 'other');
  assert.equal(object.name, 'Объект из импорта');
  assert.deepEqual(
    [object.widthCm, object.depthCm, object.heightCm],
    [100, 50, 75],
  );
  // источника нет — уверенность не утверждается вовсе
  assert.equal(object.source, undefined);
});

test('acceptCard выдаёт следующий id и не меняет исходный проект', () => {
  const project = {
    formatVersion: 1, name: 'Дом', floors: [], objects: [], snapshots: [],
    counters: { object: 1 },
  };
  const card: AssistantCard = { name: 'Стул' };
  const { project: next, object } = acceptCard(project, card);
  assert.equal(object.id, 2);
  assert.equal(next.objects.length, 1);
  assert.equal(next.counters.object, 2);
  // исходный проект не тронут (иммутабельный стиль)
  assert.equal(project.objects.length, 0);
  assert.equal(project.counters.object, 1);
});
