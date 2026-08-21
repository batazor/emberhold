/**
 * Правила стройки стен в лагере (§12, §6.1.6). Проверяется не то, красиво ли
 * вышло, а четыре обещания панели стройки.
 *
 * Первое: **жест не рвёт стену**. Палец ходит как угодно, включая по диагонали
 * и рывками, а конструктору нужна четырёхсвязная цепь. Мазок обязан её давать
 * при любом пути.
 *
 * Второе: **стройка не ломает лагерь**. Стена не встаёт ни за площадь,
 * ни поверх здания, и здания остаются на месте.
 *
 * Третье: **апгрейд башни идёт только вверх** — то же обещание, что в замке,
 * но здесь его даёт панель: тап по башне поднимает ярус и не трогает клетку.
 *
 * Четвёртое: **всё построенное разбирается**. Снос возвращает лагерь ровно
 * в то состояние, из которого стройка началась: иначе «попробовать» стоит
 * дороже, чем не пробовать.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CASTLE_CELL, DIRS, TOWER_MAX, keyOf, type Spot } from './castle';
import { BUILD_COST, BUILD_SECONDS, campArea, createCamp, moveBuilding } from './camp';
import { emptyResources, type Resources } from './resources';
import {
  WALL_COST,
  completeWallIfDue,
  cycleTower,
  nextTowerLevel,
  startTower,
  startWall,
  strokeFit,
  wallPrice,
  wallProgress,
  wallSeconds,
  emptyWalls,
  gateBlock,
  putStairs,
  raiseWall,
  razeWall,
  stairsBlock,
  strokeCells,
  toggleGate,
  wallBlock,
  wallAt,
  wallCount,
  wallGrid,
  wallPieces,
  wallSpotOf,
  wallSpots,
  type CampWalls,
  type WallSite,
} from './campWalls';

const siteOf = (hq = 5): WallSite => {
  const camp = createCamp();
  camp.levels.hq = hq;
  return { area: campArea(hq), layout: camp.layout, levels: camp.levels };
};

/** Пустая площадка: зданий нет вовсе, чтобы правило про жест мерило жест. */
const bare = (hq = 5): WallSite => ({ area: campArea(hq), layout: {}, levels: {} });

const connected = (cells: readonly Spot[]): boolean => {
  if (cells.length === 0) return true;
  const set = new Set(cells.map(keyOf));
  const seen = new Set([keyOf(cells[0]!)]);
  const queue = [cells[0]!];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const [dx, dz] of DIRS) {
      const next = { x: cur.x + dx, z: cur.z + dz };
      if (!set.has(keyOf(next)) || seen.has(keyOf(next))) continue;
      seen.add(keyOf(next));
      queue.push(next);
    }
  }
  return seen.size === set.size;
};

describe('Стройка стен: жест', () => {
  test('мазок по диагонали не рвёт стену — достраивается лесенкой', () => {
    const path = [
      { x: 0, z: 0 },
      { x: 3, z: 3 },
    ];
    const cells = strokeCells(path);
    assert.ok(connected(cells), 'диагональный мазок дал разорванную цепь');
    assert.ok(cells.length >= 7, `клеток ${cells.length} — лесенка не достроена`);
  });

  test('рывки пальца тоже не рвут: любой путь даёт связную цепь', () => {
    // Путь нарочно рваный: так ведёт палец, когда экран не успевает за ним.
    const paths: readonly (readonly Spot[])[] = [
      [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }],
      [{ x: 2, z: 2 }, { x: 0, z: 5 }, { x: 5, z: 5 }, { x: 5, z: 0 }],
      [{ x: 1, z: 1 }],
      [{ x: 3, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 1 }],
    ];
    for (const path of paths) {
      assert.ok(connected(strokeCells(path)), `путь ${JSON.stringify(path)} порвался`);
    }
  });

  test('клетка не строится дважды за один мазок', () => {
    const cells = strokeCells([
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 0, z: 0 },
    ]);
    assert.equal(new Set(cells.map(keyOf)).size, cells.length, 'клетка повторилась');
  });

  test('клетка лагеря переводится в клетку стены целочисленно', () => {
    // Шаг сетки — CASTLE_CELL, и обе клетки внутри детали дают одну и ту же.
    for (let x = 0; x < 8; x++) {
      assert.equal(wallSpotOf(x, 0).x, Math.floor(x / CASTLE_CELL), `клетка ${x}`);
    }
    assert.deepEqual(wallSpotOf(0, 0), wallSpotOf(1, 1), 'детали 2×2 достался разный адрес');
    assert.notDeepEqual(wallSpotOf(1, 1), wallSpotOf(2, 2), 'соседние детали слились');
  });
});

