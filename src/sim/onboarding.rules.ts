/**
 * Правила онбординга. Проверяется не текст подсказок, а то, ради чего
 * раскадровка `onboarding.html` вообще написана: порядок, который нельзя
 * менять, и невозможность застрять между кадрами.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCamp, kitchenFood, TIER_KITCHEN_GATE, tierBlock } from './camp';
import { TIER_RISK } from './config';
import { createRaid } from './raid';
import {
  BAIT_TIMEOUT,
  ONB_ORDER,
  REVEAL_PAUSE,
  grantFirstBuilding,
  isRaidStep,
  nextRaidStep,
  openEvacWhenEarned,
  reveal,
  stepIndex,
} from './onboarding';
import type { OnbStep, RaidSignals } from './onboarding';

const NOTHING: RaidSignals = { moved: false, wounded: false, looted: 0, sinceStep: 0 };
const sig = (over: Partial<RaidSignals>): RaidSignals => ({ ...NOTHING, ...over });

describe('Онбординг: порядок кадров', () => {
  test('игра начинается ходьбой по локации, а не в лагере', () => {
    assert.equal(ONB_ORDER[0], 'glade', 'первый кадр — прогулка по поляне');
    assert.ok(
      stepIndex('gather') === stepIndex('glade') + 1,
      'сбор дерева — часть пролога, а не отдельная сцена после него',
    );
    assert.ok(
      stepIndex('upgrade') === stepIndex('gather') + 1,
      'второй уровень палатки — часть пролога, а не первое дело в лагере',
    );
    assert.ok(
      stepIndex('move') === stepIndex('upgrade') + 1,
      'вылазка идёт сразу за прологом: между ними нет ни экрана, ни меню',
    );
    assert.ok(
      stepIndex('build') > stepIndex('evac'),
      'лагерь идёт после эвакуации: он награда за вылазку, а не стартовая комната',
    );
  });

  test('кадры вылазки переживают перезапуск сбросом, лагерные — нет', () => {
    assert.ok(isRaidStep('glade'), 'поляна тоже не переживает перезапуск');
    assert.ok(isRaidStep('gather'), 'собранное на поляне перезапуск не переживает');
    assert.ok(isRaidStep('move') && isRaidStep('evac'));
    assert.ok(!isRaidStep('return') && !isRaidStep('build') && !isRaidStep('done'));
  });
});

describe('Онбординг: полосы включаются по одной', () => {
  test('в первом кадре открыт только провиант', () => {
    const r = reveal('glade');
    assert.ok(r.food);
    assert.ok(!r.wounds && !r.bag && !r.back && !r.risk && !r.evac && !r.controls);
  });

  test('каждая полоса появляется на своём кадре и больше не гаснет', () => {
    const flags = ['food', 'wounds', 'bag', 'back', 'risk', 'evac', 'controls'] as const;
    let prev = reveal(ONB_ORDER[0]!);
    for (const step of ONB_ORDER.slice(1)) {
      const now = reveal(step);
      for (const f of flags) {
        if (prev[f]) assert.ok(now[f], `${f} погасло на кадре ${step}`);
      }
      prev = now;
    }
  });

  test('ставка вводится последней из полос', () => {
    assert.ok(
      stepIndex('bait') > stepIndex('back') && stepIndex('back') > stepIndex('loot'),
      'сначала рюкзак, потом путь назад, и только потом «под угрозой»',
    );
    assert.ok(!reveal('back').risk, 'на кадре с ценой возврата ставки ещё нет');
    assert.ok(reveal('bait').risk);
  });

  test('в первой вылазке жест ровно один — тап по земле', () => {
    for (const step of ONB_ORDER) {
      if (step === 'done') continue;
      assert.ok(!reveal(step).controls, `${step}: поворот и зум не показываются`);
    }
    assert.ok(reveal('done').controls, 'после онбординга управление открыто целиком');
  });
});

describe('Онбординг: цепочка не рвётся', () => {
  test('кадр движения ждёт первого шага', () => {
    assert.equal(nextRaidStep('move', NOTHING), null);
    assert.equal(nextRaidStep('move', sig({ moved: true })), 'approach');
  });

  test('рана двигает кадр, но её отсутствие цепочку не держит', () => {
    assert.equal(nextRaidStep('approach', sig({ wounded: true })), 'wound');
    assert.equal(
      nextRaidStep('approach', sig({ looted: 1 })),
      'loot',
      'игрок обошёл бой и вскрыл сундук — рюкзак обязан появиться',
    );
    assert.equal(nextRaidStep('approach', NOTHING), null);
  });

  test('добыча, цена возврата и ставка расходятся паузой', () => {
    assert.equal(nextRaidStep('loot', sig({ sinceStep: REVEAL_PAUSE - 0.1 })), null);
    assert.equal(nextRaidStep('loot', sig({ sinceStep: REVEAL_PAUSE })), 'back');
    assert.equal(nextRaidStep('back', sig({ sinceStep: REVEAL_PAUSE })), 'bait');
  });

  test('выход показывается и тому, кто за приманкой не пошёл', () => {
    assert.equal(nextRaidStep('bait', sig({ looted: 2 })), 'evac');
    assert.equal(nextRaidStep('bait', sig({ sinceStep: BAIT_TIMEOUT })), 'evac');
    assert.equal(nextRaidStep('bait', sig({ looted: 1, sinceStep: 1 })), null);
  });

  test('из любого кадра вылазки цепочка доходит до эвакуации', () => {
    let step: OnbStep = 'move';
    const s = sig({ moved: true, wounded: true, looted: 2, sinceStep: BAIT_TIMEOUT });
    for (let guard = 0; guard < ONB_ORDER.length && step !== 'evac'; guard++) {
      const next = nextRaidStep(step, s);
      assert.notEqual(next, null, `застряли на кадре ${step}`);
      step = next!;
    }
    assert.equal(step, 'evac');
  });
});

describe('Онбординг: выход открывается добычей', () => {
  const first = (): ReturnType<typeof createRaid> =>
    createRaid({ seed: 7, tier: 0, kitchenLevel: 1, storageLevel: 1, evacOpen: false });

  test('обычная вылазка начинается с открытым выходом', () => {
    const state = createRaid({ seed: 7, tier: 0, kitchenLevel: 1, storageLevel: 1 });
    assert.equal(state.evacOpen, true, 'замеры и бот считают вылазку как прежде');
  });

  test('герой стартует на точке эвакуации — потому выход и закрыт', () => {
    const state = first();
    assert.equal(state.hero.x, state.loc.evac.x);
    assert.equal(state.hero.z, state.loc.evac.z);
    assert.equal(state.evacOpen, false);
  });

  test('пустой рюкзак домой не уводит', () => {
    const state = first();
    assert.equal(openEvacWhenEarned(state, 'approach'), false);
    assert.equal(state.evacOpen, false);
  });

  test('первая добыча открывает выход сразу — выбор обязан быть настоящим', () => {
    const state = first();
    state.bagTotal = 3;
    assert.equal(openEvacWhenEarned(state, 'loot'), true);
    assert.equal(state.evacOpen, true);
    assert.equal(openEvacWhenEarned(state, 'loot'), false, 'открывается один раз');
  });

  test('кадр 7 открывает выход и без добычи', () => {
    const state = first();
    assert.equal(openEvacWhenEarned(state, 'evac'), true);
  });
});

describe('Онбординг: первая постройка', () => {
  test('первое здание бесплатно и мгновенно (§20.2, §20.3)', () => {
    const camp = createCamp();
    const before = { ...camp.resources };
    assert.ok(grantFirstBuilding(camp, 'kitchen'));
    assert.equal(camp.levels.kitchen, 2);
    assert.equal(camp.construction, null, 'таймера нет: здание выросло на глазах');
    assert.deepEqual(camp.resources, before, 'ценника нет');
  });

  test('Кухня поднимает провиант и открывает следующий ярус со ставкой', () => {
    const camp = createCamp();
    assert.equal(tierBlock(camp, 1), 'kitchen', 'до постройки ярус 1 закрыт');
    const foodBefore = kitchenFood(camp.levels.kitchen);
    grantFirstBuilding(camp, 'kitchen');
    assert.ok(kitchenFood(camp.levels.kitchen) > foodBefore, 'провиант вырос');
    assert.equal(camp.levels.kitchen, TIER_KITCHEN_GATE[1]);
    assert.equal(tierBlock(camp, 1), 'ok');
    assert.equal(TIER_RISK[0], 0, 'первая жадность вознаграждается: ставка нулевая');
    assert.ok(TIER_RISK[1] > 0, 'ненулевая ставка показывается только на кадре 10');
  });

  test('подарок не выдаётся поверх занятого слота стройки', () => {
    const camp = createCamp();
    camp.construction = { building: 'hq', toLevel: 2, startedAt: 0, endsAt: 999 };
    assert.equal(grantFirstBuilding(camp, 'kitchen'), false);
    assert.equal(camp.levels.kitchen, 1);
  });
});
