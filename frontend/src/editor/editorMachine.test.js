import assert from 'node:assert/strict';
import test from 'node:test';

import { reduceDimensionSelection } from './editorMachine.ts';

test('выбирает неподвижную точку А, затем точку Б и сбрасывает выбор повторным кликом по А', () => {
  const empty = { aId: null, bId: null };

  const withA = reduceDimensionSelection(empty, { type: 'pointClicked', pointId: 12 });
  assert.deepEqual(withA, { aId: 12, bId: null });

  const withB = reduceDimensionSelection(withA, { type: 'pointClicked', pointId: 18 });
  assert.deepEqual(withB, { aId: 12, bId: 18 });

  const reset = reduceDimensionSelection(withB, { type: 'pointClicked', pointId: 12 });
  assert.deepEqual(reset, empty);
});

test('явное намерение сброса очищает обе точки', () => {
  assert.deepEqual(
    reduceDimensionSelection({ aId: 3, bId: 7 }, { type: 'reset' }),
    { aId: null, bId: null },
  );
});
