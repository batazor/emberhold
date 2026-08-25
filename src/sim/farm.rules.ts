/**
 * Ферма: цель считается добычей после выдачи и переживает расходы.
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FOOD_PER_MOUTH } from './balance';
import { createCamp, upgradeBlock } from './camp';
import { WORK_SECONDS, admit } from './residents';
import {
  FARM_FOOD_GOAL,
  FARM_CROPS,
  FARM_DEFAULT_CROP,
  FARM_GROW_SECONDS,
  FARM_HARVEST_FOOD,
  FARM_PLOT_COUNT,
  FARM_RETURN_ACTION_PLOTS,
  FARM_SEED_FOOD,
  FARM_STARTING_PLOT_COUNT,
  advanceFarmOnboarding,
  chooseFarmCaretaker,
  completeFarmConstruction,
  farmBuildBlock,
  farmStructureCost,
  farmPlantBlock,
  farmPlotPhase,
  farmReturnActionUnlocked,
  farmStatus,
  gatherFarmFood,
  harvestFarmPlot,
  plantFarmPlot,
  repeatReadyFarmPlots,
  selectFarmCrop,
  startFarmConstruction,
  syncFarmStory,
} from './farm';

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
    assert.equal(farm.activePlots, FARM_STARTING_PLOT_COUNT);
    assert.equal(farm.selectedCrop, FARM_DEFAULT_CROP);
    assert.deepEqual(farm.plots, Array(FARM_PLOT_COUNT).fill(null));
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

  test('посев оплачивается пищей и не занимает соседние грядки', () => {
    const camp = createCamp();
    admit(camp, resident('Первый', 1));
    admit(camp, resident('Второй', 2));
    gatherFarmFood(camp, FARM_FOOD_GOAL);
    const before = camp.resources.food;
    assert.equal(plantFarmPlot(camp, 3, 'barley', 100), true);
    assert.equal(camp.resources.food, before - FARM_SEED_FOOD);
    assert.deepEqual(camp.farm?.plots[3], { plantedAt: 100, crop: 'barley' });
    assert.equal(camp.farm?.plots[1], null);
    assert.equal(farmPlantBlock(camp, 3), 'occupied');
  });

  test('первый уровень открывает внутреннюю пару, дальние полосы объяснимо закрыты', () => {
    const camp = createCamp();
    admit(camp, resident('Первый', 1));
    admit(camp, resident('Второй', 2));
    gatherFarmFood(camp, FARM_FOOD_GOAL);
    assert.equal(farmPlotPhase(camp, 0, 100), 'empty');
    assert.equal(farmPlotPhase(camp, 3, 100), 'empty');
    for (const index of [1, 2, 4, 5]) {
      assert.equal(farmPlotPhase(camp, index, 100), 'locked');
      assert.equal(farmPlantBlock(camp, index), 'bed');
      assert.equal(plantFarmPlot(camp, index, 'barley', 100), false);
    }
  });

  test('урожай дозревает офлайн по отметке времени и собирается один раз', () => {
    const camp = createCamp();
    admit(camp, resident('Первый', 1));
    admit(camp, resident('Второй', 2));
    gatherFarmFood(camp, FARM_FOOD_GOAL);
    plantFarmPlot(camp, 0, 'barley', 1_000);
    assert.equal(farmPlotPhase(camp, 0, 1_000 + FARM_GROW_SECONDS - 1), 'growing');
    assert.equal(harvestFarmPlot(camp, 0, 1_000 + FARM_GROW_SECONDS - 1), 0);
    assert.equal(farmPlotPhase(camp, 0, 1_000 + FARM_GROW_SECONDS), 'ready');
    const before = camp.resources.food;
    assert.equal(harvestFarmPlot(camp, 0, 1_000 + FARM_GROW_SECONDS), FARM_HARVEST_FOOD);
    assert.equal(camp.resources.food, before + FARM_HARVEST_FOOD);
    assert.equal(farmPlotPhase(camp, 0, 1_000 + FARM_GROW_SECONDS), 'empty');
    assert.equal(harvestFarmPlot(camp, 0, 1_000 + FARM_GROW_SECONDS), 0);
  });

  test('без пищи посев объяснимо закрыт', () => {
    const camp = createCamp();
    admit(camp, resident('Первый', 1));
    admit(camp, resident('Второй', 2));
    gatherFarmFood(camp, FARM_FOOD_GOAL);
    camp.resources.food = 0;
    assert.equal(farmPlantBlock(camp, 0), 'food');
    assert.equal(plantFarmPlot(camp, 0, 'barley', 10), false);
  });

  test('статус одним числом различает свободное, растущее и готовое', () => {
    const camp = createCamp();
    admit(camp, resident('Первый', 1));
    admit(camp, resident('Второй', 2));
    gatherFarmFood(camp, FARM_FOOD_GOAL);
    plantFarmPlot(camp, 0, 'barley', 1_000);
    assert.deepEqual(farmStatus(camp.farm, 1_001), {
      active: 2,
      empty: 1,
      growing: 1,
      ready: 0,
      locked: 4,
      nextReadyAt: 1_000 + FARM_GROW_SECONDS,
    });
    assert.deepEqual(farmStatus(camp.farm, 1_000 + FARM_GROW_SECONDS), {
      active: 2,
      empty: 1,
      growing: 0,
      ready: 1,
      locked: 4,
      nextReadyAt: null,
    });
  });

  test('стартовый огород выгоднее ручным вниманием, но не кормит шесть ртов', () => {
    const cyclesPerHour = 3600 / FARM_GROW_SECONDS;
    const gardenPerHour =
      FARM_STARTING_PLOT_COUNT * (FARM_HARVEST_FOOD - FARM_SEED_FOOD) * cyclesPerHour;
    const gathererPerHour = 3600 / WORK_SECONDS;
    const sixMouthsPerHour = 6 * FOOD_PER_MOUTH * (3600 / WORK_SECONDS);
    assert.ok(gardenPerHour > gathererPerHour, `${gardenPerHour} <= ${gathererPerHour}`);
    assert.ok(gardenPerHour < sixMouthsPerHour, `${gardenPerHour} >= ${sixMouthsPerHour}`);
    assert.equal(gardenPerHour, 2.5);
    assert.equal(sixMouthsPerHour, 4);
  });

  test('репа быстрее, ячмень выгоднее, и выбор не меняет уже посеянное', () => {
    const camp = createCamp();
    admit(camp, resident('Первый', 1));
    admit(camp, resident('Второй', 2));
    gatherFarmFood(camp, FARM_FOOD_GOAL);
    assert.equal(selectFarmCrop(camp, 'turnip'), true);
    assert.equal(camp.farm?.selectedCrop, 'turnip');
    assert.equal(plantFarmPlot(camp, 0, 'turnip', 1_000), true);
    assert.equal(selectFarmCrop(camp, 'barley'), true);
    assert.equal(camp.farm?.plots[0]?.crop, 'turnip');
    assert.equal(
      farmPlotPhase(camp, 0, 1_000 + FARM_CROPS.turnip.growSeconds),
      'ready',
    );
    assert.equal(
      harvestFarmPlot(camp, 0, 1_000 + FARM_CROPS.turnip.growSeconds),
      FARM_CROPS.turnip.harvestFood,
    );

    assert.equal(plantFarmPlot(camp, 3, 'barley', 2_000), true);
    assert.equal(
      farmPlotPhase(camp, 3, 2_000 + FARM_CROPS.turnip.growSeconds),
      'growing',
    );
    assert.equal(
      harvestFarmPlot(camp, 3, 2_000 + FARM_CROPS.barley.growSeconds),
      FARM_CROPS.barley.harvestFood,
    );
    assert.ok(
      FARM_CROPS.barley.harvestFood - FARM_CROPS.barley.seedFood >
        FARM_CROPS.turnip.harvestFood - FARM_CROPS.turnip.seedFood,
    );
  });

  test('после четырёх грядок готовые циклы можно повторить одним действием', () => {
    const camp = createCamp();
    admit(camp, resident('Первый', 1));
    admit(camp, resident('Второй', 2));
    gatherFarmFood(camp, FARM_FOOD_GOAL);
    camp.farm!.activePlots = FARM_RETURN_ACTION_PLOTS;
    camp.farm!.story.structures.barn = true;
    const now = 20_000;
    plantFarmPlot(camp, 0, 'turnip', now - FARM_CROPS.turnip.growSeconds);
    plantFarmPlot(camp, 3, 'barley', now - FARM_CROPS.barley.growSeconds);
    plantFarmPlot(camp, 1, 'turnip', now - 100);
    const emptyBefore = camp.farm!.plots[4];
    const foodBefore = camp.resources.food;

    assert.equal(farmReturnActionUnlocked(camp.farm), true);
    assert.deepEqual(repeatReadyFarmPlots(camp, now), {
      harvested: 2,
      replanted: 2,
      foodHarvested: 8,
      seedFood: 2,
      netFood: 6,
    });
    assert.equal(camp.resources.food, foodBefore + 6);
    assert.deepEqual(camp.farm!.plots[0], { plantedAt: now, crop: 'turnip' });
    assert.deepEqual(camp.farm!.plots[3], { plantedAt: now, crop: 'barley' });
    assert.equal(camp.farm!.plots[1]?.plantedAt, now - 100, 'растущий посев перезапущен');
    assert.equal(camp.farm!.plots[4], emptyBefore, 'пустая грядка засеялась сама');
  });

  test('на двух грядках массовое действие скрыто и ничего не меняет', () => {
    const camp = createCamp();
    admit(camp, resident('Первый', 1));
    admit(camp, resident('Второй', 2));
    gatherFarmFood(camp, FARM_FOOD_GOAL);
    plantFarmPlot(camp, 0, 'turnip', 0);
    const before = camp.resources.food;
    assert.equal(farmReturnActionUnlocked(camp.farm), false);
    assert.equal(repeatReadyFarmPlots(camp, FARM_CROPS.turnip.growSeconds).harvested, 0);
    assert.equal(camp.resources.food, before);
    assert.notEqual(camp.farm?.plots[0], null);
  });
});

describe('Ферма: история развития на 15 дней', () => {
  const openedFarm = () => {
    const camp = createCamp();
    admit(camp, resident('Первый', 1));
    admit(camp, resident('Второй', 2));
    gatherFarmFood(camp, FARM_FOOD_GOAL);
    return camp;
  };

  test('за мировые сутки открывается не больше одной выполненной главы', () => {
    const camp = openedFarm();
    const story = camp.farm!.story;
    assert.equal(syncFarmStory(camp, 100), true);
    story.plantedPlots = 2;
    assert.equal(syncFarmStory(camp, 101), true);
    assert.equal(story.day, 2);
    story.harvestedPlots = 2;
    assert.equal(syncFarmStory(camp, 101), false, 'две главы открылись в одни сутки');
    assert.equal(syncFarmStory(camp, 105), true, 'пропущенные дни не мешают продолжить');
    assert.equal(story.day, 3, 'пропуск промотал главы вперёд');
  });

  test('стройки огорода делят слот с лагерем и дают обещанное расширение', () => {
    const camp = openedFarm();
    const farm = camp.farm!;
    farm.story.day = 4;
    camp.resources.wood = 1_000;
    camp.resources.stone = 1_000;
    camp.resources.iron = 1_000;
    camp.resources.crystal = 1_000;
    const before = { ...camp.resources };
    const cost = farmStructureCost('well');
    assert.equal(farmBuildBlock(camp, 'well'), 'ok');
    assert.equal(startFarmConstruction(camp, 'well', 1_000), true);
    assert.equal(upgradeBlock(camp, 'hq'), 'slot-busy');
    assert.equal(camp.resources.wood, before.wood - (cost.wood ?? 0));
    assert.equal(completeFarmConstruction(camp, farm.story.construction!.endsAt - 1), null);
    assert.equal(completeFarmConstruction(camp, farm.story.construction!.endsAt), 'well');
    assert.equal(farm.activePlots, 4);

    farm.story.day = 12;
    assert.equal(startFarmConstruction(camp, 'plots', 2_000), true);
    assert.equal(completeFarmConstruction(camp, farm.story.construction!.endsAt), 'plots');
    assert.equal(farm.activePlots, FARM_PLOT_COUNT);
  });

  test('сарай и дом появляются только в своих главах, выбор смотрителя одноразовый', () => {
    const camp = openedFarm();
    const farm = camp.farm!;
    camp.resources.wood = 10_000;
    camp.resources.stone = 10_000;
    camp.resources.iron = 10_000;
    camp.resources.crystal = 10_000;
    assert.equal(farmBuildBlock(camp, 'barn'), 'locked');
    farm.story.day = 8;
    assert.equal(startFarmConstruction(camp, 'barn', 10), true);
    completeFarmConstruction(camp, farm.story.construction!.endsAt);
    assert.equal(farm.story.structures.barn, true);
    farm.story.day = 11;
    assert.equal(chooseFarmCaretaker(camp, 'grower'), true);
    assert.equal(chooseFarmCaretaker(camp, 'steward'), false);
    farm.story.day = 13;
    assert.equal(startFarmConstruction(camp, 'farmhouse', 20), true);
    completeFarmConstruction(camp, farm.story.construction!.endsAt);
    assert.equal(farm.story.structures.farmhouse, true);
  });
});
