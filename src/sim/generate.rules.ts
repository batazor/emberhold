/**
 * Структурные правила карты. Они держат не конкретный рисунок сида, а
 * то, ради чего генератор заменён: отдельные комнаты, осмысленные связи,
 * связность и растущую глубину. Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildCaveRoomGraph,
  caveCorridorPath,
  CAVE_LAYOUT_CANDIDATES,
  delaunayRoomEdges,
  generateLocation,
  shapeCaveGeology,
} from './generate';
import { distanceField, idx, NEIGHBORS_4 } from './grid';
import type { GameLocation, Tier } from './types';

const TIERS: readonly Tier[] = [0, 1, 2, 3];

function topology(loc: GameLocation): {
  readonly cells: number;
  readonly junctions: number;
  readonly cycles: number;
  readonly depth: number;
} {
  let cells = 0;
  let edges = 0;
  let junctions = 0;
  for (let z = 0; z < loc.size; z++) for (let x = 0; x < loc.size; x++) {
    if (loc.blocked[idx(loc.size, x, z)]) continue;
    cells++;
    let degree = 0;
    for (const [dx, dz] of NEIGHBORS_4) {
      if (!loc.blocked[idx(loc.size, x + dx, z + dz)]) degree++;
    }
    edges += degree;
    if (degree >= 3) junctions++;
  }
  return {
    cells,
    junctions,
    // Граф связный по построению, поэтому цикломатическое число E − V + 1.
    cycles: edges / 2 - cells + 1,
    depth: Math.max(...loc.backSteps),
  };
}

function roomCells(loc: GameLocation, room: NonNullable<GameLocation['caveRooms']>[number]): Set<number> {
  const base = room.kind === 'small' ? [3, 3] : room.kind === 'wide' ? [5, 3] : [5, 5];
  const [width, depth] = room.turn % 2 === 0 ? base : [base[1], base[0]];
  const cells = new Set<number>();
  for (let z = room.z - (depth - 1) / 2; z <= room.z + (depth - 1) / 2; z++) {
    for (let x = room.x - (width - 1) / 2; x <= room.x + (width - 1) / 2; x++) {
      cells.add(idx(loc.size, x, z));
    }
  }
  return cells;
}

describe('Подземелье: сеть комнат', () => {
  test('направленный A* строит несколько читаемых прямых плеч', () => {
    const path = caveCorridorPath(20, { x: 2, z: 2 }, { x: 16, z: 13 }, new Set(), 17);
    assert.ok(path !== null);
    assert.deepEqual(path[0], { x: 2, z: 2 });
    assert.deepEqual(path.at(-1), { x: 16, z: 13 });
    const dirs = path.slice(1).map((cell, at) => ({
      x: cell.x - path[at]!.x,
      z: cell.z - path[at]!.z,
    }));
    const segments = dirs.reduce((count, dir, at) => (
      count + (at === 0 || dir.x !== dirs[at - 1]!.x || dir.z !== dirs[at - 1]!.z ? 1 : 0)
    ), 0);
    assert.ok(segments >= 2 && segments <= 3, `A* нарезал путь на ${segments} плеч`);
    assert.equal(new Set(path.map(({ x, z }) => `${x}:${z}`)).size, path.length, 'A* оставил петлю в коридоре');

    const existing = new Set<number>();
    for (let z = 4; z <= 11; z++) existing.add(idx(20, 9, z));
    const separate = caveCorridorPath(20, { x: 2, z: 2 }, { x: 16, z: 13 }, new Set(), 19, existing, new Set());
    assert.ok(separate !== null);
    for (const cell of separate) {
      assert.ok(!existing.has(idx(20, cell.x, cell.z)), 'A* пересёк готовый коридор без необходимости');
      const touchesParallel = NEIGHBORS_4.some(([dx, dz]) => existing.has(idx(20, cell.x + dx, cell.z + dz)));
      assert.ok(!touchesParallel, 'A* проложил длинный параллельный коридор вплотную');
    }
  });

  test('геологический проход добавляет только тупиковые ниши после графа', () => {
    const size = 20;
    const floor = new Uint8Array(size * size);
    for (let x = 2; x <= 16; x++) floor[idx(size, x, 2)] = 1;
    const before = Uint8Array.from(floor);
    const room = { nodeId: 0, kind: 'small', role: 'entry', x: 2, z: 2, turn: 0 } as const;
    const added = shapeCaveGeology(123, 2, size, floor, [room], []);
    assert.ok(added.length > 0, 'геология ничего не выела');
    assert.equal(floor.reduce((sum, open) => sum + open, 0) - before.reduce((sum, open) => sum + open, 0), added.length);
    for (let at = 0; at < size; at++) {
      assert.equal(floor[idx(size, at, 0)], 0);
      assert.equal(floor[idx(size, at, size - 1)], 0);
      assert.equal(floor[idx(size, 0, at)], 0);
      assert.equal(floor[idx(size, size - 1, at)], 0);
    }
    const graphCycles = (cells: Uint8Array): number => {
      let vertices = 0;
      let edges = 0;
      for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
        if (!cells[idx(size, x, z)]) continue;
        vertices++;
        if (x + 1 < size && cells[idx(size, x + 1, z)]) edges++;
        if (z + 1 < size && cells[idx(size, x, z + 1)]) edges++;
      }
      return edges - vertices + 1;
    };
    assert.equal(graphCycles(floor), graphCycles(before), 'геология создала новый маршрут');
  });

  test('геологические ниши не перехватывают врагов и награды', () => {
    for (const tier of [2, 3] as const) for (let seed = 1; seed <= 60; seed++) {
      const loc = generateLocation(seed, tier);
      assert.ok((loc.caveGeology?.length ?? 0) > 0, `${seed}/${tier}: нет геологической формы`);
      const niches = new Set(loc.caveGeology!.map((cell) => idx(loc.size, cell.x, cell.z)));
      for (const cell of niches) assert.equal(loc.blocked[cell], 0, `${seed}/${tier}: ниша замурована`);
      for (const enemy of loc.enemies) assert.ok(!niches.has(idx(loc.size, enemy.x, enemy.z)), 'враг ушёл в нишу');
      for (const container of loc.containers) assert.ok(!niches.has(idx(loc.size, container.x, container.z)), 'награда ушла в нишу');
    }
  });

  test('семантический граф существует до геометрии и задаёт критический маршрут', () => {
    for (const tier of TIERS) {
      const graph = buildCaveRoomGraph(tier);
      assert.deepEqual(graph.nodes.map((node) => node.id), graph.nodes.map((_, id) => id));
      assert.equal(graph.nodes[graph.entry]?.role, 'entry');
      assert.equal(graph.nodes[graph.objective]?.role, 'objective');
      assert.equal(graph.criticalPath[0], graph.entry);
      assert.equal(graph.criticalPath.at(-1), graph.objective);

      const keys = new Set<string>();
      for (const edge of graph.edges) {
        assert.ok(graph.nodes[edge.a] !== undefined && graph.nodes[edge.b] !== undefined, 'ребро смотрит мимо узла');
        const key = `${Math.min(edge.a, edge.b)}:${Math.max(edge.a, edge.b)}`;
        assert.ok(!keys.has(key), `дублированное ребро ${key}`);
        keys.add(key);
      }
      for (let at = 1; at < graph.criticalPath.length; at++) {
        const a = graph.criticalPath[at - 1]!;
        const b = graph.criticalPath[at]!;
        const edge = graph.edges.find((candidate) => (
          (candidate.a === a && candidate.b === b) || (candidate.a === b && candidate.b === a)
        ));
        assert.equal(edge?.kind, 'critical', `${tier}: разорван критический путь ${a}:${b}`);
        assert.equal(graph.nodes[b]?.criticalDepth, at, `${tier}: неверная смысловая глубина ${b}`);
      }

      const reached = new Set<number>([graph.entry]);
      const queue = [graph.entry];
      for (const current of queue) for (const edge of graph.edges) {
        const next = edge.a === current ? edge.b : edge.b === current ? edge.a : -1;
        if (next >= 0 && !reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
      assert.equal(reached.size, graph.nodes.length, `${tier}: смысловой граф распался`);
    }
  });

  test('геометрия сохраняет id, роли и размеры смысловых узлов', () => {
    for (const tier of TIERS) for (let seed = 1; seed <= 100; seed++) {
      const loc = generateLocation(seed, tier);
      assert.deepEqual(loc.caveRoomGraph, buildCaveRoomGraph(tier));
      assert.deepEqual(
        loc.caveRooms?.map(({ nodeId, kind, role }) => ({ nodeId, kind, role })),
        loc.caveRoomGraph?.nodes.map(({ id: nodeId, kind, role }) => ({ nodeId, kind, role })),
        `${seed}/${tier}: геометрия потеряла семантику`,
      );
      const criticalDepths = loc.caveRoomGraph!.criticalPath.map((nodeId) => {
        const room = loc.caveRooms![nodeId]!;
        return loc.backSteps[idx(loc.size, room.x, room.z)]!;
      });
      for (let at = 1; at < criticalDepths.length; at++) {
        assert.ok(
          criticalDepths[at]! >= criticalDepths[at - 1]!,
          `${seed}/${tier}: критический путь повернул назад ${criticalDepths.join('→')}`,
        );
      }
      assert.ok(
        criticalDepths.at(-1)! >= Math.max(...loc.backSteps) * 0.6,
        `${seed}/${tier}: цель оказалась в мелкой части карты`,
      );
    }
  });

  test('каждая открытая клетка достижима, край остаётся породой', () => {
    for (const tier of TIERS) for (let seed = 1; seed <= 60; seed++) {
      const loc = generateLocation(seed, tier);
      const reach = distanceField(loc.size, loc.blocked, loc.evac);
      for (let i = 0; i < loc.blocked.length; i++) {
        if (!loc.blocked[i]) assert.notEqual(reach[i], -1, `${seed}/${tier}: остров ${i}`);
      }
      for (let at = 0; at < loc.size; at++) {
        assert.equal(loc.blocked[idx(loc.size, at, 0)], 1, `${seed}/${tier}: открыт север`);
        assert.equal(loc.blocked[idx(loc.size, at, loc.size - 1)], 1, `${seed}/${tier}: открыт юг`);
        assert.equal(loc.blocked[idx(loc.size, 0, at)], 1, `${seed}/${tier}: открыт запад`);
        assert.equal(loc.blocked[idx(loc.size, loc.size - 1, at)], 1, `${seed}/${tier}: открыт восток`);
      }
    }
  });

  test('развилки, петли и глубина растут вместе с ярусом', () => {
    const minJunctions = [1, 12, 20, 32];
    const minCycles = [0, 6, 10, 14];
    const minDepth = [7, 14, 21, 28];
    for (const tier of TIERS) for (let seed = 1; seed <= 60; seed++) {
      const shape = topology(generateLocation(seed, tier));
      assert.ok(shape.junctions >= minJunctions[tier]!, `${seed}/${tier}: развилок ${shape.junctions}`);
      assert.ok(shape.cycles >= minCycles[tier]!, `${seed}/${tier}: петель ${shape.cycles}`);
      assert.ok(shape.depth >= minDepth[tier]!, `${seed}/${tier}: глубина ${shape.depth}`);
    }
  });

  test('тот же сид повторяется, а серия сидов сохраняет разнообразие форм', () => {
    const minimumForms = [2, 3, 12, 28];
    for (const tier of TIERS) {
      assert.deepEqual(generateLocation(17, tier).blocked, generateLocation(17, tier).blocked);
      const forms = new Set<string>();
      for (let seed = 1; seed <= 40; seed++) {
        forms.add(Array.from(generateLocation(seed, tier).blocked).join(''));
      }
      assert.ok(forms.size >= minimumForms[tier]!, `${tier}: конкурс схлопнулся до ${forms.size} форм`);
    }
  });

  test('из двенадцати кандидатов выбирается победитель, а не всегда первый', () => {
    const selected = new Set<number>();
    for (const tier of TIERS) for (let seed = 1; seed <= 30; seed++) {
      const choice = generateLocation(seed, tier).caveGeneration!;
      assert.equal(choice.evaluated, CAVE_LAYOUT_CANDIDATES);
      assert.equal(choice.scores.length, CAVE_LAYOUT_CANDIDATES);
      assert.ok(choice.valid >= 1, `${seed}/${tier}: нет валидного кандидата`);
      assert.equal(choice.scores[choice.selected], Math.max(...choice.scores), `${seed}/${tier}: выбран не лучший`);
      selected.add(choice.selected);
    }
    assert.ok(selected.size >= CAVE_LAYOUT_CANDIDATES / 2, `использовано только ${selected.size} индексов кандидатов`);
  });

  test('конкурс геометрии не зависит от множителей содержимого', () => {
    for (const tier of TIERS) {
      const normal = generateLocation(23, tier);
      const changedContent = generateLocation(23, tier, 0.35, 1.75, 0);
      assert.deepEqual(changedContent.blocked, normal.blocked);
      assert.deepEqual(changedContent.caveGeneration, normal.caveGeneration);
    }
  });

  test('нижние ярусы получают большие залы и по закрытой секретной комнате', () => {
    const expected = {
      2: ['small', 'large', 'wide', 'small', 'small'],
      3: ['small', 'large', 'wide', 'large', 'wide', 'small'],
    } as const;
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
    for (const tier of [2, 3] as const) for (let seed = 1; seed <= 60; seed++) {
      const loc = generateLocation(seed, tier);
      assert.deepEqual(loc.caveRooms?.map((room) => room.kind), expected[tier], `${seed}/${tier}: состав залов`);
      assert.equal(loc.caveSecretRooms?.length, 1, `${seed}/${tier}: нет секретной комнаты`);
      const secret = loc.caveSecretRooms![0]!;
      const [dx, dz] = dirs[secret.dir]!;
      assert.equal(loc.blocked[idx(loc.size, secret.gate.x + dx, secret.gate.z + dz)], 1, 'за воротами не порода');
      let exits = 0;
      for (const [gx, gz] of NEIGHBORS_4) {
        if (!loc.blocked[idx(loc.size, secret.gate.x + gx, secret.gate.z + gz)]) exits++;
      }
      assert.equal(exits, 1, 'к закрытым воротам ведёт не тупик');
      for (let z = secret.z - 1; z <= secret.z + 1; z++) for (let x = secret.x - 1; x <= secret.x + 1; x++) {
        assert.equal(loc.blocked[idx(loc.size, x, z)], 1, 'секретный footprint уже открыт');
      }
    }
  });

  test('обычные комнаты не пересекаются и соединены коридорами через границы', () => {
    for (const tier of TIERS) for (let seed = 1; seed <= 60; seed++) {
      const loc = generateLocation(seed, tier);
      const occupied = new Set<number>();
      const footprints = loc.caveRooms!.map((room) => roomCells(loc, room));
      for (const footprint of footprints) for (const cell of footprint) {
        assert.ok(!occupied.has(cell), `${seed}/${tier}: комнаты пересеклись в ${cell}`);
        occupied.add(cell);
        assert.equal(loc.blocked[cell], 0, `${seed}/${tier}: клетка комнаты замурована`);
      }
      for (let roomAt = 0; roomAt < footprints.length; roomAt++) {
        let doors = 0;
        for (const cell of footprints[roomAt]!) {
          const x = cell % loc.size;
          const z = (cell / loc.size) | 0;
          for (const [dx, dz] of NEIGHBORS_4) {
            const next = idx(loc.size, x + dx, z + dz);
            if (!footprints[roomAt]!.has(next) && !loc.blocked[next]) doors++;
          }
        }
        assert.ok(doors >= 1, `${seed}/${tier}: у комнаты ${roomAt} нет выхода в коридор`);
      }
      const corridorCells = loc.blocked.reduce((count, blocked, cell) => (
        count + (!blocked && !occupied.has(cell) ? 1 : 0)
      ), 0);
      // На стартовой карте 8×8 две комнаты могут состыковаться дверью:
      // внутренней клетки под отдельный коридор между ними просто нет.
      if (loc.size > 8) {
        assert.ok(corridorCells >= footprints.length - 1, `${seed}/${tier}: нет сети коридоров`);
      }
    }
  });

  test('триангуляция комнат связна и её рёбра не пересекаются', () => {
    const orient = (a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }): number =>
      (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    for (const tier of TIERS) for (let seed = 1; seed <= 100; seed++) {
      const rooms = generateLocation(seed, tier).caveRooms!;
      const edges = delaunayRoomEdges(rooms);
      const reached = new Set<number>([0]);
      const queue = [0];
      while (queue.length > 0) {
        const at = queue.pop()!;
        for (const [u, v] of edges) {
          const next = u === at ? v : v === at ? u : -1;
          if (next >= 0 && !reached.has(next)) {
            reached.add(next);
            queue.push(next);
          }
        }
      }
      assert.equal(reached.size, rooms.length, `${seed}/${tier}: триангуляция распалась`);
      for (let a = 0; a < edges.length; a++) for (let b = a + 1; b < edges.length; b++) {
        const [a0, a1] = edges[a]!;
        const [b0, b1] = edges[b]!;
        if (a0 === b0 || a0 === b1 || a1 === b0 || a1 === b1) continue;
        const crosses = orient(rooms[a0]!, rooms[a1]!, rooms[b0]!) * orient(rooms[a0]!, rooms[a1]!, rooms[b1]!) < 0
          && orient(rooms[b0]!, rooms[b1]!, rooms[a0]!) * orient(rooms[b0]!, rooms[b1]!, rooms[a1]!) < 0;
        assert.ok(!crosses, `${seed}/${tier}: рёбра триангуляции пересеклись`);
      }
    }
  });

  test('перепады резервируются до содержимого и не пропадают', () => {
    for (const tier of [2, 3] as const) for (let seed = 1; seed <= 100; seed++) {
      const loc = generateLocation(seed, tier);
      const hints = loc.caveStairHints ?? [];
      assert.equal(hints.length, tier === 2 ? 1 : 2, `${seed}/${tier}: потерян перепад`);
      const busy = new Set([
        ...loc.containers.map((item) => `${item.x}:${item.z}`),
        ...loc.enemies.map((enemy) => `${Math.round(enemy.x)}:${Math.round(enemy.z)}`),
        ...loc.stones.map((stone) => `${stone.x}:${stone.z}`),
      ]);
      for (const hint of hints) for (const cell of [hint.low, hint.high]) {
        assert.equal(loc.blocked[idx(loc.size, cell.x, cell.z)], 0, 'перепад зарезервирован в породе');
        assert.ok(!busy.has(`${cell.x}:${cell.z}`), 'содержимое заняло зарезервированный перепад');
      }
    }
  });
});
