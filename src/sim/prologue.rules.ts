/**
 * Правила пролога. Проверяется не картинка поляны, а то, ради чего кадр
 * существует: он кончается провиантом и ничем другим.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FOOD_COST } from './config';
import { distanceField, idx } from './grid';
import {
  GLADE_BAG,
  GLADE_FOOD,
  GLADE_LOGS,
  GLADE_SIZE,
  REST_EVERY,
  REST_FOOD,
  REST_REACH,
  CAMP_WOOD,
  TENT_WOOD,
  UPGRADE_WOOD,
  adoptGladeLayout,
  firstGladeCell,
  gladeCapacity,
  gladeFood,
  generateGlade,
  nearCamp,
  restTick,
  siteBlock,
} from './prologue';
import { restartStep } from './onboarding';
import { campArea, createCamp } from './camp';
import { commandMove, createRaid, setSupply, stepRaid } from './raid';

const glade = (seed = 1): ReturnType<typeof generateGlade> => generateGlade(seed);

const freeCells = (loc: ReturnType<typeof generateGlade>): number => {
  let n = 0;
  for (let i = 0; i < loc.size * loc.size; i++) if (!loc.blocked[i]) n++;
  return n;
};

describe('Пролог: поляна', () => {
  test('на поляне не с кем драться', () => {
    for (let seed = 0; seed < 40; seed++) {
      assert.equal(glade(seed).enemies.length, 0, `сид ${seed}: противник в прологе`);
    }
  });

  test('на поляне семь брусков: пять нужных и два запасных', () => {
    for (let seed = 0; seed < 40; seed++) {
      const loc = glade(seed);
      assert.equal(loc.containers.length, GLADE_LOGS, `сид ${seed}: брусков не восемь`);
      let wood = 0;
      for (const c of loc.containers) {
        assert.equal(c.kind, 'wood', `сид ${seed}: на поляне не дерево`);
        wood += c.amount;
      }
      // Пять уходят в палатку и её второй уровень, два лежат про запас:
      // поляна не обязана вычищаться под ноль, промах не должен запирать кадр.
      assert.equal(wood, GLADE_LOGS, `сид ${seed}: дерева ${wood}`);
      assert.ok(
        wood > CAMP_WOOD + UPGRADE_WOOD,
        'запаса нет: любой промах запирает второй уровень',
      );
    }
  });

  test('бруски лежат врозь и не под ногами: до каждого надо дойти', () => {
    let closest = Infinity;
    for (let seed = 0; seed < 40; seed++) {
      const loc = glade(seed);
      const dist = distanceField(loc.size, loc.blocked, loc.evac);
      for (const c of loc.containers) {
        const d = dist[idx(loc.size, c.x, c.z)]!;
        assert.ok(d >= 4, `сид ${seed}: брусок в ${d} шагах — на него наступают`);
        assert.ok(d <= 7, `сид ${seed}: брусок в ${d} шагах — это уже поход`);
      }
      for (const a of loc.containers) {
        for (const b of loc.containers) {
          if (a.id >= b.id) continue;
          closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
        }
      }
    }
    /*
     * Граница берётся из замера жадной раскладки, а не назначается: чем больше
     * брусков в том же кольце 4–7 шагов, тем они теснее. Прежние «не ближе 4»
     * были правилом для двух, «не ближе 3» — для семи, теперь их восемь.
     *
     * Замер на 200 сидах: ближе 2,83 клетки бруски не сходятся, в среднем
     * 3,49. Раздвинуть их обратно умеет кольцо 4–8 — оно возвращает 3,16, —
     * но платит семью секундами пролога и оставляет худший сид с тремя
     * единицами провианта вместо восьми. Кольцо оставлено, граница опущена
     * до замеренной.
     *
     * 2,83 — это ровно диагональ через клетку (2√2): между брусками остаётся
     * пустая земля, и «две находки» они читаются по-прежнему. Ниже опускать
     * нельзя: 2 — это соседняя клетка, то есть одна находка из двух частей.
     */
    assert.ok(closest > 2, `бруски сходятся до ${closest.toFixed(2)} — читаются как одна находка`);
  });

  test('сумка пролога — своя: Склада ещё нет', () => {
    assert.equal(gladeCapacity(), GLADE_BAG);
    assert.ok(GLADE_BAG > TENT_WOOD, 'сумка обязана вмещать палатку целиком');
    // Ровно цена второго уровня: за улучшением ходят один раз и приносят
    // полный рюкзак — цену видно в полосе, а не в ценнике.
    assert.equal(GLADE_BAG, UPGRADE_WOOD, 'сумка перестала быть ценой улучшения');
  });

  test('уйти с поляны нельзя: кромка — сплошной лес', () => {
    const loc = glade();
    const last = loc.size - 1;
    for (let i = 0; i < loc.size; i++) {
      assert.ok(loc.blocked[idx(loc.size, i, 0)], 'север открыт');
      assert.ok(loc.blocked[idx(loc.size, i, last)], 'юг открыт');
      assert.ok(loc.blocked[idx(loc.size, 0, i)], 'запад открыт');
      assert.ok(loc.blocked[idx(loc.size, last, i)], 'восток открыт');
    }
  });

  test('каждая свободная клетка достижима — тап не может не сработать', () => {
    for (let seed = 0; seed < 40; seed++) {
      const loc = glade(seed);
      const dist = distanceField(loc.size, loc.blocked, loc.evac);
      for (let i = 0; i < loc.size * loc.size; i++) {
        if (loc.blocked[i]) continue;
        assert.notEqual(dist[i], -1, `сид ${seed}: клетка ${i} отрезана`);
      }
    }
  });

  test('герой стоит на чистом пятне, а не в кустах', () => {
    for (let seed = 0; seed < 40; seed++) {
      const loc = glade(seed);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = idx(loc.size, loc.evac.x + dx, loc.evac.z + dz);
          assert.ok(!loc.blocked[i], `сид ${seed}: дерево вплотную к старту`);
        }
      }
    }
  });

  test('поляну нельзя обойти целиком: свободных клеток больше, чем шагов', () => {
    const steps = gladeFood() / FOOD_COST.step;
    for (let seed = 0; seed < 40; seed++) {
      assert.ok(
        freeCells(glade(seed)) > steps,
        `сид ${seed}: провианта хватает на всю поляну — бродить негде`,
      );
    }
  });

  test('тот же сид — та же поляна', () => {
    assert.deepEqual(glade(12).blocked, glade(12).blocked);
    assert.notDeepEqual(glade(12).blocked, glade(13).blocked);
  });
});

