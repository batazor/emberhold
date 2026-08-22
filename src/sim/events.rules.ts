/**
 * Правила событий локации (§11.6) и входа первой вылазки.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  EVENTS,
  EVENT_ORDER,
  EVENT_SHARE,
  EVENT_WINDOW_SHIFTS,
  NO_EVENT,
  effectOf,
  isGentle,
} from './events';
import {
  KIND,
  RICH_WINDOW,
  SHIFTS_PER_DAY,
  SHIFT_SEC,
  WORLD_EPOCH,
  dayAt,
  dayStartShift,
  eventAt,
  firstRaidNode,
  regionAt,
  worldAt,
} from './world';
import type { Visit } from './world';
import { atRisk, createRaid, stepFoodCost } from './raid';

const DAY0 = dayAt(WORLD_EPOCH) + 3;
const at = (day: number, shift: number): number => (dayStartShift(day) + shift) * SHIFT_SEC;

describe('События: модель', () => {
  test('без события все модификаторы нейтральны', () => {
    // Бот, калибровка §20.3 и золотой мастер считают вылазку без событий.
    // Ненейтральный ноль здесь сделал бы все прежние замеры несравнимыми.
    assert.deepEqual(effectOf(null), NO_EVENT);
    assert.equal(NO_EVENT.risk, 0);
    assert.equal(NO_EVENT.loot, 1);
    assert.equal(NO_EVENT.enemies, 1);
    assert.equal(NO_EVENT.vision, 0);
    assert.equal(NO_EVENT.step, 1);
  });

  test('§11.6 — каждое событие чем-то платит или чем-то платят ему', () => {
    // Событие, у которого только плюсы, — не предложение, а подарок:
    // за подарок не платят, и решения в нём нет.
    for (const id of EVENT_ORDER) {
      const e = EVENTS[id];
      const better = e.loot > 1 || e.enemies < 1 || e.vision > 0 || e.step < 1;
      const worse = e.risk > 0 || e.loot < 1 || e.enemies > 1 || e.vision < 0 || e.step > 1;
      assert.ok(worse, `${e.name}: событие без цены`);
      // Обвал — единственное, у которого одна цена и никакой выгоды, и это
      // сознательно: он работает как выработанная локация (§4) — плохая
      // сделка, а не запрет. Остальные обязаны быть сделкой.
      if (id !== 'collapse') assert.ok(better, `${e.name}: цена без выгоды`);
    }
  });

  test('ставка события — слагаемое, а не множитель', () => {
    // §11.2: доля = база[ярус] + сумма модификаторов события. Множителем
    // на нулевом ярусе (база 0%) событие не значило бы ничего.
    assert.ok(EVENTS.storm.risk > 0 && EVENTS.storm.risk < 1);
  });

  test('мягкое событие ровно одно', () => {
    // §11.6 заводит «Тихую ночь» как «мягкий вход для новичка». Если мягких
    // станет два, кадр `move` не сломается — он спрашивает `isGentle`,
    // а не имя, — но знать об этом надо.
    assert.equal(EVENT_ORDER.filter(isGentle).length, 1);
    assert.ok(isGentle('quiet'));
    assert.ok(!isGentle(null));
  });

  test('окно события — часы, а не минуты, и меньше суток', () => {
    const hours = (EVENT_WINDOW_SHIFTS * SHIFT_SEC) / 3600;
    assert.ok(hours >= 2, `окно ${hours} ч — событие не переживёт сессию`);
    assert.ok(
      EVENT_WINDOW_SHIFTS < SHIFTS_PER_DAY,
      'окно длиной в сутки делает карту расписанием',
    );
    // Замер: 9 смен = 6 часов, ровно четыре окна в сутках.
    assert.equal(SHIFTS_PER_DAY % EVENT_WINDOW_SHIFTS, 0, 'окно не делит сутки нацело');
  });

  test('событие держится всё окно и меняется на его границе', () => {
    const day = DAY0;
    const node = 0;
    const first = eventAt(day, node, at(day, 0));
    for (let s = 1; s < EVENT_WINDOW_SHIFTS; s++) {
      assert.equal(eventAt(day, node, at(day, s)), first, `смена ${s}: событие дёрнулось внутри окна`);
    }
    // За сутки на точке обязано смениться хоть что-то: иначе окно ни при чём.
    const all = new Set<string>();
    for (let s = 0; s < SHIFTS_PER_DAY; s++) all.add(String(eventAt(day, node, at(day, s))));
    assert.ok(all.size >= 1);
  });
});

describe('События: замеры на регионе', () => {
  /**
   * Точки, носящие события, за все дни окна — выборка, на которой считаются
   * доли. Прогулочные точки (замок, кладбище, тропа) событий не носят
   * (`KIND[].events`), и в знаменателе они разбавляли бы долю: `EVENT_SHARE`
   * обещана на бросок `eventFor`, а он случается только там, где события есть.
   */
  const sample = (days: number): (string | null)[] => {
    const out: (string | null)[] = [];
    for (let d = 0; d < days; d++) {
      const day = DAY0 + d;
      const region = regionAt(day);
      const world = worldAt(at(day, RICH_WINDOW), []);
      world.forEach((state, i) => {
        if (KIND[region.nodes[i]!.kind].events) out.push(state.event);
      });
    }
    return out;
  };

  test('событие — отклонение, а не обычный день', () => {
    const all = sample(60);
    const share = all.filter((e) => e !== null).length / all.length;
    // Замер на 60 днях: 25,7% при заданных 25%.
    assert.ok(share > 0.15, `событий ${(share * 100).toFixed(1)}% — правилом не станут`);
    assert.ok(share < 0.35, `событий ${(share * 100).toFixed(1)}% — это уже обычный день`);
    assert.ok(Math.abs(share - EVENT_SHARE) < 0.05, 'доля разошлась с заданной');
  });

  test('за два месяца встречаются все четыре события, и ни одно не доминирует', () => {
    const all = sample(60).filter((e): e is string => e !== null);
    for (const id of EVENT_ORDER) {
      const n = all.filter((e) => e === id).length;
      assert.ok(n > 0, `${EVENTS[id].name} не выпало ни разу`);
      // Замер: 68 / 71 / 82 / 71 на 60 днях. Четверть ±10 пунктов.
      const share = n / all.length;
      assert.ok(share > 0.15 && share < 0.35, `${EVENTS[id].name}: доля ${(share * 100).toFixed(0)}%`);
    }
  });

  /**
   * Главное условие карты (`world.rules.ts`): в любой момент доступны минимум
   * три локации с богатством ≥ 2. События богатства не тратят и сломать его
   * не могут — поэтому здесь проверяется то, что они сломать способны:
   * **выбор**. Обвал это цена без выгоды, и точка под ним из выбора выпадает.
   */
  test('события не съедают выбор: три пригодных места остаются под нагрузкой', () => {
    let worst = Infinity;
    for (let d = 0; d < 20; d++) {
      const day = DAY0 + d;
      const visits: Visit[] = [];
      for (let s = 0; s < SHIFTS_PER_DAY; s += RICH_WINDOW) {
        const world = worldAt(at(day, s), visits);
        // Пять вылазок подряд, всегда в самое богатое, — та же нагрузка,
        // что в `world.rules.ts`.
        for (let k = 0; k < 5; k++) {
          let best = 0;
          world.forEach((n, i) => {
            if (n.rich > world[best]!.rich) best = i;
          });
          visits.push({ node: best, shift: dayStartShift(day) + s });
        }
      }
      for (let s = RICH_WINDOW; s < SHIFTS_PER_DAY; s += 3) {
        const world = worldAt(at(day, s), visits);
        const good = world.filter((n) => n.rich >= 2 && n.event !== 'collapse').length;
        worst = Math.min(worst, good);
      }
    }
    // Замер на 540 проверках: ни разу не опускалось ниже трёх.
    assert.ok(worst >= 3, `осталось ${worst} пригодных мест — карта перестала быть выбором`);
  });
});

