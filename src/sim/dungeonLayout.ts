/**
 * Визуальный план подземелья поверх игровой сетки (§6.1.2, §11.1).
 *
 * `generateLocation` остаётся единственным хозяином проходимости: он строит
 * спинной ход, залы, тупики и циклы. Этот файл ничего не вырезает и не
 * замуровывает, а выводит из готового `blocked` четыре слоя KayKit Dungeon:
 * пол на каждой свободной клетке, панели на точной границе со стеной,
 * колонны в углах панелей и одну лестницу в глубоком зале.
 *
 * Разделение принципиально. Если модель меняет путь, симуляция обязана знать
 * о ней; если модель лишь говорит, где уже лежит пол и где уже стоит стена,
 * новый источник правды ей не нужен.
 */
import { idx, inBounds } from './grid';
import type { Cell, GameLocation, Tier } from './types';

export const DUNGEON_FLOORS = [
  'floor_dirt_small_A', 'floor_dirt_small_B', 'floor_dirt_small_C', 'floor_dirt_small_D',
  'floor_tile_small', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B',
  'floor_tile_small_corner', 'floor_tile_small_decorated',
  'floor_wood_small', 'floor_wood_small_dark',
] as const;

export const DUNGEON_WALLS = [
  'wall', 'wall_arched', 'wall_pillar', 'wall_window_closed', 'wall_archedwindow_gated',
  'wall_half', 'wall_half_endcap', 'wall_half_endcap_sloped',
] as const;

export const DUNGEON_PILLARS = ['pillar', 'pillar_decorated'] as const;
export const DUNGEON_STAIRS = ['stairs_narrow', 'stairs_wall_left', 'stairs_wall_right'] as const;

export type DungeonFloorModel = (typeof DUNGEON_FLOORS)[number];
export type DungeonWallModel = (typeof DUNGEON_WALLS)[number];
export type DungeonPillarModel = (typeof DUNGEON_PILLARS)[number];
export type DungeonStairsModel = (typeof DUNGEON_STAIRS)[number];

/** Сторона свободной клетки, за которой начинается `blocked`: −z,+x,+z,−x. */
export type DungeonEdgeDir = 0 | 1 | 2 | 3;

const EDGE_DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

export interface DungeonEdge {
  readonly x: number;
  readonly z: number;
  readonly dir: DungeonEdgeDir;
}

export interface DungeonFloorPiece {
  readonly model: DungeonFloorModel;
  readonly x: number;
  readonly z: number;
  readonly turn: number;
}

export interface DungeonWallPiece {
  readonly model: DungeonWallModel;
  readonly x: number;
  readonly z: number;
  readonly turn: number;
  /** Одна грань у половины стены, две последовательные — у полной. */
  readonly edges: readonly DungeonEdge[];
}

export interface DungeonPillarPiece {
  readonly model: DungeonPillarModel;
  readonly x: number;
  readonly z: number;
  readonly turn: number;
}

export interface DungeonStairsPiece {
  readonly model: DungeonStairsModel;
  readonly x: number;
  readonly z: number;
  readonly turn: number;
  /** Четыре свободные клетки под скатом 2×2. */
  readonly cells: readonly Cell[];
}

export interface DungeonLayout {
  readonly floors: readonly DungeonFloorPiece[];
  readonly walls: readonly DungeonWallPiece[];
  readonly pillars: readonly DungeonPillarPiece[];
  readonly stairs: DungeonStairsPiece | null;
}