describe('Пролог: кадр кончается собранным деревом', () => {
  const prologue = (seed = 3): ReturnType<typeof createRaid> =>
    createRaid({
      seed,
      tier: 0,
      kitchenLevel: 1,
      storageLevel: 1,
      loc: glade(seed),
      food: gladeFood(),
      capacity: gladeCapacity(),
      evacOpen: false,
      containerFood: 0,
      hunger: false,
    });

  /**
   * Прогулка по делу: герой идёт от ближайшего бруска к ближайшему, пока
   * не наберёт `need`. Тот же жадный маршрут, что рисует игроку кольцо
   * подсказки (`firstGladeCell`), — меряется то, что игроку показано.
   */
  const walk = (state: ReturnType<typeof createRaid>, need: number, limit = 240): number => {
    const dt = 1 / 60;
    let t = 0;
    while (t < limit && state.food > 0 && state.bag.wood < need) {
      if (state.path.length === 0) {
        const cell = firstGladeCell(state.loc, state.hero);
        if (cell === null) break;
        commandMove(state, cell);
        if (state.path.length === 0) break;
      }
      stepRaid(state, dt, false, 0);
      t += dt;
    }
    return t;
  };

  /** Дорога в заданную клетку — ею герой возвращается к палатке. */
  const walkTo = (
    state: ReturnType<typeof createRaid>,
    cell: { x: number; z: number },
    limit = 240,
  ): number => {
    const dt = 1 / 60;
    let t = 0;
    commandMove(state, cell);
    while (t < limit && state.food > 0 && state.path.length > 0) {
      stepRaid(state, dt, false, 0);
      t += dt;
    }
    return t;
  };

  test('провиант пролога — свой, а не кухонный: Кухни ещё нет', () => {
    const state = prologue();
    assert.equal(state.food, GLADE_FOOD);
    assert.equal(state.foodMax, GLADE_FOOD);
  });

  /**
   * Длина кадра меряется прогулкой, а не делением провианта на скорость:
   * герой тормозит на поворотах, и расчёт расходился с замером в полтора раза.
   *
   * Меряется теперь не «сколько бродить до нуля», а «сколько идти за деревом»:
   * кадр кончается собранными брусками, и это его настоящая длина. Замер
   * на 60 сидах — 7,7–12,1 с, в среднем 9,4; границы взяты с запасом, чтобы
   * падение означало смену механики, а не дрожание генератора.
   */
  test('за деревом на лагерь ходят несколько секунд, а не минуту', () => {
    // Замер на 60 сидах: 7,7–12,1 с, в среднем 9,4. Первый акт удлинился,
    // когда костёр перестал быть бесплатным: собирают три бруска, а не два.
    // Границы взяты с запасом — падение означает смену механики,
    // а не дрожание генератора.
    for (const seed of [0, 7, 23, 41]) {
      const t = walk(prologue(seed), CAMP_WOOD);
      assert.ok(t > 4 && t < 18, `сид ${seed}: за деревом ходили ${t.toFixed(1)} с`);
    }
  });

  /**
   * Тупика в первые пятнадцать секунд быть не может: палатка стоит два бруска,
   * и провианта обязано хватать на оба с запасом на то, чтобы побродить.
   */
  test('провианта хватает на весь лагерь, и ещё остаётся', () => {
    for (let seed = 0; seed < 60; seed++) {
      const state = prologue(seed);
      walk(state, CAMP_WOOD);
      assert.equal(state.bag.wood, CAMP_WOOD, `сид ${seed}: в сумке не лагерь`);
      assert.ok(state.food >= 5, `сид ${seed}: осталось ${state.food} — побродить нечем`);
    }
  });

  /**
   * Главное правило кадра: **кто идёт по делу, не ждёт**.
   *
   * Отдых у лагеря (+3 за 10 секунд) — цена шагов, потраченных не туда,
   * а не обязательный простой. Поэтому меряется весь пролог целиком: три
   * бруска на лагерь, три на второй уровень жилья и дорога обратно к палатке.
   * Жадный маршрут обязан уложиться в `GLADE_FOOD`, ни разу не встав.
   *
   * Провианта здесь 54, и это число замера, а не оценки: на 60 сидах прямая
   * дорога занимает 24,5–37,5 с и доходит с остатком 8–26. Не сойдётся —
   * поднимать надо провиант, а не темп отдыха: темп задан решением
   * («потратил шаги не туда — стой и жди»), и подкручивать его под маршрут
   * значит отменять цену промаха.
   */
  test('прямой дорогой пролог проходится без единой секунды отдыха', () => {
    let worst = Infinity;
    for (let seed = 0; seed < 60; seed++) {
      const state = prologue(seed);
      walk(state, CAMP_WOOD);
      // Лагерь встаёт там, где игрок стоит, — и туда же он вернётся с деревом.
      const home = { x: Math.round(state.hero.x), z: Math.round(state.hero.z) };
      state.bag.wood -= CAMP_WOOD;
      state.bagTotal -= CAMP_WOOD;
      walk(state, UPGRADE_WOOD);
      assert.equal(
        state.bag.wood,
        UPGRADE_WOOD,
        `сид ${seed}: на второй уровень дерева не набралось`,
      );
      walkTo(state, home);
      assert.ok(
        nearCamp([home], state.hero),
        `сид ${seed}: до палатки не дошли — провиант кончился в дороге`,
      );
      worst = Math.min(worst, state.food);
      assert.ok(
        state.food >= 5,
        `сид ${seed}: пришёл с ${state.food.toFixed(1)} — прямая дорога упирается в отдых`,
      );
    }
    assert.ok(worst < GLADE_FOOD / 2, `запас ${worst.toFixed(1)} — провианта дали лишнего`);
  });

  test('сумка не переполняется: она и есть цена улучшения', () => {
    assert.equal(CAMP_WOOD, GLADE_BAG, 'лагерь перестал быть ровно полным рюкзаком');
    assert.ok(UPGRADE_WOOD <= GLADE_BAG, 'за улучшением пришлось бы ходить дважды');
  });

  test('выход закрыт: с поляны не эвакуируются', () => {
    assert.equal(prologue().evacOpen, false);
  });

  test('поляна больше любой вылазки — в кромку за провиант не упереться', () => {
    assert.ok(GLADE_SIZE > 20, 'дно вылазки — 20×20 (§11.1)');
  });

  test('подбор в прологе бесплатен: провиант здесь — шаги, и только шаги', () => {
    const state = prologue(11);
    const before = state.food;
    const cell = firstGladeCell(state.loc, state.hero)!;
    commandMove(state, cell);
    let steps = 0;
    while (state.bag.wood === 0 && steps < 60 * 60) {
      stepRaid(state, 1 / 60, false, 0);
      steps++;
    }
    assert.equal(state.bag.wood, 1, 'брусок не подобрался');
    // Ровно шаги и ни глотка сверх: платный подбор превращал промах в тупик.
    assert.equal(before - state.food, state.steps * FOOD_COST.step);
  });

  test('голод в прологе раны не грызёт: нуль провианта — повод отдохнуть', () => {
    const state = prologue(4);
    setSupply(state, 0);
    const wounds = state.hero.hp;
    for (let i = 0; i < 60 * 30; i++) stepRaid(state, 1 / 60, false, 0);
    assert.equal(state.hero.hp, wounds, 'пролог начал отнимать раны');
    assert.equal(state.status, 'running', 'пролог кончился голодом');
  });

  test('перезапуск возвращает в пролог, а не в вылазку', () => {
    assert.equal(restartStep('glade'), 'glade', 'сохранённый пролог открывался вылазкой');
    // Собранный брусок перезапуск не переживает вместе с поляной: кадр
    // начинается с себя самого, иначе палатка встала бы из ничего.
    assert.equal(restartStep('gather'), 'glade', 'сбор возвращал в вылазку');
    // Второй акт — тоже пролог: вылазка перезапуск не переживает, а палатка,
    // поднятая до второго уровня, встала бы в нём из ничего.
    assert.equal(restartStep('upgrade'), 'glade', 'второй акт возвращал в вылазку');
    assert.equal(restartStep('bait'), 'move', 'вылазка по-прежнему перематывается к началу');
    assert.equal(restartStep('build'), 'build', 'лагерные кадры перезапуск переживают');
  });
});

