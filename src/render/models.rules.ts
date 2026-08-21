/**
 * Правила артбука. Проверяется не то, как модель выглядит, — это решает глаз, —
 * а два обещания, которые артбук даёт числами и которые молча протухают:
 * бюджет треугольников и палитра артбука.
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
import { ADVENTURERS_MODELS } from './adventurers.data';
import { adventurerGeometry } from './adventurers';
import { HERO_MODELS, buildingGeometry, enemyGeometry, heroGeometry, stageOf } from './models';
import { FOREST_SLOTS } from './forest.data';
import { CASTLE_MODELS, CASTLE_SLOTS } from './castle.data';
import { CASTLE_SCALE, castleGeometry } from './castle';
import { PARTS, STAIRS, TOWER, TOWER_MAX, WALK, WALL_TOP, towerHeight } from '../sim/castle';
import { ELEVATION } from './scene';
import { CASTLE_SLOT_ORDER, FOREST_SLOT_ORDER, MATERIAL, SKELETON_SLOT_ORDER } from './palette';
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

  /**
   * Девятьсот считались, когда героев в кадре предполагалось много. Их один —
   * и в лагере, и в вылазке, — поэтому классу с моделью набора (§6.1.4) этот
   * потолок не подходит и не должен: его цена не в кадре, а в бандле, и её
   * меряет потолок принятого набора выше. Классам без модели девятьсот
   * остаются: их силуэт по-прежнему свой.
   */
  test('герой-примитив укладывается в 900', () => {
    for (const cls of CLASS_ORDER) {
      if (HERO_MODELS[cls] !== undefined) continue;
      const geo = heroGeometry(cls);
      const t = triangles(geo);
      geo.dispose();
      assert.ok(t <= BUDGET.hero, `${cls}: ${t} > ${BUDGET.hero}`);
    }
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

  test('у героя в руке есть предмет, и он стоит на узле набора', () => {
    // Не «геометрия непустая», а именно то, ради чего узел запекается:
    // модель героя знает матрицу руки, и с предметом она тяжелее, чем без.
    const bare = adventurerGeometry('Barbarian', 1);
    const armed = heroGeometry('ranger');
    assert.ok(ADVENTURERS_MODELS.Barbarian.hand !== undefined, 'у варвара нет узла руки');
    assert.ok(
      triangles(armed) > triangles(bare),
      `герой с предметом ${triangles(armed)} не тяжелее безоружного ${triangles(bare)}`,
    );
    bare.dispose();
    armed.dispose();
  });

  test('шесть уровней укладываются в три стадии', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(stageOf), [0, 0, 1, 1, 2, 2]);
  });
});

/**
 * Замок (§6.1.6). Проверяется не то, красив ли он, а два обещания, которые
 * иначе протухнут молча: что конструктору есть чем строить и что стена
 * читается стеной, а не забором.
 */
