/**
 * Правила подарка за вход (§29). Живут рядом с daily.ts: механика приносит
 * свои правила с собой.
 *
 * Главное здесь — не то, что подарок выдаётся, а то, что он **не обгоняет
 * игру**: гарантия §29.1 проверяется на округлённых числах, тем же приёмом,
 * которым §20.3.3 сторожит слой округления. Модель, проверенная до
 * округления, отменяется косметикой молча — это уже случилось однажды
 * со Складом.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TIER_HAUL } from './balance';
import {
  CYCLE_WEEK,
  DAY_WEIGHT,
  ROOKIE_WEEK,
  WEEK,
  WEEK_BUDGET_SHARE,
  claimBlock,
  claimed,
  dayOf,
  emptyDaily,
  giftAt,
  giftLoot,
  rookie,
  weekAt,
  weekOf,
} from './daily';
import { totalOf } from './resources';
import type { Tier } from './types';

const TIERS: readonly Tier[] = [0, 1, 2, 3];

/**
 * Сколько всего штук выдаёт неделя на этом ярусе — по округлённым числам.
 * `from` — номер подарка, с которого неделя начинается: первая идёт с нуля,
 * повторяющийся круг — с седьмого.
 */
function weekTotal(from: number, tier: Tier): number {
  let sum = 0;
  for (let day = 0; day < WEEK; day++) {
    const taken = from + day;
    const loot = giftLoot(giftAt(taken), tier, taken);
    sum += totalOf({ stone: 0, wood: 0, iron: 0, crystal: 0, food: 0, ...loot });
  }
  return sum;
}

describe('подарок за вход', () => {
  test('в круге и в первой неделе ровно по семь дней', () => {
    assert.equal(ROOKIE_WEEK.length, WEEK);
    assert.equal(CYCLE_WEEK.length, WEEK);
    assert.equal(DAY_WEIGHT.length, WEEK);
  });

  test('веса дней растут к седьмому и в сумме дают число дней', () => {
    for (let i = 1; i < DAY_WEIGHT.length; i++) {
      assert.ok(
        DAY_WEIGHT[i]! >= DAY_WEIGHT[i - 1]!,
        `день ${i + 1} легче предыдущего — круг обязан расти к концу`,
      );
    }
    const sum = DAY_WEIGHT.reduce((a, b) => a + b, 0);
    assert.ok(
      Math.abs(sum - WEEK) < 1e-9,
      `сумма весов ${sum.toFixed(2)} вместо ${WEEK}: доля вылазки перестала читаться средним днём`,
    );
  });

  test('неделя подарков не больше 70% недели самого редкого игрока', () => {
    // Гарантия §29.1 целиком: одна вылазка в день — это семь добыч в неделю.
    // Проверяется на округлённом, а не на модельном: округление вверх уже
    // однажды отменило гарантию Склада (§20.3.3).
    for (const tier of TIERS) {
      const gifts = weekTotal(WEEK, tier);
      const played = WEEK * TIER_HAUL[tier];
      assert.ok(
        gifts <= played * WEEK_BUDGET_SHARE,
        `ярус ${tier}: неделя подарков ${gifts.toFixed(1)} против ${(played * WEEK_BUDGET_SHARE).toFixed(1)} — ` +
          'подарок обгоняет игру у того, кто играет меньше всех',
      );
    }
  });

  test('ни один день не больше одной вылазки', () => {
    // Следствие весов, но проверяется отдельно: вес правят руками, а это
    // та граница, за которой вход выгоднее захода.
    for (const tier of TIERS) {
      for (let day = 0; day < WEEK; day++) {
        const loot = giftLoot(giftAt(WEEK + day), tier, day);
        const sum = totalOf({ stone: 0, wood: 0, iron: 0, crystal: 0, food: 0, ...loot });
        assert.ok(
          sum <= TIER_HAUL[tier],
          `ярус ${tier}, день ${day + 1}: ${sum} против добычи вылазки ${TIER_HAUL[tier]}`,
        );
      }
    }
  });

  test('кристалла в подарке нет ни в одном дне ни на одном ярусе', () => {
    // §13: на кристалле держится вся конструкция глубины. Капающий
    // кристалл отменяет причину спускаться, и замер добычи этого не увидит.
    for (const tier of TIERS) {
      for (let taken = 0; taken < WEEK * 4; taken++) {
        const loot = giftLoot(giftAt(taken), tier, taken);
        assert.equal(
          loot.crystal,
          undefined,
          `ярус ${tier}, подарок ${taken + 1} даёт кристалл — глубина обесценена`,
        );
      }
    }
  });

  test('пустых дней не бывает: округление вниз не съедает подарок', () => {
    for (const tier of TIERS) {
      for (let taken = 0; taken < WEEK * 2; taken++) {
        const gift = giftAt(taken);
        if (gift.kinds.length === 0) continue;
        const loot = giftLoot(gift, tier, taken);
        for (const kind of gift.kinds) {
          assert.ok(
            (loot[kind] ?? 0) >= 1,
            `ярус ${tier}, подарок ${taken + 1}: ${kind} округлился в ноль`,
          );
        }
      }
    }
  });

  test('вещи и люди выдаются только в первой неделе', () => {
    // §29.2 — повторяется расходуемое. Сундук, выдаваемый каждую неделю,
    // это вторая кладовая, растущая сама по себе.
    assert.deepEqual(
      CYCLE_WEEK.filter((g) => g.id !== 'ресурсы'),
      [],
      'в повторяющемся круге завелась вещь — она будет выдаваться бесконечно',
    );
    const once = ROOKIE_WEEK.filter((g) => g.id !== 'ресурсы').map((g) => g.id);
    assert.deepEqual(once, ['сундук', 'стрелы', 'встреча']);
  });

  test('круг считается подарками, а не календарём', () => {
    // Пропущенный день ничего не сжигает: седьмой достанется тому, кто
    // пришёл семь раз, за сколько бы недель он это ни сделал.
    let state = emptyDaily();
    const days = [10, 11, 40, 41, 90, 91, 200];
    for (const day of days) {
      assert.equal(claimBlock(state, day), 'ok');
      state = claimed(state, day);
    }
    assert.equal(state.taken, WEEK);
    assert.equal(rookie(state.taken), false, 'первая неделя не кончилась после семи подарков');
    assert.equal(weekOf(state.taken), 2);
    assert.equal(dayOf(state.taken), 0);
    assert.equal(weekAt(state.taken), CYCLE_WEEK);
  });

  test('второй подарок в тот же день не берётся', () => {
    let state = claimed(emptyDaily(), 100);
    assert.equal(claimBlock(state, 100), 'today');
    assert.equal(claimBlock(state, 101), 'ok');
    state = claimed(state, 101);
    assert.equal(state.taken, 2);
  });

  test('пустой отметки хватает, чтобы взять подарок в первый же день', () => {
    // День −1 — не «вчера», а «никогда»: нулевой день эпохи существует,
    // и совпадение с ним заперло бы первый подарок у того, кто пришёл
    // 1 января 1970 года. Дешевле проверить, чем объяснять.
    assert.equal(claimBlock(emptyDaily(), 0), 'ok');
    assert.equal(giftAt(emptyDaily().taken), ROOKIE_WEEK[0]);
  });
});
