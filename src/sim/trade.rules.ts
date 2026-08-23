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
import { PARITY, OFFER_ORDER, dealsToParity, feeOf, offerLine, offerOf, trade, tradeBlock } from './trade';
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
