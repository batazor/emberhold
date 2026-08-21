/**
 * Правила верха стены (§6.1.6). Проверяется не то, красиво ли герой стоит
 * на зубцах, а четыре обещания второго яруса.
 *
 * Первое: **граф верха выведен из обмера, а не написан руками.** Настил берётся
 * из `DECK`, открытые рёбра — из `Part.open`, поворот — из `fitTurn`. Если
 * завтра в набор придёт деталь с другим ходом, граф обязан измениться сам.
 *
 * Второе: **разрывы держатся.** Башня и надвратная шапка имеют настил на той же
 * высоте, что стена, но зубцы у них по всем четырём рёбрам — войти неоткуда,
 * и в граф они не входят.
 *
 * Третье: **наверх только по лестнице.** Без неё верх недостижим ни из одной
 * клетки земли, и это не следствие планировки, а правило.
 *
 * Четвёртое: **граф считается, а не хранится.** Построили, снесли, построили —
 * тот же граф.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { CASTLE_CELL, DECK, DIRS, PARTS, STAIRS, fitTurn, keyOf, turnDir } from './castle';
import { campArea, createCamp, type CampState } from './camp';
import { campBlocked } from './campWalk';
import {
  cycleTower,
  emptyWalls,
  putStairs,
  raiseWall,
  razeWall,
  stairsBlock,
  toggleGate,
  type WallSite,
} from './campWalls';
import { outward, topCenter, topWalkable, wallTop, type WallTop } from './campTop';
import { idx } from './grid';

const catalog = JSON.parse(
  readFileSync(new URL('../../assets/kenney-castle-kit/catalog.json', import.meta.url), 'utf8'),
) as { models: readonly { name: string; deck: number | null }[] };
const measured = new Map(catalog.models.map((m) => [m.name, m]));

const bigCamp = (): CampState => {
  const camp = createCamp();
  camp.levels.hq = 5;
  camp.walls = emptyWalls();
  return camp;
};

/**
 * Площадка без зданий: правила этого файла про верх стены, а не про то, где
 * стоит Жильё. С настоящей раскладкой стена в углу просто не встала бы,
 * и правило мерило бы отказ стройки.
 */
const siteOf = (camp: CampState): WallSite => ({
  area: campArea(camp.levels.hq),
  layout: {},
  levels: {},
});

const topOf = (camp: CampState): WallTop => {
  const area = campArea(camp.levels.hq);
  // Земля берётся пустой по той же причине, по какой пуста площадка: здания
  // здесь ни при чём, а занятая клетка у подножия отменила бы портал.
  return wallTop(camp.walls!, area, new Uint8Array(area * area));
};

/** Клетки, по верху которых ходят, — в том виде, в каком их ждёт лестница. */
const topsOf = (top: WallTop): Set<string> => {
  const out = new Set<string>();
  for (let z = 0; z < top.grid; z++) {
    for (let x = 0; x < top.grid; x++) if (topWalkable(top, { x, z })) out.add(`${x}:${z}`);
  }
  return out;
};

