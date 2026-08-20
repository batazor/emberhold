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
import { gzipSync } from 'node:zlib';
import { describe, test } from 'node:test';
import { BUILDING_ORDER } from '../sim/camp';
import { CLASS_ORDER } from '../sim/heroes';
import type { EnemyKind } from '../sim/types';
import { C, triangles } from './blocking';
import { buildingGeometry, enemyGeometry, heroGeometry, stageOf, villagerGeometry } from './models';
import { FOREST_SLOTS } from './forest.data';
import { FOREST_SLOT_ORDER, MATERIAL, SKELETON_SLOT_ORDER } from './palette';
import { SKELETON_SLOTS } from './skeleton.data';

/**
 * Артбук, раздел 03: здание ≤ 1500, герой ≤ 900.
 *
 * Бюджет в треугольниках — про модель, которую рисуют руками: §6.1 объясняет
 * его двумя вещами, «читалась на пяти сантиметрах экрана» и «рисовалась
 * за вечер». Противника в списке нет и не будет: он берётся готовым, и обе
 * половины обоснования к нему не относятся — рисовать нечего, а силуэт
 * треугольниками не меряется. Цена готовой модели одна и она другая:
 * килобайты в бандле у всех игроков (§6.1.3).
 */
const BUDGET = { building: 1500, hero: 900 } as const;

/**
 * Потолок принятого набора: сколько он весит в бандле, а не в кадре.
 *
 * **Мерка — gzip, а не base64.** Первая версия этого правила считала символы
 * base64, и это оказалось не тем: при переходе на индексированную запись
 * со скином они выросли на 8%, а то, что скачивает игрок, — на 51%. Индексы
 * и байты костей жмутся заметно хуже квантованных позиций, и потолок
 * в base64 такого прироста просто не видит.
 *
 * Число не выбрано, а посчитано: это **весь состав, который вообще может
 * понадобиться врагам** — четыре скелета и всё их оружие, 252 КБ gzip.
 * Округлено вверх. Смысл потолка в том, что упереться в него можно ровно
 * один раз: за ним не «ещё один противник», а второй набор, и это отдельное
 * решение, а не строка в списке.
 *
 * Сейчас занято 190 КБ из 260 — трое противников §15, топор, посох, скелет
 * и пять состояний §17.1.
 */
const PACK_KB = 260;

/** По одному уровню на каждую стадию роста. */
const LEVEL_OF_STAGE = [1, 3, 5] as const;

const ENEMY_KINDS: readonly EnemyKind[] = ['minion', 'warrior', 'mage'];

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

  /**
   * Потолка в треугольниках у противника больше нет, но опечатка в имени
   * модели набора даёт пустую геометрию — и молча: противник просто
   * не рисуется, а игра работает.
   */
  test('у каждого противника §15 есть модель', () => {
    for (const kind of ENEMY_KINDS) {
      const geo = enemyGeometry(kind);
      const t = triangles(geo);
      geo.dispose();
      assert.ok(t > 0, `${kind}: пустая геометрия`);
    }
  });

  test('готовый набор противников укладывается в свой потолок — килобайты', () => {
    /**
     * Считается по самому файлу и в gzip: перечислять поля руками — способ
     * не заметить новое. Когда к позициям добавились индексы, кости и веса,
     * прежний счёт по двум полям молча остался прежним, а бандл вырос.
     */
    const source = readFileSync(new URL('./skeleton.data.ts', import.meta.url), 'utf8');
    const blobs = [...source.matchAll(/'([A-Za-z0-9+/]{40,}={0,2})'/g)].map((m) => m[1]!).join('');
    const kb = Math.round(gzipSync(Buffer.from(blobs), { level: 9 }).length / 1024);
    assert.ok(kb <= PACK_KB, `набор скелетов: ${kb} КБ gzip > ${PACK_KB} КБ`);
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
     * Один цвет взят из самого артбука, где он тоже стоит литералом мимо
     * списка, — ткань Следопыта. Исключение названо здесь, чтобы оно было
     * видно, а не растворилось среди прочих литералов. Второе исключение,
     * глаза противника, ушло вместе с примитивными врагами: их рисует набор.
     */
    const fromArtbook = new Set(['#35454e']);

    const stray = [...src.matchAll(/'(#[0-9a-fA-F]{6})'/g)]
      .map((m) => m[1]!.toLowerCase())
      .filter((hex) => !palette.has(hex) && !fromArtbook.has(hex));

    assert.deepEqual([...new Set(stray)], [], 'цвет мимо 28 из артбука');
  });

  test('палитра — ровно 28 цветов', () => {
    assert.equal(Object.keys(C).length, 28);
  });

  /**
   * Список цветов один, а имён у него два: короткие латинские ключи, которыми
   * красятся примитивы, и русские имена слотов, которыми красятся готовые
   * наборы. Разойтись они могут молча — и тогда «единая палитра» из §6.1
   * станет двумя палитрами, похожими друг на друга.
   */
  /**
   * Порядок слотов набора живёт в двух местах: его пишет `npm run models`
   * рядом с геометрией и повторяет `palette.ts`, чтобы страницам не приходилось
   * тянуть геометрию ради имён. Расходятся такие пары молча — и тогда набор
   * перекрашивается со сдвигом на слот, а выглядит это как «художник ошибся».
   */
  test('порядок слотов в палитре — тот же, что в запечённом наборе', () => {
    assert.deepEqual([...FOREST_SLOT_ORDER], [...FOREST_SLOTS]);
    assert.deepEqual([...SKELETON_SLOT_ORDER], [...SKELETON_SLOTS]);
  });

  test('цвета примитивов и цвета наборов — один список', () => {
    const primitives = [...new Set(Object.values(C).map((c) => c.toLowerCase()))].sort();
    const slots = [...new Set(Object.values(MATERIAL).map((n) => `#${n.toString(16).padStart(6, '0')}`))].sort();
    assert.deepEqual(slots, primitives);
  });
});
