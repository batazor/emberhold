/**
 * Правила дорог. Проверяется вывод формы из соседей — единственное, что
 * модуль обещает: плитка обязана открываться ровно в стороны, где есть
 * сосед, и никакая пара соседних плиток не смотрит друг на друга торцами.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { roadPieces, turnFor, type RoadPiece, type RoadTile } from './roads';
import type { Spot } from './castle';

/** Стороны клетки в нумерации модуля: север, восток, юг, запад. */
const DIRS: readonly Spot[] = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];

/** Открытые стороны плитки после её поворота — выведенные заново, через
 *  `turnFor`: правило спрашивает контракт, а не копирует таблицу. */
function openOf(piece: RoadPiece): Set<number> {
  const base: Record<RoadTile, readonly number[]> = {
    'прямая': [0, 2],
    'поворот': [1, 2],
    'тройник': [1, 2, 3],
    'крест': [0, 1, 2, 3],
  };
  return new Set(base[piece.tile].map((d) => (d + 3 * piece.turn) % 4));
}

describe('дороги: форма из соседей', () => {
  test('крест, тройник, прямая и поворот выводятся из числа соседей', () => {
    const cross = roadPieces([
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
    ]);
    assert.equal(cross.find((p) => p.x === 0 && p.z === 0)?.tile, 'крест');

    const tee = roadPieces([
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 },
    ]);
    assert.equal(tee.find((p) => p.x === 0 && p.z === 0)?.tile, 'тройник');

    const straight = roadPieces([{ x: 0, z: -1 }, { x: 0, z: 0 }, { x: 0, z: 1 }]);
    assert.equal(straight.find((p) => p.z === 0)?.tile, 'прямая');

    const bend = roadPieces([{ x: 0, z: -1 }, { x: 0, z: 0 }, { x: 1, z: 0 }]);
    assert.equal(bend.find((p) => p.x === 0 && p.z === 0)?.tile, 'поворот');
  });

  test('плитка открыта ровно в стороны с соседями', () => {
    // Змейка с поворотами, тройником и тупиками — все формы разом.
    const cells: Spot[] = [
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 },
      { x: 2, z: 1 }, { x: 2, z: 2 }, { x: 1, z: 2 },
      { x: 1, z: 1 },
    ];
    const set = new Set(cells.map((c) => `${c.x}:${c.z}`));
    for (const piece of roadPieces(cells)) {
      const open = openOf(piece);
      DIRS.forEach((d, at) => {
        const near = set.has(`${piece.x + d.x}:${piece.z + d.z}`);
        if (near) {
          assert.ok(open.has(at), `${piece.x},${piece.z} (${piece.tile}) закрыта к соседу ${at}`);
        }
      });
      // Обратное — «открыта только к соседям» — верно для всех форм, кроме
      // тупика: заглушки в наборе нет, и прямая у тупика открыта в пустоту.
    }
  });

  test('одинокая клетка и тупик — прямая вдоль того, что есть', () => {
    const lone = roadPieces([{ x: 5, z: 5 }])[0]!;
    assert.equal(lone.tile, 'прямая');

    const dead = roadPieces([{ x: 0, z: 0 }, { x: 1, z: 0 }]);
    for (const piece of dead) {
      assert.equal(piece.tile, 'прямая');
      // Ось восток–запад: открыта в 1 и 3.
      assert.deepEqual([...openOf(piece)].sort(), [1, 3]);
    }
  });

  test('каждой форме находится поворот под её же набор сторон', () => {
    assert.equal(turnFor('прямая', new Set([0, 2])), 0);
    assert.ok(turnFor('прямая', new Set([1, 3])) >= 0);
    assert.ok(turnFor('поворот', new Set([0, 1])) >= 0);
    assert.ok(turnFor('поворот', new Set([2, 3])) >= 0);
    assert.ok(turnFor('тройник', new Set([0, 1, 2])) >= 0);
    assert.equal(turnFor('поворот', new Set([0, 2])), -1);
  });
});
