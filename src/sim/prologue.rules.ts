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
import { GLADE_FOOD, GLADE_SIZE, gladeFood, generateGlade, siteBlock } from './prologue';
import { restartStep } from './onboarding';
import { commandMove, createRaid, stepRaid } from './raid';

const glade = (seed = 1): ReturnType<typeof generateGlade> => generateGlade(seed);

const freeCells = (loc: ReturnType<typeof generateGlade>): number => {
  let n = 0;
  for (let i = 0; i < loc.size * loc.size; i++) if (!loc.blocked[i]) n++;
  return n;
};

describe('Пролог: поляна', () => {
  test('на поляне не с кем драться и нечего вскрывать', () => {
    for (let seed = 0; seed < 40; seed++) {
      const loc = glade(seed);
      assert.equal(loc.enemies.length, 0, `сид ${seed}: противник в прологе`);
      assert.equal(loc.containers.length, 0, `сид ${seed}: добыча в прологе`);
    }
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

describe('Пролог: кадр кончается провиантом', () => {
  const prologue = (): ReturnType<typeof createRaid> =>
    createRaid({
      seed: 3,
      tier: 0,
      kitchenLevel: 1,
      storageLevel: 1,
      loc: glade(3),
      food: gladeFood(),
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
   * Замер на 60 сидах даёт 11,6–15,0 с; границы взяты с запасом, чтобы
   * падение означало смену механики, а не дрожание генератора.
   */
  test('прогулка кончается провиантом за десяток секунд, а не за минуту', () => {
    const dt = 1 / 60;
    for (const seed of [0, 7, 23, 41]) {
      const loc = glade(seed);
      const state = createRaid({
        seed, tier: 0, kitchenLevel: 1, storageLevel: 1,
        loc, food: gladeFood(), evacOpen: false,
      });
      let t = 0;
      while (state.food > 0 && t < 120) {
        if (state.path.length === 0) {
          const d = distanceField(loc.size, loc.blocked, {
            x: Math.round(state.hero.x),
            z: Math.round(state.hero.z),
          });
          let best = -1;
          let target = loc.evac;
          for (let z = 0; z < loc.size; z++) {
            for (let x = 0; x < loc.size; x++) {
              const v = d[idx(loc.size, x, z)]!;
              if (v > best) { best = v; target = { x, z }; }
            }
          }
          commandMove(state, target);
        }
        stepRaid(state, dt, false, 0);
        t += dt;
      }
      assert.ok(t > 8 && t < 20, `сид ${seed}: прогулка ${t.toFixed(1)} с`);
    }
  });

  test('выход закрыт: с поляны не эвакуируются', () => {
    assert.equal(prologue().evacOpen, false);
  });

  test('поляна больше любой вылазки — в кромку за провиант не упереться', () => {
    assert.ok(GLADE_SIZE > 20, 'дно вылазки — 20×20 (§11.1)');
  });

  test('перезапуск возвращает в пролог, а не в вылазку', () => {
    assert.equal(restartStep('glade'), 'glade', 'сохранённый пролог открывался вылазкой');
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
