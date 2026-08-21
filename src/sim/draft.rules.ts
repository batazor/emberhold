/**
 * Правила драфта (§19). Живут рядом с draft.ts.
 *
 * Проверяется здесь ровно то, что §19 объявляет правилами раздачи, — и на
 * всех состояниях прогресса, а не на одном: §19.3 требует, чтобы оба правила
 * соблюдались «без исключений» и чтобы «ни одна доступная карта не выпадала
 * из оборота». Раздача, которая держит правила на богатом лагере и ломает
 * их на бедном, — это раздача, которая ломается ровно там, где игрок её
 * впервые видит.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mulberry32 } from '../core/rng';
import { createCamp } from './camp';
import type { CampState } from './camp';
import {
  DRAFT,
  DRAFT_ORDER,
  HAND_SIZE,
  deal,
  draftReady,
  effectOfCard,
  isOpen,
  openCards,
} from './draft';
import type { DraftCardId } from './draft';
import { createRaid } from './raid';
import type { Tier } from './types';

/** Лагерь с ровными уровнями: состояние прогресса задаётся одним числом. */
function campAt(level: number): CampState {
  const camp = createCamp();
  for (const id of Object.keys(camp.levels) as (keyof typeof camp.levels)[]) {
    camp.levels[id] = level;
  }
  return camp;
}

/** Все состояния, на которых драфт вообще может показаться игроку. */
const STATES: { level: number; tier: Tier }[] = [];
for (const level of [1, 2, 3, 4, 5, 6]) {
  for (const tier of [0, 1, 2, 3] as Tier[]) STATES.push({ level, tier });
}

