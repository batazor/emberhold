import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SURVIVAL_MODELS, SURVIVAL_SLOTS } from './survival.data';
import { SURVIVAL_PALETTE } from './palette';
import { survivalTentGeometry } from './survival';

describe('Kenney Survival Kit: палатка', () => {
  test('в бандле ровно каркас и две стадии полотна', () => {
    assert.deepEqual(Object.keys(SURVIVAL_MODELS).sort(), [
      'tent',
      'tent-canvas',
      'tent-canvas-half',
    ]);
  });

  test('строительная стадия отличается от готовой и стоит на том же месте', () => {
    const building = survivalTentGeometry('building');
    const complete = survivalTentGeometry('complete');
    building.computeBoundingBox();
    complete.computeBoundingBox();
    assert.notEqual(building.getAttribute('position').count, complete.getAttribute('position').count);
    assert.deepEqual(building.boundingBox?.min.toArray(), complete.boundingBox?.min.toArray());
    assert.deepEqual(building.boundingBox?.max.toArray(), complete.boundingBox?.max.toArray());
  });

  test('все слоты запечённой модели имеют цвет игровой палитры', () => {
    assert.equal(SURVIVAL_SLOTS.length, SURVIVAL_PALETTE.length);
  });
});
