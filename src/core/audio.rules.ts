/**
 * Правила звука. Проверяются не тембры — их слушают в `audioart.html`, — а то,
 * что записано в §18 как решение: пульс провианта молчит в начале, ускоряется
 * и повышается к концу и никогда не идёт вспять.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { CAMP_PHRASES, SAMPLES, SFX, foodPulse, midiHz, phraseSec, sampleFile } from './audio';

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
      'evac', 'fail', 'build', 'levelup', 'gift', 'tap', 'deny',
      'heavyStep', 'stoneHit', 'roar', 'golemBreak',
    ];
    assert.deepEqual(Object.keys(SFX).sort(), [...expected].sort());
  });

  test('созвучие остаётся одно на игру', () => {
    // §18.3 — арпеджио приберегается росту здания. Правило записано словами
    // и до сих пор держалось само собой; подарок за вход был первым звуком
    // за долгое время, который просился в аккорд, и поводом его проверить.
    const source = readFileSync(new URL('./audio.ts', import.meta.url), 'utf8');
    const chords = [...source.matchAll(/(\w+): \(\): void => \{\s*for \(const \[i, f\] of \[/g)]
      .map((m) => m[1]!);
    assert.deepEqual(
      chords.sort(),
      ['evac', 'levelup'],
      'созвучий стало больше двух — трезвучие возвращения и арпеджио здания были последними',
    );
  });

  test('звук без контекста не падает в Node — симуляция гоняется headless', () => {
    for (const name of Object.keys(SFX) as (keyof typeof SFX)[]) {
      assert.doesNotThrow(() => SFX[name](), `${name} упал без AudioContext`);
    }
  });
});

describe('Звук: сэмплы чужого набора (§18.5)', () => {
  /**
   * Восемь имён, которым набор не годится по существу, а не по случаю: их
   * тембр выведен из разнесения по частоте (§18.1), а пульс провианта вдобавок
   * задан таблицей §18.2 и проверяется числами. Сэмпл сюда не заходит — иначе
   * проверять станет нечего, а решение уедет в чужой файл.
   */
  const SIGNAL = ['wound', 'kill', 'tick', 'evac', 'fail', 'levelup', 'gift', 'tap', 'deny'];

  test('сэмпл есть только у имени из библиотеки', () => {
    for (const spec of SAMPLES) {
      assert.ok(spec.name in SFX, `${spec.name} — не имя §18.3`);
    }
  });

  test('сигнальные звуки остаются синтезом', () => {
    for (const spec of SAMPLES) {
      assert.ok(!SIGNAL.includes(spec.name), `${spec.name} сигнальный, сэмплу там не место`);
    }
  });

  test('у каждого имени есть варианты, и они разные — иначе метроном', () => {
    for (const spec of SAMPLES) {
      assert.ok(spec.files.length > 0, `${spec.name} без файлов`);
      assert.equal(
        new Set(spec.files).size,
        spec.files.length,
        `${spec.name}: один файл записан дважды`,
      );
    }
  });

  test('громкость сэмпла не выше ранения — §18.3 про порядок, а не про набор', () => {
    // Ранение — самый громкий звук игры, его тон идёт с gain 0.34.
    for (const spec of SAMPLES) {
      assert.ok(spec.gain <= 0.34, `${spec.name} громче ранения: ${spec.gain}`);
    }
  });

  test('имена файлов не сталкиваются — сборка кладёт их в одну папку', () => {
    const all = SAMPLES.flatMap((s) => s.files.map((_, i) => sampleFile(s.name, i)));
    assert.equal(new Set(all).size, all.length, 'два сэмпла метят в один файл');
  });

  test('рецепт остаётся на месте: без загруженных сэмплов игра звучит', () => {
    // Тот же прогон, что и для всей библиотеки, но названный отдельно:
    // именно это свойство делает загрузку сэмплов необязательной.
    for (const spec of SAMPLES) {
      assert.doesNotThrow(() => SFX[spec.name](), `${spec.name} упал без сэмпла`);
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