describe('Драфт сборов (§19)', () => {
  test('§19.1 — в раздаче не бывает двух карт одной оси', () => {
    for (const { level, tier } of STATES) {
      const camp = campAt(level);
      for (let seed = 0; seed < 200; seed++) {
        const hand = deal(camp, tier, mulberry32(seed));
        const axes = new Set(hand.map((id) => DRAFT[id].axis));
        assert.equal(
          axes.size,
          hand.length,
          `уровень ${level}, ярус ${tier}, сид ${seed}: ${hand.join(', ')}`,
        );
      }
    }
  });

  test('§19.1 — не больше одной карты риска', () => {
    for (const { level, tier } of STATES) {
      const camp = campAt(level);
      for (let seed = 0; seed < 200; seed++) {
        const hand = deal(camp, tier, mulberry32(seed));
        const risky = hand.filter((id) => DRAFT[id].risky).length;
        assert.ok(risky <= 1, `уровень ${level}, ярус ${tier}, сид ${seed}: риска ${risky}`);
      }
    }
  });

  test('§19.1 — в раздаче нет повторов и все карты открыты', () => {
    for (const { level, tier } of STATES) {
      const camp = campAt(level);
      for (let seed = 0; seed < 100; seed++) {
        const hand = deal(camp, tier, mulberry32(seed));
        assert.equal(new Set(hand).size, hand.length, 'повтор карты в руке');
        for (const id of hand) {
          assert.ok(isOpen(id, camp, tier), `${id} не открыта на ${level}/${tier}`);
        }
      }
    }
  });

  /**
   * §19.3 — «ни одна доступная карта не выпадает из оборота». Карта, которая
   * открыта, но не выпадает никогда, — это мёртвая строка в таблице: игрок
   * заплатил за неё уровнем здания и не получил ничего.
   */
  test('§19.3 — каждая открытая карта попадается', () => {
    const camp = campAt(6);
    const tier: Tier = 3;
    const seen = new Set<DraftCardId>();
    for (let seed = 0; seed < 4000; seed++) {
      for (const id of deal(camp, tier, mulberry32(seed))) seen.add(id);
    }
    for (const id of openCards(camp, tier)) {
      assert.ok(seen.has(id), `${DRAFT[id].name} не выпала ни разу за 4000 раздач`);
    }
  });

  test('§19 — рука полна там, где хватает осей', () => {
    const camp = campAt(6);
    const hand = deal(camp, 3, mulberry32(1));
    assert.equal(hand.length, HAND_SIZE, 'на полном пуле раздаётся три карты');
  });

  /**
   * §19.4 — драфт не включается в первой сессии. Условие взято по пулу,
   * а не по счётчику сессий: выбор из двух на одной оси не выбор.
   */
  test('§19.4 — на стартовом лагере драфта нет, на выросшем есть', () => {
    assert.equal(draftReady(createCamp(), 0), false, 'первая сессия — без драфта');
    assert.ok(draftReady(campAt(6), 3), 'выросший лагерь даёт три оси');
  });

  test('§19.2 — у каждой карты есть ось, вес и открывающее здание', () => {
    for (const id of DRAFT_ORDER) {
      const c = DRAFT[id];
      assert.ok(c.weight > 0, `${id}: вес`);
      assert.ok(c.need.level >= 1, `${id}: уровень здания`);
      assert.ok(c.gives.length > 0, `${id}: строка «даёт»`);
    }
  });

  /**
   * Главное правило пула §19.2: **карта обязана менять решение «глубже или
   * назад»**. Проверяемая его половина — что карта вообще что-то меняет:
   * нейтральный эффект означает карту-пустышку, которая тратит выбор игрока
   * и не возвращает ничего.
   */
  test('§19.2 — ни одна карта не нейтральна', () => {
    for (const id of DRAFT_ORDER) {
      const e = effectOfCard(id);
      const moves =
        e.food !== 0 || e.bag !== 0 || e.vision !== 0 || e.risk !== 0 ||
        e.loot !== 1 || e.back !== 1 || e.hp !== 0 || e.fightFood !== null;
      assert.ok(moves, `${DRAFT[id].name} ничего не меняет`);
    }
  });

  /**
   * Эффект обязан доезжать до вылазки, а не оставаться в таблице. Проверяются
   * все поля разом, каждое своей картой: таблица, которую никто не читает,
   * это ровно тот дефект, из-за которого §14.2 и §14.3 годами стояли
   * написанными и невызванными.
   */
  test('§19 — карта доезжает до вылазки', () => {
    const base = { seed: 5, tier: 1 as Tier, kitchenLevel: 3, storageLevel: 3 };
    const plain = createRaid(base);

    assert.equal(
      createRaid({ ...base, draft: 'ration' }).foodMax,
      plain.foodMax + 25,
      'Двойной паёк поднимает и запас, и потолок полосы',
    );
    assert.equal(
      createRaid({ ...base, draft: 'crate' }).capacity,
      plain.capacity + 3,
      'Пустой короб расширяет рюкзак',
    );
    assert.ok(
      createRaid({ ...base, draft: 'crate' }).riskAdd > plain.riskAdd,
      'и он же поднимает ставку — это его цена',
    );
    assert.equal(
      createRaid({ ...base, draft: 'bat' }).visionAdd,
      plain.visionAdd + 2,
      'Нетопырь даёт обзор',
    );
    assert.equal(
      createRaid({ ...base, draft: 'bandage' }).hero.hpMax,
      plain.hero.hpMax + 4,
      'Повязки дают очки жизни',
    );
    assert.equal(
      createRaid({ ...base, draft: 'whetstone' }).fightFood,
      2,
      'Точило переписывает цену стычки',
    );
    assert.equal(createRaid({ ...base, draft: 'rope' }).backMul, 0.75, 'Верёвка сокращает дорогу');
    assert.ok(
      createRaid({ ...base, draft: 'pledge' }).riskAdd < plain.riskAdd,
      'Заклад снижает ставку',
    );
  });

  test('§19 — вылазка без карты считается ровно как считалась', () => {
    const base = { seed: 11, tier: 2 as Tier, kitchenLevel: 3, storageLevel: 3 };
    const plain = createRaid(base);
    const none = createRaid({ ...base, draft: null });
    assert.equal(none.foodMax, plain.foodMax);
    assert.equal(none.capacity, plain.capacity);
    assert.equal(none.riskAdd, plain.riskAdd);
    assert.equal(none.backMul, 1);
    assert.equal(none.hero.hpMax, plain.hero.hpMax);
  });
});