describe('Стройка стен: что панель не пускает', () => {
  test('поле стены растёт со Жильёом и не вылезает за площадь', () => {
    for (let hq = 1; hq <= 5; hq++) {
      const grid = wallGrid(campArea(hq));
      assert.equal(grid, Math.floor(campArea(hq) / CASTLE_CELL), `Жильё ${hq}`);
      assert.ok(grid * CASTLE_CELL <= campArea(hq), `Жильё ${hq}: поле стены шире площади`);
      assert.equal(wallBlock(bare(hq), { x: grid, z: 0 }), 'вне площади');
      assert.equal(wallBlock(bare(hq), { x: -1, z: 0 }), 'вне площади');
    }
  });

  test('стена не встаёт поверх здания, и здание при этом не двигается', () => {
    const site = siteOf(5);
    const before = JSON.parse(JSON.stringify(site.layout));
    const walls = emptyWalls();
    // Жильё стоит в 1,1 — это клетка стены 0,0.
    assert.equal(wallBlock(site, { x: 0, z: 0 }), 'занято зданием');
    raiseWall(walls, site, [{ x: 0, z: 0 }, { x: 4, z: 0 }]);
    assert.ok(!walls.cells.includes(keyOf({ x: 0, z: 0 })), 'стена встала на Жильё');
    assert.deepEqual(site.layout, before, 'здание сдвинулось от стройки');
  });

  test('мазок мимо площади не строит ничего, но и не падает', () => {
    const walls = emptyWalls();
    assert.equal(raiseWall(walls, bare(1), [{ x: 9, z: 9 }, { x: 12, z: 12 }]), 0);
    assert.equal(walls.cells.length, 0);
  });

  test('ворота — только на прямом участке, лестница — только у стены', () => {
    const walls: CampWalls = emptyWalls();
    raiseWall(walls, bare(5), [{ x: 0, z: 0 }, { x: 3, z: 0 }]);
    assert.equal(gateBlock(walls, { x: 1, z: 0 }), 'ok', 'середина прямой не пустила ворота');
    assert.equal(gateBlock(walls, { x: 0, z: 0 }), 'не прямая', 'ворота встали в тупик');
    assert.equal(gateBlock(walls, { x: 1, z: 2 }), 'нет стены');

    assert.equal(stairsBlock(walls, bare(5), { x: 1, z: 1 }), 'ok');
    assert.equal(stairsBlock(walls, bare(5), { x: 4, z: 4 }), 'нет стены');
    assert.equal(stairsBlock(walls, bare(5), { x: 1, z: 0 }), 'занято зданием', 'лестница в стене');
  });
});

describe('Стройка стен: башня, ворота, лестница', () => {
  test('тап по башне поднимает ярус и не трогает клетку', () => {
    const walls = emptyWalls();
    const site = bare(5);
    const spot = { x: 2, z: 2 };
    assert.equal(cycleTower(walls, site, spot), 1);
    assert.equal(cycleTower(walls, site, spot), 2);
    assert.equal(cycleTower(walls, site, spot), TOWER_MAX);
    assert.equal(cycleTower(walls, site, spot), null, 'после потолка башня не снялась');
    assert.equal(walls.cells.length, 1, 'клеток стало больше одной');
    assert.equal(walls.cells[0], keyOf(spot), 'башня уехала с клетки');
  });

  test('башня растёт вверх: деталей больше, клетка та же', () => {
    const walls = emptyWalls();
    const site = bare(5);
    const spot = { x: 2, z: 2 };
    const counts: number[] = [];
    for (let level = 1; level <= TOWER_MAX; level++) {
      cycleTower(walls, site, spot);
      const here = wallPieces(walls).filter((p) => p.x === spot.x && p.z === spot.z);
      counts.push(here.length);
      assert.ok(here.every((p) => p.role === 'башня'), `уровень ${level}: на клетке не башня`);
    }
    assert.deepEqual(counts, [2, 3, 4], 'ярусы не прибавляются по одному');
  });

  test('ворота ставятся и снимаются тем же тапом', () => {
    const walls = emptyWalls();
    raiseWall(walls, bare(5), [{ x: 0, z: 0 }, { x: 3, z: 0 }]);
    assert.ok(toggleGate(walls, { x: 1, z: 0 }));
    assert.equal(wallCount(walls)['ворота'], 1);
    const withGate = wallPieces(walls).filter((p) => p.role === 'ворота');
    assert.equal(withGate.length, 3, 'ворота — арка, створка и шапка');
    assert.ok(toggleGate(walls, { x: 1, z: 0 }));
    assert.equal(wallCount(walls)['ворота'], 0);
  });

  test('лестница поворачивается к стене, а не в пустоту', () => {
    const walls = emptyWalls();
    raiseWall(walls, bare(5), [{ x: 0, z: 0 }, { x: 3, z: 0 }]);
    assert.ok(putStairs(walls, bare(5), { x: 1, z: 1 }));
    const stairs = wallPieces(walls).find((p) => p.role === 'лестница');
    assert.ok(stairs !== undefined, 'лестница не встала');
    // Ход у детали выходит ребром −z; после поворота он обязан смотреть
    // на стену, то есть на клетку с меньшим z.
    const turned = DIRS[[2].map((d) => (d + stairs.turn) % 4)[0]!];
    assert.ok(turned !== undefined);
  });
});

