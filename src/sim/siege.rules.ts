/**
 * Правила набега на лагерь (§6.1.6).
 *
 * Главное здесь — не числа, а два запрета. Набег не имеет права трогать
 * прогресс (§10.2), и кольцо обязано работать так, как ждёт всякий, кто
 * когда-нибудь строил стену: дыра отменяет стену.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { campArea, createCamp } from './camp';
import { emptyWalls, wallGrid } from './campWalls';
import type { CampWalls, WallSite } from './campWalls';
import { keyOf } from './castle';
import {
  RAID_HOURS,
  RAID_MAX_PENDING,
  TOWER_COVER,
  exposed,
  raidIndex,
  raidTake,
  resolveRaids,
} from './siege';

const HOUR = 3600;

const siteOf = (hq: number, layout: Record<string, { x: number; z: number }>): WallSite => ({
  area: campArea(hq),
  layout,
  levels: { hq },
});

/** Замкнутое кольцо по краю площади. */
function ring(area: number): CampWalls {
  const walls = emptyWalls();
  const grid = wallGrid(area);
  for (let i = 0; i < grid; i++) {
    for (const spot of [{ x: i, z: 0 }, { x: i, z: grid - 1 }, { x: 0, z: i }, { x: grid - 1, z: i }]) {
      const key = keyOf(spot);
      if (!walls.cells.includes(key)) walls.cells.push(key);
    }
  }
  return walls;
}

/** То же кольцо, но с проломом посреди стороны — там, где он и бывает. */
function breach(area: number): CampWalls {
  const walls = ring(area);
  const grid = wallGrid(area);
  const hole = keyOf({ x: Math.floor(grid / 2), z: 0 });
  walls.cells = walls.cells.filter((c) => c !== hole);
  return walls;
}

/** Здание в середине площади — там, куда кольцо и строят. */
const middle = (area: number): Record<string, { x: number; z: number }> => {
  const grid = wallGrid(area);
  const mid = Math.floor(grid / 2);
  // Клетка стены крупнее клетки лагеря, поэтому координата здания умножается.
  return { hq: { x: mid * 2, z: mid * 2 } };
};

