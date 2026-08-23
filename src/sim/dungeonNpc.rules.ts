/**
 * Правила мирной жизни скелетов в подземелье.
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { generateLocation } from './generate';
import {
  DUNGEON_NPC_MIN_WAIT,
  DUNGEON_NPC_TEXT,
  dungeonNpcAt,
  stepDungeonNpcs,
} from './dungeonNpc';
import { createRaid } from './raid';
import { idx } from './grid';
import type { RaidState } from './raid';
import type { Tier } from './types';

const SEEDS = [1, 2, 3, 7, 11, 42, 1337, 2718, 90210];
const TIERS: readonly Tier[] = [0, 1, 2, 3];

function skeletonPatrolRaid(): RaidState {
  for (const seed of SEEDS) {
    const raid = createRaid({ seed, tier: 2, kitchenLevel: 3, storageLevel: 2 });
    const patrols = raid.loc.enemyPatrols ?? [];
    if (patrols.length >= 2 && patrols.some((p) => p.legs.some((leg) => leg.length > 0))) return raid;
  }
  throw new Error('не нашлось вылазки с двумя скелетами на обходе');
}

describe('Подземелье: скелеты патрулируют и занимаются своим', () => {
  test('каждому скелету назначен обход со стоянками', () => {
    for (const tier of TIERS) {
      for (const seed of SEEDS) {
        const loc = generateLocation(seed, tier);
        const skeletons = loc.enemies.filter((e) =>
          e.kind === 'minion' || e.kind === 'warrior' || e.kind === 'mage');
        const patrols = loc.enemyPatrols ?? [];
        assert.equal(patrols.length, skeletons.length, `сид ${seed}, ярус ${tier}: не у всех есть обход`);
        for (const patrol of patrols) {
          assert.ok(patrol.legs.length >= 2, `сид ${seed}, ярус ${tier}: обход слишком короткий`);
          assert.ok(patrol.cycle > 8, `сид ${seed}, ярус ${tier}: обход не похож на дело`);
          assert.ok(
            patrol.legs.some((leg) => leg.wait >= DUNGEON_NPC_MIN_WAIT),
            `сид ${seed}, ярус ${tier}: скелет нигде не задерживается`,
          );
        }
      }
    }
  });

  test('обход ходит только по свободным клеткам', () => {
    for (const tier of TIERS) {
      for (const seed of SEEDS) {
        const loc = generateLocation(seed, tier);
        for (const patrol of loc.enemyPatrols ?? []) {
          const step = Math.max(0.35, 1 / patrol.speed);
          for (let t = 0; t < patrol.cycle; t += step) {
            const p = dungeonNpcAt(patrol, t);
            const x = Math.round(p.x);
            const z = Math.round(p.z);
            assert.equal(
              loc.blocked[idx(loc.size, x, z)],
              0,
              `сид ${seed}, ярус ${tier}: обход ${patrol.enemy} вошёл в стену ${x},${z}`,
            );
          }
        }
      }
    }
  });

  test('спящие скелеты двигаются, проснувшихся ведёт уже бой', () => {
    const raid = skeletonPatrolRaid();
    const patrols = raid.loc.enemyPatrols!;
    const moving = patrols.find((p) => p.legs.some((leg) => leg.length > 0))!;
    const sleeping = raid.loc.enemies.find((e) => e.id === moving.enemy)!;
    const awakePatrol = patrols.find((p) => p.enemy !== moving.enemy)!;
    const awake = raid.loc.enemies.find((e) => e.id === awakePatrol.enemy)!;
    awake.awake = true;
    const awakeAt = { x: awake.x, z: awake.z };
    raid.nextNpcLine = Infinity;

    let moved = false;
    for (let t = 0; t <= 30; t += 1) {
      raid.elapsed = t;
      stepDungeonNpcs(raid);
      moved ||= Math.hypot(sleeping.x - sleeping.prevX, sleeping.z - sleeping.prevZ) > 0.01;
    }

    assert.ok(moved, 'спящий скелет так и остался стоять');
    assert.deepEqual({ x: awake.x, z: awake.z }, awakeAt, 'проснувшегося скелета перехватил патруль');
  });

  test('скелеты иногда бурчат в HUD, но не спамят каждый тик', () => {
    const raid = skeletonPatrolRaid();
    raid.vision = 99;
    raid.nextNpcLine = 0;
    raid.events.length = 0;

    stepDungeonNpcs(raid);
    assert.equal(raid.events.length, 1, 'рядом не прозвучала реплика скелета');
    const lines: readonly string[] = Object.values(DUNGEON_NPC_TEXT);
    assert.ok(
      lines.includes(raid.events[0]!),
      `неизвестная реплика: ${raid.events[0]}`,
    );

    const next = raid.nextNpcLine;
    raid.events.length = 0;
    stepDungeonNpcs(raid);
    assert.equal(raid.events.length, 0, 'реплика повторилась без паузы');
    assert.equal(raid.nextNpcLine, next, 'таймер реплики сдвинулся раньше срока');
  });
});
