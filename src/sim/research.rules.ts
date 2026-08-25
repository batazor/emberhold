import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCamp, storeCapacity } from './camp';
import {
  RESEARCH,
  RESEARCH_ORDER,
  completeResearchIfDue,
  grantResearchNotes,
  researchBagBonus,
  researchBlock,
  researchCost,
  researchFoodBonus,
  researchInfirmaryBonus,
  researchScoutingBonus,
  researchStoreBonus,
  researchWorkCapBonus,
  startResearch,
} from './research';

describe('Личное дерево исследований лагеря', () => {
  test('без Архива Записи не начисляются и исследование закрыто', () => {
    const camp = createCamp();
    assert.equal(grantResearchNotes(camp), 0);
    assert.equal(camp.research.notes, 0);
    assert.equal(researchBlock(camp, 'crop-rotation'), 'archive');
  });

  test('исследование платится один раз и заканчивается по офлайн-часам', () => {
    const camp = createCamp();
    camp.levels.hq = 5;
    camp.levels.archive = 1;
    camp.research.notes = 20;
    camp.resources.wood = 20;
    const cost = researchCost('crop-rotation', 1);

    assert.equal(startResearch(camp, 'crop-rotation', 100), true);
    assert.equal(camp.research.notes, 20 - cost.notes);
    assert.equal(camp.resources.wood, 20 - (cost.resources.wood ?? 0));
    assert.equal(researchBlock(camp, 'cartography'), 'busy');
    assert.equal(completeResearchIfDue(camp, 100 + cost.seconds - 1), null);
    assert.equal(completeResearchIfDue(camp, 100 + cost.seconds), 'crop-rotation');
    assert.equal(camp.research.levels['crop-rotation'], 1);
    assert.equal(camp.research.job, null);
  });

  test('следующий ряд требует общий прогресс и предыдущий узел своей ветки', () => {
    const camp = createCamp();
    camp.levels.hq = 5;
    camp.levels.archive = 2;
    camp.research.notes = 100;
    camp.resources.stone = 100;
    assert.equal(researchBlock(camp, 'work-orders'), 'previous');
    camp.research.levels['crop-rotation'] = 1;
    assert.equal(researchBlock(camp, 'work-orders'), 'levels');
    camp.research.levels['road-provisions'] = 1;
    camp.research.levels.cartography = 1;
    assert.equal(researchBlock(camp, 'work-orders'), 'ok');
  });

  test('все девять узлов дают читаемый эффект на каждом уровне', () => {
    assert.equal(RESEARCH_ORDER.length, 9);
    for (const id of RESEARCH_ORDER) {
      assert.equal(RESEARCH[id].effects.length, 3, id);
      assert.ok(RESEARCH[id].effects.every((line) => line.length > 0), id);
    }
  });

  test('уровни сворачиваются в модификаторы без дополнительных флагов', () => {
    const camp = createCamp();
    camp.research.levels['road-provisions'] = 2;
    camp.research.levels['leather-packs'] = 3;
    camp.research.levels.cartography = 2;
    camp.research.levels['signal-network'] = 1;
    camp.research.levels['work-orders'] = 2;
    camp.research.levels.shelving = 3;
    camp.research.levels.herbalism = 1;
    assert.equal(researchFoodBonus(camp), 6);
    assert.equal(researchBagBonus(camp), 6);
    assert.equal(researchScoutingBonus(camp), 1.5);
    assert.equal(researchWorkCapBonus(camp), 2);
    assert.equal(researchStoreBonus(camp), 30);
    assert.equal(storeCapacity(camp), 90);
    assert.equal(researchInfirmaryBonus(camp), 1);
  });
});
