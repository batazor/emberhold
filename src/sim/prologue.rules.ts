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
  GLADE_SIZE,
  TENT_WOOD,
  firstGladeCell,
  gladeCapacity,
  gladeFood,
  generateGlade,
  siteBlock,
} from './prologue';
import { restartStep } from './onboarding';
import { commandMove, createRaid, stepRaid } from './raid';

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

  test('на поляне лежит ровно столько дерева, сколько стоит палатка', () => {
    for (let seed = 0; seed < 40; seed++) {
      const loc = glade(seed);
      assert.equal(loc.containers.length, TENT_WOOD, `сид ${seed}: брусков не по цене палатки`);
      let wood = 0;
      for (const c of loc.containers) {
        assert.equal(c.kind, 'wood', `сид ${seed}: на поляне не дерево`);
        wood += c.amount;
      }
      // Лишний брусок учил бы собирать про запас, недостающий — запирал бы
      // палатку. Подсвечено ровно то, что понадобится.
      assert.equal(wood, TENT_WOOD, `сид ${seed}: дерева ${wood}, палатка стоит ${TENT_WOOD}`);
    }
  });

  test('бруски лежат врозь и не под ногами: до каждого надо дойти', () => {
    for (let seed = 0; seed < 40; seed++) {
      const loc = glade(seed);
      const dist = distanceField(loc.size, loc.blocked, loc.evac);
      for (const c of loc.containers) {
        const d = dist[idx(loc.size, c.x, c.z)]!;
        assert.ok(d >= 4, `сид ${seed}: брусок в ${d} шагах — на него наступают`);
        assert.ok(d <= 7, `сид ${seed}: брусок в ${d} шагах — это уже поход`);
      }
      const [a, b] = loc.containers;
      if (a !== undefined && b !== undefined) {
        assert.ok(
          Math.hypot(a.x - b.x, a.z - b.z) >= 4,
          `сид ${seed}: бруски рядом — читаются как одна находка`,
        );
      }
    }
  });

  test('сумка пролога — своя: Склада ещё нет', () => {
    assert.equal(gladeCapacity(), GLADE_BAG);
    assert.ok(GLADE_BAG > TENT_WOOD, 'сумка обязана вмещать палатку целиком');
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
    });

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
   * на 60 сидах — 7,8–13,7 с, в среднем 10,7; границы взяты с запасом, чтобы
   * падение означало смену механики, а не дрожание генератора.
   */
  test('за деревом ходят десяток секунд, а не минуту', () => {
    const dt = 1 / 60;
    for (const seed of [0, 7, 23, 41]) {
      const state = prologue(seed);
      const loc = state.loc;
      let t = 0;
      while (t < 120 && state.food > 0 && !loc.containers.every((c) => c.opened)) {
        if (state.path.length === 0) {
          const cell = firstGladeCell(loc, state.hero);
          if (cell === null) break;
          commandMove(state, cell);
          if (state.path.length === 0) break;
        }
        stepRaid(state, dt, false, 0);
        t += dt;
      }
      assert.ok(t > 5 && t < 18, `сид ${seed}: за деревом ходили ${t.toFixed(1)} с`);
    }
  });

  /**
   * Тупика в первые пятнадцать секунд быть не может: палатка стоит два бруска,
   * и провианта обязано хватать на оба с запасом на то, чтобы побродить.
   * Запас — это и есть разница между старыми 20 и нынешними 40 (`prologue.ts`).
   */
  test('провианта хватает на оба бруска, и ещё остаётся', () => {
    const dt = 1 / 60;
    for (let seed = 0; seed < 60; seed++) {
      const state = prologue(seed);
      const loc = state.loc;
      let t = 0;
      while (t < 120 && state.food > 0 && !loc.containers.every((c) => c.opened)) {
        if (state.path.length === 0) {
          const cell = firstGladeCell(loc, state.hero);
          if (cell === null) break;
          commandMove(state, cell);
          if (state.path.length === 0) break;
        }
        stepRaid(state, dt, false, 0);
        t += dt;
      }
      assert.ok(
        loc.containers.every((c) => c.opened),
        `сид ${seed}: дерево не собрано за провиант — палатку не из чего ставить`,
      );
      assert.equal(state.bagTotal, TENT_WOOD, `сид ${seed}: в сумке не палатка`);
      assert.ok(state.food >= 5, `сид ${seed}: осталось ${state.food} — побродить нечем`);
    }
  });

  test('сумка не переполняется: собирать нечего сверх палатки', () => {
    assert.ok(TENT_WOOD <= GLADE_BAG, 'палатка не влезает в сумку пролога');
  });

  test('выход закрыт: с поляны не эвакуируются', () => {
    assert.equal(prologue().evacOpen, false);
  });

  test('поляна больше любой вылазки — в кромку за провиант не упереться', () => {
    assert.ok(GLADE_SIZE > 20, 'дно вылазки — 20×20 (§11.1)');
  });

  test('перезапуск возвращает в пролог, а не в вылазку', () => {
    assert.equal(restartStep('glade'), 'glade', 'сохранённый пролог открывался вылазкой');
    // Собранный брусок перезапуск не переживает вместе с поляной: кадр
    // начинается с себя самого, иначе палатка встала бы из ничего.
    assert.equal(restartStep('gather'), 'glade', 'сбор возвращал в вылазку');
    assert.equal(restartStep('bait'), 'move', 'вылазка по-прежнему перематывается к началу');
    assert.equal(restartStep('build'), 'build', 'лагерные кадры перезапуск переживают');
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
