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
import { CAMP_SPEED, campBlocked, campStart, commandCampMove, createCampHero, stepCampHero } from './campWalk';
import { emptyWalls, raiseWall, type WallSite } from './campWalls';
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
    assert.ok(commandCampMove(camp, hero, goal), 'путь не найден');
    walkOut(camp, hero);
    assert.equal(Math.round(hero.x), goal.x, 'не дошёл по x');
    assert.equal(Math.round(hero.z), goal.z, 'не дошёл по z');
  });

  test('сквозь здание не пройти: путь обходит его', () => {
    const camp = bigCamp();
    const hero = createCampHero(camp);
    const area = campArea(camp.levels.hq);
    const blocked = campBlocked(camp);
    assert.ok(commandCampMove(camp, hero, { x: area - 1, z: area - 1 }));
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

  test('ворота — не дыра в стене: проход считается по клеткам, а не по виду', () => {
    // Ворота в лагере рисуются аркой, но клетка под ними остаётся стеной:
    // отдельного прохода в симуляции нет, и правило это фиксирует, чтобы
    // расхождение «видно проезд, а пройти нельзя» не осталось незамеченным.
    const camp = bigCamp();
    const area = campArea(camp.levels.hq);
    raiseWall(camp.walls!, siteOf(camp), [{ x: 1, z: 1 }]);
    camp.walls!.gates.push('1:1');
    const blocked = campBlocked(camp);
    assert.equal(blocked[idx(area, 2, 2)], 1, 'клетка ворот перестала быть стеной');
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
    assert.ok(commandCampMove(camp, hero, { x: 7, z: hero.z }), 'путь по пустому ряду не нашёлся');
    stepCampHero(camp, hero, 1);
    const gone = Math.hypot(hero.x - from.x, hero.z - from.z);
    assert.ok(
      Math.abs(gone - CAMP_SPEED) < 0.05,
      `за секунду прошёл ${gone.toFixed(2)} при скорости ${CAMP_SPEED}`,
    );
  });
});
