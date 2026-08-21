/**
 * Правила расходников (§21). Живут рядом с consumables.ts по тому же
 * правилу, что и остальные: фича приносит свои проверки с собой.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TICK } from '../core/loop';
import { createCamp, startUpgrade, suggestUpgrade } from './camp';
import {
  CONSUMABLES,
  RATION_FOOD,
  buyConsumable,
  cheapestAffordable,
  refundConsumable,
} from './consumables';
import { createRaid, setSupply, stepRaid } from './raid';

describe('Расходники', () => {
  test('§21.1 — не больше двух за вылазку', () => {
    const camp = createCamp();
    camp.resources = { stone: 999, wood: 0, iron: 999, crystal: 0 };
    assert.equal(buyConsumable(camp, 'ration'), true);
    assert.equal(buyConsumable(camp, 'bandage'), true);
    assert.equal(buyConsumable(camp, 'smoke'), false, 'третий слот не продаётся');
    assert.equal(camp.loadout.length, 2);
  });

  test('§21.1 — до входа деньги возвращаются целиком', () => {
    const camp = createCamp();
    camp.resources = { stone: 20, wood: 0, iron: 0, crystal: 0 };
    const price = CONSUMABLES.ration.price.stone ?? 0;
    buyConsumable(camp, 'ration');
    assert.equal(camp.resources.stone, 20 - price, 'списано ровно по прайсу');
    assert.equal(refundConsumable(camp, 0), true);
    assert.equal(camp.resources.stone, 20);
    assert.equal(refundConsumable(camp, 0), false, 'возвращать нечего');
  });

  test('§21.3 — предлагается самый дешёвый по карману', () => {
    const camp = createCamp();
    const cheapest = CONSUMABLES.ration.price.stone ?? 0;
    camp.resources = { stone: cheapest, wood: 0, iron: 0, crystal: 0 };
    assert.equal(cheapestAffordable(camp.resources, camp.loadout), 'ration');
    camp.resources.stone = cheapest - 1;
    assert.equal(cheapestAffordable(camp.resources, camp.loadout), null);
  });

  test('§20.1 — предлагается, когда слот стройки занят', () => {
    const camp = createCamp();
    camp.resources = { stone: 30, wood: 30, iron: 0, crystal: 0 };
    startUpgrade(camp, 'hq', 0);
    assert.equal(suggestUpgrade(camp), null, 'стройку предложить нельзя');
    assert.notEqual(
      cheapestAffordable(camp.resources, camp.loadout),
      null,
      'а расходник — можно: в этом весь второй сток',
    );
  });
});

describe('Срабатывание', () => {
  const raidWith = (consumables: ('bandage' | 'ration' | 'smoke')[], tier: 1 | 2 = 1) =>
    createRaid({ seed: 5, tier, kitchenLevel: 3, storageLevel: 2, consumables });

  test('§21.1 — повязка срабатывает сама на четверти здоровья', () => {
    const raid = raidWith(['bandage']);
    // Четверть здоровья — та же граница, на которой HUD красит число красным:
    // «плохо» в правилах и «плохо» на экране обязаны значить одно.
    raid.hero.hp = Math.floor(raid.hero.hpMax / 4);
    const before = raid.hero.hp;
    stepRaid(raid, TICK, true, 5);
    assert.ok(raid.hero.hp > before, 'здоровье возвращено');
    assert.ok(raid.hero.hp <= raid.hero.hpMax, 'и не выше потолка');
    assert.deepEqual(raid.fired, ['bandage']);
    assert.equal(raid.consumables.length, 0, 'расходник истрачен');
  });

  test('§21 — паёк срабатывает на нуле провианта', () => {
    const raid = raidWith(['ration']);
    setSupply(raid, 0);
    stepRaid(raid, TICK, true, 5);
    assert.equal(raid.food, RATION_FOOD);
    assert.deepEqual(raid.fired, ['ration']);
  });

  test('§21 — повязка страхует ошибку, а не воскрешает', () => {
    const raid = raidWith(['bandage']);
    for (const f of raid.party) f.hp = 0;
    stepRaid(raid, TICK, true, 5);
    assert.equal(raid.status, 'failed');
    assert.deepEqual(raid.fired, [], 'повязка не тратится на труп');
  });

  test('§21 — дым гасит свалку и даёт передышку', () => {
    const raid = raidWith(['smoke'], 2);
    // Врагов надо поставить рядом: далёкие теряют героя в том же тике,
    // и свалки не получается.
    for (const e of raid.loc.enemies.slice(0, 2)) {
      e.x = raid.hero.x + 2;
      e.z = raid.hero.z + 2;
      e.awake = true;
    }
    stepRaid(raid, TICK, true, 5);
    assert.deepEqual(raid.fired, ['smoke']);
    assert.equal(raid.loc.enemies.every((e) => !e.awake), true, 'контакт разорван');
    assert.ok(raid.smokeUntil > raid.elapsed, 'есть окно, пока никто не просыпается');
  });

  test('§21 — без расходников ничего не срабатывает', () => {
    const raid = raidWith([]);
    raid.hero.hp = 1;
    setSupply(raid, 0);
    stepRaid(raid, TICK, true, 5);
    assert.deepEqual(raid.fired, []);
    assert.equal(raid.hero.hp, 1);
  });
});
