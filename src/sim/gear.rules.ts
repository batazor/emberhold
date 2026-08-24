/**
 * Правила Мастерской и снаряжения (§14). Живут рядом с gear.ts по тому же
 * правилу, что и остальные: фича приносит свои проверки с собой.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { START_FOOD } from './balance';
import {
  BUILD_COST,
  craftGear,
  createCamp,
  gearBlock,
  startUpgrade,
  suggestGear,
  suggestUpgrade,
  upgradeBlock,
} from './camp';
import { GEAR_COST, MAX_ITEM_LEVEL, NO_MODS, emptyGear, gearMods } from './gear';
import { atRisk, createRaid, raidResult } from './raid';
import { load, save, wipe } from './save';
import { createRoster } from './heroes';

describe('Мастерская', () => {
  test('§14.3 — «снаряжения нет» это снаряжение нулевого уровня, а не другое', () => {
    /**
     * `NO_MODS` была табличкой, набранной руками, и разошлась с `gearMods`
     * ровно в одном поле — колчане. Стоило это класса: Лучник, вошедший
     * без снаряжения, оказывался не стрелком, а худшим ближником игры,
     * и `npm run classes` объявлял его вырожденным, меряя героя без лука.
     *
     * Второго источника правды больше нет, и это правило держит его снесённым.
     */
    assert.deepEqual(
      NO_MODS,
      gearMods(emptyGear()),
      'NO_MODS разошлась со снаряжением нулевого уровня',
    );
    assert.ok(NO_MODS.arrows > 0, 'у невыкованного лука колчан не нулевой (§14.3)');
  });

  test('§16 — закрыта до Жилья ур. 2 и говорит, чем закрыта', () => {
    const camp = createCamp();
    camp.resources = { stone: 999, wood: 999, iron: 999, crystal: 999, food: 0 };
    assert.equal(camp.levels.forge, 0, 'в новом лагере Мастерской нет');
    assert.equal(upgradeBlock(camp, 'forge'), 'locked');
    assert.equal(gearBlock(camp, 'weapon'), 'no-forge', 'ковать негде');
    camp.levels.hq = 2;
    assert.equal(upgradeBlock(camp, 'forge'), 'ok');
  });

  /**
   * Прежде правило звучало «первый уровень бесплатен и мгновенен» и проверяло
   * постройку из пустого лагеря. Бесплатность §20.3 с появлением третьего акта
   * пролога (§16.1) сузилась до самого пролога: там первое здание дарится
   * `grantLevelOffBooks`, а Мастерская — первая, за которую платят. Мгновенность
   * осталась: ждать таймер игрок к этому кадру ещё не научился.
   */
  test('§16.1 — первый уровень мгновенен, но уже не бесплатен', () => {
    const camp = createCamp();
    camp.levels.hq = 2;
    assert.equal(startUpgrade(camp, 'forge', 1000), false, 'без камня не встаёт');

    camp.resources.stone = BUILD_COST[1]?.stone ?? 0;
    assert.equal(startUpgrade(camp, 'forge', 1000), true);
    assert.equal(camp.levels.forge, 1, 'выросла на глазах, без таймера');
    assert.equal(camp.construction, null, 'слот стройки свободен');
    // §13.7 — пища стартового запаса остаётся: стройка её не тратит,
    // и ноль здесь означал бы, что Мастерская съела обед.
    assert.deepEqual(camp.resources, { stone: 0, wood: 0, iron: 0, crystal: 0, food: START_FOOD });
  });

  /**
   * Главная проверка всей фичи. Ради неё Мастерская и переехала из этапа 5
   * в вертикальный срез: §20.1 обещает, что главная кнопка экрана возврата
   * остаётся тратой, даже когда единственный слот стройки занят.
   */
  test('§20.1 — ковка работает, пока слот стройки занят', () => {
    const camp = createCamp();
    camp.levels = { hq: 3, kitchen: 1, storage: 1, forge: 1, infirmary: 0, yard: 0, archery: 0, barracks: 0, watchtower: 0 };
    camp.resources = { stone: 999, wood: 999, iron: 999, crystal: 999, food: 0 };
    assert.equal(startUpgrade(camp, 'kitchen', 0), true);
    assert.equal(upgradeBlock(camp, 'storage'), 'slot-busy', 'стройка встала в очередь');
    assert.equal(suggestUpgrade(camp), null, 'постройки предложить нечего');
    assert.notEqual(suggestGear(camp), null, 'Мастерская предлагает трату');
    assert.equal(craftGear(camp, 'weapon'), true);
    assert.equal(camp.gear.weapon, 1);
    assert.notEqual(camp.construction, null, 'ковка не тронула стройку');
  });

  test('§14 — предмет не может быть лучше своей Мастерской', () => {
    const camp = createCamp();
    camp.levels = { hq: 2, kitchen: 1, storage: 1, forge: 1, infirmary: 0, yard: 0, archery: 0, barracks: 0, watchtower: 0 };
    camp.resources = { stone: 0, wood: 0, iron: 999, crystal: 999, food: 0 };
    assert.equal(craftGear(camp, 'bag'), true, 'ур. 1 доступен');
    assert.equal(gearBlock(camp, 'bag'), 'forge-cap', 'ур. 2 требует Мастерскую ур. 2');
    camp.levels.forge = 6;
    for (let i = camp.gear.bag; i < MAX_ITEM_LEVEL; i++) craftGear(camp, 'bag');
    assert.equal(camp.gear.bag, MAX_ITEM_LEVEL);
    assert.equal(gearBlock(camp, 'bag'), 'max', 'шестого уровня у предметов нет');
  });

  test('§14 — Мастерская улучшает, а не рандомит', () => {
    const a = createCamp();
    const b = createCamp();
    for (const camp of [a, b]) {
      camp.levels = { hq: 3, kitchen: 1, storage: 1, forge: 3, infirmary: 0, yard: 0, archery: 0, barracks: 0, watchtower: 0 };
      camp.resources = { stone: 0, wood: 0, iron: 999, crystal: 999, food: 0 };
      craftGear(camp, 'ring');
      craftGear(camp, 'ring');
    }
    // Один и тот же вход даёт один и тот же выход: ни бросков, ни перебросов.
    assert.deepEqual(a.gear, b.gear);
    assert.equal(a.gear.ring, 2);
    assert.deepEqual(a.resources, b.resources);
  });

  test('§14 — цена только железо и кристалл, и растёт со ступенью', () => {
    for (let level = 1; level <= MAX_ITEM_LEVEL; level++) {
      const cost = GEAR_COST[level] ?? {};
      assert.equal(cost.stone ?? 0, 0, `камень на уровне ${level}`);
      assert.equal(cost.wood ?? 0, 0, `дерево на уровне ${level}`);
      assert.ok((cost.iron ?? 0) > 0, `железо на уровне ${level}`);
      // §13 — кристалл не входит в цену раньше своего яруса.
      if (level < 3) assert.equal(cost.crystal ?? 0, 0, `кристалл на уровне ${level}`);
    }
    const totals = [1, 2, 3, 4, 5].map((l) =>
      Object.values(GEAR_COST[l] ?? {}).reduce((a, b) => a + b, 0),
    );
    for (let i = 1; i < totals.length; i++) {
      assert.ok(totals[i]! > totals[i - 1]!, `ступень ${i + 1} не дороже предыдущей`);
    }
  });
});