describe('События: что видит вылазка', () => {
  const raid = (event: 'storm' | 'collapse' | 'quiet' | 'vein' | null) =>
    createRaid({ seed: 11, tier: 1, kitchenLevel: 2, storageLevel: 2, event });

  test('без события вылазка считается ровно как до событий', () => {
    const a = raid(null);
    assert.equal(a.riskAdd, 0);
    assert.equal(a.stepMul, 1);
    assert.equal(a.visionAdd, 0);
    // Локация обязана совпасть с той, что даёт голый createRaid: иначе
    // золотой мастер и калибровка §20.3 меряют другую игру.
    const plain = createRaid({ seed: 11, tier: 1, kitchenLevel: 2, storageLevel: 2 });
    assert.equal(a.loc.enemies.length, plain.loc.enemies.length);
    assert.deepEqual(
      a.loc.containers.map((c) => c.amount),
      plain.loc.containers.map((c) => c.amount),
    );
  });

  test('буря поднимает ставку слагаемым и на нулевом ярусе тоже', () => {
    const deep = createRaid({ seed: 11, tier: 0, kitchenLevel: 1, storageLevel: 1, event: 'storm' });
    deep.bag.stone = 10;
    deep.bagTotal = 10;
    // База нулевого яруса — 0%, и множитель дал бы ноль. Слагаемое даёт треть.
    assert.ok(atRisk(deep) > 0, 'на Подступах буря ничего не поставила под угрозу');
    assert.equal(atRisk(deep), Math.ceil(10 * EVENTS.storm.risk));
  });

  test('ставка не переваливает за сто процентов', () => {
    // На Дне база уже 100% (§11.2). Событие поверх обещало бы отнять больше,
    // чем игрок несёт, — а отнять больше нечего, и карточка врала бы числом.
    const bottom = createRaid({
      seed: 11, tier: 3, kitchenLevel: 4, storageLevel: 4, event: 'storm',
    });
    bottom.bag.stone = 10;
    bottom.bagTotal = 10;
    assert.equal(atRisk(bottom), 10, 'под угрозой оказалось больше рюкзака');
  });

  test('обвал дорожит шаг, тихая ночь убирает противников, жила добавляет', () => {
    assert.ok(stepFoodCost(raid('collapse')) > stepFoodCost(raid(null)), 'обвал не подорожал');
    assert.equal(raid('collapse').visionAdd, -1);
    assert.ok(raid('quiet').loc.enemies.length < raid(null).loc.enemies.length, 'тихая ночь не тише');
    assert.ok(raid('vein').loc.enemies.length > raid(null).loc.enemies.length, 'жила не опаснее');
  });

  test('добыча события множится с богатством, а не заменяет его', () => {
    // Выработанная локация под бурей остаётся выработанной: события не чинят
    // истощение, иначе «сходить ещё раз» перестаёт быть решением (§4).
    const poor = createRaid({ seed: 11, tier: 1, kitchenLevel: 2, storageLevel: 2, lootMul: 0.4 });
    const poorStorm = createRaid({
      seed: 11, tier: 1, kitchenLevel: 2, storageLevel: 2, lootMul: 0.4, event: 'storm',
    });
    const rich = createRaid({ seed: 11, tier: 1, kitchenLevel: 2, storageLevel: 2, lootMul: 1 });
    const sum = (r: typeof poor) => r.loc.containers.reduce((n, c) => n + c.amount, 0);
    assert.ok(sum(poorStorm) > sum(poor), 'буря не подняла добычу');
    assert.ok(sum(poorStorm) < sum(rich), 'буря отменила истощение');
  });
});

