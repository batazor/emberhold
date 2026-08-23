/**
 * Правила содержания (§13.7). Сторожат не числа, а заборы: содержание —
 * первый сток, идущий без участия игрока, и снести им можно сразу три
 * решения из разных разделов.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createCamp } from './camp';
import { WORK_CAP, WORK_SECONDS, buildTent } from './residents';
import { collectWork } from './residents';
import type { CampState } from './camp';
import {
  FIRE_WOOD,
  FOOD_PER_MOUTH,
  mouths,
  payUpkeep,
  upkeepDue,
  workingAfter,
} from './upkeep';

/** Лагерь с `n` жильцами под крышами и заданной кладовой. */
function campWith(n: number, food: number, wood = 0): CampState {
  const camp = createCamp();
  camp.levels.hq = 6;
  camp.resources.food = food;
  camp.resources.wood = wood;
  for (let i = 0; i < n; i++) {
    camp.residents.push({
      name: `Ж${i}`,
      look: 'поселенец',
      seed: i,
      answer: i === 0 ? 'кормим' : 'ходим',
      rest: false,
    });
    camp.resources.wood += 5;
    buildTent(camp);
  }
  camp.resources.wood = wood;
  return camp;
}

test('§13.1 — голод не запирает вылазку: он трогает только работу', () => {
  const camp = campWith(3, 0);
  const before = { ...camp.resources };
  const got = payUpkeep(camp, WORK_SECONDS * 3);
  assert.equal(got.eaten, 0, 'есть нечего — и списывать нечего');
  assert.ok(got.hungry > 0, 'при пустой кладовой кто-то обязан быть голоден');
  // Ничего, кроме пищи и дерева, содержание не трогает: провиант вылазки
  // (§11.9) считается Кухней и здесь не участвует вовсе.
  assert.equal(camp.resources.stone, before.stone);
  assert.equal(camp.resources.iron, before.iron);
  assert.equal(camp.resources.crystal, before.crystal);
});

test('§13.7 — недоеденное не копится: у прихода и расхода один клапан', () => {
  const camp = campWith(3, 999);
  const week = upkeepDue(camp, WORK_SECONDS * 1000);
  const capped = upkeepDue(camp, WORK_SECONDS * WORK_CAP);
  assert.equal(week.food, capped.food, 'отлучка на неделю не съедает больше потолка');
  assert.equal(week.ticks, WORK_CAP);
});

test('§13.7 — один добытчик кормит троих', () => {
  // Такт работы даёт единицу пищи, такт содержания съедает треть на рот.
  assert.equal(Math.round(1 / FOOD_PER_MOUTH), 3);
});

test('§13.7 — голодный не работает, сытый работает', () => {
  const fed = campWith(3, 999);
  const hungry = campWith(3, 0);
  const fedReport = payUpkeep(fed, WORK_SECONDS);
  const hungryReport = payUpkeep(hungry, WORK_SECONDS);
  const worked = collectWork(fed, WORK_SECONDS, workingAfter(fed, fedReport.hungry));
  const starved = collectWork(hungry, WORK_SECONDS, workingAfter(hungry, hungryReport.hungry));
  assert.ok(worked.length > 0, 'накормленный лагерь работает');
  assert.equal(starved.length, 0, 'голодный лагерь не приносит ничего');
});

test('§24.1 — костёр стоит одинаково днём и ночью', () => {
  // Времени суток у содержания нет вовсе: функция от секунд отлучки,
  // и подставить в неё ночь нечем. Правило сторожит подпись, а не число.
  const camp = campWith(1, 999, 999);
  camp.fires = [{ x: 0, z: 0 }];
  const a = upkeepDue(camp, WORK_SECONDS);
  const b = upkeepDue(camp, WORK_SECONDS);
  assert.deepEqual(a, b);
  assert.equal(a.wood, FIRE_WOOD, 'один костёр — один паёк дерева');
});

test('§13.7 — костёр гаснет, но ничего не запирает', () => {
  const camp = campWith(1, 999, 0);
  camp.fires = [{ x: 0, z: 0 }];
  const got = payUpkeep(camp, WORK_SECONDS * 3);
  assert.ok(got.dark, 'дерева нет — костёр погас');
  assert.ok(got.eaten > 0, 'но люди поели: сперва человек, потом огонь');
});

test('§13.7 — рот считается жильцами, а не героем', () => {
  assert.equal(mouths(createCamp()), 0, 'лагерь без жильцов не ест: провиант героя — не пища');
  assert.equal(mouths(campWith(2, 0)), 2);
});
