/**
 * Ферма: цель считается добычей после выдачи и переживает расходы.
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCamp } from './camp';
import { admit } from './residents';
import { FARM_FOOD_GOAL, advanceFarmOnboarding, gatherFarmFood } from './farm';

const resident = (name: string, seed: number) => ({
  name,
  seed,
  look: 'поселенец' as const,
  answer: 'кормим' as const,
  rest: false,
});

describe('Ферма: первая цель', () => {
  test('выдаётся после второго приглашённого жителя и запоминает запас', () => {
    const camp = createCamp();
    admit(camp, resident('Первый', 1));
    assert.equal(Boolean(camp.farm), false);
    admit(camp, resident('Второй', 2));
    const farm = camp.farm;
    assert.ok(farm !== undefined);
    assert.equal(farm.foodAtStart, camp.resources.food);
    assert.equal(farm.gatheredFood, 0);
    assert.equal(farm.step, 'intro');
  });

  test('считает валовую добычу, а не текущий остаток пищи', () => {
    const camp = createCamp();
    admit(camp, resident('Первый', 1));
    admit(camp, resident('Второй', 2));
    advanceFarmOnboarding(camp);
    gatherFarmFood(camp, 12);
    camp.resources.food = 0;
    gatherFarmFood(camp, FARM_FOOD_GOAL - 12);
    assert.equal(camp.farm?.gatheredFood, FARM_FOOD_GOAL);
    assert.equal(camp.farm?.unlocked, true);
    assert.equal(camp.farm?.step, 'reward');
  });

  test('лишняя добыча не переливает цель и завершённая награда не откатывается', () => {
    const camp = createCamp();
    admit(camp, resident('Первый', 1));
    admit(camp, resident('Второй', 2));
    gatherFarmFood(camp, FARM_FOOD_GOAL + 50);
    assert.equal(camp.farm?.gatheredFood, FARM_FOOD_GOAL);
    assert.equal(advanceFarmOnboarding(camp), true);
    assert.equal(camp.farm?.step, 'done');
    assert.equal(gatherFarmFood(camp, 10), false);
  });
});
