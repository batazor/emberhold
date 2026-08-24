import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCamp } from './camp';
import { FARM_CROPS, FARM_FOOD_GOAL, gatherFarmFood, plantFarmPlot } from './farm';
import {
  FARM_CARE_BONUS,
  FARM_CARE_SECONDS,
  collectResidentFarmHarvest,
  farmCareHelpers,
} from './farmResidents';
import { admit, buildTent } from './residents';

const makeCamp = () => {
  const camp = createCamp();
  camp.resources.wood = 100;
  admit(camp, { name: 'Руна', seed: 1, look: 'поселенка', answer: 'кормим', rest: false });
  admit(camp, { name: 'Тихон', seed: 2, look: 'поселенец', answer: 'строим', rest: false });
  assert.ok(buildTent(camp) !== null);
  assert.ok(buildTent(camp) !== null);
  gatherFarmFood(camp, FARM_FOOD_GOAL);
  return camp;
};

describe('Ферма: помощь жителей', () => {
  test('добытчик пищи собирает одну созревшую грядку и даёт бонус за уход', () => {
    const camp = makeCamp();
    plantFarmPlot(camp, 0, 'turnip', 0);
    plantFarmPlot(camp, 3, 'barley', 0);
    const before = camp.resources.food;

    // Дневная смена начинается в 07:00; к 08:00 после созревания репы
    // прошло полное рабочее окно ухода.
    const report = collectResidentFarmHarvest(camp, 0, 8 * 3600, 2);
    assert.deepEqual(report, {
      helpers: ['Руна'],
      plots: 1,
      food: FARM_CROPS.turnip.harvestFood + FARM_CARE_BONUS,
      bonus: FARM_CARE_BONUS,
    });
    assert.equal(camp.resources.food, before + report.food);
    assert.equal(camp.farm?.plots[0], null, 'собранная репа осталась на грядке');
    assert.notEqual(camp.farm?.plots[3], null, 'один помощник собрал больше одной грядки');
  });

  test('без рабочей смены, крыши или еды урожай ждёт игрока', () => {
    const camp = makeCamp();
    plantFarmPlot(camp, 0, 'turnip', 0);
    const before = camp.resources.food;
    const report = collectResidentFarmHarvest(camp, 0, 8 * 3600, 0);
    assert.equal(report.plots, 0);
    assert.equal(camp.resources.food, before);
    assert.notEqual(camp.farm?.plots[0], null);
  });

  test('созреванию нужен хотя бы получасовой остаток рабочей смены', () => {
    const camp = makeCamp();
    // Репа созревает ровно к началу смены; на секунду меньше получаса
    // помощнику ещё недостаточно.
    plantFarmPlot(camp, 0, 'turnip', 6 * 3600);
    const early = collectResidentFarmHarvest(camp, 0, 7 * 3600 + FARM_CARE_SECONDS - 1, 2);
    assert.equal(early.plots, 0);
    const onTime = collectResidentFarmHarvest(camp, 0, 7 * 3600 + FARM_CARE_SECONDS, 2);
    assert.equal(onTime.plots, 1);
  });

  test('панель показывает только доступных добытчиков пищи', () => {
    const camp = makeCamp();
    assert.deepEqual(farmCareHelpers(camp).map((helper) => helper.name), ['Руна']);
    camp.residents[0] = { ...camp.residents[0]!, rest: true };
    assert.deepEqual(farmCareHelpers(camp), []);
  });
});
