import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCamp } from './camp';
import {
  acceptMinotaurQuest,
  claimMinotaurRelic,
  completeMinotaurQuest,
  generateMinotaurCastle,
  makeMinotaurTrade,
  minotaurQuestFor,
  minotaurQuestRotation,
} from './minotaurCastle';

describe('Замок минотавра', () => {
  test('золотой сундук заперт мирным хозяином и двумя големами', () => {
    for (const seed of [1, 2, 42, 1337]) {
      const site = generateMinotaurCastle(seed, false, false);
      assert.equal(site.loc.containers.length, 1);
      assert.equal(site.goldenChest.look, 'золотой');
      assert.deepEqual(site.goldenChest.lockedBy, ['minotaur', 'stone-golem']);
      assert.equal(site.minotaur?.peaceful, true);
      assert.equal(site.loc.enemies[0], site.minotaur);
      assert.equal(site.guards.length, 2);
      assert.ok(site.guards.every((guard) => guard.kind === 'stone-golem' && guard.peaceful === true));
      assert.equal(new Set(site.loc.enemies.map((enemy) => `${enemy.x}:${enemy.z}`)).size, 3);
    }
  });

  test('победа убирает хозяина, получение награды оставляет сундук открытым', () => {
    assert.equal(generateMinotaurCastle(7, true, false).minotaur, null);
    assert.equal(generateMinotaurCastle(7, true, false).guards.length, 0);
    assert.equal(generateMinotaurCastle(7, true, false).goldenChest.lockedBy, undefined);
    assert.equal(generateMinotaurCastle(7, true, true).goldenChest.opened, true);
  });

  test('заказ детерминирован, оплачивается один раз', () => {
    const camp = createCamp();
    const expected = minotaurQuestFor(91);
    const quest = acceptMinotaurQuest(camp, 91);
    assert.deepEqual(quest, expected);
    camp.resources[quest.kind] = quest.amount;
    assert.equal(completeMinotaurQuest(camp, 91), true);
    assert.equal(camp.coins, quest.reward);
    assert.equal(camp.minotaurReputation, quest.reputation);
    assert.equal(camp.minotaurQuestCycle, 1);
    assert.equal(completeMinotaurQuest(camp, 91), false);
    assert.equal(camp.coins, quest.reward);
  });

  test('малый обмен требует ресурсы и начисляет монеты', () => {
    const camp = createCamp();
    assert.equal(makeMinotaurTrade(camp, 'iron-arrows'), null, 'закрытый товар продался без репутации');
    camp.resources.stone = 6;
    assert.equal(makeMinotaurTrade(camp, 'stone-coins')?.rewardAmount, 7);
    assert.equal(camp.resources.stone, 0);
    assert.equal(camp.coins, 7);
  });

  test('в ротации три разных заказа из пяти, и новый круг её меняет', () => {
    const first = minotaurQuestRotation(91, 0);
    const next = minotaurQuestRotation(91, 1);
    assert.equal(first.length, 3);
    assert.equal(new Set(first.map((quest) => quest.id)).size, 3);
    assert.notDeepEqual(first.map((quest) => quest.id), next.map((quest) => quest.id));
  });

  test('репутация постепенно открывает стрелы и кристаллы', () => {
    const camp = createCamp();
    camp.resources.iron = 7;
    assert.equal(makeMinotaurTrade(camp, 'iron-arrows'), null);
    camp.minotaurReputation = 2;
    assert.equal(makeMinotaurTrade(camp, 'iron-arrows')?.rewardKind, 'arrows');
    assert.ok(camp.arrows > 0);
    assert.equal(makeMinotaurTrade(camp, 'iron-crystal'), null);
    camp.minotaurReputation = 7;
    assert.equal(makeMinotaurTrade(camp, 'iron-crystal')?.rewardKind, 'crystal');
    assert.equal(camp.resources.crystal, 2);
  });

  test('каждый золотой сундук гарантированно записывает редкий предмет', () => {
    const camp = createCamp();
    for (const seed of [10, 11, 12]) {
      const relic = claimMinotaurRelic(camp, seed);
      assert.equal(camp.minotaurRelics?.[String(seed)], relic.id);
      assert.ok(relic.name.length > 0 && relic.effect.length > 0);
    }
    assert.equal(Object.keys(camp.minotaurRelics ?? {}).length, 3);
  });
});
