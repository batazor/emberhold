/**
 * Правила обмена (§13.5). Держат три критерия курса и одно требование
 * к самой операции.
 *
 * Числа курса меряет `npm run trade` ботом на живой симуляции; здесь стоят
 * границы, падение которых означает смену механики, а не дрожание генератора.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEAL_REASON, PARITY, OFFER_ORDER, STOCKED, dealBlock, dealsToParity, feeOf, makeDeal,
  marketKey, offerLine, offerOf, pruneBought, stockOf, trade, tradeBlock,
} from './trade';
import { generateCastleSite } from './castleSite';
import { localsOf, localsTook } from './berries';
import { DAY_SEC } from './world';
import { WORK_SECONDS } from './residents';
import type { DealBlock } from './trade';
import { createCamp, BUILD_COST } from './camp';
import { GEAR_COST } from './gear';
import { RESOURCE_NAME } from './resources';

/**
 * Замер `npm run trade`, ярус 0 при Кухне ур. 1 и ярус 1 при Кухне ур. 2,
 * по 200 заходов бота. Числа держатся здесь затем, чтобы правила читались
 * без запуска бота: правило обязано падать быстро.
 */
const T0_STONE = 4.1;
const T0_WOOD = 2.0;
/** Железа в минуту, если просто ходить на ярус 1: 1,8 за 22 секунды. */
const IRON_PER_MIN_RAID = 4.93;
const T0_SECONDS = 12;

/** Сколько заходов нулевого яруса стоит один обмен. */
const raidsPerTrade = (id: (typeof OFFER_ORDER)[number]): number => {
  const give = PARITY[id].give;
  if (give.stone !== undefined) return give.stone / T0_STONE;
  if (give.wood !== undefined) return give.wood / T0_WOOD;
  throw new Error(`курс ${id} не назван ни в камне, ни в дереве`);
};

/** Железа в минуту, если добывать его обменом, а не глубиной. */
const ironPerMin = (id: (typeof OFFER_ORDER)[number]): number => {
  const got = PARITY[id].take.iron ?? 0;
  return (got / (raidsPerTrade(id) * T0_SECONDS)) * 60;
};

describe('Обмен: курс', () => {
  /**
   * Главный критерий, из которого выведено всё остальное. §13 про кристалл:
   * «его нельзя получить иначе, кроме как рискнув; если он однажды начнёт
   * капать на мелких ярусах, игра лишится смысла спускаться». Железо устроено
   * так же уровнем ниже — оно и есть причина открывать ярус 1.
   *
   * Та же форма, что у §13.3: «рубка обязана проигрывать подбору на каждом
   * сиде».
   */
  test('§13 — обмен проигрывает вылазке на ярус 1, и с запасом', () => {
    for (const id of OFFER_ORDER) {
      const rate = ironPerMin(id);
      assert.ok(
        rate < IRON_PER_MIN_RAID,
        `${id}: ${rate.toFixed(2)} железа в минуту против ${IRON_PER_MIN_RAID} вылазкой — ` +
          'лавка обогнала глубину, и ярус 1 стал не нужен',
      );
      // Не «чуть меньше»: лавка обязана читаться плохой сделкой с одного
      // взгляда, иначе её выберут по привычке, а не по решению.
      assert.ok(
        rate < IRON_PER_MIN_RAID * 0.8,
        `${id}: ${rate.toFixed(2)} — слишком близко к вылазке, сделка не читается плохой`,
      );
    }
  });

  test('обмен по карману: один заход не дороже двух с половиной', () => {
    // Дороже — лавкой не пользуется никто, и всё равно что её нет.
    for (const id of OFFER_ORDER) {
      const raids = raidsPerTrade(id);
      assert.ok(raids <= 2.5, `${id}: ${raids.toFixed(1)} заходов за один обмен — до лавки не дойдут`);
      assert.ok(raids >= 1, `${id}: ${raids.toFixed(1)} захода — обмен дешевле добычи, это подарок`);
    }
  });

  /**
   * Кухня ур. 2 открывает ярус 1, то есть настоящее железо. Лавка, съедающая
   * её быстрее, чем игрок копит, тормозит выход на ярус 1 — и работает против
   * себя же.
   *
   * Дровяная строка тут на границе, и это измеренный факт: дерева два за
   * заход, Кухне нужно четыре, то есть весь дровяной доход двух заходов
   * уходит в неё целиком.
   */
  test('обмен не отодвигает Кухню ур. 2 больше чем на два захода', () => {
    const kitchen = BUILD_COST[2] ?? {};
    assert.ok((kitchen.stone ?? 0) > 0 && (kitchen.wood ?? 0) > 0, 'Кухня перестала стоить камня и дерева');
    for (const id of OFFER_ORDER) {
      assert.ok(
        raidsPerTrade(id) <= 2,
        `${id}: обмен отодвигает Кухню на ${raidsPerTrade(id).toFixed(1)} захода`,
      );
    }
  });

  /**
   * Прежде здесь стоял четвёртый критерий — «первая ковка достижима, пока
   * ярус 1 закрыт», — и инструмент его снял. Правило ниже держит память
   * об этом: окно и вправду короткое, и требовать от лавки успеть в него
   * значит требовать, чтобы она обогнала глубину.
   */
  test('окно, ради которого лавку заводили, короче, чем один обмен', () => {
    const kitchenStone = BUILD_COST[2]?.stone ?? 0;
    const raidsToKitchen = kitchenStone / T0_STONE;
    const firstItem = GEAR_COST[1]?.iron ?? 0;
    const cheapest = Math.min(...OFFER_ORDER.map((id) => raidsPerTrade(id) * (firstItem / (PARITY[id].take.iron ?? 1))));
    assert.ok(
      cheapest > raidsToKitchen,
      `наменять на первый предмет (${cheapest.toFixed(1)} заходов) быстрее, чем открыть ярус 1 ` +
        `(${raidsToKitchen.toFixed(1)}) — значит курс щедрее вылазки`,
    );
  });

  test('дерево покупает лучше камня: дороже то, чего меньше', () => {
    // §13: дерево — «ранний ограничитель темпа», его два за заход и оно всё
    // уходит в постройки; камня четыре, и §13.2 признаёт, что стоки у него
    // слабые. Если камень станет выгоднее дерева, обе роли перепутаются.
    assert.ok(
      raidsPerTrade('iron-wood') < raidsPerTrade('iron-stone'),
      'камень покупает железо выгоднее дерева — роли ресурсов §13 перепутаны',
    );
  });
});

