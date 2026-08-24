/**
 * Правила хроники (`chronicle.ts`). Меряется не то, красиво ли написано, —
 * это решает глаз, — а четыре обещания §25, которые протухают молча:
 * строка выводится из события, день пересказан одной строкой, число в строке
 * есть всегда, и ни один шаблон не мёртв.
 *
 * Последнее — главное. Шаблон, который не выпадает никогда, это не строка
 * про запас, а мёртвый контент: он выглядит как разнообразие в исходнике
 * и не существует в игре. Проверяется он тем же способом, что и классы
 * героев (§11.7): прогоном бота, а не рассуждением. События для прогона
 * собираются из настоящих вылазок — тех же, что меряет `npm run measure`.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mulberry32 } from '../core/rng';
import { POLICIES, playRaid } from './bot';
import type { PolicyName } from './bot';
import { kitchenFood, storageCapacity } from './camp';
import { CHRON_LIMIT, CHRON_ORDER, CHRON_TEXT, chronicle } from './chronicle';
import type { ChronId } from './chronicle';
import { emptyGear } from './gear';
import { createHero } from './heroes';
import { reportOf, ticketOf } from './sortie';
import type { TelemetryEvent } from './telemetry';
import type { Tier } from './types';
import { DAY_SEC } from './world';

/** Секунда внутри суток, в которую кладётся событие: день решает всё. */
const at = (day: number, offset = 0): number => day * DAY_SEC + 3600 + offset;

/**
 * Настоящие вылазки, разложенные по суткам: бот играет, а мы записываем
 * за ним ровно то, что записала бы игра. Две вылазки в день — столько же,
 * сколько кладёт в день кривая §16.
 *
 * Манер игры три, а не одна, и это не про полноту прогона. Осторожный бот
 * уходит на шестидесяти процентах рюкзака и полным его не приносит никогда:
 * на нём одном шаблон `full` числился мёртвым, хотя мёртв был не он,
 * а прибор. Жадный уходит на единице — и вопрос «выпадает ли полный рюкзак»
 * снова про игру, а не про настройку бота.
 *
 * **Условия берутся броском, а не остатком от деления.** Первая версия
 * раздавала ярус, Кухню, Склад и манеру через `i % 4`, `i % 5`, `i % 3`:
 * циклы совпали фазами, Дно досталось одним и тем же тридцати сидам,
 * и провалов на нём не случилось ни одного — при том что на свободном
 * прогоне их выпадает два-четыре из сорока. Прибор показывал мёртвым
 * шаблон, который жив; это та же порода ошибки, что §11.10.
 */
const HANDS: readonly PolicyName[] = ['cautious', 'balanced', 'greedy'];

function played(runs: number): TelemetryEvent[] {
  const out: TelemetryEvent[] = [];
  for (let i = 0; i < runs; i++) {
    const seed = i + 1;
    const day = Math.floor(i / 2);
    // Свой поток, а не тот, которым играет вылазка: условия захода и его
    // случайности не должны быть одним броском.
    const roll = mulberry32(seed * 7919);
    const tier = Math.floor(roll() * 4) as Tier;
    const kitchenLevel = 1 + Math.floor(roll() * 6);
    const storageLevel = 1 + Math.floor(roll() * 3);
    const hand = HANDS[Math.floor(roll() * HANDS.length)]!;
    const r = playRaid({ seed, tier, kitchenLevel, storageLevel }, POLICIES[hand], mulberry32(seed));
    out.push({
      t: 'raid_start',
      at: at(day, i),
      tier,
      food: kitchenFood(kitchenLevel),
      capacity: storageCapacity(storageLevel),
    });
    out.push({
      t: 'raid_end',
      at: at(day, i + 1),
      tier,
      failed: r.status !== 'evacuated',
      maxBack: r.maxBack,
      locMaxBack: r.locMaxBack,
      carried: r.carriedTotal,
      lost: r.lost,
      steps: r.steps,
      foodLeft: r.foodLeft,
      durationSec: r.durationSec,
      cause: r.cause,
      lastHitBy: r.lastHitBy,
      damageTaken: r.damageTaken,
      fights: r.fights,
      kills: r.kills,
    });
  }
  return out;
}

/** Сутки, в которых кончилась стройка и больше ничего не случилось. */
const builtDay = (day: number): TelemetryEvent[] => [
  { t: 'build_done', at: at(day), building: 'storage', level: 2 },
];

/**
 * Сутки, в которые ходил только отряд (§26). Событие берётся из настоящего
 * похода, а не пишется руками: строка хроники обязана называть то же число,
 * которое лагерь положил на склад.
 */