describe('Пролог: отдых у лагеря', () => {
  const resting = (food: number): ReturnType<typeof createRaid> => {
    const state = createRaid({
      seed: 2,
      tier: 0,
      kitchenLevel: 1,
      storageLevel: 1,
      loc: glade(2),
      food: gladeFood(),
      capacity: gladeCapacity(),
      evacOpen: false,
      containerFood: 0,
      hunger: false,
    });
    setSupply(state, food);
    return state;
  };

  test('провиант приходит порциями, а не струйкой', () => {
    const state = resting(0);
    let acc = 0;
    // Девять секунд ожидания — это ещё ноль: порция обязана быть заметной,
    // иначе полоса дрожит и ожидание читается как зависание.
    for (let i = 0; i < 9 * 60; i++) acc = restTick(acc, 1 / 60, state);
    assert.equal(state.food, 0, 'провиант потёк струйкой');
    for (let i = 0; i < 60; i++) acc = restTick(acc, 1 / 60, state);
    assert.equal(state.food, REST_FOOD, `за ${REST_EVERY} с пришло не ${REST_FOOD}`);
  });

  test('отдых не переливает через край', () => {
    const state = resting(GLADE_FOOD - 1);
    let acc = 0;
    for (let i = 0; i < 60 * 60; i++) acc = restTick(acc, 1 / 60, state);
    assert.equal(state.food, GLADE_FOOD, 'провианта стало больше, чем герой унёс');
  });

  test('отдыхают у лагеря, а не где стоят', () => {
    const home = { x: 10, z: 10 };
    assert.ok(nearCamp([home], { x: 10, z: 10 }), 'на палатке не отдыхается');
    assert.ok(nearCamp([home], { x: 10 + REST_REACH, z: 10 }), 'радиус меньше обещанного');
    assert.ok(!nearCamp([home], { x: 10 + REST_REACH + 1, z: 10 }), 'отдых догоняет в лесу');
    assert.ok(!nearCamp([], { x: 10, z: 10 }), 'отдыхали до того, как лагерь встал');
  });

  test('отдых медленнее ходьбы: он цена промаха, а не второй провиант', () => {
    // Шаг стоит 1 и делается быстрее, чем набегает порция: стоять выгоднее
    // только тому, кто уже потратил шаги не туда.
    assert.ok(REST_FOOD / REST_EVERY < FOOD_COST.step, 'отдых кормит быстрее, чем дорога тратит');
  });
});