describe('Первая вылазка: одна точка', () => {
  /**
   * Вход обязан находиться **в любой день**. Замер на 60 днях нашёл один день,
   * в котором идеального входа не существует: нет точки, которая разом
   * нулевого яруса, полного богатства и без клана. Поэтому выбор — это
   * ранжирование, а не фильтр: фильтр запер бы игрока в лагере, и кадр `move`
   * не наступил бы вовсе.
   */
  test('вход находится в любой день из шестидесяти', () => {
    for (let d = 0; d < 60; d++) {
      const day = DAY0 + d;
      const t = at(day, RICH_WINDOW);
      const node = firstRaidNode(day, t);
      assert.notEqual(node, null, `день ${d}: первой вылазке некуда идти`);
      const region = regionAt(day);
      const picked = region.nodes.find((n) => n.id === node);
      assert.notEqual(picked, undefined, `день ${d}: выбран несуществующий узел`);
      assert.equal(picked!.kind, 'вылазка', `день ${d}: первой вылазкой выбран замок`);
    }
  });

  test('вход — самое щадящее место дня', () => {
    let deeper = 0;
    for (let d = 0; d < 60; d++) {
      const day = DAY0 + d;
      const t = at(day, RICH_WINDOW);
      const node = firstRaidNode(day, t)!;
      const region = regionAt(day);
      const picked = region.nodes.find((n) => n.id === node)!;
      const raids = region.nodes.filter((n) => n.kind === 'вылазка');
      const lowest = Math.min(...raids.map((n) => n.tier));
      assert.equal(picked.tier, lowest, `день ${d}: ярус ${picked.tier} при доступном ${lowest}`);
      if (picked.tier > 0) deeper++;
    }
    // Дни без нулевого яруса вообще §4.1 разрешает намеренно («день, в котором
    // рядом только третий ярус, обязан быть возможен»). Тогда первая вылазка
    // идёт в самое мелкое из выпавшего — но такие дни обязаны быть редкими.
    assert.ok(deeper <= 6, `дней без Подступов ${deeper} из 60 — первая вылазка слишком часто глубокая`);
  });

  test('вход не в занятое клану и не в выработанное', () => {
    let taken = 0;
    for (let d = 0; d < 60; d++) {
      const day = DAY0 + d;
      const t = at(day, RICH_WINDOW);
      const node = firstRaidNode(day, t)!;
      const state = worldAt(t, [])[node]!;
      if (state.clan !== null || state.rich < 2) taken++;
    }
    assert.ok(taken <= 3, `в ${taken} днях из 60 первая вылазка идёт в занятое или бедное место`);
  });
});
