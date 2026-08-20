/**
 * Правила звука. Проверяются не тембры — их слушают в `sound.html`, — а то,
 * что записано в §18 как решение: пульс провианта молчит в начале, ускоряется
 * и повышается к концу и никогда не идёт вспять.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SFX, foodPulse } from './audio';

describe('Звук: пульс провианта (§18.2)', () => {
  test('выше 60% пульса нет вовсе — тишина это состояние', () => {
    for (const share of [1, 0.9, 0.75, 0.61]) {
      assert.equal(foodPulse(share), null, `на ${share} пульс не молчит`);
    }
  });

  test('таблица §18.2 воспроизведена по границам', () => {
    assert.deepEqual(foodPulse(0.6), { everyMs: 2000, hz: 70 });
    assert.deepEqual(foodPulse(0.31), { everyMs: 2000, hz: 70 });
    assert.deepEqual(foodPulse(0.3), { everyMs: 1200, hz: 88 });
    assert.deepEqual(foodPulse(0.16), { everyMs: 1200, hz: 88 });
    assert.deepEqual(foodPulse(0.15), { everyMs: 600, hz: 110 });
    assert.deepEqual(foodPulse(0), { everyMs: 600, hz: 110 });
  });

  test('чем меньше провианта, тем чаще и выше — и ни разу наоборот', () => {
    let prev = foodPulse(0.6)!;
    for (let share = 0.59; share >= 0; share -= 0.01) {
      const now = foodPulse(share);
      assert.notEqual(now, null, `на ${share.toFixed(2)} пульс пропал`);
      assert.ok(now!.everyMs <= prev.everyMs, `пульс замедлился на ${share.toFixed(2)}`);
      assert.ok(now!.hz >= prev.hz, `пульс понизился на ${share.toFixed(2)}`);
      prev = now!;
    }
  });

  test('пустой провиант звучит тревожнее полного, а не тише', () => {
    const low = foodPulse(0.05)!;
    const mid = foodPulse(0.5)!;
    assert.ok(low.everyMs < mid.everyMs);
    assert.ok(low.hz > mid.hz);
  });
});

describe('Звук: библиотека (§18.3)', () => {
  test('вся библиотека артбука перенесена', () => {
    const expected = [
      'step', 'swing', 'hit', 'wound', 'kill', 'chest', 'pick', 'tick',
      'evac', 'fail', 'build', 'levelup', 'tap', 'deny',
    ];
    assert.deepEqual(Object.keys(SFX).sort(), [...expected].sort());
  });

  test('звук без контекста не падает в Node — симуляция гоняется headless', () => {
    for (const name of Object.keys(SFX) as (keyof typeof SFX)[]) {
      assert.doesNotThrow(() => SFX[name](), `${name} упал без AudioContext`);
    }
  });
});