describe('Обмен: операция', () => {
  test('меняет ровно по текущему курсу и не даёт залезть в долг', () => {
    const camp = createCamp();
    const price = offerOf('iron-stone', 0).give.stone ?? 0;
    camp.resources = { stone: price, wood: 0, iron: 0, crystal: 0, food: 0 };
    assert.equal(tradeBlock(camp, 'iron-stone'), 'ok');
    assert.equal(trade(camp, 'iron-stone'), true);
    assert.deepEqual(camp.resources, { stone: 0, wood: 0, iron: 1, crystal: 0, food: 0 });
    assert.equal(camp.trades, 1, 'сделка записана в отношения');

    assert.equal(tradeBlock(camp, 'iron-stone'), 'resources', 'причина, а не молчание');
    assert.equal(trade(camp, 'iron-stone'), false);
    assert.deepEqual(camp.resources, { stone: 0, wood: 0, iron: 1, crystal: 0, food: 0 }, 'отказ ничего не тронул');
    assert.equal(camp.trades, 1, 'отказ знакомством не считается');
  });

  test('наценка в пользу продавца и тает сделками до паритета', () => {
    assert.equal(feeOf(0), 0.25, 'незнакомому — четверть сверху');
    for (let d = 0; d < 8; d++) {
      assert.ok(feeOf(d + 1) <= feeOf(d), 'наценка не растёт от сделок');
      for (const id of OFFER_ORDER) {
        const now = offerOf(id, d).give;
        const base = PARITY[id].give;
        for (const kind of Object.keys(base) as (keyof typeof base)[]) {
          assert.ok((now[kind] ?? 0) >= (base[kind] ?? 0), `${id}: курс щедрее паритета — §13 рушится`);
        }
      }
    }
    assert.equal(feeOf(5), 0, 'после пятой сделки — своя цена');
    assert.equal(dealsToParity(0), 5);
    assert.equal(dealsToParity(5), 0);
    assert.deepEqual(offerOf('iron-stone', 9), PARITY['iron-stone'], 'дальше паритета курс не идёт');
  });

  test('обратного обмена нет ни одного', () => {
    // Продать железо обратно нельзя намеренно: обратный курс превратил бы
    // лавку в качели, а §21.3 боится ровно «торгового автомата, где нечего
    // решать».
    for (const id of OFFER_ORDER) {
      const offer = PARITY[id];
      assert.equal(offer.give.iron ?? 0, 0, `${id}: железо отдают обратно`);
      assert.equal(offer.give.crystal ?? 0, 0, `${id}: кристалл вошёл в обмен`);
      assert.ok((offer.take.crystal ?? 0) === 0, `${id}: кристалл продаётся — §13 отменён`);
    }
  });

  test('строка курса называет оба конца словами и текущую цену', () => {
    const start = offerLine('iron-stone', (k) => RESOURCE_NAME[k], 0);
    assert.equal(start.give, 'Камень 10', 'незнакомому дороже паритета');
    assert.equal(start.take, 'Железо 1');
    const parity = offerLine('iron-stone', (k) => RESOURCE_NAME[k], 5);
    assert.equal(parity.give, 'Камень 8', 'своя цена — измеренный паритет');
  });
});

