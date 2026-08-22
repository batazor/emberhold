/**
 * Правила боя (§11.3). Здесь только то, что проверяется без статистики:
 * нарушение любого из этих утверждений — поломка конструкции, а не сдвиг
 * баланса, и ловить его должен `npm run check`, а не замер.
 *
 * Числа боя живут в `scripts/combat.ts` и `npm run measure`. Разделение
 * намеренное: тест, знающий конкретное число, краснеет на каждой настройке
 * и потому перестаёт что-либо охранять.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TIER_ENEMY_LEVEL, TIER_HERO_LEVEL, TIER_ROSTER } from './balance';
import { MIN_DAMAGE } from './config';
import { ENEMY_STATS, enemyStats } from './enemies';
import { CLASS_ORDER, HERO_CLASSES, createHero, loadout, referenceLoadout } from './heroes';
import { damageOf } from './raid';
import type { EnemyKind, Tier } from './types';

const KINDS = Object.keys(ENEMY_STATS) as EnemyKind[];
/** Заведомо больше всего, что может дать класс со снаряжением пятого уровня. */
const ABSURD_DEFENSE = 1000;

describe('Бой: модель', () => {
  test('§11.3 — неуязвимости не существует ни при какой Защите', () => {
    // Смысл MIN_DAMAGE: «набрать Защиту и перестать получать урон» невозможно
    // по построению. Без правила бой выбыл бы из причин провала не настройкой,
    // а конструкцией — и §11.3 сломался бы молча.
    for (const kind of KINDS) {
      const { attack, name } = ENEMY_STATS[kind];
      assert.ok(
        damageOf(attack, ABSURD_DEFENSE) >= MIN_DAMAGE,
        `${name}: при Защите ${ABSURD_DEFENSE} удар перестал стоить хоть чего-то`,
      );
    }
    assert.ok(MIN_DAMAGE > 0, 'нижняя граница урона нулевой быть не может');
  });

  test('§11.3 — Защита не увеличивает урон и смягчает его плавно', () => {
    // Монотонность: больше Защиты — не больше урона. Перепутанный max
    // превратил бы броню в проклятие незаметно.
    //
    // И плавность: со шкалой Защита обязана работать на любом шаге, а не
    // порогами. Ровно этого не умели целые раны — там любая Защита давала
    // ровно одну рану, и характеристика не делала ничего.
    for (const kind of KINDS) {
      const { attack, name } = ENEMY_STATS[kind];
      let prev = damageOf(attack, 0);
      let moved = false;
      for (let d = 1; d <= 24; d++) {
        const now = damageOf(attack, d);
        assert.ok(now <= prev, `${name}: Защита ${d} стоит дороже, чем ${d - 1}`);
        if (now < prev) moved = true;
        prev = now;
      }
      assert.ok(moved, `${name}: Защита не изменила урон ни на одном значении`);
    }
  });

  test('§11.3 — каждый класс убивает каждого противника за конечное время', () => {
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
    for (const kind of KINDS) {
      const { reach, name } = ENEMY_STATS[kind];
      assert.ok(reach > 0, `${name}: нулевая досягаемость`);
    }
  });

  test('§22.6 — уровень в уровень: модельный герой яруса добивает его тела', () => {
    // Лестница уровней обязана оставлять §15 в силе: «пробиться» — вариант
    // на каждом ярусе, а не только «обойти». Проверяется конструкция,
    // а не баланс: конечные удары в обе стороны, ни одна не бьёт насмерть
    // с одного раза.
    for (const [key, roster] of Object.entries(TIER_ROSTER)) {
      const tier = Number(key) as Tier;
      const hero = referenceLoadout(TIER_HERO_LEVEL[tier]);
      for (const kind of new Set(roster)) {
        const foe = enemyStats(kind, TIER_ENEMY_LEVEL[tier]);
        const hits = Math.ceil(foe.hp / hero.attack);
        assert.ok(
          Number.isFinite(hits) && hits > 0 && hits <= 12,
          `ярус ${tier}, ${foe.name}: ${hits} ударов — бой не кончается`,
        );
        const bite = Math.max(MIN_DAMAGE, foe.attack * 0.35, foe.attack - hero.defense / 2);
        assert.ok(
          bite < 20,
          `ярус ${tier}, ${foe.name}: удар ${bite} — модельный герой падает с одного`,
        );
      }
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
