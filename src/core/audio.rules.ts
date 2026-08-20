/**
 * Правила звука. Проверяются не тембры — их слушают в `sound.html`, — а то,
 * что записано в §18 как решение: пульс провианта молчит в начале, ускоряется
 * и повышается к концу и никогда не идёт вспять.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CAMP_PHRASES, SFX, foodPulse, midiHz, phraseSec } from './audio';

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

describe('Звук: мелодия лагеря (§18.4)', () => {
  /**
   * Ля-минор — тот же строй, что у арпеджио роста здания (523·659·784·1046,
   * до-мажор). Классы высот совпадают, поэтому достроившееся под музыку
   * здание попадает внутрь неё, а не поверх.
   */
  const IN_KEY = new Set([0, 2, 4, 5, 7, 9, 11]);

  test('вся петля лежит в одном строе с арпеджио роста здания', () => {
    for (const p of CAMP_PHRASES) {
      for (const n of p.notes) {
        assert.ok(IN_KEY.has(n.midi % 12), `нота ${n.midi} выпадает из ля-минора`);
      }
    }
  });

  test('арпеджио §18.3 действительно в том же строе — иначе проверка пустая', () => {
    for (const hz of [523, 659, 784, 1046]) {
      const midi = Math.round(69 + 12 * Math.log2(hz / 440));
      assert.ok(IN_KEY.has(midi % 12), `${hz} Гц выпадает из строя`);
    }
  });

  test('пауза длиннее фразы: этим петля и не надоедает', () => {
    for (const p of CAMP_PHRASES) {
      assert.ok(
        p.restSec > phraseSec(p),
        `фраза ${phraseSec(p).toFixed(1)} с при паузе ${p.restSec} с — музыка идёт сплошняком`,
      );
    }
  });

  test('фраз больше одной — иначе петля читается метрономом', () => {
    assert.ok(CAMP_PHRASES.length >= 2);
    assert.notDeepEqual(CAMP_PHRASES[0]!.notes, CAMP_PHRASES[1]!.notes);
  });

  test('круг короткий: игрок сидит в лагере от 30 секунд до двух минут', () => {
    const loop = CAMP_PHRASES.reduce((sum, p) => sum + phraseSec(p) + p.restSec, 0);
    assert.ok(loop > 15 && loop < 40, `круг ${loop.toFixed(1)} с`);
  });

  test('midiHz совпадает с камертоном', () => {
    assert.equal(Math.round(midiHz(69)), 440);
    assert.equal(Math.round(midiHz(57)), 220);
  });
});