describe('Снаряжение в вылазке', () => {
  const opts = { seed: 7, tier: 1 as const, kitchenLevel: 2, storageLevel: 2 };

  test('§14 — каждый слот меняет вылазку, и каждый чем-то платит', () => {
    const bare = createRaid(opts);

    const withBag = createRaid({ ...opts, gear: { ...emptyGear(), bag: 3 } });
    assert.equal(withBag.capacity, bare.capacity + 3, 'сумка расширяет рюкзак');

    const armed = createRaid({ ...opts, gear: { ...emptyGear(), weapon: 2 } });
    assert.ok(armed.mods.attack > 0, 'оружие прибавляет Атаку');
    assert.equal(armed.capacity, bare.capacity - 1, '§14 — тяжёлое оружие стоит места');

    const armored = createRaid({ ...opts, gear: { ...emptyGear(), armor: 3 } });
    assert.equal(armored.hero.hp, bare.hero.hp + 1, 'броня добавляет рану');
    assert.ok(armored.mods.foodStep > 1, '§14 — тяжёлая броня дороже в дороге');

    const lit = createRaid({ ...opts, gear: { ...emptyGear(), torch: 4 } });
    assert.equal(lit.mods.vision, 2, 'фонарь прибавляет обзор');
  });

  /**
   * §14.2 — единственное место раздела, где две вещи спорят за один слот.
   * Проверяется не «щит работает», а то, ради чего он заведён: ни один
   * из двух вариантов не лучше другого во всём, иначе выбора нет.
   */
  test('§14.2 — левая рука одна: фонарь или щит, и ни один не лучше', () => {
    const gear = { ...emptyGear(), torch: 4 };
    const lit = gearMods(gear, 'torch');
    const held = gearMods(gear, 'shield');

    assert.equal(lit.vision, 2, 'фонарь светит');
    assert.equal(lit.defense, 0, 'и только светит');
    assert.equal(held.vision, 0, 'щит не светит вовсе');
    assert.ok(held.defense > 0, 'щит держит удар');
    assert.ok(held.defense > lit.defense && lit.vision > held.vision, 'выбор существует');

    assert.deepEqual(gearMods(gear), lit, 'умолчание — фонарь, как было до §14.2');

    // Щит и броня покупают одно — «переживу удар», — но платят разным:
    // броня провиантом на каждом шаге, щит обзором. Одинаковой ценой они бы
    // дублировали друг друга; разной — дают выбор.
    const both = gearMods({ ...emptyGear(), armor: 3, torch: 2 }, 'shield');
    assert.equal(both.wounds, 1, 'прибавка к здоровью — целиком за бронёй (§14.2)');
    assert.ok(both.defense > 0, 'живучесть щита приходит Защитой, а не раной');
    assert.ok(both.foodStep > 1, 'платит только броня — шагом');
    assert.equal(both.vision, 0, 'и только щит — темнотой');
  });

  test('§14.2 — щит доходит до вылазки, а не только до сводки', () => {
    const gear = { ...emptyGear(), torch: 4 };
    const opts = { seed: 5, tier: 2, kitchenLevel: 3, storageLevel: 3, gear } as const;
    // До §14.2 вылазка звала gearMods без второго аргумента, и щит был
    // недостижим из игры: посчитан, покрыт тестами и никому не виден.
    assert.equal(createRaid({ ...opts }).mods.vision, 2, 'без указания руки — фонарь');
    assert.equal(createRaid({ ...opts, offhand: 'shield' }).mods.vision, 0, 'со щитом не светит');
    assert.ok(createRaid({ ...opts, offhand: 'shield' }).mods.defense > 0, 'и держит удар');
  });

  test('§11.2 — кольцо смягчает ставку, но не отменяет её', () => {
    const make = (ring: number): number => {
      const state = createRaid({
        seed: 3,
        tier: 3,
        kitchenLevel: 3,
        storageLevel: 3,
        gear: { ...emptyGear(), ring },
      });
      state.bagTotal = 10;
      return atRisk(state);
    };
    assert.equal(make(0), 10, 'на дне без кольца под угрозой всё');
    assert.equal(make(5), 5, 'потолок кольца — половина');
    assert.ok(make(5) > 0, 'ставка остаётся ставкой');
  });

  test('§14 — снаряжение не теряется при провале', () => {
    const camp = createCamp();
    camp.levels = { hq: 3, kitchen: 1, storage: 1, forge: 3, infirmary: 0, yard: 0, archery: 0, barracks: 0, watchtower: 0 };
    camp.resources = { stone: 0, wood: 0, iron: 999, crystal: 999, food: 0 };
    craftGear(camp, 'weapon');
    craftGear(camp, 'armor');
    const before = { ...camp.gear };

    const raid = createRaid({ seed: 11, tier: 2, kitchenLevel: 2, storageLevel: 2, gear: camp.gear });
    raid.bagTotal = 8;
    raid.bag = { stone: 8, wood: 0, iron: 0, crystal: 0, food: 0 };
    raid.status = 'failed';
    const result = raidResult(raid);

    assert.ok(result.lost > 0, 'добыча теряется');
    assert.deepEqual(camp.gear, before, 'снаряжение остаётся в лагере');
  });

  test('снаряжение переживает круг save → load', () => {
    // В Node хранилища нет, поэтому оно подделывается — ровно так же,
    // как в save.rules.ts: проверяем сериализацию, а не браузер.
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    wipe();
    const camp = createCamp();
    camp.levels = { hq: 3, kitchen: 1, storage: 1, forge: 2, infirmary: 0, yard: 0, archery: 0, barracks: 0, watchtower: 0 };
    camp.resources = { stone: 0, wood: 0, iron: 999, crystal: 999, food: 0 };
    craftGear(camp, 'torch');
    craftGear(camp, 'torch');
    save(camp, createRoster(), 5);

    const { camp: back } = load();
    assert.equal(back.gear.torch, 2);
    assert.equal(back.levels.forge, 2, 'непостроенное и построенное различимы');
    wipe();
  });
});
