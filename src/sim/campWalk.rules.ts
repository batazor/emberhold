/**
 * Правила ходьбы по лагерю (§16.1, §20.4). Лагерь — та поляна, на которой
 * в прологе поставили палатку, и обещаний у неё три.
 *
 * Первое: **сквозь стену не пройти**. Это то, ради чего стена и строится;
 * стена, которую можно пересечь, — рисунок на земле.
 *
 * Второе: **сквозь здание тоже не пройти**, и площадь лагеря не покинуть.
 *
 * Третье: **герой не застревает**. Стену можно построить у него под ногами,
 * и он обязан выйти из неё, а не провалиться внутрь.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { campArea, createCamp, type CampState } from './camp';
import {
  CAMP_SPEED,
  campBlocked,
  campNav,
  campStart,
  commandCampMove,
  createCampHero,
  stepCampHero,
} from './campWalk';
import {
  cycleTower,
  emptyWalls,
  putStairs,
  raiseWall,
  razeWall,
  toggleGate,
  type WallSite,
} from './campWalls';
import { topCenter, topWalkable } from './campTop';
import { idx } from './grid';

const bigCamp = (): CampState => {
  const camp = createCamp();
  camp.levels.hq = 5;
  camp.walls = emptyWalls();
  return camp;
};

const siteOf = (camp: CampState): WallSite => ({
  area: campArea(camp.levels.hq),
  layout: camp.layout,
  levels: camp.levels,
});

/** Провести героя до конца пути: столько секунд, сколько нужно на площадь. */
/** Площадка без зданий: правила про ярусы, а не про раскладку лагеря. */
const bare = (hq = 5): WallSite => ({ area: campArea(hq), layout: {}, levels: {} });

/**
 * Лагерь, в котором зданий нет, а Жильё убрано в дальний угол. Нужен правилам
 * про ярусы: кольцо стен в углу площади иначе накладывалось бы на постройки,
 * и правило мерило бы отказ стройки вместо хода поверху.
 */
const emptyCamp = (): CampState => {
  const camp = bigCamp();
  camp.levels.kitchen = 0;
  camp.levels.storage = 0;
  camp.levels.forge = 0;
  camp.layout.hq = { x: 8, z: 8 };
  return camp;
};

/** Ставит героя во двор: кольцо без ворот снаружи не пускает, и это верно. */
const intoYard = (hero: ReturnType<typeof createCampHero>): void => {
  hero.x = 4;
  hero.z = 4;
  hero.path = [];
};

/** Клетки, по верху которых ходят, — в том виде, в каком их ждёт лестница. */
const topsOf = (camp: CampState): Set<string> => {
  const top = campNav(camp).top;
  const out = new Set<string>();
  for (let z = 0; z < top.grid; z++) {
    for (let x = 0; x < top.grid; x++) if (topWalkable(top, { x, z })) out.add(`${x}:${z}`);
  }
  return out;
};

const walkOut = (camp: CampState, hero: ReturnType<typeof createCampHero>): void => {
  for (let i = 0; i < 400 && hero.path.length > 0; i++) stepCampHero(camp, hero, 1 / 30);
};

