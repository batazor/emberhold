/**
 * Правила ветра от наклона. Проверяется то, ради чего он и заведён: ноль
 * берётся от того, как держат телефон, дрожь руки ветром не считается,
 * сила растёт с углом и имеет предел.
 *
 * Картинку это не проверяет — её проверяет глаз. Проверяется поведение
 * источника, а оно чистое и считается в Node.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TiltWind } from './tiltWind';

const DT = 1 / 60;

/** Продержать наклон n кадров: сглаживание за один кадр не доходит. */
function hold(wind: TiltWind, beta: number, gamma: number, frames = 60): void {
  for (let i = 0; i < frames; i++) {
    wind.feed(beta, gamma);
    wind.step(DT);
  }
}

describe('Ветер от наклона', () => {
  test('без датчика ветра нет', () => {
    const wind = new TiltWind();
    for (let i = 0; i < 60; i++) {
      wind.feed(null, null);
      wind.step(DT);
    }
    assert.equal(wind.tilt, null, 'ветер завёлся без единого замера');
  });

  test('ноль — это как держали, а не горизонт', () => {
    const wind = new TiltWind();
    // Человек читает экран под привычным углом и не шевелится.
    hold(wind, 34, -12);
    assert.equal(wind.tilt, null, 'привычный наклон читается ураганом');
  });

  test('наклон вбок кладёт траву вбок', () => {
    const wind = new TiltWind();
    hold(wind, 34, -12, 5); // взяли телефон: это ноль
    hold(wind, 34, 8);      // повели вправо на 20°
    assert.ok(wind.x > 0.5, `вправо наклонили, а дует в ${wind.x.toFixed(2)}`);
    assert.ok(Math.abs(wind.y) < 0.1, 'ветер уводит вперёд, хотя вперёд не наклоняли');
  });

  test('наклон от себя дует вглубь экрана', () => {
    const wind = new TiltWind();
    hold(wind, 0, 0, 5);
    hold(wind, 20, 0);
    assert.ok(wind.y > 0.5, `от себя наклонили, а дует в ${wind.y.toFixed(2)}`);
  });

  test('дрожь руки ветром не считается', () => {
    const wind = new TiltWind();
    hold(wind, 0, 0, 5);
    hold(wind, 2, -1.5);
    assert.equal(wind.tilt, null, 'мёртвой зоны нет: поле дрожит вместе с рукой');
  });

  test('сила растёт с углом и упирается в единицу', () => {
    const small = new TiltWind();
    hold(small, 0, 0, 5);
    hold(small, 0, 10);

    const big = new TiltWind();
    hold(big, 0, 0, 5);
    hold(big, 0, 24);

    const huge = new TiltWind();
    hold(huge, 0, 0, 5);
    hold(huge, 0, 80);

    assert.ok(big.strength > small.strength, 'сильнее наклонить — не сильнее дуть');
    assert.ok(huge.strength <= 1, `сила ${huge.strength} — предела нет`);
    assert.ok(huge.strength > 0.95, 'на восьмидесяти градусах ветер всё ещё вполсилы');
  });

  test('поле не дёргается за рукой: ветер приходит за кадры, а не мгновенно', () => {
    const wind = new TiltWind();
    hold(wind, 0, 0, 5);
    wind.feed(0, 40);
    wind.step(DT);
    assert.ok(wind.strength < 0.5, `за один кадр ветер вырос до ${wind.strength.toFixed(2)}`);
    hold(wind, 0, 40);
    assert.ok(wind.strength > 0.95, 'за секунду ветер так и не набрал силу');
  });

  test('телефон вернули ровно — ветер стих', () => {
    const wind = new TiltWind();
    hold(wind, 0, 0, 5);
    hold(wind, 0, 30);
    assert.ok(wind.tilt !== null, 'наклон не поднял ветра вовсе');
    hold(wind, 0, 0);
    assert.equal(wind.tilt, null, 'телефон ровно, а поле всё лежит');
  });

  test('датчик замолчал — ветер стих, и ничего не сломалось', () => {
    const wind = new TiltWind();
    hold(wind, 0, 0, 5);
    hold(wind, 0, 30);
    wind.stop();
    for (let i = 0; i < 60; i++) wind.step(DT);
    assert.equal(wind.tilt, null, 'ветер остался без датчика');
    assert.ok(Number.isFinite(wind.x) && Number.isFinite(wind.strength), 'в ветре завелось NaN');
  });
});
