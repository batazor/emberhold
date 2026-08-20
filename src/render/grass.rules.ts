/**
 * Правила травы. Проверяется размещение — та часть, которая не про картинку,
 * а про игру: трава не встаёт в камень, не закрывает выход и добычу,
 * повторяется по сиду и прореживается равномерно.
 *
 * Первый файл правил в render/: раскладка чистая, поэтому считается в Node,
 * как и вся симуляция. Картинку эти правила не проверяют — её проверяет глаз.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { generateLocation } from '../sim/generate';
import { idx } from '../sim/grid';
import { GRASS_MAX_PER_TILE, plantGrass, tileTop } from './grass';

const loc = generateLocation(4242, 2);

/** Клетка, в которой стоит корень. */
const cellOf = (roots: Float32Array, i: number): { x: number; z: number } => ({
  x: Math.round(roots[i * 3]!),
  z: Math.round(roots[i * 3 + 2]!),
});

describe('Трава', () => {
  test('в камне не растёт', () => {
    const plan = plantGrass(loc, 8);
    const total = plan.perPass * plan.passes;
    assert.ok(total > 0, 'локация без единой травинки — уже поломка');
    for (let i = 0; i < total; i++) {
      const c = cellOf(plan.roots, i);
      assert.equal(loc.blocked[idx(loc.size, c.x, c.z)], 0, `травинка в камне: ${c.x},${c.z}`);
    }
  });

  test('§11.1 — выход и добыча не зарастают', () => {
    const plan = plantGrass(loc, 8);
    const total = plan.perPass * plan.passes;
    const forbidden = new Set<number>([idx(loc.size, loc.evac.x, loc.evac.z)]);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      forbidden.add(idx(loc.size, loc.evac.x + dx, loc.evac.z + dz));
    }
    for (const c of loc.containers) forbidden.add(idx(loc.size, c.x, c.z));

    for (let i = 0; i < total; i++) {
      const c = cellOf(plan.roots, i);
      assert.ok(
        !forbidden.has(idx(loc.size, c.x, c.z)),
        `трава на выходе или на контейнере: ${c.x},${c.z}`,
      );
    }
  });

  test('§6 — та же локация выглядит так же', () => {
    const a = plantGrass(generateLocation(777, 1), 6);
    const b = plantGrass(generateLocation(777, 1), 6);
    assert.deepEqual(Array.from(a.roots), Array.from(b.roots));

    const other = plantGrass(generateLocation(778, 1), 6);
    assert.notDeepEqual(Array.from(a.roots), Array.from(other.roots), 'сид ни на что не влияет');
  });

  test('плотность прореживает поле равномерно, а не лысинами', () => {
    const plan = plantGrass(loc, GRASS_MAX_PER_TILE);
    // Так плотность и меняется в игре: mesh.count = perPass × проходов.
    const thin = plan.perPass * 2;
    const cells = new Set<number>();
    for (let i = 0; i < thin; i++) {
      const c = cellOf(plan.roots, i);
      cells.add(idx(loc.size, c.x, c.z));
    }
    assert.equal(
      cells.size,
      plan.perPass,
      'два прохода обязаны накрыть все травяные клетки по разу',
    );
  });

  test('корень лежит на крышке своей клетки', () => {
    const plan = plantGrass(loc, 4);
    const total = plan.perPass * plan.passes;
    for (let i = 0; i < total; i++) {
      const c = cellOf(plan.roots, i);
      // fround: в Float32Array double уже округлён, и сравнивать надо с ним.
      assert.equal(
        plan.roots[i * 3 + 1],
        Math.fround(tileTop(c.x, c.z)),
        'травинка висит над землёй или тонет в ней',
      );
    }
  });
});