describe('Верх стены: граф выведен из обмера', () => {
  test('таблица настилов совпадает с каталогом набора', () => {
    for (const [model, deck] of Object.entries(DECK)) {
      const it = measured.get(model);
      assert.ok(it !== undefined, `детали «${model}» в каталоге нет`);
      assert.equal(deck, it.deck, `«${model}»: объявлено ${deck}, измерено ${it.deck}`);
    }
  });

  test('ход поверху есть только там, где деталь его измерила', () => {
    const camp = bigCamp();
    raiseWall(camp.walls!, siteOf(camp), [{ x: 0, z: 0 }, { x: 3, z: 0 }]);
    const top = topOf(camp);
    for (let x = 0; x <= 3; x++) {
      assert.ok(topWalkable(top, { x, z: 0 }), `по стене ${x},0 не ходят`);
      // Настил измерен и переведён в клетки лагеря — это высота, а не флаг.
      assert.ok(top.deck[idx(top.grid, x, 0)]! > 0, `у ${x},0 нет высоты`);
    }
    assert.ok(!topWalkable(top, { x: 0, z: 2 }), 'ход появился там, где стены нет');
  });

  test('граф верха симметричен: соседи открыты друг другу', () => {
    const camp = bigCamp();
    raiseWall(camp.walls!, siteOf(camp), [
      { x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }, { x: 0, z: 3 }, { x: 0, z: 0 },
    ]);
    const top = topOf(camp);
    for (let z = 0; z < top.grid; z++) {
      for (let x = 0; x < top.grid; x++) {
        if (!topWalkable(top, { x, z })) continue;
        const mask = top.links[idx(top.grid, x, z)]!;
        for (let dir = 0; dir < 4; dir++) {
          const nx = x + DIRS[dir]![0];
          const nz = z + DIRS[dir]![1];
          if (!topWalkable(top, { x: nx, z: nz })) continue;
          const back = top.links[idx(top.grid, nx, nz)]!;
          const there = (mask & (1 << dir)) !== 0;
          // Обратное направление: −x ↔ +x, −z ↔ +z.
          const home = (back & (1 << (dir ^ 1))) !== 0;
          assert.equal(there, home, `рёбра ${x},${z} и ${nx},${nz} разошлись`);
        }
      }
    }
  });

  test('лестница смотрит вверх и вниз противоположно', () => {
    for (let turn = 0; turn < 4; turn++) {
      const up = turnDir(2, turn);
      const down = turnDir(3, turn);
      assert.equal(DIRS[up]![0] + DIRS[down]![0], 0, `поворот ${turn}: подъём и спуск не напротив`);
      assert.equal(DIRS[up]![1] + DIRS[down]![1], 0, `поворот ${turn}: подъём и спуск не напротив`);
    }
    // Поворот выводится тем же `fitTurn`, что в замке, а не своей таблицей.
    for (let dir = 0; dir < 4; dir++) {
      const turn = fitTurn(STAIRS.open, [dir]);
      assert.ok(turn >= 0, `на направление ${dir} поворота нет`);
      assert.equal(turnDir(2, turn), dir, `поворот ${turn} смотрит не туда`);
    }
  });
});

describe('Верх стены: разрывы', () => {
  test('башня рвёт ход — площадка есть, войти неоткуда', () => {
    const camp = bigCamp();
    const site = siteOf(camp);
    raiseWall(camp.walls!, site, [{ x: 0, z: 0 }, { x: 4, z: 0 }]);
    cycleTower(camp.walls!, site, { x: 2, z: 0 });
    const top = topOf(camp);
    // Настил у шапки башни измерен и лежит на той же высоте, что у стены,
    // но зубцы стоят по всем четырём рёбрам.
    assert.equal(measured.get('tower-square-top')!.deck, DECK['tower-square-top']);
    assert.ok(!topWalkable(top, { x: 2, z: 0 }), 'по башне ходят');
    assert.ok(topWalkable(top, { x: 1, z: 0 }) && topWalkable(top, { x: 3, z: 0 }));
  });

  test('надвратная шапка рвёт ход так же', () => {
    const camp = bigCamp();
    raiseWall(camp.walls!, siteOf(camp), [{ x: 0, z: 0 }, { x: 4, z: 0 }]);
    toggleGate(camp.walls!, { x: 2, z: 0 });
    const top = topOf(camp);
    assert.ok(!topWalkable(top, { x: 2, z: 0 }), 'по верху ворот ходят');
  });

  test('одиночная стена — не площадка: островок местом не считается', () => {
    const camp = bigCamp();
    raiseWall(camp.walls!, siteOf(camp), [{ x: 2, z: 2 }]);
    const top = topOf(camp);
    // `tower-square` — деталь одиночной клетки: настил 1.18, рёбра закрыты.
    assert.equal(DECK['tower-square'], 1.18);
    assert.ok(!topWalkable(top, { x: 2, z: 2 }), 'на островок можно попасть');
  });

  test('у клетки хода есть наружная сторона — задел под оборону', () => {
    const camp = bigCamp();
    raiseWall(camp.walls!, siteOf(camp), [{ x: 0, z: 0 }, { x: 3, z: 0 }]);
    const top = topOf(camp);
    // Стена тянется вдоль x, значит ход открыт по −x и +x, а наружу смотрят
    // два ребра поперёк — −z и +z. Это и есть ответ, который понадобится
    // стрельбе: куда клетка стены обращена.
    const out = outward(top, { x: 1, z: 0 });
    assert.deepEqual([...out].sort(), [2, 3], `наружу смотрят ${out}`);
  });
});