describe('Лагерь: по нему ходят', () => {
  test('герой начинает на свободной клетке, а не в здании', () => {
    const camp = bigCamp();
    const start = campStart(camp);
    const blocked = campBlocked(camp);
    const area = campArea(camp.levels.hq);
    assert.equal(blocked[idx(area, start.x, start.z)], 0, 'герой стоит внутри постройки');
  });

  test('тап уводит героя, и он доходит', () => {
    const camp = bigCamp();
    const hero = createCampHero(camp);
    const area = campArea(camp.levels.hq);
    const goal = { x: area - 1, z: area - 1 };
    assert.equal(commandCampMove(camp, hero, goal), 'ok', 'путь не найден');
    walkOut(camp, hero);
    assert.equal(Math.round(hero.x), goal.x, 'не дошёл по x');
    assert.equal(Math.round(hero.z), goal.z, 'не дошёл по z');
  });

  test('сквозь здание не пройти: путь обходит его', () => {
    const camp = bigCamp();
    const hero = createCampHero(camp);
    const area = campArea(camp.levels.hq);
    const blocked = campBlocked(camp);
    assert.equal(commandCampMove(camp, hero, { x: area - 1, z: area - 1 }), 'ok');
    for (const cell of hero.path) {
      assert.equal(blocked[idx(area, cell.x, cell.z)], 0, `путь идёт сквозь ${cell.x},${cell.z}`);
    }
  });

  test('сквозь стену не пройти', () => {
    const camp = bigCamp();
    const area = campArea(camp.levels.hq);
    // Стена поперёк площади, от края до края и без щелей. Ряд взят там,
    // где не стоит ни одно здание: на занятую клетку стена не встаёт,
    // и щель в ней была бы не дефектом ходьбы, а отказом стройки.
    const grid = Math.floor(area / 2);
    const row = Array.from({ length: grid }, (_, x) => ({ x, z: 3 }));
    assert.equal(raiseWall(camp.walls!, siteOf(camp), row), grid, 'стена встала не целиком');

    const blocked = campBlocked(camp);
    for (let x = 0; x < area; x++) {
      assert.equal(blocked[idx(area, x, 6)], 1, `в стене щель на ${x},6`);
      assert.equal(blocked[idx(area, x, 7)], 1, `в стене щель на ${x},7`);
    }

    // Герой стоит выше стены; за неё пути нет вовсе.
    const hero = createCampHero(camp);
    const behind = { x: area - 1, z: area - 1 };
    const went = commandCampMove(camp, hero, behind);
    walkOut(camp, hero);
    assert.ok(
      Math.round(hero.z) < 6,
      `герой оказался за стеной в ${Math.round(hero.x)},${Math.round(hero.z)} (путь ${went})`,
    );
  });

  test('через ворота проходят, и без них та же стена не пускает', () => {
    // Ради этого ворота и ставят: стена без прохода запирает двор наглухо,
    // и арка на ней была бы украшением.
    const camp = bigCamp();
    const area = campArea(camp.levels.hq);
    const grid = Math.floor(area / 2);
    const row = Array.from({ length: grid }, (_, x) => ({ x, z: 3 }));
    raiseWall(camp.walls!, siteOf(camp), row);
    const behind = { x: area - 1, z: area - 1 };

    // Глухая стена: за неё не пройти.
    const shut = createCampHero(camp);
    commandCampMove(camp, shut, behind);
    walkOut(camp, shut);
    assert.ok(Math.round(shut.z) < 6, 'глухая стена пропустила');

    // Те же клетки, но с воротами в середине — проходит.
    assert.ok(toggleGate(camp.walls!, { x: 2, z: 3 }), 'ворота не встали на прямой участок');
    const open = createCampHero(camp);
    assert.equal(campBlocked(camp)[idx(area, 4, 6)], 0, 'клетка ворот осталась стеной');
    assert.equal(commandCampMove(camp, open, behind), 'ok', 'пути через ворота нет');
    walkOut(camp, open);
    assert.equal(Math.round(open.z), behind.z, 'через ворота не прошёл');
    assert.equal(Math.round(open.x), behind.x, 'через ворота не прошёл');
  });

  test('за площадь лагеря не выйти', () => {
    const camp = bigCamp();
    const hero = createCampHero(camp);
    const area = campArea(camp.levels.hq);
    commandCampMove(camp, hero, { x: area + 5, z: area + 5 });
    walkOut(camp, hero);
    assert.ok(hero.x >= 0 && hero.x < area, `герой ушёл за площадь по x: ${hero.x}`);
    assert.ok(hero.z >= 0 && hero.z < area, `герой ушёл за площадь по z: ${hero.z}`);
  });
});

describe('Лагерь: герой не застревает', () => {
  test('стена под ногами выталкивает, а не запирает', () => {
    const camp = bigCamp();
    const hero = createCampHero(camp);
    const area = campArea(camp.levels.hq);
    // Строим стену ровно там, где он стоит.
    raiseWall(camp.walls!, siteOf(camp), [{ x: Math.floor(hero.x / 2), z: Math.floor(hero.z / 2) }]);
    stepCampHero(camp, hero, 1 / 30);
    const blocked = campBlocked(camp);
    assert.equal(
      blocked[idx(area, Math.round(hero.x), Math.round(hero.z))],
      0,
      'герой остался внутри стены',
    );
  });

  test('ходьба считается временем, а не кадрами', () => {
    const camp = bigCamp();
    const a = createCampHero(camp);
    const b = createCampHero(camp);
    const goal = { x: campArea(camp.levels.hq) - 1, z: a.z };
    commandCampMove(camp, a, goal);
    commandCampMove(camp, b, goal);
    // Одна секунда одним шагом и тридцатью — одно и то же расстояние.
    stepCampHero(camp, a, 1);
    for (let i = 0; i < 30; i++) stepCampHero(camp, b, 1 / 30);
    assert.ok(Math.abs(a.x - b.x) < 0.05, `${a.x} против ${b.x} — шаг зависит от кадров`);
  });

  test('скорость лагеря — та же, что в вылазке', () => {
    const camp = bigCamp();
    const hero = createCampHero(camp);
    // Пустой ряд у нижней кромки: мерить скорость на пути, который обходит
    // здание, значит мерить обход, а не скорость.
    hero.x = 1;
    hero.z = campArea(camp.levels.hq) - 2;
    const from = { x: hero.x, z: hero.z };
    assert.equal(commandCampMove(camp, hero, { x: 7, z: hero.z }), 'ok', 'путь по пустому ряду не нашёлся');
    stepCampHero(camp, hero, 1);
    const gone = Math.hypot(hero.x - from.x, hero.z - from.z);
    assert.ok(
      Math.abs(gone - CAMP_SPEED) < 0.05,
      `за секунду прошёл ${gone.toFixed(2)} при скорости ${CAMP_SPEED}`,
    );
  });
});

