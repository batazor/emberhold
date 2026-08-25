/**
 * Правила картинок глобальной карты (`worldMap.ts`).
 *
 * Canvas больше не собирает значки из линий: карта показывает семь PNG
 * Kenney Cartography Pack. Здесь сторожатся обещания, которые легко сломать
 * при следующей раздаче картинок: каждому виду назначен свой файл, файлы
 * действительно являются retina-PNG набора, а рисунок остаётся внутри кольца.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { KIND } from '../sim/world';
import type { NodeKind } from '../sim/world';
import { createCamp } from '../sim/camp';
import {
  CAMP_ICON_URL,
  MAP_ICON_DIAMETER,
  MAP_ICON_URL,
  roadStoryTarget,
} from './worldMap';

const KINDS = Object.keys(KIND) as NodeKind[];

/** Размер PNG лежит в IHDR сразу после восьмибайтовой сигнатуры и длины. */
function pngSize(url: string): readonly [number, number] {
  const bytes = readFileSync(new URL(url));
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${url} — не PNG`,
  );
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('Картинки глобальной карты', () => {
  test('каждому виду назначен отдельный рисунок', () => {
    assert.deepEqual(Object.keys(MAP_ICON_URL).sort(), [...KINDS].sort());
    assert.equal(new Set(Object.values(MAP_ICON_URL)).size, KINDS.length);
    assert.ok(!Object.values(MAP_ICON_URL).includes(CAMP_ICON_URL));
  });

  test('в игру едут retina-файлы Kenney', () => {
    for (const [kind, url] of Object.entries(MAP_ICON_URL)) {
      assert.deepEqual(pngSize(url), [128, 128], `${kind}: не retina 128×128`);
    }
    assert.deepEqual(pngSize(CAMP_ICON_URL), [128, 128], 'палатка: не retina 128×128');
  });

  test('рисунок остаётся внутри кольца и не наступает на служебные метки', () => {
    assert.ok(MAP_ICON_DIAMETER > 1.4, 'рисунок слишком мелкий для карты');
    assert.ok(MAP_ICON_DIAMETER <= 1.8, 'рисунок добрался до события или флага');
  });
});

describe('Карточки первой главы', () => {
  test('каждый незавершённый шаг ведёт к своей локации', () => {
    const camp = createCamp();
    assert.equal(roadStoryTarget(camp), null);
    camp.roadStory = { step: 'return-to-trader' };
    assert.equal(roadStoryTarget(camp), 'замок');
    camp.roadStory = { step: 'find-caravan' };
    assert.equal(roadStoryTarget(camp), 'тропа');
    camp.roadStory = { step: 'settle-supply' };
    assert.equal(roadStoryTarget(camp), 'замок минотавра');
  });

  test('завершённая глава больше не перехватывает фокус карты', () => {
    const camp = createCamp();
    camp.roadStory = { step: 'done', route: 'trade' };
    assert.equal(roadStoryTarget(camp), null);
  });
});