const FLOOR_BY_TIER: Readonly<Record<Tier, readonly DungeonFloorModel[]>> = {
  0: ['floor_dirt_small_A', 'floor_dirt_small_B', 'floor_dirt_small_C', 'floor_dirt_small_D'],
  1: ['floor_tile_small', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B'],
  2: ['floor_tile_small', 'floor_tile_small_corner', 'floor_wood_small'],
  3: ['floor_tile_small', 'floor_tile_small_decorated', 'floor_wood_small_dark'],
};

const WALL_BY_TIER: Readonly<Record<Tier, readonly DungeonWallModel[]>> = {
  0: ['wall'],
  1: ['wall', 'wall_arched'],
  2: ['wall', 'wall_pillar', 'wall_window_closed'],
  3: ['wall_pillar', 'wall_window_closed', 'wall_archedwindow_gated'],
};

const WALL_HALF: readonly DungeonWallModel[] = [
  'wall_half', 'wall_half_endcap', 'wall_half_endcap_sloped',
];

/** Хеш координаты: выбор вида не зависит от порядка обхода и числа деталей. */
function mix(seed: number, x: number, z: number, salt: number): number {
  let n = (seed ^ Math.imul(x + 0x51ed, 0x9e3779b1) ^ Math.imul(z + 0x7f4a, 0x85ebca77) ^ salt) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
}

function pick<T>(list: readonly T[], seed: number, x: number, z: number, salt: number): T {
  return list[mix(seed, x, z, salt) % list.length]!;
}

export const dungeonEdgeKey = (edge: DungeonEdge): string => `${edge.x}:${edge.z}:${edge.dir}`;

function boundaryEdges(loc: Pick<GameLocation, 'size' | 'blocked'>): DungeonEdge[] {
  const out: DungeonEdge[] = [];
  for (let z = 0; z < loc.size; z++) {
    for (let x = 0; x < loc.size; x++) {
      if (loc.blocked[idx(loc.size, x, z)] !== 0) continue;
      for (let dir = 0; dir < 4; dir++) {
        const [dx, dz] = EDGE_DIRS[dir]!;
        const nx = x + dx;
        const nz = z + dz;
        if (inBounds(loc.size, nx, nz) && loc.blocked[idx(loc.size, nx, nz)] === 0) continue;
        out.push({ x, z, dir: dir as DungeonEdgeDir });
      }
    }
  }
  return out;
}

/** Одна линия одинаково направленных граней; внутри неё можно ставить стену длиной 2. */
function lineKey(edge: DungeonEdge): string {
  if (edge.dir === 0 || edge.dir === 2) return `${edge.dir}:z:${edge.z * 2 + (edge.dir === 0 ? -1 : 1)}`;
  return `${edge.dir}:x:${edge.x * 2 + (edge.dir === 1 ? 1 : -1)}`;
}

const along = (edge: DungeonEdge): number => edge.dir === 0 || edge.dir === 2 ? edge.x : edge.z;

function wallAt(edges: readonly DungeonEdge[]): { readonly x: number; readonly z: number } {
  const a = edges[0]!;
  if (a.dir === 0 || a.dir === 2) {
    return {
      x: edges.reduce((sum, edge) => sum + edge.x, 0) / edges.length,
      z: a.z + (a.dir === 0 ? -0.5 : 0.5),
    };
  }
  return {
    x: a.x + (a.dir === 1 ? 0.5 : -0.5),
    z: edges.reduce((sum, edge) => sum + edge.z, 0) / edges.length,
  };
}

function buildWalls(loc: GameLocation, edges: readonly DungeonEdge[]): DungeonWallPiece[] {
  const lines = new Map<string, DungeonEdge[]>();
  for (const edge of edges) {
    const key = lineKey(edge);
    const list = lines.get(key) ?? [];
    list.push(edge);
    lines.set(key, list);
  }

  const out: DungeonWallPiece[] = [];
  for (const list of lines.values()) {
    list.sort((a, b) => along(a) - along(b));
    for (let start = 0; start < list.length;) {
      let end = start + 1;
      while (end < list.length && along(list[end]!) === along(list[end - 1]!) + 1) end++;
      for (let at = start; at < end;) {
        const count = at + 1 < end ? 2 : 1;
        const covered = list.slice(at, at + count);
        const center = wallAt(covered);
        const first = covered[0]!;
        out.push({
          model: count === 2
            ? pick(WALL_BY_TIER[loc.tier], loc.seed, first.x, first.z, 0x7711)
            : pick(WALL_HALF, loc.seed, first.x, first.z, 0x7712),
          x: center.x,
          z: center.z,
          turn: first.dir,
          edges: covered,
        });
        at += count;
      }
      start = end;
    }
  }
  return out;
}

/** Удвоенные координаты вершины позволяют хранить полуцелые без строк с дробями. */
function edgeVertices(edge: DungeonEdge): readonly [readonly [number, number], readonly [number, number]] {
  if (edge.dir === 0 || edge.dir === 2) {
    const z = edge.z * 2 + (edge.dir === 0 ? -1 : 1);
    return [[edge.x * 2 - 1, z], [edge.x * 2 + 1, z]];
  }
  const x = edge.x * 2 + (edge.dir === 1 ? 1 : -1);
  return [[x, edge.z * 2 - 1], [x, edge.z * 2 + 1]];
}

function buildPillars(loc: GameLocation, edges: readonly DungeonEdge[]): DungeonPillarPiece[] {
  const vertices = new Map<string, { x: number; z: number; mask: number }>();
  for (const edge of edges) {
    const bit = edge.dir === 0 || edge.dir === 2 ? 1 : 2;
    for (const [x, z] of edgeVertices(edge)) {
      const key = `${x}:${z}`;
      const old = vertices.get(key);
      vertices.set(key, { x, z, mask: (old?.mask ?? 0) | bit });
    }
  }
  const models = loc.tier === 3 ? DUNGEON_PILLARS : DUNGEON_PILLARS.slice(0, 1);
  return [...vertices.values()]
    .filter((vertex) => vertex.mask === 3)
    .map((vertex) => ({
      model: pick(models, loc.seed, vertex.x, vertex.z, 0x7713),
      x: vertex.x / 2,
      z: vertex.z / 2,
      turn: mix(loc.seed, vertex.x, vertex.z, 0x7714) % 4,
    }));
}

function stairTurn(loc: GameLocation, x: number, z: number): number {
  const sides = [
    { turn: 0, cells: [{ x, z: z - 1 }, { x: x + 1, z: z - 1 }] },
    { turn: 1, cells: [{ x: x - 1, z }, { x: x - 1, z: z + 1 }] },
    { turn: 2, cells: [{ x, z: z + 2 }, { x: x + 1, z: z + 2 }] },
    { turn: 3, cells: [{ x: x + 2, z }, { x: x + 2, z: z + 1 }] },
  ];
  let best = Infinity;
  let turn = 0;
  for (const side of sides) {
    for (const cell of side.cells) {
      if (!inBounds(loc.size, cell.x, cell.z)) continue;
      const back = loc.backSteps[idx(loc.size, cell.x, cell.z)]!;
      if (back >= 0 && back < best) {
        best = back;
        turn = side.turn;
      }
    }
  }
  return turn;
}

function buildStairs(loc: GameLocation): DungeonStairsPiece | null {
  const busy = new Set([
    ...loc.containers.map((item) => `${item.x}:${item.z}`),
    ...loc.enemies.map((enemy) => `${Math.round(enemy.x)}:${Math.round(enemy.z)}`),
    ...loc.stones.map((stone) => `${stone.x}:${stone.z}`),
  ]);
  let best: { x: number; z: number; depth: number } | null = null;
  for (let z = 1; z < loc.size - 2; z++) {
    for (let x = 1; x < loc.size - 2; x++) {
      const cells = [{ x, z }, { x: x + 1, z }, { x, z: z + 1 }, { x: x + 1, z: z + 1 }];
      if (cells.some((cell) => loc.blocked[idx(loc.size, cell.x, cell.z)] !== 0 || busy.has(`${cell.x}:${cell.z}`))) continue;
      const depth = Math.min(...cells.map((cell) => loc.backSteps[idx(loc.size, cell.x, cell.z)]!));
      if (depth < 4 || (best !== null && depth <= best.depth)) continue;
      best = { x, z, depth };
    }
  }
  if (best === null) return null;
  const cells = [
    { x: best.x, z: best.z }, { x: best.x + 1, z: best.z },
    { x: best.x, z: best.z + 1 }, { x: best.x + 1, z: best.z + 1 },
  ];
  return {
    model: pick(DUNGEON_STAIRS, loc.seed, best.x, best.z, 0x7715),
    x: best.x + 0.5,
    z: best.z + 0.5,
    turn: stairTurn(loc, best.x, best.z),
    cells,
  };
}

export function buildDungeonLayout(loc: GameLocation): DungeonLayout {
  const floors: DungeonFloorPiece[] = [];
  const floorModels = FLOOR_BY_TIER[loc.tier];
  for (let z = 0; z < loc.size; z++) {
    for (let x = 0; x < loc.size; x++) {
      if (loc.blocked[idx(loc.size, x, z)] !== 0) continue;
      floors.push({
        model: pick(floorModels, loc.seed, x, z, 0x7710),
        x,
        z,
        turn: mix(loc.seed, x, z, 0x770f) % 4,
      });
    }
  }
  const edges = boundaryEdges(loc);
  return {
    floors,
    walls: buildWalls(loc, edges),
    pillars: buildPillars(loc, edges),
    stairs: buildStairs(loc),
  };
}