describe('Пролог: место под здание', () => {
  const loc = glade(5);
  const free = (): { x: number; z: number } => {
    for (let z = 1; z < loc.size - 1; z++) {
      for (let x = 1; x < loc.size - 1; x++) {
        if (!loc.blocked[idx(loc.size, x, z)]) return { x, z };
      }
    }
    throw new Error('поляна заросла целиком');
  };

  test('на свободную землю — можно', () => {
    assert.equal(siteBlock(loc, [], { x: -9, z: -9 }, free()), 'ok');
  });

  test('в дерево — нельзя, и это видно причиной', () => {
    assert.equal(siteBlock(loc, [], { x: -9, z: -9 }, { x: 0, z: 0 }), 'tree');
  });

  test('за краем поляны — нельзя', () => {
    assert.equal(siteBlock(loc, [], { x: -9, z: -9 }, { x: -1, z: 3 }), 'tree');
    assert.equal(siteBlock(loc, [], { x: -9, z: -9 }, { x: loc.size, z: 3 }), 'tree');
  });

  test('поверх уже стоящего здания — нельзя', () => {
    const c = free();
    assert.equal(siteBlock(loc, [c], { x: -9, z: -9 }, c), 'busy');
  });

  test('под ноги герою — нельзя: он оказался бы внутри', () => {
    const c = free();
    assert.equal(siteBlock(loc, [], { x: c.x + 0.2, z: c.z - 0.3 }, c), 'hero');
  });
});

