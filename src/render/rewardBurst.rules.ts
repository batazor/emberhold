import assert from 'node:assert/strict';
import test from 'node:test';
import { RewardBurst } from './rewardBurst';

test('наградный эффект переиспользует ограниченный пул и сам затухает', () => {
  const burst = new RewardBurst();
  burst.burst({ x: 0, y: 0, z: 0, kind: 'stone', amount: 5 });
  assert.ok(burst.activeCount >= 6);
  for (let i = 0; i < 20; i += 1) burst.update(0.08);
  assert.equal(burst.activeCount, 0);
  assert.equal(burst.mesh.visible, false);
  burst.dispose();
});
