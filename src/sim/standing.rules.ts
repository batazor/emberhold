/**
 * Правила силы (§30). Сила — это вылазки, вложенные в лагерь, и главное,
 * что здесь проверяется, — что перевод не выдуман: он обязан сойтись
 * с той самой лестницей, из которой §20.3 выводил цены построек.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BUILD_COST, BUILDING_ORDER, MAX_LEVEL, createCamp } from './camp';
import { RAIDS_PER_LEVEL } from './balance';
import { GEAR_ORDER, MAX_ITEM_LEVEL } from './gear';
import { WORLD_EPOCH, clanGrowth } from './world';
import {
  NO_CLAN,
  buildingRaids,
  campPower,
  clanPower,
  clanRaids,
  levelRaids,
  rawPower,
  raidsFor,
  standings,
  yourPlace,
} from './standing';
import type { CampState } from './camp';

/** Полный лагерь: всё доверху. Верхняя точка шкалы. */
function fullCamp(): CampState {
  const camp = createCamp();
  for (const id of BUILDING_ORDER) camp.levels[id] = MAX_LEVEL;
  for (const slot of GEAR_ORDER) camp.gear[slot] = MAX_ITEM_LEVEL;
  return camp;
}

describe('Сила: перевод в вылазки', () => {
  /**
   * Тот самый сторож, ради которого файл и заведён. §20.3 назначал цену
   * уровня как «столько-то вылазок × что вылазка приносит»; сила делит
   * обратно. Разойдись эти два счёта — и сила перестанет быть измерением,
   * оставшись числом, которое кто-то придумал.
   */
  test('цена уровня, посчитанная назад, сходится с RAIDS_PER_LEVEL', () => {
    for (const [level, raids] of Object.entries(RAIDS_PER_LEVEL)) {
      const back = raidsFor(Number(level), BUILD_COST[Number(level)] ?? {});
      assert.ok(
        Math.abs(back - raids) <= 0.35,
        `уровень ${level}: в таблице ${raids} вылазок, назад вышло ${back.toFixed(2)}`,
      );
    }
  });

  test('за потолком ступень продолжается последним измеренным шагом', () => {
    const last = levelRaids(MAX_LEVEL);
    const step = last - levelRaids(MAX_LEVEL - 1);
    assert.ok(step > 0, 'шаг лестницы не растёт');
    assert.ok(
      Math.abs(levelRaids(MAX_LEVEL + 1) - (last + step)) < 1e-9,
      'первая ступень за потолком посчитана не шагом',
    );
  });

  test('дробный уровень лежит между соседними целыми', () => {
    const half = buildingRaids(3.5);
    assert.ok(half > buildingRaids(3) && half < buildingRaids(4), `${half} не между ступенями`);
  });
});

describe('Сила: что она считает', () => {
  test('свежий лагерь стоит меньше вылазки', () => {
    assert.ok(rawPower(createCamp()) < 1, 'начало отсчёта сдвинуто');
  });

  test('любое вложение силу увеличивает', () => {
    for (const id of BUILDING_ORDER) {
      const camp = createCamp();
      const was = rawPower(camp);
      camp.levels[id] += 1;
      assert.ok(rawPower(camp) > was, `${id} не прибавил силы`);
    }
    for (const slot of GEAR_ORDER) {
      const camp = createCamp();
      const was = rawPower(camp);
      camp.gear[slot] += 1;
      assert.ok(rawPower(camp) > was, `${slot} не прибавил силы`);
    }
    const camp = createCamp();
    const was = rawPower(camp);
    camp.tents.push({ x: 0, z: 0 });
    assert.ok(rawPower(camp) > was, 'палатка не прибавила силы');
  });

  /**
   * Стена не даёт эффекта ни одной строкой (`campWalls.ts`), и сила его
   * не обещает. Правило стоит здесь затем, что стену легко вписать походя —
   * она стоит камня, как и всё остальное.
   */
  test('стены в силу не входят', () => {
    const camp = createCamp();
    const was = rawPower(camp);
    camp.walls = { cells: ['0:0', '0:1', '1:0'], towers: {}, gates: [], stairs: {}, work: null };
    assert.equal(rawPower(camp), was, 'стена посчитана силой');
  });

  test('люди в силу не входят', () => {
    const camp = createCamp();
    const was = rawPower(camp);
    camp.residents.push({ name: 'Гита', look: 'поселенец', seed: 1, answer: 'строим', rest: false });
    assert.equal(rawPower(camp), was, 'жилец посчитан имуществом');
  });

  test('полный лагерь — потолок шкалы', () => {
    const full = rawPower(fullCamp());
    const camp = createCamp();
    camp.levels.hq = MAX_LEVEL;
    assert.ok(rawPower(camp) < full, 'одно здание сравнялось с целым лагерем');
    // Потолок Жилья потолок и есть: уровень выше него силы не прибавляет.
    const over = fullCamp();
    over.levels.hq = MAX_LEVEL + 3;
    assert.equal(rawPower(over), full, 'лагерь перерос собственный потолок');
  });

  test('показанное число — округлённое настоящее', () => {
    const camp = fullCamp();
    assert.ok(Math.abs(campPower(camp) - rawPower(camp)) <= 5, 'округление увело число');
  });
});

