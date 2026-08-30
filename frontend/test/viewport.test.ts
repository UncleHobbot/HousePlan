import assert from 'node:assert/strict';
import test from 'node:test';
import { createViewport } from '../src/editor/roomCanvas/viewport.ts';

test('viewport переводит координаты в обе стороны без потери', () => {
  const viewport = createViewport(
    [
      { x: 100, y: 200 },
      { x: 500, y: 400 },
    ],
    { width: 960, height: 560, padding: 60 },
  );

  const canvasPoint = viewport.toCanvas({ x: 275, y: 325 });
  const worldPoint = viewport.toWorld(canvasPoint);

  assert.ok(Math.abs(worldPoint.x - 275) < 1e-9);
  assert.ok(Math.abs(worldPoint.y - 325) < 1e-9);
});

test('viewport помещает границы плана в поле и центрирует по свободной оси', () => {
  const viewport = createViewport(
    [
      { x: 100, y: 200 },
      { x: 500, y: 400 },
    ],
    { width: 960, height: 560, padding: 60 },
  );

  assert.deepEqual(viewport.toCanvas({ x: 100, y: 200 }), { x: 60, y: 70 });
  assert.deepEqual(viewport.toCanvas({ x: 500, y: 400 }), { x: 900, y: 490 });
});

test('viewport учитывает базовые границы рабочего поля даже без точек', () => {
  const viewport = createViewport([], {
    width: 960,
    height: 560,
    padding: 60,
    worldBounds: { minX: 0, minY: 0, maxX: 600, maxY: 440 },
  });

  assert.deepEqual(viewport.toCanvas({ x: 0, y: 0 }), { x: 180, y: 60 });
  assert.deepEqual(viewport.toCanvas({ x: 600, y: 440 }), { x: 780, y: 500 });
});
