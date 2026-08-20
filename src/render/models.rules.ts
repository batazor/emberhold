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
import { HERO_MODELS, buildingGeometry, enemyGeometry, heroGeometry, stageOf, villagerGeometry } from './models';

/** Артбук, раздел 03: здание ≤ 1500, герой ≤ 900, враг ≤ 700. */
const BUDGET = { building: 1500, hero: 900, enemy: 700 } as const;

/**
 * §6.1.3: у класса с моделью набора цена не в кадре, а в бандле. В кадре
 * такой герой один — и в лагере, и в вылазке, — поэтому треугольники его
 * не ограничивают; ограничивают килобайты, которые скачивает каждый игрок.
 * Потолок на одного персонажа, а не на всех: сколько их взять — решение,
 * и оно должно приниматься строкой в HERO_MODELS, а не молча.
 */
const BAKED_KB = 200;

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

  test('герой-примитив укладывается в 900, житель тоже', () => {
    for (const cls of CLASS_ORDER) {
      // Класс с моделью набора мерится не здесь: у него другой бюджет.
      if (HERO_MODELS[cls] !== undefined) continue;
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

  test(`запечённый персонаж стоит не дороже ${BAKED_KB} КБ в бандле`, () => {
    // Меряется сам файл данных: в бандл едет он, а не геометрия в памяти.
    const src = readFileSync(new URL('./adventurers.data.ts', import.meta.url), 'utf8');
    const blocks = [...src.matchAll(/'([^']+)': \{[\s\S]*?pos: '([^']*)',[\s\S]*?slot: '([^']*)',/g)];
    assert.ok(blocks.length > 0, 'в adventurers.data.ts нет ни одной модели');
    for (const [, name, pos, slot] of blocks) {
      const kb = (pos!.length + slot!.length) / 1024;
      assert.ok(kb <= BAKED_KB, `${name}: ${kb.toFixed(0)} КБ > ${BAKED_KB} КБ`);
    }
    // И столько же моделей, сколько вписано классам: лишняя едет молча.
    assert.equal(blocks.length, Object.keys(HERO_MODELS).length, 'запечено не то, что вписано');
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

  test('палитра — ровно 32 цвета', () => {
    assert.equal(Object.keys(C).length, 32);
  });

  /**
   * Список цветов написан руками дважды: здесь он код, в `artbook.html` — арт-байбл
   * с образцами. Такие копии расходятся молча, и однажды уже разошлись: сталь
   * завелась в коде вторым списком под другим именем, отличаясь на три единицы
   * из семисот шестидесяти пяти. Сверяются значения, а не подписи: подписи
   * на странице человеческие, в коде — короткие, и приводить их друг к другу
   * значило бы завести третий список.
   */
  test('палитра артбука и палитра кода — один список', () => {
    const src = readFileSync(new URL('../../artbook.html', import.meta.url), 'utf8');
    const shown = [...src.matchAll(/\["[^"]+","(#[0-9a-f]{6})"\]/g)].map((m) => m[1]!);
    const code = Object.values(C).map((c) => c.toLowerCase());
    assert.deepEqual([...shown].sort(), [...code].sort(), 'artbook.html и colors.ts разошлись');
  });
});
