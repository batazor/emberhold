import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MIN_DAMAGE, MIN_DAMAGE_SHARE } from './config';
import { damageOf, protectionOf } from './protection';

describe('Защита: один расчёт для боя и показа', () => {
  test('неуязвимости нет ни при какой Защите', () => {
    assert.equal(damageOf(10, 10_000), 10 * MIN_DAMAGE_SHARE);
    assert.ok(damageOf(1, 10_000) >= MIN_DAMAGE);
  });

  test('разложение сходится с итоговым уроном', () => {
    const hit = protectionOf(7, 6, { guarding: true });
    assert.equal(hit.afterDefense, 4);
    assert.equal(hit.afterTechnique, 4);
    assert.equal(hit.dealt, 2);
    assert.equal(hit.preventedByDefense, 3);
    assert.equal(hit.preventedByGuard, 2);
  });

  test('особые приёмы стоят между Защитой и Блоком', () => {
    const charge = protectionOf(7, 6, { add: 3, guarding: true });
    assert.equal(charge.afterDefense, 4);
    assert.equal(charge.afterTechnique, 7);
    assert.equal(charge.dealt, 4);

    const stone = protectionOf(5, 0, { absorb: 2 });
    assert.equal(stone.dealt, 3);
  });
});
