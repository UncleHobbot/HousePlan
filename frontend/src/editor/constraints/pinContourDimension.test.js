import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { createContourDimensionPinner } from './pinContourDimension.ts';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm');

function rectangle() {
  return {
    points: [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 600, y: 0 },
      { id: 3, x: 600, y: 300 },
      { id: 4, x: 0, y: 300 },
    ],
    thicknesses: {},
    locks: [],
    closed: true,
  };
}

function assertIntegerCoordinates(contour) {
  for (const point of contour.points) {
    assert.equal(Number.isFinite(point.x), true);
    assert.equal(Number.isFinite(point.y), true);
    assert.equal(Number.isInteger(point.x), true);
    assert.equal(Number.isInteger(point.y), true);
  }
}

function assertMinimumWallLength(contour) {
  contour.points.forEach((point, index) => {
    const next = contour.points[(index + 1) % contour.points.length];
    assert.ok(Math.hypot(next.x - point.x, next.y - point.y) >= 10);
  });
}

function assertExactLockLengths(contour) {
  for (const lock of contour.locks) {
    let index = contour.points.findIndex((point) => point.id === lock.aId);
    const end = contour.points.findIndex((point) => point.id === lock.bId);
    let length = 0;
    while (index !== end) {
      const point = contour.points[index];
      const next = contour.points[(index + 1) % contour.points.length];
      length += Math.hypot(next.x - point.x, next.y - point.y);
      index = (index + 1) % contour.points.length;
    }
    assert.equal(length, lock.length);
  }
}

test('прибивает размер прямоугольника, оставляя точку А неподвижной', async () => {
  const pinner = await createContourDimensionPinner(wasmPath);
  try {
    const contour = rectangle();
    const result = pinner.pinContourDimension(contour, 1, 2, 500);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.contour.points[0], { id: 1, x: 0, y: 0 });
      assert.deepEqual(result.contour.points[1], { id: 2, x: 500, y: 0 });
      assert.deepEqual(result.contour.points[2], { id: 3, x: 500, y: 300 });
      assert.deepEqual(result.contour.locks, [{ aId: 1, bId: 2, length: 500 }]);
      assertIntegerCoordinates(result.contour);
      assertMinimumWallLength(result.contour);
      assertExactLockLengths(result.contour);
    }
  } finally {
    pinner.dispose();
  }
});

test('сохраняет прежний замок при добавлении совместимого', async () => {
  const pinner = await createContourDimensionPinner(wasmPath);
  try {
    const first = pinner.pinContourDimension(rectangle(), 1, 2, 500);
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = pinner.pinContourDimension(first.contour, 2, 3, 250);
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.deepEqual(second.contour.points, [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 500, y: 0 },
        { id: 3, x: 500, y: 250 },
        { id: 4, x: 0, y: 250 },
      ]);
      assert.deepEqual(second.contour.locks, [
        { aId: 1, bId: 2, length: 500 },
        { aId: 2, bId: 3, length: 250 },
      ]);
      assertIntegerCoordinates(second.contour);
      assertMinimumWallLength(second.contour);
      assertExactLockLengths(second.contour);
    }
  } finally {
    pinner.dispose();
  }
});

test('не принимает решение, в котором остаётся стена короче 10 см', async () => {
  const pinner = await createContourDimensionPinner(wasmPath);
  try {
    const contour = {
      points: [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 600, y: 0 },
        { id: 3, x: 600, y: 300 },
        { id: 4, x: 5, y: 300 },
        { id: 5, x: 0, y: 300 },
      ],
      thicknesses: {},
      locks: [],
      closed: true,
    };
    const before = structuredClone(contour);

    const result = pinner.pinContourDimension(contour, 1, 2, 500);

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /короче 10 см/);
    assert.deepEqual(contour, before);
  } finally {
    pinner.dispose();
  }
});

test('не принимает решение с самопересечением', async () => {
  const pinner = await createContourDimensionPinner(wasmPath);
  try {
    const contour = {
      points: [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 100, y: 0 },
        { id: 3, x: 0, y: 100 },
        { id: 4, x: 100, y: 100 },
      ],
      thicknesses: {},
      locks: [],
      closed: true,
    };
    const before = structuredClone(contour);

    const result = pinner.pinContourDimension(contour, 1, 2, 120);

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /самопересечение/);
    assert.deepEqual(contour, before);
  } finally {
    pinner.dispose();
  }
});

test('отвергает конфликт, называет прежний замок и не меняет контур', async () => {
  const pinner = await createContourDimensionPinner(wasmPath);
  try {
    const first = pinner.pinContourDimension(rectangle(), 1, 2, 500);
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const beforeConflict = structuredClone(first.contour);
    const conflict = pinner.pinContourDimension(first.contour, 1, 2, 400);

    assert.equal(conflict.ok, false);
    if (!conflict.ok) {
      assert.match(conflict.reason, /противоречит/);
      assert.deepEqual(conflict.conflicts, ['А1–А2 = 500']);
    }
    assert.deepEqual(first.contour, beforeConflict);
  } finally {
    pinner.dispose();
  }
});

// Ниже — сценарии, которые раньше проверяли собственный пересчёт размеров
// в shared (`tryLock`). Сам он удалён, а правила остались те же, поэтому
// проверки перенесены на planegcs — утверждённый решатель ограничений.