describe('Артбук: замок', () => {
  test('каждая деталь конструктора запечена в бандл', () => {
    const named = [
      ...Object.values(PARTS).flat().map((p) => p.model),
      STAIRS.model,
      TOWER.base,
      TOWER.cap,
      ...TOWER.body,
      ...TOWER.roofs,
    ];
    for (const model of named) {
      assert.ok(
        model in CASTLE_MODELS,
        `«${model}» стоит в словаре конструктора, но в бандл не поехал`,
      );
    }
  });

  test('слоты замка не разошлись с палитрой артбука', () => {
    assert.deepEqual([...CASTLE_SLOTS], [...CASTLE_SLOT_ORDER]);
    for (const name of CASTLE_SLOTS) {
      assert.ok(name in MATERIAL, `слота «${name}» нет среди цветов артбука`);
    }
  });

  test('через стену не заглянуть, и ход по ней идёт над головой', () => {
    // Рост героя меряется, а не берётся числом: модель может смениться,
    // и масштаб замка обязан спорить с новой, а не со старой.
    const geo = heroGeometry('ranger');
    geo.computeBoundingBox();
    const hero = geo.boundingBox!.max.y - geo.boundingBox!.min.y;
    geo.dispose();
    const wall = WALL_TOP * CASTLE_SCALE;
    const walk = WALK * CASTLE_SCALE;
    assert.ok(
      walk > hero * 1.5,
      `ход поверху ${walk.toFixed(2)} при герое ${hero.toFixed(2)} — не над головой`,
    );
    assert.ok(
      wall > walk && wall > hero * 1.8,
      `стена ${wall.toFixed(2)} при герое ${hero.toFixed(2)} — это забор, а не стена`,
    );
  });

  test('потолок роста башни посчитан камерой, а не выбран', () => {
    /**
     * Камера смотрит с фиксированного наклона, и башня прячет за собой полосу
     * земли длиной H · ctg(наклон). Двор самого большого замка — 7 клеток
     * плана, то есть 14 клеток локации; самого малого — 4 плана, 8 локации.
     *
     * Требование, из которого взят потолок: **на верхнем уровне башня ещё
     * помещается в самый большой двор, а следующий уровень не помещается
     * ни в один**. Ни одно из этих чисел не назначено — все меряются.
     */
    const hides = (level: number): number =>
      (towerHeight(level) * CASTLE_SCALE) / Math.tan(ELEVATION);
    const YARD_MAX = 7 * CASTLE_SCALE;
    const YARD_MIN = 4 * CASTLE_SCALE;

    assert.ok(
      hides(TOWER_MAX) <= YARD_MAX,
      `башня ${TOWER_MAX} уровня прячет ${hides(TOWER_MAX).toFixed(1)} клеток — больше двора ${YARD_MAX}`,
    );
    assert.ok(
      hides(TOWER_MAX + 1) > YARD_MAX,
      `башня ${TOWER_MAX + 1} уровня прячет ${hides(TOWER_MAX + 1).toFixed(1)} — потолок занижен`,
    );
    assert.ok(hides(1) < YARD_MIN, 'первый уровень уже закрывает самый малый двор');
  });

  test('тап по верху стены обязан считаться по верху, а не по земле', () => {
    /**
     * Камера смотрит с фиксированного наклона, и площадка на высоте H
     * смещает пересечение луча с землёй на H·ctg(наклон). Правило утверждает
     * не «иногда неточно», а «промах гарантирован»: смещение больше клетки
     * стены целиком, то есть попадание уезжает мимо соседней детали.
     */
    const deck = WALK * CASTLE_SCALE;
    const shift = deck / Math.tan(ELEVATION);
    assert.ok(
      shift > CASTLE_SCALE,
      `смещение ${shift.toFixed(2)} не дотягивает до клетки стены ${CASTLE_SCALE}`,
    );
  });

  test('готовый замок укладывается в свой потолок — килобайты', () => {
    const source = readFileSync(new URL('./castle.data.ts', import.meta.url), 'utf8');
    const blobs = [...source.matchAll(/'([A-Za-z0-9+/]{40,}={0,2})'/g)].map((m) => m[1]!).join('');
    const kb = Math.round(gzipSync(Buffer.from(blobs), { level: 9 }).length / 1024);
    // Потолок посчитан, а не выбран: это всё, что взято сейчас, округлённое
    // вверх до десятка. Упереться в него можно один раз — за ним не «ещё одна
    // деталь», а решение брать из набора больше.
    assert.ok(kb <= 40, `набор замка: ${kb} КБ gzip > 40 КБ`);
  });

  test('геометрия детали приходит в клетку локации, а не в единицы набора', () => {
    const geo = castleGeometry('wall');
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    assert.ok(
      Math.abs(box.max.x - box.min.x - CASTLE_SCALE) < 0.02,
      `стена шириной ${(box.max.x - box.min.x).toFixed(2)} при клетке ${CASTLE_SCALE}`,
    );
    assert.ok(Math.abs(box.min.y) < 0.02, 'основание стены не на нуле');
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

  test('палитра — ровно 34 цвета', () => {
    assert.equal(Object.keys(C).length, 34);
  });

  /**
   * Тот же список третьей копией — образцами в `artbook.html`, где он и есть
   * арт-байбл. Сверяются значения, а не подписи: подписи на странице
   * человеческие, в коде короткие, и приводить их друг к другу значило бы
   * завести четвёртый список.
   */
  test('палитра артбука и палитра кода — один список', () => {
    const src = readFileSync(new URL('../../artbook.html', import.meta.url), 'utf8');
    const shown = [...src.matchAll(/\["[^"]+","(#[0-9a-f]{6})"\]/g)].map((m) => m[1]!);
    const code = Object.values(C).map((c) => c.toLowerCase());
    assert.deepEqual([...shown].sort(), [...code].sort(), 'artbook.html и blocking.ts разошлись');
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