describe('Стена: наверх только по лестнице', () => {
  /** Кольцо стен без лестницы: верх есть, попасть на него неоткуда. */
  const ring = (camp: CampState): void => {
    raiseWall(camp.walls!, bare(5), [
      { x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }, { x: 0, z: 3 }, { x: 0, z: 0 },
    ]);
  };

  test('без лестницы верх недостижим, и отказ говорит почему', () => {
    const camp = emptyCamp();
    ring(camp);
    const hero = createCampHero(camp);
    intoYard(hero);
    const goal = topCenter({ x: 1, z: 0 });
    assert.equal(commandCampMove(camp, hero, goal, 'верх'), 'нет лестницы');
    assert.equal(hero.level, 'земля', 'герой всё-таки поднялся');
  });

  test('поставили лестницу — поднялся; сняли — снова нет', () => {
    const camp = emptyCamp();
    ring(camp);
    const tops = topsOf(camp);
    assert.ok(putStairs(camp.walls!, bare(5), { x: 1, z: 1 }, tops), 'лестница не встала');

    const hero = createCampHero(camp);
    intoYard(hero);
    const goal = topCenter({ x: 1, z: 0 });
    assert.equal(commandCampMove(camp, hero, goal, 'верх'), 'ok', 'наверх пути нет');
    walkOut(camp, hero);
    assert.equal(hero.level, 'верх', 'не поднялся');
    assert.ok(hero.y > 0, 'поднялся, но остался на нулевой высоте');

    // Спуск — тем же путём.
    assert.equal(commandCampMove(camp, hero, { x: 4, z: 4 }, 'земля'), 'ok');
    walkOut(camp, hero);
    assert.equal(hero.level, 'земля', 'не спустился');
    assert.equal(hero.y, 0, 'спустился, но висит');

    razeWall(camp.walls!, { x: 1, z: 1 });
    assert.equal(commandCampMove(camp, hero, goal, 'верх'), 'нет лестницы', 'лестницы нет, а путь есть');
  });

  test('в пути ровно одна смена яруса, и она на лестнице', () => {
    const camp = emptyCamp();
    ring(camp);
    const tops = topsOf(camp);
    putStairs(camp.walls!, bare(5), { x: 1, z: 1 }, tops);
    const hero = createCampHero(camp);
    intoYard(hero);
    assert.equal(commandCampMove(camp, hero, topCenter({ x: 3, z: 1 }), 'верх'), 'ok');
    let changes = 0;
    let prev = hero.level;
    for (const step of hero.path) {
      if (step.level !== prev) changes++;
      prev = step.level;
    }
    assert.equal(changes, 1, `ярус меняется ${changes} раз`);
  });

  test('снос под ногами роняет на землю, а не подвешивает', () => {
    const camp = emptyCamp();
    ring(camp);
    const tops = topsOf(camp);
    putStairs(camp.walls!, bare(5), { x: 1, z: 1 }, tops);
    const hero = createCampHero(camp);
    intoYard(hero);
    commandCampMove(camp, hero, topCenter({ x: 1, z: 0 }), 'верх');
    walkOut(camp, hero);
    assert.equal(hero.level, 'верх');

    razeWall(camp.walls!, { x: 1, z: 0 });
    stepCampHero(camp, hero, 1 / 30);
    assert.equal(hero.level, 'земля', 'герой завис в воздухе');
    assert.equal(hero.y, 0, 'высота осталась от снесённой стены');
    assert.deepEqual(hero.path, [], 'путь пережил падение');
  });

  test('через башню поверху не пройти', () => {
    const camp = emptyCamp();
    const site = bare(5);
    raiseWall(camp.walls!, site, [{ x: 0, z: 0 }, { x: 4, z: 0 }]);
    cycleTower(camp.walls!, site, { x: 2, z: 0 });
    const tops = topsOf(camp);
    putStairs(camp.walls!, site, { x: 0, z: 1 }, tops);

    const hero = createCampHero(camp);
    assert.equal(commandCampMove(camp, hero, topCenter({ x: 1, z: 0 }), 'верх'), 'ok', 'ближний участок недостижим');
    // За башней — другой участок, и единственная лестница туда не ведёт.
    const far = createCampHero(camp);
    assert.equal(
      commandCampMove(camp, far, topCenter({ x: 3, z: 0 }), 'верх'),
      'нет лестницы',
      'герой обошёл башню поверху',
    );
  });

  test('скорость наверху та же, что на земле', () => {
    const camp = emptyCamp();
    raiseWall(camp.walls!, bare(5), [{ x: 0, z: 0 }, { x: 4, z: 0 }]);
    const tops = topsOf(camp);
    putStairs(camp.walls!, bare(5), { x: 0, z: 1 }, tops);
    const hero = createCampHero(camp);
    commandCampMove(camp, hero, topCenter({ x: 0, z: 0 }), 'верх');
    walkOut(camp, hero);

    const from = { x: hero.x, z: hero.z };
    commandCampMove(camp, hero, topCenter({ x: 4, z: 0 }), 'верх');
    stepCampHero(camp, hero, 1);
    const gone = Math.hypot(hero.x - from.x, hero.z - from.z);
    assert.ok(
      Math.abs(gone - CAMP_SPEED) < 0.05,
      `за секунду по стене прошёл ${gone.toFixed(2)} при скорости ${CAMP_SPEED}`,
    );
  });
});