describe('Пролог: механику не называют словом раньше механики', () => {
  test('событие подбора не говорит про ставку', () => {
    const loc = glade(7);
    const raid = createRaid({
      seed: 7, tier: 0, kitchenLevel: 1, storageLevel: 1,
      loc, food: 50, capacity: 3, evacOpen: false, containerFood: 0,
      hunger: false, risk: false,
    });
    const log = raid.loc.containers[0]!;
    commandMove(raid, { x: log.x, z: log.z });
    for (let i = 0; i < 60 * 60 && raid.loc.containers.every((c) => !c.opened); i++) {
      stepRaid(raid, 1 / 60, false, 0);
    }
    assert.ok(raid.loc.containers.some((c) => c.opened), 'брусок подобран');
    const picked = raid.events.filter((e) => e.startsWith('+'));
    assert.ok(picked.length > 0, 'событие подбора записано');
    for (const e of picked) {
      assert.ok(!e.includes('под угрозой'), `ставка названа до кадра bait: «${e}»`);
    }
  });

  test('в вылазке ставка называется по-прежнему', () => {
    const raid = createRaid({ seed: 3, tier: 1, kitchenLevel: 1, storageLevel: 2 });
    const box = raid.loc.containers[0]!;
    commandMove(raid, { x: box.x, z: box.z });
    for (let i = 0; i < 60 * 60 && raid.loc.containers.every((c) => !c.opened); i++) {
      stepRaid(raid, 1 / 60, false, 0);
    }
    const picked = raid.events.filter((e) => e.startsWith('+'));
    if (picked.length > 0) {
      assert.ok(picked.every((e) => e.includes('под угрозой')), 'ставка объявлена');
    }
  });
});

