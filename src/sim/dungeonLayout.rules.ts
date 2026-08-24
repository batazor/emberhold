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
  CAVE_MODULES,
  CAVE_BOUNDARY_MODELS,
  CAVE_GATE_BARRIERS,
  CAVE_ROOM_MODELS,
  CAVE_STAIRS,
  DUNGEON_FLOORS,
  DUNGEON_PILLARS,
  DUNGEON_STAIRS,
  DUNGEON_WALLS,
  buildDungeonLayout,
  caveRockDistance,
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

  test('коридоры и многоклеточные залы вместе покрывают каждую свободную клетку', () => {
    const modelDegree = {
      'corridor-end': 1,
      corridor: 2,
      'corridor-corner': 2,
      'corridor-junction': 3,
      'corridor-intersection': 4,
    } as const;
    for (const loc of locations) {
      const layout = buildDungeonLayout(loc);
      const free = [...loc.blocked].filter((cell) => cell === 0).length;
      const roomFloor = layout.caveRooms.filter((room) => !room.secret)
        .reduce((sum, room) => sum + room.cells.length, 0);
      assert.equal(layout.caves.length + roomFloor, free, `${loc.seed}/${loc.tier}: оболочка не покрыла пол`);
      for (const piece of layout.caves) {
        const openings = DIRS.flatMap(([dx, dz], dir) => {
          const nx = piece.x + dx;
          const nz = piece.z + dz;
          return inBounds(loc.size, nx, nz) && loc.blocked[idx(loc.size, nx, nz)] === 0 ? [dir] : [];
        });
        assert.deepEqual(piece.openings, openings, `${piece.x}:${piece.z}: проходы разошлись с blocked`);
        assert.equal(modelDegree[piece.model], openings.length, `${piece.model}: неверная степень клетки`);
        if (piece.model === 'corridor') {
          assert.equal((openings[0]! + 2) % 4, openings[1], 'прямая поставлена на повороте');
        }
        if (piece.model === 'corridor-corner') {
          assert.notEqual((openings[0]! + 2) % 4, openings[1], 'угол поставлен на прямой');
        }
      }
    }
  });

  test('залы совпадают с footprint-ами генератора, секретный зал остаётся в породе', () => {
    for (const loc of locations) {
      const layout = buildDungeonLayout(loc);
      const regular = layout.caveRooms.filter((room) => !room.secret);
      const secrets = layout.caveRooms.filter((room) => room.secret);
      assert.equal(regular.length, loc.caveRooms?.length ?? 0);
      assert.equal(secrets.length, loc.caveSecretRooms?.length ?? 0);
      for (const room of regular) {
        assert.equal(room.cells.length, room.kind === 'large' ? 25 : room.kind === 'wide' ? 15 : 9);
        for (const cell of room.cells) {
          assert.equal(loc.blocked[idx(loc.size, cell.x, cell.z)], 0, `${room.kind}: зал не вырезан`);
          assert.equal(layout.elevation[idx(loc.size, cell.x, cell.z)], room.level, `${room.kind}: зал разорвало перепадом`);
        }
      }
      for (const room of secrets) {
        assert.equal(room.cells.length, 9);
        for (const cell of room.cells) assert.equal(loc.blocked[idx(loc.size, cell.x, cell.z)], 1, 'тайная комната уже проходима');
      }
    }
  });

  test('нижние карты окружены плотной кромкой, а внутренняя порода заполнена скалами', () => {
    for (const loc of locations) {
      const boundary = buildDungeonLayout(loc).caveBoundary;
      if (loc.tier < 2) {
        assert.deepEqual(boundary, []);
        continue;
      }
      const secret = new Set((loc.caveSecretRooms ?? []).flatMap((room) => {
        const cells: string[] = [];
        for (let z = room.z - 1; z <= room.z + 1; z++) for (let x = room.x - 1; x <= room.x + 1; x++) {
          cells.push(`${x}:${z}`);
        }
        return cells;
      }));
      const perCell = new Map<string, number>();
      const massCells = new Set<string>();
      const rockDepth = caveRockDistance(loc);
      for (const piece of boundary) {
        if (piece.model === 'template-floor-big') {
          const minX = Math.floor(piece.x);
          const minZ = Math.floor(piece.z);
          for (let z = minZ; z <= minZ + 1; z++) for (let x = minX; x <= minX + 1; x++) {
            assert.equal(loc.blocked[idx(loc.size, x, z)], 1, 'крупная скала попала в проход');
            assert.ok(!secret.has(`${x}:${z}`), 'крупная скала заполнила будущую тайную комнату');
            assert.ok(rockDepth[idx(loc.size, x, z)]! >= 2, 'крупная скала нависла над проходом');
            assert.ok(!massCells.has(`${x}:${z}`), 'крупные каменные массы пересеклись');
            massCells.add(`${x}:${z}`);
          }
          continue;
        }
        const x = Math.round(piece.x);
        const z = Math.round(piece.z);
        assert.equal(loc.blocked[idx(loc.size, x, z)], 1, 'скала попала в проход');
        assert.ok(!secret.has(`${x}:${z}`), 'скала заполнила будущую тайную комнату');
        const key = `${x}:${z}`;
        perCell.set(key, (perCell.get(key) ?? 0) + 1);
      }
      for (let z = 0; z < loc.size; z++) for (let x = 0; x < loc.size; x++) {
        if (!loc.blocked[idx(loc.size, x, z)] || secret.has(`${x}:${z}`)) continue;
        const edge = x === 0 || z === 0 || x === loc.size - 1 || z === loc.size - 1;
        const count = perCell.get(`${x}:${z}`);
        if (edge) assert.equal(count, 4, `${x}:${z}: разрежен внешний контур`);
        else if (massCells.has(`${x}:${z}`)) assert.equal(count, 1, `${x}:${z}: масса продублирована`);
        else if (rockDepth[idx(loc.size, x, z)]! <= 1) assert.equal(count, 3, `${x}:${z}: у прохода нет осыпи`);
        else if (rockDepth[idx(loc.size, x, z)]! === 2) assert.equal(count, 2, `${x}:${z}: неверный переход плотности`);
        else assert.ok(count === 1 || count === 2, `${x}:${z}: неверная глубинная плотность ${count}`);
      }
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

  test('пещерные лестницы — единственные перепады уровня и ничем не заняты', () => {
    for (const loc of locations) {
      const layout = buildDungeonLayout(loc);
      if (loc.tier >= 2) assert.equal(layout.caveStairs.length, loc.tier === 2 ? 1 : 2, 'потерян обязательный перепад');
      const stairEdges = new Set(layout.caveStairs.map((piece) => {
        const a = idx(loc.size, piece.low.x, piece.low.z);
        const b = idx(loc.size, piece.high.x, piece.high.z);
        return a < b ? `${a}:${b}` : `${b}:${a}`;
      }));
      const busy = new Set([
        ...loc.containers.map((item) => `${item.x}:${item.z}`),
        ...loc.enemies.map((enemy) => `${Math.round(enemy.x)}:${Math.round(enemy.z)}`),
        ...loc.stones.map((stone) => `${stone.x}:${stone.z}`),
      ]);
      for (const piece of layout.caveStairs) {
        const low = layout.elevation[idx(loc.size, piece.low.x, piece.low.z)]!;
        const high = layout.elevation[idx(loc.size, piece.high.x, piece.high.z)]!;
        assert.equal(high, low + 1, 'лестница не поднимает ровно на уровень');
        assert.equal(piece.level, low, 'основание лестницы стоит не на нижнем уровне');
        for (const cell of piece.cells) assert.ok(!busy.has(`${cell.x}:${cell.z}`), 'лестница накрыла сущность');
      }
      for (let z = 0; z < loc.size; z++) for (let x = 0; x < loc.size; x++) {
        if (loc.blocked[idx(loc.size, x, z)] !== 0) continue;
        for (const [dx, dz] of DIRS.slice(0, 2)) {
          const nx = x + dx;
          const nz = z + dz;
          if (!inBounds(loc.size, nx, nz) || loc.blocked[idx(loc.size, nx, nz)] !== 0) continue;
          const a = idx(loc.size, x, z);
          const b = idx(loc.size, nx, nz);
          const diff = Math.abs(layout.elevation[a]! - layout.elevation[b]!);
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          assert.ok(diff <= 1, 'соседние площадки перепрыгнули уровень');
          assert.equal(diff === 1, stairEdges.has(key), 'перепад и лестница разошлись');
        }
      }
      const wanted = loc.tier < 2 ? 0 : loc.tier === 2 ? 1 : 2;
      assert.equal(layout.caveStairs.length, wanted, `${loc.seed}/${loc.tier}: неверное число перепадов`);
    }
  });

  test('открытые ворота стоят в проходе, закрытые — перед породой', () => {
    for (const loc of locations) {
      const layout = buildDungeonLayout(loc);
      const states = layout.caveGates.map((gate) => gate.state);
      if (loc.tier < 2) {
        assert.deepEqual(states, []);
        continue;
      }
      assert.equal(states.filter((state) => state === 'open').length, loc.tier === 3 ? 2 : 1);
      assert.equal(states.filter((state) => state === 'closed').length, 1);
      for (const gate of layout.caveGates) {
        const [dx, dz] = DIRS[gate.edge.dir]!;
        const nx = gate.edge.x + dx;
        const nz = gate.edge.z + dz;
        const beyondOpen = inBounds(loc.size, nx, nz) && loc.blocked[idx(loc.size, nx, nz)] === 0;
        assert.equal(beyondOpen, gate.state === 'open', `${gate.state}: грань врёт о проходимости`);
        assert.equal(gate.barrier === null, gate.state === 'open', `${gate.state}: неверная створка`);
        assert.equal(gate.level, layout.elevation[idx(loc.size, gate.edge.x, gate.edge.z)]!);
      }
    }
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

  test('за серией сидов встречается каждая форма пещерного модуля', () => {
    const used = new Set<string>();
    for (const tier of TIERS) for (let seed = 1; seed <= 100; seed++) {
      for (const piece of buildDungeonLayout(generateLocation(seed, tier)).caves) used.add(piece.model);
    }
    assert.deepEqual(CAVE_MODULES.filter((model) => !used.has(model)), []);
  });

  test('за серией сидов встречается каждый размер комнаты', () => {
    const used = new Set<string>();
    for (const tier of TIERS) for (let seed = 1; seed <= 100; seed++) {
      for (const piece of buildDungeonLayout(generateLocation(seed, tier)).caveRooms) used.add(piece.model);
    }
    assert.deepEqual(CAVE_ROOM_MODELS.filter((model) => !used.has(model)), []);
  });

  test('за серией сидов встречаются лестница и обе закрытые створки', () => {
    const used = new Set<string>();
    for (const tier of [2, 3] as const) for (let seed = 1; seed <= 100; seed++) {
      const layout = buildDungeonLayout(generateLocation(seed, tier));
      for (const piece of [...layout.caveStairs, ...layout.caveBoundary]) used.add(piece.model);
      for (const gate of layout.caveGates) if (gate.barrier !== null) used.add(gate.barrier);
    }
    assert.deepEqual([...CAVE_STAIRS, ...CAVE_GATE_BARRIERS, ...CAVE_BOUNDARY_MODELS].filter((model) => !used.has(model)), []);
  });
});
