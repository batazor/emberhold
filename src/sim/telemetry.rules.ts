/**
 * Правила телеметрии: сводка обязана отвечать на вопросы §9, а не просто
 * считать события.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { events, setEvents, summarize } from './telemetry';
import type { TelemetryEvent } from './telemetry';

type End = Extract<TelemetryEvent, { t: 'raid_end' }>;

/**
 * Конец вылазки с умолчаниями. Заведён затем, чтобы проверка про глубину
 * не перечисляла поля боя, а проверка про бой — поля глубины: иначе каждая
 * новая метрика правит все тесты сразу и перестаёт быть проверяемой.
 */
const end = (over: Partial<End>): End => ({
  t: 'raid_end', at: 0, tier: 1, failed: false,
  maxBack: 0, locMaxBack: 20, carried: 0, lost: 0, steps: 0, foodLeft: 0, durationSec: 0,
  cause: 'evacuated', lastHitBy: null, damageTaken: 0, fights: 0, kills: 0,
  ...over,
});

describe('Телеметрия и экран возврата', () => {
  test('§9 — сводка отвечает на «эвакуируются ли слишком рано»', () => {
    setEvents([
      end({ at: 0, failed: false, maxBack: 5, carried: 6, lost: 0, steps: 30, foodLeft: 40, durationSec: 60 }),
      end({ at: 1, failed: true, maxBack: 15, carried: 0, lost: 4, steps: 50, foodLeft: 0, durationSec: 90, cause: 'food' }),
    ]);
    const s = summarize(events());
    assert.equal(s.raids, 2);
    assert.equal(s.failRate, 0.5);
    assert.equal(s.avgDepthShare, 0.5, '(5/20 + 15/20) / 2');
    assert.equal(s.avgCarried, 3);
    assert.equal(s.avgLost, 2);
  });

  /**
   * Доли «провиант против боя» здесь больше нет: соотношение снято с действия
   * вместе с §11.3. Осталась атрибуция — кто добил, — потому что она отвечает
   * не на «чем кончаются вылазки», а на «кого чинить», и этот вопрос жив.
   */
  test('провалы считаются, и добивший записывается поимённо', () => {
    setEvents([
      end({ at: 0, failed: false }),
      end({ at: 1, failed: false }),
      end({ at: 2, failed: true, cause: 'food' }),
      end({ at: 3, failed: true, cause: 'combat', lastHitBy: 'warrior' }),
      end({ at: 4, failed: true, cause: 'combat', lastHitBy: 'mage' }),
    ]);
    const s = summarize(events());
    assert.equal(s.failRate, 0.6, 'три провала из пяти вылазок');
    assert.deepEqual(s.fatalBy, { warrior: 1, mage: 1 }, 'без атрибуции неясно, что чинить');
  });

  test('успешная вылазка не попадает в атрибуцию боя', () => {
    setEvents([end({ at: 0, failed: false, damageTaken: 2, fights: 3, kills: 4 })]);
    const s = summarize(events());
    assert.deepEqual(s.fatalBy, {}, 'никто не добивал — атрибуции нет');
    assert.equal(s.avgDamageTaken, 2, 'урон считается и у выживших: бой был');
    assert.equal(s.avgFights, 3);
  });

  test('защита сводится по вылазкам, а старые записи получают нули', () => {
    setEvents([
      end({
        at: 0,
        guardTurns: 2,
        guardPrevented: 6,
        shieldPushes: 1,
        intercepts: 1,
        dodges: 3,
      }),
      end({ at: 1 }),
    ]);
    const s = summarize(events());
    assert.equal(s.avgGuardTurns, 1);
    assert.equal(s.avgGuardPrevented, 3);
    assert.equal(s.avgShieldPushes, 0.5);
    assert.equal(s.avgIntercepts, 0.5);
    assert.equal(s.avgDodges, 1.5);
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
