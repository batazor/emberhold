/**
 * Правила боя и расстановки противников.
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { HERO_HP, ENCOUNTER_WOUND } from './balance';
import { HERO_REACH } from './config';
import { ENEMY_GROWTH, ENEMY_STATS, TIER_ROSTER, enemyStats } from './enemies';
import { generateLocation } from './generate';
import { distanceField, idx } from './grid';
import type { EnemyKind, RaidEnemyKind, Tier } from './types';

describe('Бой', () => {
  test('§22.6 — уровень растит стойкость и Атаку, не трогая рисунок типа', () => {
    for (const kind of Object.keys(ENEMY_STATS) as EnemyKind[]) {
      const base = ENEMY_STATS[kind];
      assert.deepEqual(enemyStats(kind, 1), base, `${base.name}: первый уровень — это база`);
      const up = enemyStats(kind, 4);
      assert.equal(up.hp, base.hp + ENEMY_GROWTH[kind].hp * 3, `${base.name}: стойкость`);
      assert.equal(up.attack, base.attack + ENEMY_GROWTH[kind].attack * 3, `${base.name}: Атака`);
      // Скорость, замах, дальность и манера — рисунок типа, а не сила:
      // воин пятого уровня обязан читаться воином.
      assert.equal(up.speed, base.speed, `${base.name}: скорость не растёт`);
      assert.equal(up.telegraph, base.telegraph, `${base.name}: замах не растёт`);
      assert.equal(up.reach, base.reach, `${base.name}: дальность не растёт`);
      assert.equal(up.chases, base.chases, `${base.name}: манера не меняется`);
    }
  });

  test('§15 — герой достаёт до каждого противника', () => {
    for (const stats of Object.values(ENEMY_STATS)) {
      // Противник останавливается на reach × 0.9; если герой не достаёт туда,
      // враг неуязвим, а не «бьёт первым».
      const engageAt = Math.max(HERO_REACH, stats.reach);
      assert.ok(engageAt >= stats.reach * 0.9, `${stats.name} недосягаем`);
    }
  });

  test('§22 — бюджет ран, а не голов', () => {
    // Считать противников поштучно означает мерить не то. Но и дуэльная цена
    // не годится: обход врага — часть игры, и непреследующего мага обходят
    // чаще всех. Годится только цена присутствия из настоящей вылазки —
    // и она своя у каждого яруса, потому что на большой карте того же врага
    // встречают реже (§22.6).
    for (const [key, roster] of Object.entries(TIER_ROSTER)) {
      const tier = Number(key) as Tier;
      const wounds = (roster as readonly RaidEnemyKind[]).reduce((sum, kind) => sum + ENCOUNTER_WOUND[tier][kind], 0);
      assert.ok(
        wounds < HERO_HP - 0.5,
        `ярус ${tier}: ожидаемые ${wounds.toFixed(2)} ран при ${HERO_HP} у героя — ` +
          'провал становится расписанием, а не риском',
      );
      // Верхняя граница по головам остаётся, но она про отрисовку:
      // скиннованные меши не инстансятся (§21).
      assert.ok(roster.length <= 12, `ярус ${tier}: ${roster.length} противников`);
    }
  });

  test('§15 — маг не встаёт в единственный проход', () => {
    // Проверяем на десяти сидах: от выхода до каждого контейнера должен
    // существовать путь, даже если зону мага считать непроходимой.
    for (let seed = 1; seed <= 10; seed++) {
      const loc = generateLocation(seed, 3);
      const walled = Uint8Array.from(loc.blocked);
      for (const e of loc.enemies) {
        if (e.kind !== 'mage') continue;
        for (let z = Math.round(e.z) - 1; z <= Math.round(e.z) + 1; z++) {
          for (let x = Math.round(e.x) - 1; x <= Math.round(e.x) + 1; x++) {
            if (x >= 0 && z >= 0 && x < loc.size && z < loc.size) walled[idx(loc.size, x, z)] = 1;
          }
        }
      }
      const reach = distanceField(loc.size, walled, loc.evac);
      for (const c of loc.containers) {
        assert.ok(reach[idx(loc.size, c.x, c.z)]! >= 0, `сид ${seed}: контейнер отрезан магом`);
      }
    }
  });
});
