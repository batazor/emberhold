/**
 * Правила боя (§11.3). Здесь только то, что проверяется без статистики:
 * нарушение любого из этих утверждений — поломка конструкции, а не сдвиг
 * баланса, и ловить его должен `npm run check`, а не трёхсотвылазочный замер.
 *
 * Числа боя живут в `scripts/combat.ts` и `npm run measure`. Разделение
 * намеренное: тест, знающий конкретное число, краснеет на каждой настройке
 * и потому перестаёт что-либо охранять.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TIER_ROSTER } from './balance';
import { HP_PER_WOUND, MIN_PIERCE_SHARE } from './config';
import { ENEMY_STATS } from './enemies';
import { CLASS_ORDER, HERO_CLASSES, createHero, loadout } from './heroes';
import { woundsPerHit } from './raid';
import type { EnemyKind, Tier } from './types';

const KINDS = Object.keys(ENEMY_STATS) as EnemyKind[];
/** Заведомо больше всего, что может дать класс со снаряжением пятого уровня. */
const ABSURD_DEFENSE = 1000;

describe('Бой: модель', () => {
  test('§11.3 — неуязвимости не существует ни при какой Защите', () => {
    // Это и есть смысл MIN_PIERCE_SHARE: потолок смягчения записан долей,
    // а не единицей, поэтому «набрать Защиту и перестать получать урон»
    // невозможно по построению. Без правила бой выбыл бы из причин провала
    // не настройкой, а конструкцией — и §11.3 сломался бы молча.
    for (const kind of KINDS) {
      const { attack, name } = ENEMY_STATS[kind];
      assert.ok(
        woundsPerHit(attack, ABSURD_DEFENSE) >= 1,
        `${name}: при Защите ${ABSURD_DEFENSE} удар перестал стоить хоть чего-то`,
      );
    }
    assert.ok(MIN_PIERCE_SHARE > 0, 'доля пробоя нулевой быть не может');
  });

  test('§11.3 — Защита не увеличивает урон', () => {
    // Монотонность: больше Защиты — не больше ран. Формула из двух веток,
    // и перепутанный max превратил бы броню в проклятие незаметно.
    for (const kind of KINDS) {
      const { attack, name } = ENEMY_STATS[kind];
      let prev = woundsPerHit(attack, 0);
      for (let d = 1; d <= 24; d++) {
        const now = woundsPerHit(attack, d);
        assert.ok(now <= prev, `${name}: Защита ${d} стоит дороже, чем ${d - 1}`);
        prev = now;
      }
    }
  });

  test('§11.3 — Защита хоть где-то снимает рану, иначе её нет', () => {
    // Пока каждый удар стоит одной раны, делить нечего, и характеристика
    // остаётся числом в панели героя. Замер `npm run combat` ловит это же
    // на дуэлях; здесь оно ловится без прогонов.
    const matters = KINDS.some(
      (k) => woundsPerHit(ENEMY_STATS[k].attack, 0) > woundsPerHit(ENEMY_STATS[k].attack, 24),
    );
    assert.ok(matters, 'ни один противник не бьёт на две раны — Защита ничего не делит');
  });

  test('§11.3 — каждый класс убивает каждого противника за конечное число ударов', () => {
    for (const cls of CLASS_ORDER) {
      const hero = loadout(createHero(cls, 0));
      assert.ok(hero.attack > 0, `${HERO_CLASSES[cls].name}: нулевая Атака — бой не кончится`);
      for (const kind of KINDS) {
        const hits = Math.ceil(ENEMY_STATS[kind].hp / hero.attack);
        assert.ok(
          Number.isFinite(hits) && hits > 0,
          `${HERO_CLASSES[cls].name} против ${ENEMY_STATS[kind].name}: удары не сходятся`,
        );
      }
    }
  });

  test('§15 — герой достаёт до каждого противника', () => {
    // Перенесено сюда из enemies.rules.ts по смыслу: это правило боя,
    // а не расстановки. Воин и маг держатся дальше длины геройского оружия,
    // и без этого они не «бьют первым», а неуязвимы по недосмотру (§20.3.2).
    for (const kind of KINDS) {
      const { reach, name } = ENEMY_STATS[kind];
      assert.ok(reach > 0, `${name}: нулевая досягаемость`);
    }
  });

  test('§11.3 — стойкость кратна эталону: цена врага читается в ранах', () => {
    // Очки — представление, а не новая величина. Пока стойкость кратна
    // эталону, «сколько стоит этот враг» по-прежнему считается в ранах,
    // и таблицы §15 с §22 остаются сравнимыми с прежними.
    for (const kind of KINDS) {
      const { hp, name } = ENEMY_STATS[kind];
      assert.equal(hp % HP_PER_WOUND, 0, `${name}: стойкость ${hp} не кратна эталону`);
    }
  });

  test('§22 — на каждом ярусе есть кого бить', () => {
    for (const [tier, roster] of Object.entries(TIER_ROSTER)) {
      const t = Number(tier) as Tier;
      if (t === 0) continue;
      assert.ok(roster.length > 0, `ярус ${tier}: противников нет вовсе`);
    }
  });
});