function closureDelta(contour) {
  let dx = 0;
  let dy = 0;
  contour.points.forEach((point, index) => {
    const next = contour.points[(index + 1) % contour.points.length];
    dx += next.x - point.x;
    dy += next.y - point.y;
  });
  return { dx, dy };
}

function lShape() {
  return {
    points: [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 600, y: 0 },
      { id: 3, x: 600, y: 350 },
      { id: 4, x: 250, y: 350 },
      { id: 5, x: 250, y: 600 },
      { id: 6, x: 0, y: 600 },
    ],
    thicknesses: {},
    locks: [],
    closed: true,
  };
}

function splitWallContour() {
  return {
    points: [
      { id: 1, x: 0, y: 0 },
      { id: 5, x: 250, y: 0 },
      { id: 2, x: 600, y: 0 },
      { id: 3, x: 600, y: 300 },
      { id: 4, x: 0, y: 300 },
    ],
    thicknesses: {},
    locks: [],
    closed: true,
  };
}

test('Г-образная комната: контур сходится и стены не короче минимума', async () => {
  const pinner = await createContourDimensionPinner(wasmPath);
  try {
    const result = pinner.pinContourDimension(lShape(), 1, 2, 500);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(closureDelta(result.contour), { dx: 0, dy: 0 });
      assert.deepEqual(result.contour.points[0], { id: 1, x: 0, y: 0 });
      assert.equal(result.contour.points[1].x, 500);
      assertIntegerCoordinates(result.contour);
      assertMinimumWallLength(result.contour);
      assertExactLockLengths(result.contour);
    }
  } finally {
    pinner.dispose();
  }
});

test('разрезанная стена: два замка держатся, третий называет оба', async () => {
  const pinner = await createContourDimensionPinner(wasmPath);
  try {
    const first = pinner.pinContourDimension(splitWallContour(), 1, 5, 100);
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = pinner.pinContourDimension(first.contour, 5, 2, 150);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assertExactLockLengths(second.contour);

    const third = pinner.pinContourDimension(second.contour, 1, 2, 300);
    assert.equal(third.ok, false);
    if (!third.ok) {
      assert.match(third.reason, /противоречит/);
      assert.deepEqual(third.conflicts, ['А1–А5 = 100', 'А5–А2 = 150']);
    }
  } finally {
    pinner.dispose();
  }
});

test('диагональ вне выбранного участка не мешает прибить прямую стену', async () => {
  const pinner = await createContourDimensionPinner(wasmPath);
  try {
    const contour = {
      points: [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 100, y: 0 },
        { id: 3, x: 150, y: 50 },
        { id: 4, x: 150, y: 100 },
        { id: 5, x: 0, y: 100 },
      ],
      thicknesses: {},
      locks: [],
      closed: true,
    };

    const result = pinner.pinContourDimension(contour, 1, 2, 120);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.contour.points[0], { id: 1, x: 0, y: 0 });
      assert.deepEqual(result.contour.points[1], { id: 2, x: 120, y: 0 });
      assert.deepEqual(closureDelta(result.contour), { dx: 0, dy: 0 });
      assertMinimumWallLength(result.contour);
    }
  } finally {
    pinner.dispose();
  }
});

test('участок из двух частей нельзя сжать до общего минимума', async () => {
  const pinner = await createContourDimensionPinner(wasmPath);
  try {
    const contour = {
      points: [
        { id: 1, x: 0, y: 0 },
        { id: 5, x: 50, y: 0 },
        { id: 2, x: 100, y: 0 },
        { id: 3, x: 100, y: 100 },
        { id: 4, x: 0, y: 100 },
      ],
      thicknesses: {},
      locks: [],
      closed: true,
    };
    const before = structuredClone(contour);

    const result = pinner.pinContourDimension(contour, 1, 2, 10);

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /каждая должна быть не короче/);
    assert.deepEqual(contour, before);
  } finally {
    pinner.dispose();
  }
});

test('огромный размер законен: контур сходится, прежний замок цел', async () => {
  const pinner = await createContourDimensionPinner(wasmPath);
  try {
    const huge = pinner.pinContourDimension(splitWallContour(), 1, 2, 100000);
    assert.equal(huge.ok, true);
    if (huge.ok) assert.deepEqual(closureDelta(huge.contour), { dx: 0, dy: 0 });

    // с замком на первой половине стены: остаток просто растягивается,
    // прибитые 100 см остаются ровно 100 см
    const locked = pinner.pinContourDimension(splitWallContour(), 1, 5, 100);
    assert.equal(locked.ok, true);
    if (!locked.ok) return;

    const stretched = pinner.pinContourDimension(locked.contour, 1, 2, 100000);
    assert.equal(stretched.ok, true);
    if (stretched.ok) {
      assert.deepEqual(closureDelta(stretched.contour), { dx: 0, dy: 0 });
      assertExactLockLengths(stretched.contour);
    }
  } finally {
    pinner.dispose();
  }
});

test('сильное сжатие Г-образной комнаты остаётся законным контуром', async () => {
  const pinner = await createContourDimensionPinner(wasmPath);
  try {
    const result = pinner.pinContourDimension(lShape(), 1, 2, 20);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(closureDelta(result.contour), { dx: 0, dy: 0 });
      assertMinimumWallLength(result.contour);
      assertExactLockLengths(result.contour);
    }
  } finally {
    pinner.dispose();
  }
});
