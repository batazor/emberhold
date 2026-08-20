/**
 * Правила вылазки.
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TICK } from '../core/loop';
import { createCamp, kitchenFood, storageCapacity } from './camp';
import { atRisk, backSteps, commandMove, createRaid, raidResult, stepRaid } from './raid';
import type { RaidState } from './raid';
import { addResources } from './resources';

/** Гоняет симуляцию, пока герой идёт, но не дольше лимита. */
const run = (state: RaidState, seconds: number): void => {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks && state.status === 'running' && state.path.length > 0; i++) {
    stepRaid(state, TICK, true, 5);
  }
};

describe('Вылазка', () => {
  test('§2 — Кухня и Склад задают провиант и рюкзак', () => {
    const raid = createRaid({ seed: 1, tier: 1, kitchenLevel: 3, storageLevel: 2 });
    // Значения берутся из кривых, а не повторяются числом: кривая Кухни выведена
    // моделью и меняется вместе с TIER_SPEC.
    assert.equal(raid.food, kitchenFood(3));
    assert.equal(raid.foodMax, kitchenFood(3));
    assert.equal(raid.capacity, storageCapacity(2));
  });

  test('§11.1 — путь назад считается от эвакуации', () => {
    const raid = createRaid({ seed: 7, tier: 2, kitchenLevel: 3, storageLevel: 2 });
    assert.equal(backSteps(raid), 0, 'на точке эвакуации путь назад нулевой');
    const far = raid.loc.containers[0];
    assert.ok(far !== undefined);
    assert.equal(commandMove(raid, far), true, 'до контейнера есть путь');
    run(raid, 120);
    assert.ok(backSteps(raid) > 0, 'отойдя от выхода, путь назад вырос');
  });

  test('контейнер стоит провианта и наполняет рюкзак (§11.1)', () => {
    const raid = createRaid({ seed: 7, tier: 2, kitchenLevel: 3, storageLevel: 2 });
    const target = raid.loc.containers[0];
    assert.ok(target !== undefined);
    commandMove(raid, target);
    run(raid, 120);
    assert.ok(raid.bagTotal > 0, 'добыча в рюкзаке');
    assert.ok(raid.food < raid.foodMax - raid.steps, 'вскрытие списало сверх шагов');
    assert.equal(raid.loc.containers[0]?.opened, true);
  });

  test('§11.2 — под угрозой ceil(добыча × доля яруса)', () => {
    const raid = createRaid({ seed: 3, tier: 2, kitchenLevel: 3, storageLevel: 2 });
    raid.bag.stone = 7;
    raid.bagTotal = 7;
    assert.equal(atRisk(raid), 5, '7 × 0.6 = 4.2 → 5');
  });

  test('провал теряет долю рюкзака, эвакуация — ничего', () => {
    const raid = createRaid({ seed: 3, tier: 3, kitchenLevel: 3, storageLevel: 2 });
    raid.bag = { stone: 6, wood: 0, iron: 3, crystal: 1 };
    raid.bagTotal = 10;

    raid.status = 'failed';
    const lost = raidResult(raid);
    assert.equal(lost.lost, 10, 'на дне ставка 100%');
    assert.equal(lost.carriedTotal, 0);

    raid.status = 'evacuated';
    const saved = raidResult(raid);
    assert.equal(saved.lost, 0);
    assert.deepEqual(saved.carried, { stone: 6, wood: 0, iron: 3, crystal: 1 });
  });

  test('потери распределяются по составу рюкзака, а не по одному виду', () => {
    const raid = createRaid({ seed: 3, tier: 2, kitchenLevel: 3, storageLevel: 2 });
    raid.bag = { stone: 10, wood: 0, iron: 10, crystal: 0 };
    raid.bagTotal = 20;
    raid.status = 'failed';
    const r = raidResult(raid);
    assert.equal(r.lost, 12, '20 × 0.6');
    assert.equal(r.carriedTotal, 8);
    assert.ok(r.carried.stone > 0 && r.carried.iron > 0, 'обе кучи пострадали');
  });

  test('добыча доезжает до лагеря', () => {
    const camp = createCamp();
    const raid = createRaid({ seed: 11, tier: 1, kitchenLevel: 3, storageLevel: 2 });
    raid.bag = { stone: 4, wood: 3, iron: 1, crystal: 0 };
    raid.bagTotal = 8;
    raid.status = 'evacuated';
    addResources(camp.resources, raidResult(raid).carried);
    assert.deepEqual(camp.resources, { stone: 4, wood: 3, iron: 1, crystal: 0 });
  });
});
