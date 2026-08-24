/** Правила ларца снабжения: экономика, хвост неудач и детерминизм. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SUPPLY_HARD_PITY,
  SUPPLY_PITY,
  SUPPLY_RARE_CHANCE,
  pitySummary,
  rareChanceWithin,
  rollSupplyBox,
  simulateSupplyBoxes,
  supplyBoxAt,
  supplyValueSummary,
} from './lootbox';
import { createCamp } from './camp';
import { claimSupplyBox } from './lootboxClaim';
import { generateLocation } from './generate';
import { createRaid, raidResult } from './raid';

describe('Ларец снабжения', () => {
  test('три структурированных слота и один бонус', () => {
    for (let seed = 0; seed < 100; seed++) {
      const open = rollSupplyBox(seed, 0);
      assert.equal(open.rewards.length, 3);
      assert.deepEqual(open.rewards.map((reward) => reward.slot), ['material', 'expedition', 'bonus']);
    }
  });

  test('десятый пустой цикл гарантирует редкую награду и сбрасывает счётчик', () => {
    const open = rollSupplyBox(7, SUPPLY_HARD_PITY - 1);
    assert.equal(open.rare, true);
    assert.equal(open.forced, true);
    assert.equal(open.pityAfter, 0);
    assert.equal(open.rewards[2]!.category, 'bonus-rare');
  });

  test('гарантия входит в фактическую частоту, а не нарисована поверх 10%', () => {
    const summary = pitySummary();
    assert.ok(Math.abs(summary.expectedBoxes - 6.513215599) < 1e-6);
    assert.ok(Math.abs(summary.longRunRareRate - 0.153533993) < 1e-6);
    assert.equal(summary.p50, 7);
    assert.equal(summary.p90, SUPPLY_HARD_PITY);
    assert.equal(summary.p95, SUPPLY_HARD_PITY);
    assert.equal(rareChanceWithin(SUPPLY_HARD_PITY), 1);
  });

  test('долгий EV остаётся рядом с целевыми 72 единицами', () => {
    const value = supplyValueSummary();
    assert.ok(Math.abs(value.longRunExpected - value.target) / value.target < 0.02);
    assert.ok(value.min > 0);
    assert.ok(value.max > value.longRunExpected);
  });

  test('симуляция подтверждает формулы', () => {
    const expected = supplyValueSummary();
    const actual = simulateSupplyBoxes(100_000, 91);
    assert.ok(Math.abs(actual.averageValue - expected.longRunExpected) < 0.25);
    assert.ok(Math.abs(actual.rareRate - expected.pity.longRunRareRate) < 0.003);
  });

  test('ролл и появление воспроизводимы', () => {
    assert.deepEqual(rollSupplyBox(123, 4), rollSupplyBox(123, 4));
    for (const tier of [0, 1, 2, 3] as const) {
      assert.equal(supplyBoxAt(555, tier, 8), supplyBoxAt(555, tier, 8));
      if (tier < 2) assert.equal(supplyBoxAt(555, tier, 8), false);
    }
  });

  test('настройки явно задают базовый шанс и гарантию', () => {
    assert.equal(SUPPLY_PITY.baseChance, SUPPLY_RARE_CHANCE);
    assert.equal(SUPPLY_PITY.hardPity, SUPPLY_HARD_PITY);
  });

  test('получение меняет лагерь и pity атомарно', () => {
    const camp = createCamp();
    camp.supplyPity = SUPPLY_HARD_PITY - 1;
    const claim = claimSupplyBox(camp, 17);
    assert.equal(claim.forced, true);
    assert.equal(camp.supplyPity, 0);
    assert.equal(claim.rewards[2]!.category, 'bonus-rare');
    assert.ok(camp.resources.crystal > 0 || camp.resources.iron >= 2);
  });

  test('походная награда не раздвигает два занятых слота', () => {
    const camp = createCamp();
    camp.loadout = ['ration', 'smoke'];
    const claim = claimSupplyBox(camp, 29);
    assert.equal(claim.consumableAdded, false);
    assert.deepEqual(camp.loadout, ['ration', 'smoke']);
  });

  test('в живом глубоком заходе ларец заменяет одну обычную находку', () => {
    const seed = Array.from({ length: 1000 }, (_, i) => i)
      .find((candidate) => supplyBoxAt(candidate, 2, 0));
    assert.notEqual(seed, undefined);
    const loc = generateLocation(seed!, 2, 1, 1, 0);
    const withoutSupply = generateLocation(seed!, 2, 1, 1, Infinity);
    const supply = loc.containers.filter((container) => container.supply === true);
    assert.equal(supply.length, 1);
    assert.equal(supply[0]!.look, 'сундук');
    assert.equal(loc.containers.length, withoutSupply.containers.length,
      'ларец добавился поверх росписи');
    assert.equal(withoutSupply.containers.some((container) => container.supply), false,
      'калибровочный рейд без номера захода получил новую награду');
  });

  test('найденный ларец доезжает только при успешном возвращении', () => {
    const raid = createRaid({ seed: 51, tier: 2, kitchenLevel: 3, storageLevel: 3 });
    raid.supplyBox = true;
    raid.status = 'failed';
    assert.equal(raidResult(raid).supplyBox, false);
    raid.status = 'evacuated';
    assert.equal(raidResult(raid).supplyBox, true);
  });
});
