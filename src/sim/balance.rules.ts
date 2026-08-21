/**
 * Правила модели баланса. Это не проверки чисел, а проверки инвариантов:
 * утверждения, верные для любого TIER_SPEC, а не для одного примера.
 * Новый ярус или новая ось сложности не требуют новых проверок.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_ENEMIES, TIER_KITCHEN_GATE, TIER_SPEC, deriveTier } from './balance';
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

  /**
   * §15 — состав врагов, а не только описание сложности.
   *
   * Проверка ниже («сложность растёт по ярусам») смотрит на `TIER_SPEC`,
   * и все её утверждения оставались истинными, пока лестница ярусов была
   * сломана: размер рос, ставка росла, находки прибавлялись — а на ярусе 2
   * стояли три воина, и он выходил вдвое тяжелее третьего. Описание росло
   * монотонно, состав — нет, и между ними не было ни одного правила.
   */
  test('§15 — противников не больше четырёх на локацию', () => {
    for (const tier of TIERS) {
      const { roster } = deriveTier(TIER_SPEC[tier]);
      assert.ok(
        roster.length <= MAX_ENEMIES,
        `ярус ${tier}: ${roster.length} противников — пятый делает провал в бою нормой`,
      );
    }
  });

  test('§15 — ведущий тип на ярусе один, и скелеты при нём есть всегда', () => {
    /**
     * Здесь стояло «ведущий один» — прочтение §15 строже, чем он написан.
     * Раздел раздаёт ярусам **тип**, а не поголовье: «Скелет-воин — ярус 2»,
     * «Скелет-маг — ярус 3». Сколько их — вопрос бюджета ран, и это
     * единственное, на что бюджет тратится: скелет ран не стоит вовсе.
     * Со «строго одним» ось ω из §22.1 не двигала ничего, и верхний ярус
     * сел на 95% успеха при обещанных разделом тридцати.
     *
     * Что осталось от прежней проверки и почему: **двух разных ведущих
     * на ярусе не бывает** — это и есть «свой тип у каждого яруса», —
     * и скелеты не исчезают. Именно исчезновение скелетов ломало ярус 2:
     * три воина без единого скелета, все провалы яруса от воина.
     */
    for (const tier of TIERS) {
      const { roster } = deriveTier(TIER_SPEC[tier]);
      const leads = new Set(roster.filter((k) => k !== 'minion'));
      assert.ok(
        leads.size <= 1,
        `ярус ${tier}: ведущих типов ${leads.size} (${[...leads].join(', ')}) — раздел даёт один`,
      );
      if (leads.size > 0) {
        assert.ok(
          roster.includes('minion'),
          `ярус ${tier}: ведущие вытеснили скелетов целиком — ${roster.join(', ')}`,
        );
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
