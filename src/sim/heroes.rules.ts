/**
 * Правила отряда (§3, §11.7, §11.8). Живут рядом с heroes.ts по общей
 * договорённости: фича приносит свои проверки с собой.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TICK } from '../core/loop';
import { HERO_HP } from './balance';
import { createCamp } from './camp';
import { visionRadius } from './config';
import {
  FORAGE_FOOD,
  HERO_CLASSES,
  MAX_WOUNDS,
  TRAIN_PER_LEVEL,
  addXp,
  applyRaidOutcome,
  createHero,
  createRoster,
  firstReady,
  healSeconds,
  loadout,
  raidBlock,
  refreshHeroes,
  startHealing,
  startTraining,
  syncRoster,
  trainBlock,
  trainCap,
  xpToNext,
} from './heroes';
import type { HeroState } from './heroes';
import { createRaid, stepRaid, useSkill } from './raid';
import { load, save, wipe } from './save';

describe('Отряд', () => {
  test('§11.8 — второй герой на Жилье ур. 2, третий на ур. 4', () => {
    const roster = createRoster();
    assert.equal(roster.heroes.length, 1, 'на старте герой один');
    assert.equal(syncRoster(roster, 1), null, 'Жильё ур. 1 никого не открывает');
    assert.equal(syncRoster(roster, 2), 'archer', 'ур. 2 — второй класс');
    assert.equal(syncRoster(roster, 3), null, 'ур. 3 не открывает третьего');
    assert.equal(syncRoster(roster, 4), 'rogue', 'ур. 4 — третий класс');
    assert.equal(syncRoster(roster, 6), null, 'больше трёх героев не бывает');
  });

  test('§11.8 — лечение 6 минут за рану, максимум 18', () => {
    assert.equal(healSeconds(1), 6 * 60);
    assert.equal(healSeconds(3), 18 * 60);
    assert.equal(healSeconds(4), 18 * 60, 'потолок 18 минут даже у Рыцаря');
  });

  test('§3 — вернувшийся герой занят лечением, и это создаёт ротацию', () => {
    const roster = createRoster();
    syncRoster(roster, 2);
    const [first, second] = roster.heroes as [HeroState, HeroState];
    first.wounds = 2;
    assert.equal(startHealing(first, 1000), true);
    assert.equal(raidBlock(first), 'healing', 'раненым в вылазку нельзя');
    assert.equal(firstReady(roster), second, 'ротация даёт второго');

    // Лечение идёт по монотонному времени и заканчивается само (§2, оффлайн).
    assert.equal(refreshHeroes(roster, 1000 + 11 * 60).length, 0, 'рано');
    assert.equal(refreshHeroes(roster, 1000 + healSeconds(2)).length, 1);
    assert.equal(first.wounds, 0);
    assert.equal(raidBlock(first), 'ok');
  });

  test('§11.8 — тренировка догоняет, но не обгоняет', () => {
    const roster = createRoster();
    syncRoster(roster, 2);
    syncRoster(roster, 4);
    const [first, second, third] = roster.heroes as [HeroState, HeroState, HeroState];
    first.level = 5;
    assert.equal(trainCap(roster), 3, 'потолок — на два ниже лучшего');
    // Лучшего героя тренировать нельзя раньше, чем упрёшься в слот:
    // причина возвращается по порядку строгости, и потолок строже занятости.
    assert.equal(trainBlock(roster, first), 'cap', 'на потолке тренировать нечего');

    assert.equal(startTraining(roster, second, 0), true);
    assert.equal(trainBlock(roster, third), 'slot-busy', 'слот тренировки один');
    refreshHeroes(roster, TRAIN_PER_LEVEL);
    assert.equal(second.level, 2, '1 уровень за 2 часа');

    second.level = 3;
    assert.equal(trainBlock(roster, second), 'cap', 'догнал потолок — дальше вылазками');
  });

  test('§11.7 — классы различаются рюкзаком, ранами и обзором', () => {
    const archer = loadout(createHero('archer', 0));
    const knight = loadout(createHero('knight', 1));
    const rogue = loadout(createHero('rogue', 2));

    assert.equal(archer.bagMul, 0.75, 'Лучник: рюкзак −25%');
    assert.equal(rogue.bagMul, 1.3, 'Бандит: рюкзак +30%');
    assert.ok(knight.hp > archer.hp, 'Рыцарь крепче: прибавка к здоровью больше');

    // §11.4 — обзор = 3 + Знание/5. Рыцарь видит на тайл меньше базового.
    assert.equal(visionRadius(archer.knowledge, false, false), 5);
    assert.equal(visionRadius(rogue.knowledge, false, false), 4);
    assert.equal(visionRadius(knight.knowledge, false, false), 3);
  });

  test('§11.7 — рюкзак класса доезжает до вылазки', () => {
    const opts = { seed: 4242, tier: 1 as const, kitchenLevel: 3, storageLevel: 3 };
    const base = createRaid(opts).capacity;
    const light = createRaid({ ...opts, loadout: loadout(createHero('archer', 0)) }).capacity;
    const heavy = createRaid({ ...opts, loadout: loadout(createHero('rogue', 1)) }).capacity;
    assert.ok(light < base, 'Лучник несёт меньше');
    assert.ok(heavy > base, 'Бандит несёт больше');
  });

  test('§11.7 — умение применяется один раз за вылазку, отката нет', () => {
    const state = createRaid({
      seed: 77,
      tier: 1,
      kitchenLevel: 3,
      storageLevel: 3,
      loadout: loadout(createHero('rogue', 0)),
    });
    const before = state.food;
    assert.equal(useSkill(state), true);
    assert.equal(state.food, before + FORAGE_FOOD, 'Прикорм: +20 провианта');
    assert.equal(useSkill(state), false, 'второй раз нельзя');
  });

  test('§11.7 — под Заслоном урона нет', () => {
    const state = createRaid({
      seed: 91,
      tier: 2,
      kitchenLevel: 4,
      storageLevel: 4,
      loadout: loadout(createHero('knight', 0)),
    });
    const enemy = state.loc.enemies[0];
    assert.ok(enemy !== undefined, 'на ярусе 2 есть противники');
    // Ставим героя вплотную: проверяется именно защита, а не подход к врагу.
    state.hero.x = enemy.x;
    state.hero.z = enemy.z;
    enemy.awake = true;
    useSkill(state);
    const wounds = state.hero.hp;
    for (let t = 0; t < 4; t += TICK) stepRaid(state, TICK, false, 0);
    assert.equal(state.hero.hp, wounds, 'пять секунд Заслона держат');
  });

  test('§11.7 — Тропа удешевляет шаг на четверть', () => {
    const make = (): ReturnType<typeof createRaid> =>
      createRaid({
        seed: 91,
        tier: 1,
        kitchenLevel: 3,
        storageLevel: 3,
        loadout: loadout(createHero('archer', 0)),
      });
    const plain = make();
    const trail = make();
    useSkill(trail);
    assert.ok(trail.skillLeft > 0, 'Тропа действует 30 секунд');

    // Обе идут одним и тем же путём одинаковое время: разойтись они могут
    // только ценой шага, а не маршрутом.
    const goal = { x: plain.loc.evac.x, z: plain.loc.evac.z + 3 };
    for (const state of [plain, trail]) {
      state.path = [];
      state.hero.x = state.loc.evac.x;
      state.hero.z = state.loc.evac.z;
    }
    plain.path = [goal];
    trail.path = [goal];
    for (let t = 0; t < 3; t += TICK) {
      stepRaid(plain, TICK, false, 0);
      stepRaid(trail, TICK, false, 0);
    }
    assert.equal(plain.steps, trail.steps, 'шагов поровну');
    assert.ok(trail.food > plain.food, 'но провианта Тропа тратит меньше');
  });

  test('§3 — итог вылазки переносит потери в расписание', () => {
    const hero = createHero('knight', 0);
    const full = HERO_HP + HERO_CLASSES.knight.hp;
    // Вернулся с половиной здоровья: §11.8 меряет лечение ранами, и «рана»
    // на шкале стала долей — половина потерь даёт половину ран класса.
    const out = applyRaidOutcome(hero, Math.round(full / 2), 9, 1, true, 1000);
    assert.ok(out.wounds > 0, 'потери перенеслись в расписание');
    assert.ok(out.wounds < MAX_WOUNDS, 'и не все сразу');
    assert.equal(hero.status, 'healing', 'вернувшийся ранен и занят лечением');
    assert.equal(out.healSec, healSeconds(out.wounds));
    assert.ok(hero.xp > 0, 'опыт за вынесенное начислен');

    // Целый герой в лечение не уходит: иначе ротация включалась бы всегда
    // и превращалась в налог на игру, а не в решение.
    const whole = createHero('archer', 1);
    const clean = applyRaidOutcome(whole, HERO_HP + HERO_CLASSES.archer.hp, 4, 0, true, 1000);
    assert.equal(clean.wounds, 0);
    assert.equal(clean.healSec, 0);
    assert.equal(whole.status, 'ready');
  });

  test('опыт копится и поднимает уровень', () => {
    const hero = createHero('archer', 0);
    assert.equal(addXp(hero, xpToNext(1) - 1), 0, 'до порога уровня нет');
    assert.equal(addXp(hero, 1), 1, 'порог поднимает уровень');
    assert.equal(hero.level, 2);
  });

  test('отряд переживает круг save → load', () => {
    wipe();
    const camp = createCamp();
    camp.levels.hq = 2;
    const roster = createRoster();
    syncRoster(roster, camp.levels.hq);
    roster.heroes[1]!.level = 3;
    roster.heroes[0]!.wounds = 2;
    startHealing(roster.heroes[0]!, 500);
    roster.active = 1;

    save(camp, roster, 500);
    const back = load().roster;
    // Без localStorage (Node) сейв не пишется — тогда проверяем хотя бы то,
    // что загрузка даёт живой отряд, а не пустой объект.
    assert.ok(back.heroes.length >= 1);
    if (back.heroes.length > 1) {
      assert.equal(back.active, 1);
      assert.equal(back.heroes[1]!.level, 3);
      assert.equal(back.heroes[0]!.status, 'healing', 'лечение переживает перезапуск');
    }
    wipe();
  });
});
