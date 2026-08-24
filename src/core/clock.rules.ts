import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Clock, formatDuration } from './clock';

/**
 * Часы §6. Проверяется ровно то, ради чего заведена серверная половина:
 * **перевод системных часов не меняет игровое время.**
 *
 * Правило написано подменой `Date.now` и `performance.now` — это тот случай,
 * когда подмена честнее замера: настоящие часы в тесте не перевести, а вопрос
 * именно про них. Обе подмены снимаются в `finally`, иначе следующий файл
 * тестов получил бы чужое время.
 */

/** Прогон с подменёнными часами: системные и монотонные врозь. */
function withClocks(run: (set: (system: number, mono: number) => void) => void): void {
  const realDate = Date.now;
  const realPerf = performance.now;
  let system = 1_000_000_000_000;
  let mono = 0;
  Date.now = () => system;
  performance.now = () => mono;
  try {
    run((s, m) => {
      system = s;
      mono = m;
    });
  } finally {
    Date.now = realDate;
    performance.now = realPerf;
  }
}

describe('Часы', () => {
  it('без сервера идут по системным', () => {
    withClocks((set) => {
      const clock = new Clock();
      const first = clock.now();
      set(1_000_000_060_000, 60_000);
      assert.ok(Math.abs(clock.now() - first - 60) < 0.001, 'минута системных — минута игры');
    });
  });

  it('перевод системных часов назад не отматывает время', () => {
    withClocks((set) => {
      const clock = new Clock();
      const first = clock.now();
      // Игрок увёл часы на сутки назад.
      set(1_000_000_000_000 - 86_400_000, 1_000);
      assert.ok(clock.now() >= first, 'время не идёт назад');
    });
  });

  it('при серверной привязке перевод часов вперёд не даёт времени', () => {
    withClocks((set) => {
      const clock = new Clock();
      clock.sync(2_000_000_000);
      const first = clock.now();
      // Часы уехали на сутки вперёд, монотонный счётчик — на секунду.
      set(1_000_000_000_000 + 86_400_000, 1_000);
      const second = clock.now();
      assert.ok(
        Math.abs(second - first - 1) < 0.001,
        `сутки перевода дали ${Math.round(second - first)} с вместо секунды`,
      );
    });
  });

  it('серверная отметка становится игровым временем', () => {
    withClocks(() => {
      const clock = new Clock();
      clock.sync(2_000_000_000);
      assert.ok(Math.abs(clock.now() - 2_000_000_000) < 0.001);
      assert.equal(clock.synced, true);
    });
  });

  it('сейв из будущего не отматывается назад', () => {
    withClocks(() => {
      // Отметка сейва старше серверной: другое устройство спешило.
      // Время обязано стоять на ней, а не прыгать в прошлое — по ней
      // уже посчитаны таймеры лагеря.
      const clock = new Clock(2_000_000_500);
      clock.sync(2_000_000_000);
      assert.equal(clock.now(), 2_000_000_500);
    });
  });

  it('остаток часа переносится в часы, а не показывает 60 минут', () => {
    assert.equal(formatDuration(4 * 3600 - 1), '4 ч');
    assert.equal(formatDuration(3 * 3600 + 31 * 60), '3 ч 31 мин');
  });
});
