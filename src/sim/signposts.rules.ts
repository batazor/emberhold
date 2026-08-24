import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cleanSignText, validSignposts } from './signposts';
import { regionAt, roadGraph, roadNeighbours } from './world';

describe('Указатели', () => {
  test('надпись остаётся одной короткой строкой', () => {
    assert.equal(cleanSignText('  К  огороду\nи складу  '), 'К огороду и складу');
    assert.equal(cleanSignText('я'.repeat(40)).length, 32);
  });

  test('чужое сохранение не подсовывает испорченные указатели', () => {
    assert.deepEqual(validSignposts([
      { x: 1.2, z: 2.7, turn: 0, text: ' Домой ' },
      { x: NaN, z: 0, turn: 0, text: 'сломано' },
      { x: 0, z: 0, turn: 0, text: '' },
    ]), [{ x: 1, z: 3, turn: 0, text: 'Домой' }]);
  });

  test('направления берутся из того же графа, что тракт карты', () => {
    const region = regionAt(12);
    const edges = roadGraph(region);
    for (const node of region.nodes) {
      const adjacent = new Set(edges.flatMap((e) =>
        e.a === node.id && e.b >= 0 ? [e.b] : e.b === node.id && e.a >= 0 ? [e.a] : []));
      assert.deepEqual(new Set(roadNeighbours(region, node.id).map((n) => n.id)), adjacent);
    }
  });
});
