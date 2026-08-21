/**
 * Правила местности под картой (§4.2). Обещаний у фона два, и оба такие,
 * что нарушаются молча: значок, наехавший на узел, и земля, дотянувшаяся
 * до яркости точки, выглядят как «чуть-чуть криво», а стоят читаемости
 * единственного экрана, где сравнивают локации.
 *
 * Правило лежит в `ui`, а не рядом с генератором: цвет земли живёт здесь
 * (`mapTerrain.ts`), цвет узла — в `worldMap.ts`, и сравнивать их можно
 * только отсюда. DOM ни один из модулей на импорте не трогает, поэтому
 * замер идёт в Node вместе со всеми.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CLANS, WORLD_EPOCH, dayAt, regionAt } from '../sim/world';
import { BANDS, COLS, ROWS, bandOf, terrainAt } from '../sim/terrain';
import type { Point } from '../sim/terrain';
import { BANK, LAND, MARK_COLOR, WATER } from './mapTerrain';
import { RICH_COLOR } from './worldMap';

/** Те же 60 дней, на которых проверяется сам регион (`world.rules.ts`). */
const DAY0 = dayAt(WORLD_EPOCH) + 3;
const DAYS = 60;

/** Пропорция канваса 3:2 — та же, что в генераторе. */
const ASPECT = 2 / 3;
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, (a.y - b.y) * ASPECT);

/**
 * Зазоры из `terrain.ts`. Копии здесь намеренные: замер проверяет число,
 * а не повторяет его — если константу тронут, тест обязан упасть.
 *
 * У русла зазор меньше и назван не константой генератора, а тем, что он
 * обязан беречь: внешнее кольцо выбранной точки, `r * 2` в `worldMap.ts`.
 * Река, прошедшая по кольцу, стирает выбор игрока; река в трёх пикселях
 * от него — просто река.
 */
const MARK_CLEAR = 0.075;
const RING = 0.052;

const spotsOf = (day: number): Point[] => {
  const region = regionAt(day);
  return [...region.nodes.map((n) => ({ x: n.x, y: n.y })), region.camp];
};

/** Относительная яркость (WCAG): единственная мера, в которой «темнее» — число. */
function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

describe('Карта: местность под точками', () => {
  test('§4.2 — на узле не стоит ничего: ни знак, ни русло', () => {
    for (let day = DAY0; day < DAY0 + DAYS; day++) {
      const spots = spotsOf(day);
      const land = terrainAt(day, spots);
      for (const spot of spots) {
        for (const mark of land.marks) {
          assert.ok(
            dist(mark, spot) >= MARK_CLEAR,
            `день ${day}: знак «${mark.kind}» подошёл к точке на ${dist(mark, spot).toFixed(3)}`,
          );
        }
        for (const river of land.rivers) {
          for (const p of river) {
            assert.ok(
              dist(p, spot) >= RING,
              `день ${day}: русло прошло под точкой (${dist(p, spot).toFixed(3)})`,
            );
          }
        }
      }
    }
  });

  test('§4.2 — фон остаётся фоном: земля темнее любого цвета узла', () => {
    // Самый тёмный узел — выработанная точка; ярче всех полная жила.
    const dimmest = Math.min(...RICH_COLOR.map(luma));
    for (const color of [...LAND, WATER, BANK, ...Object.values(MARK_COLOR)]) {
      assert.ok(
        luma(color) < dimmest,
        `${color} (${luma(color).toFixed(3)}) не темнее узла (${dimmest.toFixed(3)})`,
      );
    }
    // И темнее флага клана: флаг — квадрат в шесть пикселей, ему спорить
    // с землёй нечем.
    const clan = Math.min(...CLANS.map((c) => luma(c.color)));
    for (const color of [...LAND, WATER, BANK, ...Object.values(MARK_COLOR)]) {
      assert.ok(luma(color) < clan, `${color} спорит с флагом клана`);
    }
  });

  test('§4.2 — земля покрывает карту целиком и не вылезает за неё', () => {
    for (let day = DAY0; day < DAY0 + DAYS; day++) {
      const land = terrainAt(day, spotsOf(day));
      assert.equal(land.grid.length, (COLS + 1) * (ROWS + 1), `день ${day}: сетка не та`);
      for (const v of land.grid) {
        assert.ok(v.x >= 0 && v.x <= 1 && v.y >= 0 && v.y <= 1, `день ${day}: вершина за картой`);
        assert.ok(v.h >= 0 && v.h <= 1, `день ${day}: высота вне 0…1`);
        assert.ok(bandOf(v.h) >= 0 && bandOf(v.h) < BANDS, `день ${day}: полоса вне шкалы`);
      }
      // Кромка сетки лежит ровно по краю: сдвинутая внутрь открыла бы
      // под картой ту самую чёрную полосу, ради которой всё и затевалось.
      for (let i = 0; i <= COLS; i++) {
        assert.equal(land.grid[i]!.y, 0, `день ${day}: верхняя кромка отошла`);
        assert.equal(land.grid[ROWS * (COLS + 1) + i]!.y, 1, `день ${day}: нижняя кромка отошла`);
      }
      for (let j = 0; j <= ROWS; j++) {
        assert.equal(land.grid[j * (COLS + 1)]!.x, 0, `день ${day}: левая кромка отошла`);
        assert.equal(land.grid[j * (COLS + 1) + COLS]!.x, 1, `день ${day}: правая кромка отошла`);
      }
    }
  });

  test('§4.2 — знаков достаточно, чтобы земля читалась, и мало, чтобы не шуметь', () => {
    let empty = 0;
    for (let day = DAY0; day < DAY0 + DAYS; day++) {
      const land = terrainAt(day, spotsOf(day));
      assert.ok(land.marks.length <= 22, `день ${day}: знаков ${land.marks.length}`);
      assert.ok(land.rivers.length >= 1, `день ${day}: рек нет вовсе`);
      for (const river of land.rivers) {
        assert.ok(river.length >= 3, `день ${day}: русло из ${river.length} точек`);
      }
      if (land.marks.length < 4) empty++;
    }
    // Пустой день допустим — карта не обязана быть одинаково живой каждый
    // день, — но пустых не должно быть большинство.
    assert.ok(empty <= DAYS / 4, `дней почти без знаков: ${empty} из ${DAYS}`);
  });

  test('§4 — местность пересобирается вместе с регионом и держится сутки', () => {
    const shape = (day: number): string => JSON.stringify(terrainAt(day, spotsOf(day)));
    assert.equal(shape(DAY0), shape(DAY0), 'один и тот же день дал разную землю');
    let same = 0;
    for (let day = DAY0; day < DAY0 + 20; day++) {
      if (shape(day) === shape(day + 1)) same++;
    }
    assert.equal(same, 0, 'земля не сменилась вместе с днём');
  });
});
