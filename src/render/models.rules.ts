/**
 * Правила артбука. Проверяется не то, как модель выглядит, — это решает глаз, —
 * а два обещания, которые артбук даёт числами и которые молча протухают:
 * бюджет треугольников и палитра из 28 цветов.
 *
 * До сих пор оба держались на ревью («проверяется на ревью при добавлении
 * модели, а не скриптом на CI» — артбук, раздел 02). Ревью помнит хуже теста.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { BUILDING_ORDER } from '../sim/camp';
import { CLASS_ORDER } from '../sim/heroes';
import type { EnemyKind } from '../sim/types';
import { C, triangles } from './blocking';
import { buildingGeometry, enemyGeometry, heroGeometry, stageOf, villagerGeometry } from './models';

/** Артбук, раздел 03: здание ≤ 1500, герой ≤ 900, враг ≤ 700. */
const BUDGET = { building: 1500, hero: 900, enemy: 700 } as const;

/** По одному уровню на каждую стадию роста. */
const LEVEL_OF_STAGE = [1, 3, 5] as const;

const ENEMIES: readonly EnemyKind[] = ['scavenger', 'spearman', 'golem'];

describe('Артбук: бюджет треугольников', () => {
  test('здание укладывается в 1500 на каждой стадии', () => {
    for (const id of BUILDING_ORDER) {
      for (const level of LEVEL_OF_STAGE) {
        const geo = buildingGeometry(id, level);
        const t = triangles(geo);
        geo.dispose();
        assert.ok(t <= BUDGET.building, `${id} ур. ${level}: ${t} > ${BUDGET.building}`);
      }
    }
  });

  test('герой укладывается в 900, житель тоже', () => {
    for (const cls of CLASS_ORDER) {
      const geo = heroGeometry(cls);
      const t = triangles(geo);
      geo.dispose();
      assert.ok(t <= BUDGET.hero, `${cls}: ${t} > ${BUDGET.hero}`);
    }
    const v = villagerGeometry();
    const t = triangles(v);
    v.dispose();
    assert.ok(t <= BUDGET.hero, `житель: ${t} > ${BUDGET.hero}`);
  });

  test('противник укладывается в 700', () => {
    for (const kind of ENEMIES) {
      const geo = enemyGeometry(kind);
      const t = triangles(geo);
      geo.dispose();
      assert.ok(t <= BUDGET.enemy, `${kind}: ${t} > ${BUDGET.enemy}`);
    }
  });

  test('шесть уровней укладываются в три стадии', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(stageOf), [0, 0, 1, 1, 2, 2]);
  });
});

describe('Артбук: палитра', () => {
  /**
   * Цвет берётся из палитры, а не назначается на месте. Исходник читается
   * текстом по той же причине, по какой это делает `scripts/arch.ts`: цвет
   * запечён в вершины при сборке модели, и обратно из геометрии его не достать.
   */
  test('в моделях нет цветов мимо палитры', () => {
    const src = readFileSync(new URL('./models.ts', import.meta.url), 'utf8');
    const palette = new Set(Object.values(C).map((c) => c.toLowerCase()));
    /**
     * Два цвета взяты из самого артбука, где они тоже стоят литералами мимо
     * списка: ткань Следопыта и глаза падальщика. Исключение названо здесь,
     * чтобы оно было видно, а не растворилось среди прочих литералов.
     */
    const fromArtbook = new Set(['#35454e', '#8e3838']);

    const stray = [...src.matchAll(/'(#[0-9a-fA-F]{6})'/g)]
      .map((m) => m[1]!.toLowerCase())
      .filter((hex) => !palette.has(hex) && !fromArtbook.has(hex));

    assert.deepEqual([...new Set(stray)], [], 'цвет мимо 28 из артбука');
  });

  test('палитра — ровно 28 цветов', () => {
    assert.equal(Object.keys(C).length, 28);
  });
});
