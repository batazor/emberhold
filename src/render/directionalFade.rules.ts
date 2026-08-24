import assert from 'node:assert/strict';
import test from 'node:test';
import { fadeGoals, fadeSide } from './directionalFade';

test('деталь попадает в сторону, вдоль которой она дальше от центра', () => {
  assert.equal(fadeSide(-4, 1, 0, 0), 0);
  assert.equal(fadeSide(4, 1, 0, 0), 1);
  assert.equal(fadeSide(1, -4, 0, 0), 2);
  assert.equal(fadeSide(1, 4, 0, 0), 3);
});

test('камера гасит только ближнюю сторону', () => {
  const goals = fadeGoals(10, 0, 0, 0, 0.45);
  assert.deepEqual([goals[0], goals[2], goals[3]], [1, 1, 1]);
  assert.ok(Math.abs(goals[1] - 0.45) < 1e-9);
  assert.deepEqual(fadeGoals(10, 0, 0, 0, 0.45, false), [1, 1, 1, 1]);
});
