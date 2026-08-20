/**
 * Правила настроек. Проверяется не громкость, а то, что испорченное
 * хранилище не оставляет игру без звука и не выкручивает его на максимум.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_MIX } from './audio';
import { readMix } from './settings';

describe('Настройки: микшер (§18.5)', () => {
  test('пустое хранилище — умолчания артбука', () => {
    assert.deepEqual(readMix(null), DEFAULT_MIX);
    assert.deepEqual(readMix({}), DEFAULT_MIX);
  });

  test('ручка держится в пределах 0..1', () => {
    assert.equal(readMix({ master: 5 }).master, 1);
    assert.equal(readMix({ master: -2 }).master, 0);
  });

  test('ноль — это тишина, а не «поля нет»', () => {
    assert.equal(readMix({ amb: 0 }).amb, 0);
  });

  test('мусор в поле возвращает умолчание, а не тишину', () => {
    for (const bad of ['громко', NaN, Infinity, null, {}, []]) {
      assert.equal(readMix({ sfx: bad }).sfx, DEFAULT_MIX.sfx, `${String(bad)} прошёл насквозь`);
    }
  });

  test('сохранённое возвращается как есть', () => {
    const mine = { master: 0.2, sfx: 0.8, ui: 0.1, amb: 0 };
    assert.deepEqual(readMix(JSON.parse(JSON.stringify(mine))), mine);
  });
});
