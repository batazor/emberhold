/**
 * Правила пролога. Проверяется не картинка поляны, а то, ради чего кадр
 * существует: он кончается провиантом и ничем другим.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FOOD_COST, HERO_SPEED } from './config';
import { distanceField, idx } from './grid';
import { GLADE_SIZE, gladeFood, generateGlade } from './prologue';
import { createRaid } from './raid';

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

  test('провиант пролога — это Кухня ур. 1, а не назначенное заново число', () => {
    const state = prologue();
    assert.equal(state.food, gladeFood());
    assert.equal(state.foodMax, gladeFood());
  });

  test('прогулка длится около полуминуты (§17.4)', () => {
    const seconds = gladeFood() / FOOD_COST.step / HERO_SPEED;
    assert.ok(seconds > 25 && seconds < 35, `вышло ${seconds.toFixed(1)} с`);
  });

  test('выход закрыт: с поляны не эвакуируются', () => {
    assert.equal(prologue().evacOpen, false);
  });

  test('размер поляны крупнее нулевого яруса — по ней бродят', () => {
    assert.ok(GLADE_SIZE > 8);
  });
});
