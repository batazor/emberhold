import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { chronicle, raidTrend } from './statsPanel';
import type { TelemetryEvent } from '../sim/telemetry';
import type { Tier } from '../sim/types';

const raid = (at: number, tier: Tier, carried: number, failed = false): TelemetryEvent => ({
  t: 'raid_end',
  at,
  tier,
  failed,
  maxBack: 5,
  locMaxBack: 10,
  carried,
  lost: 0,
  steps: 10,
  foodLeft: 2,
  durationSec: 60,
  cause: failed ? 'combat' : 'evacuated',
  lastHitBy: null,
  damageTaken: 0,
  fights: 0,
  kills: 0,
});

describe('Летопись: карточки прогресса', () => {
  test('тренд сравнивает две последние пятёрки, а рисует только шесть походов', () => {
    const list = [...Array.from({ length: 5 }, (_, i) => raid(i, 0, 10)), ...Array.from({ length: 5 }, (_, i) => raid(i + 5, 1, 15))];
    const trend = raidTrend(list);
    assert.deepEqual(trend.values, [10, 15, 15, 15, 15, 15]);
    assert.equal(trend.change, 0.5);
  });

  test('до второй пятёрки карточка не выдумывает сравнение', () => {
    assert.equal(raidTrend([raid(1, 0, 4)]).change, null);
  });

  test('хроника хранит первый успех яруса и настоящие улучшения', () => {
    const list: TelemetryEvent[] = [
      raid(1, 0, 4),
      raid(2, 0, 9),
      raid(3, 1, 0, true),
      raid(4, 1, 8),
      { t: 'build_done', at: 5, building: 'storage', level: 2 },
      { t: 'craft', at: 6, slot: 'weapon', toLevel: 2 },
    ];
    const items = chronicle(list);
    assert.equal(items.length, 4);
    assert.equal(items[0]?.title, 'Снаряжение улучшено');
    assert.equal(items.filter((item) => item.title === 'Первая вылазка завершена').length, 1);
    assert.ok(items.some((item) => item.title === 'Открыт путь через Ярус 1'));
  });
});
