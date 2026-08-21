/**
 * Правила гекс-решётки (§11.3). Гекс — та геометрия, которую легко написать
 * так, что вблизи она выглядит правильной, а на длинных расстояниях врёт:
 * сумма трёх осей перестаёт быть нулём, соседство размыкается, линия
 * становится несимметричной. Ловится это исчерпывающими прогонами,
 * а не примерами.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  HEX_DIRS,
  hexDistance,
  hexKey,
  hexLine,
  hexNeighbors,
  hexReach,
  hexRound,
  hexSight,
  hexToWorld,
  worldToHex,
} from './hex';
import type { Hex } from './hex';
import { idx } from './grid';

/** Все гексы в радиусе — исчерпывающий перебор вместо примеров. */
function within(range: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -range; q <= range; q++) {
    for (let r = Math.max(-range, -q - range); r <= Math.min(range, -q + range); r++) {
      out.push({ q, r });
    }
  }
  return out;
}

const ALL = within(6);

describe('Гекс-решётка', () => {
  test('соседей ровно шесть, и все на расстоянии один', () => {
    for (const h of ALL) {
      const n = hexNeighbors(h);
      assert.equal(n.length, 6, `${hexKey(h)}: соседей не шесть`);
      assert.equal(new Set(n.map(hexKey)).size, 6, `${hexKey(h)}: соседи повторяются`);
      for (const x of n) assert.equal(hexDistance(h, x), 1, `${hexKey(h)}→${hexKey(x)}`);
    }
  });

  test('расстояние симметрично и подчиняется неравенству треугольника', () => {
    // Несимметричное расстояние означало бы противника, который достаёт,
    // не будучи достижим, — то же, чем болела линия видимости мира.
    for (const a of ALL) {
      for (const b of ALL) {
        assert.equal(hexDistance(a, b), hexDistance(b, a), `${hexKey(a)}↔${hexKey(b)}`);
        for (const c of within(2)) {
          assert.ok(
            hexDistance(a, b) <= hexDistance(a, c) + hexDistance(c, b),
            `треугольник ${hexKey(a)} ${hexKey(c)} ${hexKey(b)}`,
          );
        }
      }
    }
  });

  test('шесть соседей равноудалены и в мировых координатах тоже', () => {
    // Ради этого гекс и берётся: «дотянулся» перестаёт зависеть от того,
    // стоит ли противник по диагонали. На квадратной сетке восемь соседей,
    // и четыре из них дальше остальных в полтора раза.
    const c = hexToWorld({ q: 0, r: 0 });
    const d = HEX_DIRS.map((h) => {
      const w = hexToWorld(h);
      return Math.hypot(w.x - c.x, w.z - c.z);
    });
    for (const x of d) assert.ok(Math.abs(x - 1) < 1e-9, `сосед на ${x}, а не на единице`);
  });

  test('мир и решётка переводятся друг в друга без потерь', () => {
    for (const h of ALL) {
      const w = hexToWorld(h);
      assert.deepEqual(worldToHex(w.x, w.z), h, `${hexKey(h)} не вернулся из мира`);
    }
  });

  test('округление держит сумму трёх осей в нуле', () => {
    // Наивное округление двух осей из трёх даёт дыры на стыках: гекс,
    // в который не попадает ни одна точка, и точка, попадающая в два гекса.
    for (let i = 0; i < 2000; i++) {
      const q = ((i * 7919) % 1000) / 100 - 5;
      const r = ((i * 6271) % 1000) / 100 - 5;
      const h = hexRound(q, r);
      assert.equal(h.q + h.r + (-h.q - h.r), 0);
      assert.ok(Number.isInteger(h.q) && Number.isInteger(h.r), 'ось не целая');
    }
  });

  test('линия начинается и кончается там, где просили, и не рвётся', () => {
    for (const b of ALL) {
      const a: Hex = { q: 0, r: 0 };
      const line = hexLine(a, b);
      assert.deepEqual(line[0], a, `${hexKey(b)}: линия начинается не там`);
      assert.deepEqual(line[line.length - 1], b, `${hexKey(b)}: линия кончается не там`);
      assert.equal(line.length, hexDistance(a, b) + 1, `${hexKey(b)}: длина линии`);
      for (let i = 1; i < line.length; i++) {
        assert.equal(hexDistance(line[i - 1]!, line[i]!), 1, `${hexKey(b)}: разрыв линии`);
      }
    }
  });

  test('видимость симметрична', () => {
    const N = 24;
    const blocked = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) blocked[i] = (i * 7919) % 7 === 0 ? 1 : 0;
    const near = within(4).map((h) => ({ h, w: hexToWorld(h) }));
    for (const a of near) {
      for (const b of near) {
        assert.equal(
          hexSight(N, blocked, a.h, b.h),
          hexSight(N, blocked, b.h, a.h),
          `${hexKey(a.h)}↔${hexKey(b.h)}: видимость односторонняя`,
        );
      }
    }
  });

  test('досягаемость не пускает сквозь стену и сквозь тела', () => {
    const N = 24;
    const open = new Uint8Array(N * N);
    const from: Hex = { q: 2, r: 2 };

    // На чистом поле за N шагов достижимо ровно кольцо радиуса N.
    const free = hexReach(N, open, from, 3);
    for (const [, v] of free) {
      assert.equal(v.steps, hexDistance(from, v.hex), `${hexKey(v.hex)}: шагов не по расстоянию`);
    }

    // Тело соседа обходится, а не проходится насквозь.
    const blockedHex = hexNeighbors(from)[0]!;
    const guarded = hexReach(N, open, from, 1, new Set([hexKey(blockedHex)]));
    assert.ok(!guarded.has(hexKey(blockedHex)), 'шаг прошёл сквозь тело');
    assert.equal(guarded.size, 6, 'из шести соседей должен остаться пять плюс свой');
  });

  test('стена мира — это стена и в бою', () => {
    // Одна геометрия на два режима: занятая клетка занимает гекс, чей центр
    // в неё попал. Иначе стена в бою и вне боя стоят в разных местах.
    const N = 24;
    const blocked = new Uint8Array(N * N);
    const target: Hex = { q: 3, r: 1 };
    const w = hexToWorld(target);
    blocked[idx(N, Math.round(w.x), Math.round(w.z))] = 1;
    const reach = hexReach(N, blocked, { q: 0, r: 0 }, 6);
    assert.ok(!reach.has(hexKey(target)), 'гекс на занятой клетке оказался проходим');
  });
});
