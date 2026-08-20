/**
 * Правила модели баланса. Это не проверки чисел, а проверки инвариантов:
 * утверждения, верные для любого TIER_SPEC, а не для одного примера.
 * Новый ярус или новая ось сложности не требуют новых проверок.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TIER_KITCHEN_GATE, TIER_SPEC, deriveTier } from './balance';
import { kitchenFood } from './camp';
import type { Tier } from './types';

const TIERS: readonly Tier[] = [0, 1, 2, 3];

describe('Модель баланса (§22)', () => {
  test('§12.2 — запас на гейте лежит между «до дна» и «полным обходом»', () => {
    for (const tier of TIERS) {
      const d = deriveTier(TIER_SPEC[tier]);
      const food = kitchenFood(TIER_KITCHEN_GATE[tier]);
      assert.ok(
        d.geometry.deepAndBack <= food * 0.85,
        `ярус ${tier}: до дна и обратно ${d.geometry.deepAndBack} не влезает в ${food}`,
      );
      assert.ok(
        d.geometry.fullTour > food,
        `ярус ${tier}: полный обход ${d.geometry.fullTour} по карману при ${food}`,
      );
      assert.ok(d.checks.survivable, `ярус ${tier}: забег непереживаем`);
    }
  });

  test('модель сама объявляет свои гарантии выполненными', () => {
    for (const tier of TIERS) {
      const { checks } = deriveTier(TIER_SPEC[tier]);
      for (const [name, ok] of Object.entries(checks)) {
        assert.ok(ok, `ярус ${tier}: нарушена гарантия ${name}`);
      }
    }
  });

  test('сложность растёт по ярусам, а не скачет', () => {
    for (let i = 1; i < TIERS.length; i++) {
      const prev = TIER_SPEC[TIERS[i - 1]!];
      const cur = TIER_SPEC[TIERS[i]!];
      assert.ok(cur.size > prev.size, `ярус ${i}: локация не выросла`);
      assert.ok(cur.containers > prev.containers, `ярус ${i}: находок не прибавилось`);
      assert.ok(cur.risk >= prev.risk, `ярус ${i}: ставка не выросла`);
      assert.ok(cur.depthValue > prev.depthValue, `ярус ${i}: глубина не стала ценнее`);
    }
  });
});
