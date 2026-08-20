/**
 * Правила озвучки вылазки. Проверяются не тембры — их слушают в `audioart.html`, —
 * а порядок §18.3: что звучит на одно изменение состояния и что при этом
 * молчит. Ухо получает подставной приёмник и отдаёт список имён.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createRaid } from '../../sim/raid';
import type { RaidState } from '../../sim/raid';
import { createRaidEar } from './index';
import type { RaidEar, Sink } from './index';

/** Ухо и лента прозвучавшего: тест читает её как расшифровку. */
function listen(state: RaidState): { ear: RaidEar; heard: string[]; share: number[] } {
  const heard: string[] = [];
  const share: number[] = [];
  const sink: Sink = {
    play: (name) => heard.push(name),
    setFoodShare: (value) => share.push(value),
  };
  const ear = createRaidEar(sink);
  ear.reset(state);
  return { ear, heard, share };
}

const raidWithEnemies = (): RaidState => {
  const raid = createRaid({ seed: 5, tier: 2, kitchenLevel: 3, storageLevel: 2 });
  assert.ok(raid.loc.enemies.length >= 2, 'ярус 2 без противников — тест не о том');
  return raid;
};

describe('Звук вылазки (§18.3)', () => {
  test('без изменений не звучит ничего — ухо озвучивает разницу, а не состояние', () => {
    const raid = raidWithEnemies();
    const { ear, heard } = listen(raid);
    ear.hear(raid);
    ear.hear(raid);
    assert.deepEqual(heard, []);
  });

  test('reset глотает разницу: вход в вылазку не звучит прошлой', () => {
    const raid = raidWithEnemies();
    const { ear, heard } = listen(raid);
    raid.steps += 40;
    raid.bagTotal += 9;
    ear.reset(raid); // так main входит в локацию
    ear.hear(raid);
    assert.deepEqual(heard, [], 'накопленное до входа прозвучало');
  });

  test('шаг звучит на каждый шаг и ни разу сверх', () => {
    const raid = raidWithEnemies();
    const { ear, heard } = listen(raid);
    raid.steps += 1;
    ear.hear(raid);
    ear.hear(raid);
    assert.deepEqual(heard, ['step']);
  });

  test('замах слышен по прыжку отката вверх, а не по попаданию', () => {
    const raid = raidWithEnemies();
    const { ear, heard } = listen(raid);
    raid.hero.cooldown += 0.5;
    ear.hear(raid);
    assert.deepEqual(heard, ['swing']);
    // Откат тикает вниз между ударами — это не второй замах.
    raid.hero.cooldown -= 0.2;
    ear.hear(raid);
    assert.deepEqual(heard, ['swing']);
  });

  test('последний удар звучит смертью, а не смертью поверх попадания', () => {
    const raid = raidWithEnemies();
    const victim = raid.loc.enemies[0]!;
    victim.wounds = 1;
    const { ear, heard } = listen(raid);
    victim.wounds = 0;
    ear.hear(raid);
    assert.deepEqual(heard, ['kill'], 'смерть прозвучала вместе с попаданием');
  });

  test('попадание по живому звучит попаданием', () => {
    const raid = raidWithEnemies();
    const victim = raid.loc.enemies[0]!;
    victim.wounds = 3;
    const { ear, heard } = listen(raid);
    victim.wounds = 2;
    ear.hear(raid);
    assert.deepEqual(heard, ['hit']);
  });

  test('мёртвый не звучит второй раз при следующем попадании', () => {
    const raid = raidWithEnemies();
    const dead = raid.loc.enemies[0]!;
    const other = raid.loc.enemies[1]!;
    dead.wounds = 1;
    other.wounds = 3;
    const { ear, heard } = listen(raid);
    dead.wounds = 0;
    ear.hear(raid);
    other.wounds = 2;
    ear.hear(raid);
    assert.deepEqual(heard, ['kill', 'hit']);
  });

  test('рана героя звучит, лечение — нет', () => {
    const raid = raidWithEnemies();
    const { ear, heard } = listen(raid);
    raid.hero.wounds -= 1;
    ear.hear(raid);
    raid.hero.wounds += 1;
    ear.hear(raid);
    assert.deepEqual(heard, ['wound']);
  });

  test('расход провианта тикает по десятым, а не по единицам', () => {
    const raid = raidWithEnemies();
    const { ear, heard } = listen(raid);
    // Девятая часть запаса — ещё не десятая.
    raid.food = raid.foodMax - Math.floor(raid.foodMax / 10) + 1;
    ear.hear(raid);
    assert.deepEqual(heard, [], 'тик прозвучал раньше десятой');
    raid.food = raid.foodMax - Math.ceil(raid.foodMax / 10);
    ear.hear(raid);
    assert.deepEqual(heard, ['tick']);
  });

  test('исход звучит один раз, и «идёт» не звучит вовсе', () => {
    for (const [status, sound] of [
      ['evacuated', 'evac'],
      ['failed', 'fail'],
    ] as const) {
      const raid = raidWithEnemies();
      const { ear, heard } = listen(raid);
      raid.status = status;
      ear.hear(raid);
      ear.hear(raid);
      assert.deepEqual(heard, [sound]);
      raid.status = 'running';
      ear.hear(raid);
      assert.deepEqual(heard, [sound], '«идёт» прозвучало');
    }
  });

  test('доля провианта уходит в пульс каждый тик и не бывает отрицательной', () => {
    const raid = raidWithEnemies();
    const { ear, share } = listen(raid);
    ear.hear(raid);
    assert.equal(share.at(-1), 1);
    raid.food = raid.foodMax / 2;
    ear.hear(raid);
    assert.equal(share.at(-1), 0.5);
    // Голод уводит запас ниже нуля (§11.1) — пульсу от этого ускоряться некуда.
    raid.food = -5;
    ear.hear(raid);
    assert.equal(share.at(-1), 0);
  });
});