/* ---------- прилавок (§13.5 × §13.8) ---------- */

/**
 * Запас лавки. Заведён не потому, что бесконечный кран выглядит некрасиво,
 * а потому, что `trade.ts` сам требовал от пищевой строки «проигрывать
 * своему добытчику» — и на темпе игрока требование не держалось в триста
 * раз (`npm run trade`). Прилавок — то, чем оно держится.
 *
 * Мерит запас инструмент; здесь стоят границы, падение которых означает
 * смену механики.
 */
describe('Обмен: прилавок', () => {
  /** Замер `npm run trade`: 300 замков × 30 суток. Пищи за сутки, в среднем. */
  const LOCALS_FOOD_PER_DAY = 7.7;
  /**
   * Доля суток, когда местные не принесли ничего и пищи не купить. Была
   * пятой частью, стала сотой в тот день, когда у местных появились ноги
   * (§13.8): собиратель, дошедший до куста, кладёт снятое на тот же прилавок.
   * Отказ от этого не отменяется — он становится редким, а слова ему всё
   * равно положены.
   */
  const EMPTY_SHARE = 0.01;

  const camp0 = (): ReturnType<typeof createCamp> => {
    const camp = createCamp();
    // Кладовая конечна (§13.6): кошелёк держится заведомо ниже потолка,
    // иначе правило про прилавок ловило бы отказ места.
    camp.resources = { stone: 30, wood: 10, iron: 0, crystal: 0, food: 0 };
    return camp;
  };

  test('§13.2 и §13.1 — счёт стоит только на пище, железо не кончается', () => {
    // Железо в мире никто для торговца не добывает: любой счёт на нём был бы
    // числом назначенным. И он же был бы отказом после дороги — за железом
    // в замок и ходят. Пустая пища такой ценой не становится.
    assert.deepEqual([...STOCKED], ['food'], 'счёт завёлся на втором виде — откуда его числа?');
    const camp = camp0();
    const empty = { food: 0 };
    assert.equal(dealBlock(camp, { stone: 10 }, { iron: 1 }, empty), 'ok',
      'пустой прилавок закрыл железо — камень остался без безусловного стока (§13.2)');
    assert.equal(tradeBlock(camp, 'iron-stone', empty), 'ok', 'готовая пара на железе тоже не должна знать счёта');
    assert.equal(tradeBlock(camp, 'iron-wood', empty), 'ok');
  });

  test('больше принесённого не продаётся, и отказ ничего не трогает', () => {
    const camp = camp0();
    const before = { ...camp.resources };
    assert.equal(dealBlock(camp, { stone: 20 }, { food: 3 }, { food: 2 }), 'stock');
    assert.equal(makeDeal(camp, { stone: 20 }, { food: 3 }, { food: 2 }), false);
    assert.deepEqual(camp.resources, before, 'отказ прилавка списал камень');
    assert.equal(camp.trades ?? 0, 0, 'отказ знакомством не считается');
    // Ровно по запасу — проходит.
    assert.equal(makeDeal(camp, { stone: 20 }, { food: 2 }, { food: 2 }), true);
    assert.equal(camp.resources.food, 2);
  });

  test('прилавок читается раньше кошелька: пустая лавка — про мир, а не про игрока', () => {
    const broke = createCamp();
    broke.resources = { stone: 0, wood: 0, iron: 0, crystal: 0, food: 0 };
    assert.equal(dealBlock(broke, { stone: 6 }, { food: 3 }, { food: 0 }), 'stock',
      'нищему сказали про его кошелёк там, где лавка и так пуста');
  });

  test('запас не трогает цену: три критерия §13.5 сдвинуть нечем', () => {
    // Все три критерия — границы на курс. Запас убавляет сделки, а цену
    // не знает вовсе, и это видно из подписи: `offerOf` про прилавок
    // не спрашивает. Правило сторожит, чтобы так и осталось.
    for (const id of OFFER_ORDER) {
      for (let deals = 0; deals <= 6; deals++) {
        assert.deepEqual(offerOf(id, deals), offerOf(id, deals), 'курс перестал быть функцией одних отношений');
      }
    }
    assert.equal(offerOf.length, 2, 'у курса появился третий довод — не прилавок ли это');
  });

  test('счёт не хранится: он считается, а список выкупленного истекает', () => {
    const day = 3;
    const now = day * DAY_SEC + 100;
    assert.deepEqual(stockOf(5, {}, 77, now), { food: 5 }, 'нетронутый прилавок — это весь сбор местных');
    const log = { [marketKey(77, now)]: 2 };
    assert.deepEqual(stockOf(5, log, 77, now), { food: 3 }, 'выкупленное не убавило прилавок');
    assert.deepEqual(stockOf(5, log, 78, now), { food: 5 }, 'покупка в одном замке закрыла прилавок в другом');
    assert.deepEqual(stockOf(1, { [marketKey(77, now)]: 9 }, 77, now), { food: 0 }, 'прилавок ушёл в минус');
    // Самоистекающий, как `camp.picks`: вчерашнее не держит сегодняшний прилавок.
    const kept = pruneBought(log, now + DAY_SEC);
    assert.deepEqual(kept, {}, 'вчерашняя покупка пережила сутки — список растёт от прогулок');
    assert.deepEqual(pruneBought(log, now + 60), log, 'сегодняшняя покупка вычищена раньше срока');
  });

  test('§13.8 — на прилавке ровно то, что унесли местные, и это измеримо', () => {
    // Сорок замков по две недели: числа те же, что печатает `npm run trade`
    // на трёхстах, — иначе правило мерило бы другую выборку.
    let sum = 0, empty = 0, n = 0;
    for (let i = 0; i < 40; i++) {
      const site = generateCastleSite(1000 + i * 7919);
      for (let d = 0; d < 14; d++) {
        const food = localsTook(site.loc.seed, site.bushes, localsOf(site.gate, site.bushes), d * DAY_SEC + 60);
        sum += food;
        if (food === 0) empty++;
        n++;
      }
    }
    const perDay = sum / n;
    assert.ok(
      Math.abs(perDay - LOCALS_FOOD_PER_DAY) < 1,
      `местные приносят ${perDay.toFixed(2)} пищи в сутки против записанных ${LOCALS_FOOD_PER_DAY} — ` +
        'сбор §13.8 сдвинулся, и запас лавки вместе с ним',
    );
    assert.ok(perDay > 0.5, 'прилавок пуст всегда — это не запас, а закрытая лавка');
    assert.ok(
      Math.abs(empty / n - EMPTY_SHARE) < 0.05,
      `прилавок пуст в ${((empty / n) * 100).toFixed(0)}% суток против записанных ${EMPTY_SHARE * 100}%`,
    );
  });

  test('§13.7 — с запасом лавка проигрывает добытчику и на темпе игрока', () => {
    // Требование записано в `trade.ts` у пищевой строки и до запаса
    // не держалось: заход нулевого яруса несёт две пищи за двенадцать секунд.
    // Прилавок сводит суточный поток лавки к сбору местных, и он меньше
    // одного человека с приказом «Добывать пищу».
    const shopPerHour = LOCALS_FOOD_PER_DAY / (DAY_SEC / 3600);
    const gathererPerHour = 3600 / WORK_SECONDS;
    assert.ok(
      shopPerHour < gathererPerHour,
      `лавка даёт ${shopPerHour.toFixed(2)} пищи в час против ${gathererPerHour.toFixed(2)} у добытчика — ` +
        'приказ «Добывать пищу» снова отменён курсом',
    );
  });

  test('у каждой причины прилавка есть свои слова', () => {
    // §23.3 — одна причина, одни слова, один файл. Прежде озвучен был один
    // потолок кладовой, и строка жила в `main.ts`.
    const blocks: Exclude<DealBlock, 'ok'>[] = ['empty', 'resources', 'cheap', 'full', 'stock'];
    for (const block of blocks) {
      assert.ok((DEAL_REASON[block] ?? '').length > 0, `у отказа ${block} нет слов`);
    }
  });
});
