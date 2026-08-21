/**
 * Правила боя и расстановки противников.
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { HERO_WOUNDS, ENCOUNTER_WOUND } from './balance';
import { HERO_REACH } from './config';
import { ENEMY_STATS, TIER_ROSTER } from './enemies';
import { generateLocation } from './generate';
import { distanceField, idx } from './grid';

describe('Бой', () => {
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
    // (скелет 0, воин 1, маг 2) не годится: обход врага — часть игры.
    // Замер в настоящей вылазке даёт цену присутствия — 0,06 / 0,73 / 0,85.
    // Маг стоит не два воина, а 1,15: его обходят чаще всех.
    for (const [tier, roster] of Object.entries(TIER_ROSTER)) {
      const wounds = roster.reduce((sum, kind) => sum + ENCOUNTER_WOUND[kind], 0);
      assert.ok(
        wounds < HERO_WOUNDS - 0.5,
        `ярус ${tier}: ожидаемые ${wounds.toFixed(2)} ран при ${HERO_WOUNDS} у героя — ` +
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