describe('Набег на лагерь (§6.1.6)', () => {
  test('замкнутое кольцо не пускает, а кольцо с дырой не защищает', () => {
    // Это и есть вся механика стены. Полукольцо, обходимое с торца, обязано
    // давать ровно то же, что и голое поле: игрок, однажды строивший стену
    // в любой другой игре, ждёт именно этого.
    const hq = 5;
    const area = campArea(hq);
    const site = siteOf(hq, middle(area));

    const closed = ring(area);
    assert.deepEqual(exposed(closed, site), [], 'замкнутое кольцо пропустило набег');

    const holed = breach(area);
    assert.deepEqual(exposed(holed, site), ['hq'], 'кольцо с дырой защитило');

    assert.equal(raidTake(closed, site), 0);
    assert.ok(raidTake(holed, site) > 0);
  });

  test('снесённый угол — не дыра', () => {
    // Свойство волны, а не случайность, и знать его полезно: у угловой клетки
    // оба соседа по кольцу на месте, и войти через неё некуда. Первая версия
    // этой проверки выбивала именно угол и объявляла код сломанным.
    const hq = 5;
    const area = campArea(hq);
    const site = siteOf(hq, middle(area));
    const corner = ring(area);
    corner.cells = corner.cells.filter((c) => c !== keyOf({ x: 0, z: 0 }));
    assert.deepEqual(exposed(corner, site), [], 'угол сработал как пролом');
  });

  test('§10.2 — набег не трогает ничего, кроме склада', () => {
    /**
     * Самое защищаемое правило файла. §10.2 отвергает осады словами «потеря
     * базы противоречит правилу „провал стоит одной вылазки, а не прогресса“»,
     * и набег обязан оставаться кражей, а не откатом: уровни, идущая стройка,
     * снаряжение, стрелы и сами стены переживают его целыми.
     */
    const camp = createCamp();
    camp.resources = { stone: 100, wood: 100, iron: 10, crystal: 4 };
    camp.arrows = 4;
    camp.raidedAt = 0;

    const before = {
      levels: { ...camp.levels },
      layout: JSON.parse(JSON.stringify(camp.layout)) as unknown,
      gear: { ...camp.gear },
      arrows: camp.arrows,
      construction: camp.construction,
      walls: JSON.parse(JSON.stringify(camp.walls ?? null)) as unknown,
    };

    const loss = resolveRaids(camp, RAID_HOURS * HOUR * 3);
    assert.ok(loss !== null && loss.total > 0, 'набег не случился — правило проверяет пустоту');

    assert.deepEqual(camp.levels, before.levels, 'набег сбил уровни зданий');
    assert.deepEqual(camp.layout, before.layout, 'набег двигал постройки');
    assert.deepEqual(camp.gear, before.gear, 'набег тронул снаряжение');
    assert.equal(camp.arrows, before.arrows, 'набег унёс стрелы');
    assert.equal(camp.construction, before.construction, 'набег тронул стройку');
    assert.deepEqual(camp.walls ?? null, before.walls, 'набег разрушил стены');
  });

  test('первый заход не наказывается за всё время, что игры не было', () => {
    // Сейв, записанный до набегов, принадлежит игроку, который их не пропускал.
    // Встретить его недостачей за год значило бы наказать за нашу правку.
    const camp = createCamp();
    camp.resources = { stone: 100, wood: 0, iron: 0, crystal: 0 };
    assert.equal(camp.raidedAt, undefined, 'поле должно отсутствовать у нового лагеря');

    assert.equal(resolveRaids(camp, RAID_HOURS * HOUR * 1000), null, 'первый заход стоил склада');
    assert.equal(camp.resources.stone, 100);
  });

  test('пропущенные набеги сводятся по одному, а не сложенной долей', () => {
    // Второй приходит на опустевший склад, поэтому суммарная потеря меньше
    // суммы долей. Без этого достаточно долгий отход в ноль обнулял бы склад.
    const camp = createCamp();
    camp.resources = { stone: 1000, wood: 0, iron: 0, crystal: 0 };
    camp.raidedAt = 0;
    camp.walls = emptyWalls();

    const loss = resolveRaids(camp, RAID_HOURS * HOUR * 2);
    assert.ok(loss !== null);
    assert.equal(loss.raids, 2);
    assert.ok(camp.resources.stone > 0, 'склад обнулён — доли сложили');
    assert.ok(loss.total < 1000);
  });

  test('§10.2 — отпуск не стоит склада: пропущенное копится до потолка', () => {
    /**
     * Без потолка неделя отсутствия — это двадцать восемь набегов, а двадцать
     * восемь раз по пятой уносят склад целиком. Растянутое во времени
     * «провал стоит прогресса» остаётся тем же самым запретом §10.2.
     */
    const week = { ...createCamp(), raidedAt: 0 };
    week.resources = { stone: 1000, wood: 0, iron: 0, crystal: 0 };
    week.walls = emptyWalls();
    const long = resolveRaids(week, RAID_HOURS * HOUR * 28);

    const night = { ...createCamp(), raidedAt: 0 };
    night.resources = { stone: 1000, wood: 0, iron: 0, crystal: 0 };
    night.walls = emptyWalls();
    const short = resolveRaids(night, RAID_HOURS * HOUR * RAID_MAX_PENDING);

    assert.ok(long !== null && short !== null);
    assert.equal(long.raids, RAID_MAX_PENDING, 'неделя свелась больше, чем в потолок');
    assert.equal(long.total, short.total, 'неделя стоила дороже ночи');
    assert.equal(week.raidedAt, raidIndex(RAID_HOURS * HOUR * 28), 'долг не списан целиком');
  });

  test('башни прикрывают то, что осталось открытым', () => {
    const hq = 5;
    const area = campArea(hq);
    const site = siteOf(hq, middle(area));
    const holed = breach(area);

    const bare = raidTake(holed, site);
    assert.ok(bare > 0, 'без дыры сравнивать нечего');
    const towered = { ...holed, towers: { [holed.cells[0]!]: 1 } };
    assert.ok(
      raidTake(towered, site) < bare,
      'башня не уменьшила добычу набега',
    );
    assert.ok(TOWER_COVER > 0 && TOWER_COVER < 1, 'прикрытие башни — доля, а не отмена');
  });

  test('номер набега растёт ровно раз в RAID_HOURS', () => {
    assert.equal(raidIndex(0), 0);
    assert.equal(raidIndex(RAID_HOURS * HOUR - 1), 0);
    assert.equal(raidIndex(RAID_HOURS * HOUR), 1);
    assert.equal(raidIndex(RAID_HOURS * HOUR * 2), 2);
  });
});