describe('Сила: таблица лагерей', () => {
  /** Третий день мира — тот, в котором игра стоит сейчас (§4). */
  const T0 = WORLD_EPOCH + 3 * 24 * 3600;

  test('своя строка ровно одна', () => {
    const rows = standings(createCamp(), T0, null);
    assert.equal(rows.filter((r) => r.kind === 'вы').length, 1);
  });

  test('таблица идёт по убыванию силы', () => {
    const rows = standings(fullCamp(), T0, null);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1]!.power >= rows[i]!.power, `строка ${i} выбилась из порядка`);
    }
  });

  /**
   * Четыре одинаковые строки — это не таблица. На третий день мира все
   * фракции стоят на шестом уровне, и различает их только неокруглённый
   * рост: считай таблица по целому уровню — здесь было бы четыре раза
   * одно и то же число.
   */
  test('фракции в таблице различимы', () => {
    const rows = standings(createCamp(), T0, null).filter((r) => r.kind !== 'вы');
    assert.equal(new Set(rows.map((r) => r.power)).size, rows.length, 'силы фракций совпали');
  });

  test('своё имя берётся у своего клана', () => {
    const rows = standings(createCamp(), T0, 'Артель Гиты');
    assert.equal(rows.find((r) => r.kind === 'вы')?.who, 'Артель Гиты');
  });

  test('пустой лагерь стоит последним, полный поднимается', () => {
    const empty = standings(createCamp(), T0, null);
    const full = standings(fullCamp(), T0, null);
    assert.equal(yourPlace(empty), empty.length, 'пустой лагерь не последний');
    assert.ok(yourPlace(full) < yourPlace(empty), 'полный лагерь не поднялся в таблице');
  });

  test('сила фракции растёт вместе с возрастом мира', () => {
    const early = clanRaids(clanGrowth(0, T0));
    const later = clanRaids(clanGrowth(0, T0 + 60 * 24 * 3600));
    assert.ok(later > early, 'фракция не выросла за два месяца');
    assert.ok(clanPower(clanGrowth(0, T0)) > 0);
  });
});

describe('Таблица: живые соседи (§30.7)', () => {
  const T0 = WORLD_EPOCH + 3 * 24 * 3600;
  const live = (id: string, power: number, clan: string | null = null) => ({
    id,
    clan,
    power,
    level: 3,
    folk: 2,
  });

  test('сосед встаёт в ту же таблицу и на своё место по силе', () => {
    const rows = standings(createCamp(), T0, null, [live('a', 10_000)]);
    assert.equal(rows[0]?.kind, 'сосед', 'сильнейший сосед не первый');
    assert.equal(rows.filter((r) => r.kind === 'сосед').length, 1);
    assert.equal(rows.filter((r) => r.kind === 'вы').length, 1, 'своя строка не одна');
  });

  test('лагерь без клана стоит без имени, а не без строки', () => {
    const rows = standings(createCamp(), T0, null, [live('a', 5)]);
    assert.equal(rows.find((r) => r.kind === 'сосед')?.who, NO_CLAN);
    const named = standings(createCamp(), T0, null, [live('a', 5, 'Артель Гиты')]);
    assert.equal(named.find((r) => r.kind === 'сосед')?.who, 'Артель Гиты');
  });

  test('порядок остаётся по убыванию и с соседями', () => {
    const rows = standings(fullCamp(), T0, null, [live('a', 1), live('b', 9_000), live('c', 300)]);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1]!.power >= rows[i]!.power, `строка ${i} выбилась из порядка`);
    }
  });

  test('без соседей таблица такая же, какой была до них', () => {
    assert.deepEqual(standings(createCamp(), T0, null, []), standings(createCamp(), T0, null));
  });
});