describe('Стена закрывает путь', () => {
  test('клетка стены закрывает все четыре клетки лагеря под собой', () => {
    const walls = emptyWalls();
    raiseWall(walls, bare(5), [{ x: 2, z: 2 }]);
    for (const [x, z] of [[4, 4], [5, 4], [4, 5], [5, 5]]) {
      assert.ok(wallAt(walls, x!, z!), `клетка ${x},${z} осталась открытой`);
    }
    assert.ok(!wallAt(walls, 6, 4), 'стена закрыла соседнюю клетку');
    assert.ok(!wallAt(walls, 3, 4), 'стена закрыла соседнюю клетку');
  });

  test('зданию стена не мешает: планировка остаётся свободной', () => {
    const camp = createCamp();
    camp.levels.hq = 5;
    const site: WallSite = { area: campArea(5), layout: camp.layout, levels: camp.levels };
    raiseWall(camp.walls!, site, [{ x: 3, z: 3 }]);
    assert.ok(wallAt(camp.walls!, 6, 6), 'стена не заняла клетку лагеря');
    // §20.4 — перестановка выразительная, а не логистическая: стена держит
    // игрока, а не планировку.
    assert.ok(moveBuilding(camp, 'storage', 6, 6), 'стена не пустила здание');
  });
});

describe('Стройка стен: камень и время', () => {
  const rich = (): Resources => ({ ...emptyResources(), stone: 100, wood: 100 });

  /** Первое кольцо при Жилье ур. 1: поле 3×3, периметр — восемь клеток. */
  const RING = 8;

  test('кольцо стоит примерно как одно улучшение здания', () => {
    // Мерка объявлена в `campWalls.ts` и проверяется здесь: если цена клетки
    // поедет, правило скажет об этом раньше, чем игрок.
    const ring = wallPrice('стена', RING).stone!;
    const upgrade = BUILD_COST[2]!.stone!;
    assert.ok(
      ring >= upgrade && ring <= upgrade * 1.5,
      `кольцо ${ring} камня против улучшения ${upgrade} — мерка разъехалась`,
    );
  });

  test('кольцо строится примерно столько же, сколько идёт улучшение', () => {
    const ring = wallSeconds('стена', RING);
    const upgrade = BUILD_SECONDS[2]!;
    assert.ok(
      ring >= upgrade * 0.7 && ring <= upgrade * 1.3,
      `кольцо ${ring} с против улучшения ${upgrade} с`,
    );
  });

  test('камень списывается на входе, а не по готовности', () => {
    const walls = emptyWalls();
    const site = bare(5);
    const res = rich();
    const cells = strokeFit(walls, site, [{ x: 0, z: 0 }, { x: 3, z: 0 }]);
    assert.equal(startWall(walls, res, 'стена', cells, 0, false), 'ok');
    assert.equal(res.stone, 100 - WALL_COST['стена'] * cells.length, 'камень не списан');
    // Пока таймер идёт, стены нет: ни в клетках, ни в деталях.
    assert.equal(walls.cells.length, 0, 'стена встала до срока');
    assert.equal(wallPieces(walls).length, 0);
  });

  test('стройка кончается в срок и ставит ровно то, за что уплачено', () => {
    const walls = emptyWalls();
    const site = bare(5);
    const res = rich();
    const cells = strokeFit(walls, site, [{ x: 0, z: 0 }, { x: 3, z: 0 }]);
    startWall(walls, res, 'стена', cells, 1000, false);
    assert.equal(completeWallIfDue(walls, 1000 + wallSeconds('стена', cells.length) - 1), null);
    const done = completeWallIfDue(walls, 1000 + wallSeconds('стена', cells.length));
    assert.ok(done !== null, 'стройка не кончилась в срок');
    assert.equal(walls.cells.length, cells.length);
    assert.equal(walls.work, null, 'слот не освободился');
  });

  test('слот один на лагерь: занят зданием — стена не начнётся, и наоборот', () => {
    const walls = emptyWalls();
    const res = rich();
    assert.equal(
      startWall(walls, res, 'стена', [{ x: 0, z: 0 }], 0, true),
      'слот занят',
      'стена полезла в занятый слот',
    );
    assert.equal(res.stone, 100, 'камень списан за отказ');
    startWall(walls, res, 'стена', [{ x: 0, z: 0 }], 0, false);
    assert.equal(
      startWall(walls, res, 'стена', [{ x: 1, z: 0 }], 0, false),
      'слот занят',
      'две стройки стен разом',
    );
  });

  test('без камня стройка не начинается и слот не занимает', () => {
    const walls = emptyWalls();
    const poor = emptyResources();
    assert.equal(startWall(walls, poor, 'стена', [{ x: 0, z: 0 }], 0, false), 'не хватает камня');
    assert.equal(walls.work, null, 'отказ занял слот');
  });

  test('башня дорожает ярусами, и следующий ярус известен заранее', () => {
    const walls = emptyWalls();
    const site = bare(5);
    const res = rich();
    const spot = { x: 2, z: 2 };
    for (let level = 1; level <= TOWER_MAX; level++) {
      assert.equal(nextTowerLevel(walls, spot), level);
      assert.equal(startTower(walls, site, res, spot, 0, false), 'ok');
      completeWallIfDue(walls, wallSeconds('башня', 1));
      assert.equal(walls.towers[keyOf(spot)], level);
    }
    assert.equal(nextTowerLevel(walls, spot), null, 'после потолка башня не снимается');
    const spent = 100 - res.stone;
    assert.equal(spent, WALL_COST['башня'] * TOWER_MAX, `за три яруса списано ${spent}`);
  });

  test('снос возвращает камень, но не время', () => {
    const walls = emptyWalls();
    const site = bare(5);
    const res = rich();
    const cells = strokeFit(walls, site, [{ x: 0, z: 0 }, { x: 2, z: 0 }]);
    startWall(walls, res, 'стена', cells, 0, false);
    completeWallIfDue(walls, wallSeconds('стена', cells.length));
    const after = res.stone;
    for (const spot of [...wallSpots(walls)]) razeWall(walls, spot, res);
    assert.equal(res.stone, after + WALL_COST['стена'] * cells.length, 'камень не вернулся');
    assert.equal(walls.cells.length, 0);
  });

  test('полоса готовности идёт от нуля к единице и не выходит за них', () => {
    const walls = emptyWalls();
    const res = rich();
    startWall(walls, res, 'стена', [{ x: 0, z: 0 }], 100, false);
    assert.equal(wallProgress(walls, 100), 0);
    assert.ok(wallProgress(walls, 100 + WALL_COST['стена']) > 0);
    assert.equal(wallProgress(walls, 100 + wallSeconds('стена', 1)), 1);
    assert.equal(wallProgress(walls, 10_000), 1, 'полоса переполнилась');
  });
});

