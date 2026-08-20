/**
 * Правила телеметрии: сводка обязана отвечать на вопросы §9, а не просто
 * считать события.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { events, setEvents, summarize } from './telemetry';

describe('Телеметрия и экран возврата', () => {
  test('§9 — сводка отвечает на «эвакуируются ли слишком рано»', () => {
    setEvents([
      { t: 'raid_end', at: 0, tier: 1, failed: false, maxBack: 5, locMaxBack: 20, carried: 6, lost: 0, steps: 30, foodLeft: 40, durationSec: 60 },
      { t: 'raid_end', at: 1, tier: 1, failed: true, maxBack: 15, locMaxBack: 20, carried: 0, lost: 4, steps: 50, foodLeft: 0, durationSec: 90 },
    ]);
    const s = summarize(events());
    assert.equal(s.raids, 2);
    assert.equal(s.failRate, 0.5);
    assert.equal(s.avgDepthShare, 0.5, '(5/20 + 15/20) / 2');
    assert.equal(s.avgCarried, 3);
    assert.equal(s.avgLost, 2);
  });

  test('§20.1 — считается доля возвратов с доступной покупкой', () => {
    setEvents([
      { t: 'return_screen', at: 0, canBuy: true, chose: 'build' },
      { t: 'return_screen', at: 1, canBuy: true, chose: 'raid' },
      { t: 'return_screen', at: 2, canBuy: false, chose: 'raid' },
      { t: 'return_screen', at: 3, canBuy: true, chose: 'build' },
    ]);
    const s = summarize(events());
    assert.equal(s.buyOfferRate, 0.75, 'покупка предлагалась в трёх возвратах из четырёх');
    assert.equal(s.buyTakeRate, 2 / 3, 'из них стройку выбрали дважды');
  });

  test('§9 — время возврата меряется только там, где таймер шёл', () => {
    setEvents([
      { t: 'session_start', at: 0, awaySec: 600, timerLeftSec: 100 },
      { t: 'session_start', at: 1, awaySec: 1800, timerLeftSec: 0 },
      { t: 'session_start', at: 2, awaySec: 99999, timerLeftSec: null },
    ]);
    const s = summarize(events());
    assert.equal(s.medianReturnMin, 20, 'медиана 10 и 30 минут; заход без таймера не в счёт');
  });

  test('точка выхода из сессии считается по местам', () => {
    setEvents([
      { t: 'exit', at: 0, where: 'raid' },
      { t: 'exit', at: 1, where: 'camp' },
      { t: 'exit', at: 2, where: 'camp' },
    ]);
    assert.deepEqual(summarize(events()).exits, { raid: 1, camp: 2, return: 0 });
  });

  test('пустая телеметрия не ломает сводку', () => {
    setEvents([]);
    const s = summarize(events());
    assert.equal(s.raids, 0);
    assert.equal(s.firstBuilding, null);
    assert.equal(s.medianReturnMin, null);
  });
});