function sortieDay(day: number): TelemetryEvent[] {
  const hero = createHero('knight', 0);
  const ticket = ticketOf(
    3,
    1,
    4242,
    hero,
    { kitchen: 2, storage: 2, loot: 1, event: null, gear: emptyGear(), offhand: 'torch', arrows: 0 },
    at(day),
  );
  const report = reportOf(ticket, hero);
  return [
    {
      t: 'sortie',
      at: ticket.endsAt,
      tier: ticket.tier,
      failed: report.failed,
      carried: report.total,
      seconds: ticket.endsAt - ticket.startedAt,
    },
  ];
}

const RUNS = 120;
const RUN_EVENTS = played(RUNS);

describe('Хроника', () => {
  test('нет события — нет строки', () => {
    assert.deepEqual(chronicle([]), []);
    // Кадры онбординга в буфере есть всегда, а сутками они не становятся:
    // хроника пересказывает сделанное, а не всё записанное.
    const idle: TelemetryEvent[] = [
      { t: 'onboarding', at: at(3), step: 'glade' },
      { t: 'session_start', at: at(3), awaySec: 60, timerLeftSec: null },
      { t: 'exit', at: at(3), where: 'camp', sec: 180 },
    ];
    assert.deepEqual(chronicle(idle), []);
  });

  test('один день — одна строка', () => {
    const days = new Set(chronicle(RUN_EVENTS, 1000).map((e) => e.day));
    assert.equal(days.size, chronicle(RUN_EVENTS, 1000).length);
  });

  test('свежее сверху, и не длиннее лимита', () => {
    const all = chronicle(RUN_EVENTS, 1000);
    for (let i = 1; i < all.length; i++) {
      assert.ok(all[i - 1]!.day > all[i]!.day, 'дни идут не сверху вниз');
    }
    assert.ok(chronicle(RUN_EVENTS).length <= CHRON_LIMIT);
    assert.equal(chronicle(RUN_EVENTS)[0]?.day, all[0]?.day, 'обрезка съела свежий день');
  });

  test('каждая строка называет число, которое можно проверить', () => {
    for (const e of chronicle(RUN_EVENTS, 1000)) {
      assert.match(e.value, /\d/, `строка «${e.text}» не называет числа`);
      // Значение стоит справа в той же `.row`, что и подпись (§6.2):
      // строка на полстроки — это уже абзац, а не число.
      assert.ok(e.value.length <= 28, `значение длиннее строки: ${e.value}`);
    }
  });

  test('та же телеметрия — та же хроника', () => {
    assert.deepEqual(chronicle(RUN_EVENTS), chronicle([...RUN_EVENTS]));
  });

  test('мёртвых шаблонов нет: каждый выпадает на прогоне бота', () => {
    const events = [...RUN_EVENTS, ...builtDay(999), ...sortieDay(1000)];
    const seen = new Set<ChronId>(chronicle(events, 1000).map((e) => e.id));
    const dead = CHRON_ORDER.filter((id) => !seen.has(id));
    assert.deepEqual(
      dead,
      [],
      `шаблон не выпал ни разу за ${RUNS} вылазок — это мёртвый контент, а не запас`,
    );
  });

  test('старшинство: провал перебивает удачный заход того же дня', () => {
    // Порядок шаблонов — решение (§25), и проверяется он на дне, где
    // случилось и то и другое: пересказан обязан быть провал.
    const bad = RUN_EVENTS.filter(
      (e): e is Extract<TelemetryEvent, { t: 'raid_end' }> => e.t === 'raid_end' && e.failed,
    )[0];
    assert.ok(bad !== undefined, 'бот не провалил ни одной вылазки — мерить нечем');
    const good: TelemetryEvent = { ...bad, at: bad.at + 1, failed: false, lost: 0, carried: 7 };
    const line = chronicle([bad, good], 1)[0];
    assert.equal(line?.id, bad.tier === 3 ? 'bottom' : 'fail');
  });

  test('слова хроники — назывные, без адресата и без точки', () => {
    // Полная перепись голоса живёт в `voice.rules.ts`; здесь — то, что
    // касается только этой таблицы и падает первым при правке слов.
    for (const [id, text] of Object.entries(CHRON_TEXT)) {
      assert.ok(!text.endsWith('.'), `${id} кончается точкой: ${text}`);
      assert.ok(text.length <= 30, `${id} не помещается в подпись: ${text}`);
    }
    assert.deepEqual([...CHRON_ORDER].sort(), Object.keys(CHRON_TEXT).sort());
  });
});