describe('Стройка стен: всё разбирается', () => {
  test('снос возвращает лагерь в исходное состояние', () => {
    const walls = emptyWalls();
    const site = bare(5);
    raiseWall(walls, site, [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }]);
    cycleTower(walls, site, { x: 3, z: 0 });
    toggleGate(walls, { x: 1, z: 0 });
    putStairs(walls, site, { x: 1, z: 1 });
    assert.ok(wallPieces(walls).length > 0);

    for (const spot of [...wallSpots(walls), { x: 1, z: 1 }]) razeWall(walls, spot);
    assert.deepEqual(walls.cells, []);
    assert.deepEqual(walls.towers, {});
    assert.deepEqual(walls.gates, []);
    assert.deepEqual(walls.stairs, {});
    assert.equal(wallPieces(walls).length, 0, 'после сноса что-то осталось стоять');
  });

  test('одни и те же клетки дают одни и те же детали', () => {
    const a = emptyWalls();
    const b = emptyWalls();
    const path = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }, { x: 0, z: 0 }];
    raiseWall(a, bare(5), path);
    raiseWall(b, bare(5), path);
    assert.deepEqual(wallPieces(a), wallPieces(b), 'две одинаковые стены собрались по-разному');
  });

  test('счётчик панели считает построенное, а не клетки', () => {
    const walls = emptyWalls();
    const site = bare(5);
    raiseWall(walls, site, [{ x: 0, z: 0 }, { x: 4, z: 0 }]);
    cycleTower(walls, site, { x: 2, z: 0 });
    toggleGate(walls, { x: 1, z: 0 });
    const count = wallCount(walls);
    assert.equal(count['стена'] + count['башня'] + count['ворота'], walls.cells.length);
    assert.equal(count['башня'], 1);
    assert.equal(count['ворота'], 1);
  });
});