describe('Верх стены: лестница', () => {
  test('без лестницы наверх не попасть — порталов нет', () => {
    const camp = bigCamp();
    raiseWall(camp.walls!, siteOf(camp), [
      { x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }, { x: 0, z: 3 }, { x: 0, z: 0 },
    ]);
    assert.equal(topOf(camp).portals.length, 0, 'наверх попадают без лестницы');
  });

  test('лестница даёт портал, снос его убирает', () => {
    const camp = bigCamp();
    const site = siteOf(camp);
    raiseWall(camp.walls!, site, [{ x: 0, z: 0 }, { x: 3, z: 0 }]);
    assert.ok(putStairs(camp.walls!, site, { x: 1, z: 1 }, topsOf(topOf(camp))));
    const top = topOf(camp);
    assert.equal(top.portals.length, 1, 'портала нет');
    const portal = top.portals[0]!;
    assert.deepEqual(portal.landing, { x: 1, z: 0 }, 'лестница выводит не на ту клетку');
    assert.ok(portal.rise > 0, 'подъём нулевой');
    // Подножие стоит на земле и свободно.
    assert.equal(campBlocked(camp)[idx(campArea(camp.levels.hq), portal.foot.x, portal.foot.z)], 0);

    razeWall(camp.walls!, { x: 1, z: 1 });
    assert.equal(topOf(camp).portals.length, 0, 'снос лестницы портал не убрал');
  });

  test('лестница к глухой башне не встаёт — вести ей некуда', () => {
    const camp = bigCamp();
    const site = siteOf(camp);
    // Одиночная клетка стены — «одиночная», у неё рёбра закрыты.
    raiseWall(camp.walls!, site, [{ x: 3, z: 3 }]);
    const tops = topsOf(topOf(camp));
    assert.equal(stairsBlock(camp.walls!, site, { x: 3, z: 4 }, tops), 'nowhere');
    assert.ok(!putStairs(camp.walls!, site, { x: 3, z: 4 }, tops), 'лестница встала в никуда');
  });

  test('портал исчезает, если площадку наверху снесли', () => {
    const camp = bigCamp();
    const site = siteOf(camp);
    raiseWall(camp.walls!, site, [{ x: 0, z: 0 }, { x: 3, z: 0 }]);
    putStairs(camp.walls!, site, { x: 1, z: 1 }, topsOf(topOf(camp)));
    assert.equal(topOf(camp).portals.length, 1);
    razeWall(camp.walls!, { x: 1, z: 0 });
    assert.equal(topOf(camp).portals.length, 0, 'лестница ведёт в снесённую стену');
  });

  test('высота портала — измеренный настил, переведённый в клетки лагеря', () => {
    const camp = bigCamp();
    const site = siteOf(camp);
    raiseWall(camp.walls!, site, [{ x: 0, z: 0 }, { x: 3, z: 0 }]);
    putStairs(camp.walls!, site, { x: 1, z: 1 }, topsOf(topOf(camp)));
    const portal = topOf(camp).portals[0]!;
    assert.equal(portal.rise, DECK['wall']! * CASTLE_CELL, 'высота не из замера');
  });
});

describe('Верх стены: граф считается, а не хранится', () => {
  test('построили, снесли, построили — тот же граф', () => {
    const camp = bigCamp();
    const site = siteOf(camp);
    const path = [{ x: 0, z: 0 }, { x: 3, z: 0 }];
    raiseWall(camp.walls!, site, path);
    const before = [...topOf(camp).blocked];
    for (let x = 0; x <= 3; x++) razeWall(camp.walls!, { x, z: 0 });
    assert.deepEqual([...topOf(camp).blocked].filter((v) => v === 0), [], 'после сноса ход остался');
    raiseWall(camp.walls!, site, path);
    assert.deepEqual([...topOf(camp).blocked], before, 'граф пересобрался иначе');
  });

  test('центр клетки стены — тот же, каким её рисует сцена', () => {
    // Рендер ставит деталь в `spot * CASTLE_CELL + (CASTLE_CELL - 1) / 2`.
    for (const spot of [{ x: 0, z: 0 }, { x: 2, z: 3 }]) {
      assert.deepEqual(topCenter(spot), {
        x: spot.x * CASTLE_CELL + (CASTLE_CELL - 1) / 2,
        z: spot.z * CASTLE_CELL + (CASTLE_CELL - 1) / 2,
      });
    }
  });

  test('каждая деталь словаря знает свой настил', () => {
    for (const part of [...Object.values(PARTS).flat(), STAIRS]) {
      assert.ok(part.model in DECK, `у «${part.model}» настил не объявлен`);
      assert.ok(keyOf({ x: 0, z: 0 }) === '0:0', 'ключ клетки сменил форму');
    }
  });
});
