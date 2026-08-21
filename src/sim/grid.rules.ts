/**
 * Правила сетки. Волновой обход и линия видимости — те две функции, от
 * которых зависит всё остальное: путь назад, расстановка врагов и выстрел.
 * Ошибка в них выглядит как ошибка баланса, поэтому ловится здесь.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { distanceField, hasLineOfSight, idx } from './grid';

const N = 11;
const openField = (): Uint8Array => new Uint8Array(N * N);
const at = (i: number): [number, number] => [i % N, (i / N) | 0];

describe('Сетка: линия видимости', () => {
  test('на пустом поле видно всех, и обход завершается', () => {
    // Главная опасность накрывающего обхода — не ошибка, а вечный цикл:
    // шаг, который не сдвигает точку, вешает игру намертво. Исчерпывающий
    // прогон по всем парам ловит это надёжнее любого частного случая.
    const open = openField();
    for (let a = 0; a < N * N; a++) {
      for (let b = 0; b < N * N; b++) {
        const [ax, az] = at(a);
        const [bx, bz] = at(b);
        assert.ok(hasLineOfSight(N, open, ax, az, bx, bz), `${a}→${b}: пустое поле перекрыто`);
      }
    }
  });

  test('стена перекрывает, но только поперёк', () => {
    const wall = openField();
    for (let x = 0; x < N; x++) wall[idx(N, x, 5)] = 1;
    assert.equal(hasLineOfSight(N, wall, 5, 2, 5, 8), false, 'сквозь стену видно');
    assert.equal(hasLineOfSight(N, wall, 1, 2, 9, 2), true, 'вдоль стены не видно');
  });

  test('щель работает щелью', () => {
    const gap = openField();
    for (let x = 0; x < N; x++) if (x !== 5) gap[idx(N, x, 5)] = 1;
    assert.equal(hasLineOfSight(N, gap, 5, 2, 5, 8), true, 'прямо в щель не проходит');
    // Не по диагонали: прямая (2,2)→(8,8) прошла бы ровно через щель в (5,5),
    // и проверяла бы не то, что заявлено.
    assert.equal(hasLineOfSight(N, gap, 2, 2, 2, 8), false, 'мимо щели проходит');
    assert.equal(hasLineOfSight(N, gap, 8, 2, 8, 8), false, 'мимо щели проходит и справа');
  });

  test('угол не простреливается', () => {
    // Ровно то, ради чего обход накрывающий: дешёвый Брезенхэм пропускает
    // выстрел по диагонали между двумя камнями, и стрела уходит сквозь стену,
    // которую игрок видит своими глазами.
    const corner = openField();
    corner[idx(N, 5, 4)] = 1;
    corner[idx(N, 4, 5)] = 1;
    assert.equal(hasLineOfSight(N, corner, 4, 4, 5, 5), false, 'угол простреливается');
  });

  test('видимость симметрична', () => {
    // Односторонняя видимость означала бы противника, который стреляет
    // из-за камня, оставаясь недосягаемым, — и это читалось бы как
    // несправедливость, а не как укрытие (§17.3).
    const rough = openField();
    for (let i = 0; i < N * N; i++) rough[i] = (i * 7919) % 5 === 0 ? 1 : 0;
    for (let a = 0; a < N * N; a++) {
      if (rough[a]) continue;
      for (let b = 0; b < N * N; b++) {
        if (rough[b]) continue;
        const [ax, az] = at(a);
        const [bx, bz] = at(b);
        assert.equal(
          hasLineOfSight(N, rough, ax, az, bx, bz),
          hasLineOfSight(N, rough, bx, bz, ax, az),
          `${a}↔${b}: видимость односторонняя`,
        );
      }
    }
  });

  test('видимость строже пути: сквозь стену не видно, а обойти можно', () => {
    // Две функции отвечают на разные вопросы, и путать их нельзя: маг,
    // которого видно, не обязан быть достижимым, а достижимый — видимым.
    const wall = openField();
    for (let x = 0; x < N - 1; x++) wall[idx(N, x, 5)] = 1;
    const reach = distanceField(N, wall, { x: 5, z: 2 });
    assert.ok(reach[idx(N, 5, 8)]! > 0, 'обход вокруг стены существует');
    assert.equal(hasLineOfSight(N, wall, 5, 2, 5, 8), false, 'а видимости нет');
  });
});
