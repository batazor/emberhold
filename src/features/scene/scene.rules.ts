/**
 * Правила сцены: что видно и что звучит. Проверяется не вёрстка, а то,
 * ради чего таблица и заведена, — что сцены не протекают друг в друга.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { panelsFor, soundFor } from './index';
import type { Scene } from './index';

const SCENES: readonly Scene[] = ['title', 'camp', 'raid'];

describe('Сцена: что видно', () => {
  test('главный экран в каждой сцене ровно один', () => {
    for (const scene of SCENES) {
      const p = panelsFor(scene);
      const main = [p.hud, p.campHud, p.startScreen].filter(Boolean).length;
      assert.equal(main, 1, `${scene}: главных экранов ${main}`);
    }
  });

  test('лагерь не переживает вход в вылазку', () => {
    const p = panelsFor('raid');
    assert.equal(p.campHud, false);
    assert.equal(p.roster, false);
    assert.equal(p.stats, false);
  });

  test('вылазка не переживает возвращение в лагерь', () => {
    assert.equal(panelsFor('camp').hud, false);
  });

  test('заставка показывает только себя', () => {
    const p = panelsFor('title');
    assert.deepEqual(
      Object.entries(p).filter(([, on]) => on).map(([name]) => name),
      ['startScreen'],
    );
  });

  test('экран возврата и предложение лагеря сцена не поднимает', () => {
    // Их открывает событие — конец вылазки и кончившийся провиант, — а не
    // смена сцены. Сцена их только гасит.
    for (const scene of SCENES) {
      assert.equal(panelsFor(scene).returnScreen, false, scene);
      assert.equal(panelsFor(scene).campPrompt, false, scene);
    }
  });

  test('тихий лагерь кадров 9–10 прячет отряд и данные, но не сам лагерь', () => {
    const quiet = panelsFor('camp', true);
    assert.equal(quiet.campHud, true, 'лагерь спрятался вместе с панелями');
    assert.equal(quiet.roster, false);
    assert.equal(quiet.stats, false);
  });

  test('тишина раскадровки касается только лагеря', () => {
    for (const scene of SCENES) {
      if (scene === 'camp') continue;
      assert.deepEqual(panelsFor(scene, true), panelsFor(scene, false), scene);
    }
  });
});

describe('Сцена: что звучит', () => {
  test('пульс провианта идёт только в вылазке (§18.2)', () => {
    assert.equal(soundFor('raid', 2).pulse, true);
    assert.equal(soundFor('camp', 0).pulse, false);
    assert.equal(soundFor('title', 0).pulse, false);
  });

  test('музыка фоном звучит везде', () => {
    assert.equal(soundFor('camp', 0).campTune, true);
    assert.equal(soundFor('raid', 0).campTune, true);
    assert.equal(soundFor('title', 0).campTune, true);
  });

  test('подложка идёт по ярусу вылазки и молчит вне её', () => {
    for (const tier of [0, 1, 2, 3]) {
      assert.equal(soundFor('raid', tier).ambient, tier);
    }
    assert.equal(soundFor('camp', 3).ambient, null, 'ярус дотянулся до лагеря');
    assert.equal(soundFor('title', 3).ambient, null);
  });

  test('заставка: только музыка, без подложки и пульса', () => {
    assert.deepEqual(soundFor('title', 0), { ambient: null, campTune: true, pulse: false });
  });
});