/*
 * Раскладку выбирает игрок, и она обязана пережить конец пролога: лагерь,
 * показавший раскладку по умолчанию, обесценил бы единственный выбор кадра.
 */
describe('Пролог: поляна становится лагерем', () => {
  const PITCH = ['hq', 'kitchen'] as const;

  /** Клетки поляны, разнесённые как в жизни: палатка и костёр рядом. */
  const pitchedAt = (hq: [number, number], kitchen: [number, number]) => [
    { x: hq[0], z: hq[1] },
    { x: kitchen[0], z: kitchen[1] },
  ];

  test('оба здания въезжают в площадь лагеря', () => {
    const camp = createCamp();
    camp.levels.hq = 2;
    camp.levels.forge = 0;
    adoptGladeLayout(camp, 24, PITCH, pitchedAt([4, 4], [19, 19]));
    const area = campArea(camp.levels.hq);
    for (const id of PITCH) {
      const p = camp.layout[id];
      assert.ok(p.x >= 0 && p.z >= 0, `${id}: не за краем`);
      assert.ok(p.x + 2 <= area && p.z + 2 <= area, `${id}: след 2×2 внутри площади`);
    }
  });

  test('следы не налезают друг на друга даже из соседних клеток поляны', () => {
    // Худший случай: игрок поставил костёр вплотную к палатке. После пересчёта
    // 24 → 7 обе клетки схлопнулись бы в одну, и здания встали бы одно в другое.
    const camp = createCamp();
    camp.levels.hq = 2;
    adoptGladeLayout(camp, 24, PITCH, pitchedAt([11, 11], [12, 11]));
    const a = camp.layout.hq;
    const b = camp.layout.kitchen;
    assert.ok(Math.abs(a.x - b.x) >= 2 || Math.abs(a.z - b.z) >= 2, 'следы разошлись');
  });

  test('взаимное расположение сохраняется: что было севернее, севернее и осталось', () => {
    const camp = createCamp();
    camp.levels.hq = 2;
    adoptGladeLayout(camp, 24, PITCH, pitchedAt([4, 4], [18, 18]));
    assert.ok(camp.layout.hq.x <= camp.layout.kitchen.x, 'палатка осталась западнее');
    assert.ok(camp.layout.hq.z <= camp.layout.kitchen.z, 'палатка осталась севернее');
  });

  test('любой угол поляны укладывается в лагерь', () => {
    const area = campArea(2);
    for (const hq of [[1, 1], [22, 1], [1, 22], [22, 22], [12, 12]] as [number, number][]) {
      for (const kit of [[1, 1], [22, 22], [12, 1]] as [number, number][]) {
        const camp = createCamp();
        camp.levels.hq = 2;
        adoptGladeLayout(camp, 24, PITCH, pitchedAt(hq, kit));
        for (const id of PITCH) {
          const p = camp.layout[id];
          assert.ok(
            p.x >= 0 && p.z >= 0 && p.x + 2 <= area && p.z + 2 <= area,
            `${id} из ${hq} / ${kit} уехал за площадь: ${p.x},${p.z}`,
          );
        }
        const a = camp.layout.hq;
        const b = camp.layout.kitchen;
        assert.ok(
          Math.abs(a.x - b.x) >= 2 || Math.abs(a.z - b.z) >= 2,
          `следы налезли из ${hq} / ${kit}`,
        );
      }
    }
  });
});
