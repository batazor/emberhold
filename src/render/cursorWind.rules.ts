/**
 * Правила ветра от курсора. Проверяется то, ради чего он и заведён: ветер
 * берётся от движения, а не от присутствия, спадает сам и не срывается
 * от рывков ввода.
 *
 * Картинку это не проверяет — её проверяет глаз. Проверяется поведение
 * источника, а оно чистое и считается в Node.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CursorWind } from './cursorWind';

/** Кадр 60 Гц. */
const DT = 1 / 60;

/** Провести курсор из точки на dx, dz за один кадр. */
function drag(wind: CursorWind, fromX: number, fromZ: number, dx: number, dz: number): void {
  wind.point(fromX, fromZ);
  wind.step(DT); // первая точка — место, не движение
  wind.point(fromX + dx, fromZ + dz);
  wind.step(DT);
}

describe('Ветер от курсора', () => {
  test('стоячий курсор ветра не делает', () => {
    const wind = new CursorWind();
    for (let i = 0; i < 120; i++) {
      wind.point(4, 7);
      wind.step(DT);
    }
    assert.equal(wind.gust, null, 'брошенная мышь оставила вмятину в поле');
  });

  test('ветер берётся от скорости', () => {
    const slow = new CursorWind();
    drag(slow, 4, 7, 0.02, 0);
    const fast = new CursorWind();
    drag(fast, 4, 7, 0.4, 0);
    assert.ok(fast.strength > 0.9, 'рывок мыши не поднял полного порыва');
    // Ползущий курсор дует, но еле-еле: это ветерок, а не борозда.
    assert.ok(slow.strength < 0.2, `ползущий курсор дует на ${slow.strength.toFixed(2)}`);
  });

  test('сила не выходит за единицу', () => {
    const wind = new CursorWind();
    drag(wind, 4, 7, 5, 3);
    assert.ok(wind.strength <= 1, `сила ${wind.strength} — предела нет`);
  });

  test('дует по ходу курсора', () => {
    const wind = new CursorWind();
    wind.point(4, 7);
    wind.step(DT);
    // Несколько кадров подряд: направление сглажено и за один кадр не доходит.
    for (let i = 1; i <= 20; i++) {
      wind.point(4 + i * 0.3, 7);
      wind.step(DT);
    }
    assert.ok(wind.dirX > 0.95, `ведут вправо, а дует в ${wind.dirX.toFixed(2)}`);
    assert.ok(Math.abs(wind.dirZ) < 0.2, 'ветер уводит поперёк хода');
  });

  test('порыв спадает сам', () => {
    const wind = new CursorWind();
    drag(wind, 4, 7, 0.4, 0);
    assert.ok(wind.gust !== null, 'рывок не поднял ветра вовсе');
    // Курсор замер на месте: события ввода идут, движения нет.
    for (let i = 0; i < 120; i++) {
      wind.point(4.4, 7);
      wind.step(DT);
    }
    assert.equal(wind.gust, null, 'за две секунды покоя ветер не улёгся');
  });

  test('прыжок курсора полем не считается', () => {
    const wind = new CursorWind();
    wind.point(2, 2);
    wind.step(DT);
    // Вкладка вернулась в фокус, мышь уже в другом углу локации.
    wind.point(20, 18);
    wind.step(DT);
    assert.equal(wind.gust, null, 'телепорт курсора положил поле');
  });

  test('точка ветра отстаёт от курсора', () => {
    const wind = new CursorWind();
    wind.point(4, 7);
    wind.step(DT);
    for (let i = 1; i <= 10; i++) {
      wind.point(4 + i * 0.3, 7);
      wind.step(DT);
    }
    const cursor = 4 + 10 * 0.3;
    assert.ok(wind.x < cursor, 'ветер прилипает к курсору, инерции нет');
    // Но и не отваливается: за десяток кадров отставание меньше полклетки.
    assert.ok(cursor - wind.x < 0.5, `отставание ${(cursor - wind.x).toFixed(2)} — это не инерция, а разрыв`);
  });

  test('возраст порыва растёт с покоя и обнуляется рывком', () => {
    const wind = new CursorWind();
    drag(wind, 4, 7, 0.4, 0);
    assert.equal(wind.age, 0, 'свежий порыв уже немолод');
    for (let i = 0; i < 12; i++) {
      wind.point(4.4, 7);
      wind.step(DT);
    }
    assert.ok(wind.age > 0.15, 'возраст стоит на месте — волне не от чего идти');
    // Новый рывок начинает волну заново.
    wind.point(5.2, 7);
    wind.step(DT);
    assert.equal(wind.age, 0, 'рывок не обнулил возраст');
  });

  test('огибающая не отрицательная: знак отыгрыша — забота волны', () => {
    const wind = new CursorWind();
    drag(wind, 4, 7, 0.4, 0);
    for (let i = 0; i < 90; i++) {
      wind.step(DT);
      assert.ok(wind.strength >= 0, `сила ушла в минус: ${wind.strength}`);
    }
  });

  test('ушедший курсор ничего не ломает', () => {
    const wind = new CursorWind();
    drag(wind, 4, 7, 0.4, 0);
    wind.away();
    for (let i = 0; i < 120; i++) wind.step(DT);
    assert.equal(wind.gust, null, 'ветер остался без курсора');
    assert.ok(Number.isFinite(wind.x) && Number.isFinite(wind.dirX), 'в ветре завелось NaN');
  });

  test('вернувшийся курсор дует заново, а не от места ухода', () => {
    const wind = new CursorWind();
    drag(wind, 4, 7, 0.4, 0);
    wind.away();
    for (let i = 0; i < 120; i++) wind.step(DT);
    // Мышь появилась в другом конце локации: первая точка — место, не рывок.
    wind.point(18, 16);
    wind.step(DT);
    assert.equal(wind.gust, null, 'появление курсора ударило ветром');
  });
});
