/**
 * Правила условий новых локаций глобальной карты.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCamp } from './camp';
import { createHero, createRoster } from './heroes';
import { worldUnlock } from './worldUnlock';

describe('Условия новых локаций глобальной карты', () => {
  test('обычная вылазка не получает второй гейт поверх Кухни', () => {
    assert.equal(worldUnlock('вылазка', createCamp(), createRoster()), null);
  });

  test('каждая новая локация закрыта своим этапом развития и открывается на пороге', () => {
    const camp = createCamp();
    const roster = createRoster();

    assert.deepEqual(worldUnlock('замок', camp, roster), {
      goal: 'forge', current: 0, required: 1, unlocked: false,
    });
    camp.levels.forge = 1;
    assert.equal(worldUnlock('замок', camp, roster)?.unlocked, true);

    camp.raids = 2;
    assert.deepEqual(worldUnlock('кладбище', camp, roster), {
      goal: 'raids', current: 2, required: 3, unlocked: false,
    });
    camp.raids += 1;
    assert.equal(worldUnlock('кладбище', camp, roster)?.unlocked, true);

    assert.deepEqual(worldUnlock('тропа', camp, roster), {
      goal: 'storage', current: 1, required: 2, unlocked: false,
    });
    camp.levels.storage = 2;
    assert.equal(worldUnlock('тропа', camp, roster)?.unlocked, true);

    assert.deepEqual(worldUnlock('призы', camp, roster), {
      goal: 'kitchen', current: 1, required: 2, unlocked: false,
    });
    camp.levels.kitchen = 2;
    assert.equal(worldUnlock('призы', camp, roster)?.unlocked, true);

    assert.deepEqual(worldUnlock('замок минотавра', camp, roster), {
      goal: 'hero', current: 1, required: 3, unlocked: false,
    });
    roster.heroes.push(createHero('archer', 1));
    roster.heroes[1]!.level = 3;
    assert.equal(worldUnlock('замок минотавра', camp, roster)?.unlocked, true);
  });

  test('лишний прогресс не меняет порог и не закрывает место обратно', () => {
    const camp = createCamp();
    const roster = createRoster();
    camp.raids = 20;
    camp.levels.forge = 3;
    camp.levels.storage = 4;
    camp.levels.kitchen = 4;
    roster.heroes[0]!.level = 9;

    for (const kind of ['замок', 'кладбище', 'тропа', 'призы', 'замок минотавра'] as const) {
      assert.equal(worldUnlock(kind, camp, roster)?.unlocked, true, kind);
    }
  });
});
