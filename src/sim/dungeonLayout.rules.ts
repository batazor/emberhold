/**
 * Правила визуального конструктора KayKit Dungeon. Симуляция уже решила,
 * где можно ходить; этот слой обязан точно обвести её решение и никогда
 * не завести вторую, чуть отличающуюся карту подземелья.
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { generateLocation } from './generate';
import { idx, inBounds } from './grid';
import {
  DUNGEON_FLOORS,
  DUNGEON_PILLARS,
  DUNGEON_STAIRS,
  DUNGEON_WALLS,
  buildDungeonLayout,
  dungeonEdgeKey,
  type DungeonEdge,
} from './dungeonLayout';
import type { GameLocation, Tier } from './types';

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const TIERS: readonly Tier[] = [0, 1, 2, 3];
const locations = TIERS.flatMap((tier) => [1, 2, 7, 42, 1337]
  .map((seed) => generateLocation(seed, tier)));

function expectedEdges(loc: GameLocation): DungeonEdge[] {
  const out: DungeonEdge[] = [];
  for (let z = 0; z < loc.size; z++) {
    for (let x = 0; x < loc.size; x++) {
      if (loc.blocked[idx(loc.size, x, z)] !== 0) continue;
      DIRS.forEach(([dx, dz], dir) => {
        const nx = x + dx;
        const nz = z + dz;
        if (!inBounds(loc.size, nx, nz) || loc.blocked[idx(loc.size, nx, nz)] !== 0) {
          out.push({ x, z, dir: dir as 0 | 1 | 2 | 3 });
        }
      });
    }
  }
  return out;
}

describe('Подземелье: архитектура следует проходимости', () => {
  test('одна и та же локация собирается одинаково', () => {
    for (const loc of locations) {
      assert.deepEqual(buildDungeonLayout(loc), buildDungeonLayout(loc), `${loc.seed}/${loc.tier}`);
    }
  });

  test('пол есть ровно на каждой свободной клетке', () => {
    for (const loc of locations) {
      const layout = buildDungeonLayout(loc);
      const want: string[] = [];
      for (let z = 0; z < loc.size; z++) for (let x = 0; x < loc.size; x++) {
        if (loc.blocked[idx(loc.size, x, z)] === 0) want.push(`${x}:${z}`);
      }
      const got = layout.floors.map((piece) => `${piece.x}:${piece.z}`);
      assert.deepEqual(got.sort(), want.sort(), `${loc.seed}/${loc.tier}`);
    }
  });

  test('каждая граница с породой закрыта одной панелью', () => {
    for (const loc of locations) {
      const layout = buildDungeonLayout(loc);
      const want = expectedEdges(loc).map(dungeonEdgeKey).sort();
      const got = layout.walls.flatMap((wall) => wall.edges).map(dungeonEdgeKey).sort();
      assert.deepEqual(got, want, `${loc.seed}/${loc.tier}`);
      assert.equal(new Set(got).size, got.length, 'две стены закрыли одну грань');
      for (const wall of layout.walls) {
        assert.ok(wall.edges.length === 1 || wall.edges.length === 2, 'не модуль на одну или две клетки');
        if (wall.edges.length === 2) {
          const [a, b] = wall.edges;
          assert.equal(a!.dir, b!.dir, 'полная стена повернута в две стороны');
          assert.equal(Math.abs(a!.x - b!.x) + Math.abs(a!.z - b!.z), 1, 'полная стена закрывает не соседние грани');
        }
      }
    }
  });

  test('лестница занимает свободный квадрат без добычи, врагов и валунов', () => {
    let found = 0;
    for (const loc of locations) {
      const stairs = buildDungeonLayout(loc).stairs;
      if (stairs === null) continue;
      found++;
      assert.equal(new Set(stairs.cells.map((cell) => `${cell.x}:${cell.z}`)).size, 4);
      const busy = new Set([
        ...loc.containers.map((item) => `${item.x}:${item.z}`),
        ...loc.enemies.map((enemy) => `${Math.round(enemy.x)}:${Math.round(enemy.z)}`),
        ...loc.stones.map((stone) => `${stone.x}:${stone.z}`),
      ]);
      for (const cell of stairs.cells) {
        assert.equal(loc.blocked[idx(loc.size, cell.x, cell.z)], 0, 'лестница в стене');
        assert.ok(!busy.has(`${cell.x}:${cell.z}`), 'лестница накрыла сущность');
        assert.ok(loc.backSteps[idx(loc.size, cell.x, cell.z)]! >= 4, 'лестница у самого входа');
      }
    }
    assert.ok(found >= locations.length / 2, `лестница нашлась только в ${found}/${locations.length} локаций`);
  });
});

describe('Подземелье: выбранный набор действительно используется', () => {
  test('за серией сидов встречается каждый принятый архитектурный модуль', () => {
    const used = new Set<string>();
    for (const tier of TIERS) for (let seed = 1; seed <= 100; seed++) {
      const layout = buildDungeonLayout(generateLocation(seed, tier));
      for (const piece of [...layout.floors, ...layout.walls, ...layout.pillars]) used.add(piece.model);
      if (layout.stairs !== null) used.add(layout.stairs.model);
    }
    const adopted = [...DUNGEON_FLOORS, ...DUNGEON_WALLS, ...DUNGEON_PILLARS, ...DUNGEON_STAIRS];
    assert.deepEqual(adopted.filter((model) => !used.has(model)), [], 'принятая модель не имеет правила размещения');
  });
});
