/**
 * Визуальный план подземелья поверх игровой сетки (§6.1.2, §11.1).
 *
 * `generateLocation` остаётся единственным хозяином проходимости: он строит
 * комнаты, триангуляцию связей, коридоры и контролируемые циклы. Этот файл ничего не вырезает и не
 * замуровывает, а выводит из готового `blocked` четыре слоя KayKit Dungeon:
 * пол на каждой свободной клетке, панели на точной границе со стеной,
 * колонны в углах панелей, перепады уровня и ворота на настоящих границах.
 *
 * Разделение принципиально. Если модель меняет путь, симуляция обязана знать
 * о ней; если модель лишь говорит, где уже лежит пол и где уже стоит стена,
 * новый источник правды ей не нужен.
 */
import { idx, inBounds } from './grid';
import type { CaveRoom, CaveRoomKind, Cell, GameLocation, Tier } from './types';

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
export const CAVE_MODULES = [
  'corridor', 'corridor-corner', 'corridor-end',
  'corridor-junction', 'corridor-intersection',
] as const;
export const CAVE_ROOM_MODELS = [
  'room-small', 'room-wide', 'room-large',
] as const;
export const CAVE_BOUNDARY_MODELS = ['template-detail', 'template-floor-big'] as const;
export const CAVE_STAIRS = ['stairs'] as const;
export const CAVE_GATE_FRAMES = ['gate-rock', 'gate-overhang'] as const;
export const CAVE_GATE_BARRIERS = ['gate', 'gate-metal-bars'] as const;

export type DungeonFloorModel = (typeof DUNGEON_FLOORS)[number];
export type DungeonWallModel = (typeof DUNGEON_WALLS)[number];
export type DungeonPillarModel = (typeof DUNGEON_PILLARS)[number];
export type DungeonStairsModel = (typeof DUNGEON_STAIRS)[number];
export type CaveModuleModel = (typeof CAVE_MODULES)[number];
export type CaveRoomModel = (typeof CAVE_ROOM_MODELS)[number];
export type CaveBoundaryModel = (typeof CAVE_BOUNDARY_MODELS)[number];
export type CaveStairsModel = (typeof CAVE_STAIRS)[number];
export type CaveGateFrameModel = (typeof CAVE_GATE_FRAMES)[number];
export type CaveGateBarrierModel = (typeof CAVE_GATE_BARRIERS)[number];

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

export interface DungeonCavePiece {
  readonly model: CaveModuleModel;
  readonly x: number;
  readonly z: number;
  readonly turn: number;
  readonly level: number;
  /** Направления настоящих проходов этой клетки; нужны проверке стыков. */
  readonly openings: readonly DungeonEdgeDir[];
}

export interface DungeonCaveStairsPiece {
  readonly model: CaveStairsModel;
  /** Центр двух клеток, которые заменяет модель лестницы. */
  readonly x: number;
  readonly z: number;
  /** Направление подъёма: 0=−z, 1=+x, 2=+z, 3=−x. */
  readonly turn: DungeonEdgeDir;
  readonly level: number;
  readonly low: Cell;
  readonly high: Cell;
  readonly cells: readonly [Cell, Cell];
}

export interface DungeonCaveRoomPiece {
  readonly model: CaveRoomModel;
  readonly kind: CaveRoomKind;
  readonly x: number;
  readonly z: number;
  readonly turn: number;
  readonly level: number;
  readonly cells: readonly Cell[];
  /** Закрытая комната отрисована за воротами, но ещё не стала проходимой. */
  readonly secret: boolean;
}

export interface DungeonCaveBoundaryPiece {
  readonly model: CaveBoundaryModel;
  readonly x: number;
  readonly z: number;
  readonly turn: number;
  readonly level: 0;
}

export type DungeonGateState = 'open' | 'closed';

export interface DungeonCaveGatePiece {
  readonly state: DungeonGateState;
  /** Каменная рама одна у обоих состояний; створка есть только у закрытого. */
  readonly barrier: CaveGateBarrierModel | null;
  readonly x: number;
  readonly z: number;
  readonly turn: number;
  readonly level: number;
  /** Открытая грань у open, граница с породой у closed. */
  readonly edge: DungeonEdge;
}

export interface DungeonLayout {
  readonly floors: readonly DungeonFloorPiece[];
  readonly walls: readonly DungeonWallPiece[];
  readonly pillars: readonly DungeonPillarPiece[];
  readonly stairs: DungeonStairsPiece | null;
  readonly caves: readonly DungeonCavePiece[];
  readonly caveRooms: readonly DungeonCaveRoomPiece[];
  readonly caveBoundary: readonly DungeonCaveBoundaryPiece[];
  readonly caveStairs: readonly DungeonCaveStairsPiece[];
  readonly caveGates: readonly DungeonCaveGatePiece[];
  /** Целый уровень каждой клетки; физическую высоту назначает рендер. */
  readonly elevation: readonly number[];
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

const CAVE_BASE_OPENINGS: Readonly<Record<CaveModuleModel, readonly DungeonEdgeDir[]>> = {
  corridor: [0, 2],
  'corridor-corner': [1, 2],
  'corridor-end': [2],
  'corridor-junction': [1, 2, 3],
  'corridor-intersection': [0, 1, 2, 3],
};

function cellOpenings(loc: Pick<GameLocation, 'size' | 'blocked'>, x: number, z: number): DungeonEdgeDir[] {
  const out: DungeonEdgeDir[] = [];
  for (let dir = 0; dir < EDGE_DIRS.length; dir++) {
    const [dx, dz] = EDGE_DIRS[dir]!;
    const nx = x + dx;
    const nz = z + dz;
    if (inBounds(loc.size, nx, nz) && loc.blocked[idx(loc.size, nx, nz)] === 0) {
      out.push(dir as DungeonEdgeDir);
    }
  }
  return out;
}

function sameDirs(a: readonly DungeonEdgeDir[], b: readonly DungeonEdgeDir[]): boolean {
  return a.length === b.length && a.every((dir) => b.includes(dir));
}

function caveTurn(model: CaveModuleModel, openings: readonly DungeonEdgeDir[]): number {
  const base = CAVE_BASE_OPENINGS[model];
  for (let turn = 0; turn < 4; turn++) {
    const rotated = base.map((dir) => ((dir + turn) % 4) as DungeonEdgeDir);
    if (sameDirs(rotated, openings)) return turn;
  }
  return 0;
}

const cellKey = (cell: Cell): string => `${cell.x}:${cell.z}`;

const CAVE_ROOM_SIZE: Readonly<Record<CaveRoomKind, readonly [number, number]>> = {
  small: [3, 3],
  wide: [5, 3],
  large: [5, 5],
};

function caveRoomCells(room: Pick<CaveRoom, 'kind' | 'x' | 'z' | 'turn'>): Cell[] {
  const [baseWidth, baseDepth] = CAVE_ROOM_SIZE[room.kind];
  const [width, depth] = room.turn % 2 === 0
    ? [baseWidth, baseDepth]
    : [baseDepth, baseWidth];
  const cells: Cell[] = [];
  for (let z = room.z - (depth - 1) / 2; z <= room.z + (depth - 1) / 2; z++) {
    for (let x = room.x - (width - 1) / 2; x <= room.x + (width - 1) / 2; x++) cells.push({ x, z });
  }
  return cells;
}

function caveRoomModel(kind: CaveRoomKind, seed: number, x: number, z: number): CaveRoomModel {
  const models = CAVE_ROOM_MODELS.filter((model) => model.startsWith(`room-${kind}`));
  return pick(models, seed, x, z, 0x7750);
}

type CaveTopology = Pick<GameLocation, 'seed' | 'tier' | 'size' | 'blocked' | 'backSteps' | 'evac'>;

function cellsBehindEdge(loc: CaveTopology, low: Cell, high: Cell): Set<number> | null {
  const start = idx(loc.size, high.x, high.z);
  const stop = idx(loc.size, low.x, low.z);
  const seen = new Set<number>([start]);
  const queue = [start];
  for (let at = 0; at < queue.length; at++) {
    const cell = queue[at]!;
    if (cell === stop) return null;
    const x = cell % loc.size;
    const z = (cell / loc.size) | 0;
    for (const [dx, dz] of EDGE_DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      if (!inBounds(loc.size, nx, nz) || loc.blocked[idx(loc.size, nx, nz)] !== 0) continue;
      if ((x === low.x && z === low.z && nx === high.x && nz === high.z)
        || (x === high.x && z === high.z && nx === low.x && nz === low.z)) continue;
      const next = idx(loc.size, nx, nz);
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

interface RiseCandidate {
  readonly low: Cell;
  readonly high: Cell;
  readonly dir: DungeonEdgeDir;
  readonly component: ReadonlySet<number>;
  readonly depth: number;
  readonly score: number;
}

/**
 * Ищет мосты графа в прямых коридорах. Поднимается целая компонента за
 * мостом, поэтому лестница остаётся единственным местом перепада: ни один
 * соседний тайл не получает невидимого обрыва.
 */
function selectCaveRises(loc: GameLocation): RiseCandidate[] {
  if (loc.tier < 2) return [];
  const busy = new Set([
    cellKey(loc.evac),
    ...loc.containers.map(cellKey),
    ...loc.enemies.map((enemy) => `${Math.round(enemy.x)}:${Math.round(enemy.z)}`),
    ...loc.stones.map(cellKey),
  ]);
  const roomCells = new Set((loc.caveRooms ?? []).flatMap((room) => caveRoomCells(room).map(cellKey)));
  const candidates: RiseCandidate[] = [];
  for (const hint of loc.caveStairHints ?? []) {
    const component = cellsBehindEdge(loc, hint.low, hint.high);
    if (component === null) continue;
    const depth = loc.backSteps[idx(loc.size, hint.low.x, hint.low.z)]!;
    candidates.push({ ...hint, component, depth, score: 0x40000000 + depth * 0x100000 });
  }
  for (let z = 1; z < loc.size - 1; z++) for (let x = 1; x < loc.size - 1; x++) {
    if (loc.blocked[idx(loc.size, x, z)] !== 0 || busy.has(`${x}:${z}`)) continue;
    const low: Cell = { x, z };
    const lowDepth = loc.backSteps[idx(loc.size, x, z)]!;
    const openings = cellOpenings(loc, x, z);
    for (const dir of openings) {
      const [dx, dz] = EDGE_DIRS[dir]!;
      const high: Cell = { x: x + dx, z: z + dz };
      const highDepth = loc.backSteps[idx(loc.size, high.x, high.z)]!;
      if (highDepth <= lowDepth || lowDepth < 3 || busy.has(cellKey(high))) continue;
      const component = cellsBehindEdge(loc, low, high);
      if (component === null || component.size < 1) continue;
      const roomPenalty = roomCells.has(cellKey(low)) || roomCells.has(cellKey(high)) ? 0x10000000 : 0;
      const score = lowDepth * 0x100000 + (mix(loc.seed, x, z, 0x7720) & 0xfffff) - roomPenalty;
      candidates.push({ low, high, dir, component, depth: lowDepth, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const picked: RiseCandidate[] = [];
  const occupied = new Set<string>();
  const wanted = loc.tier === 3 ? 2 : 1;
  for (const candidate of candidates) {
    if (picked.length >= wanted) break;
    if (occupied.has(cellKey(candidate.low)) || occupied.has(cellKey(candidate.high))) continue;
    if (picked.some((old) => Math.abs(old.depth - candidate.depth) < 4)) continue;
    picked.push(candidate);
    occupied.add(cellKey(candidate.low));
    occupied.add(cellKey(candidate.high));
  }
  // В компактной room-first карте два мостика могут лежать рядом. Сначала
  // разносили их на четыре шага, но отсутствие второго перепада хуже близкой
  // лестницы: добираем оставшиеся мосты, не накрывая ту же клетку.
  for (const candidate of candidates) {
    if (picked.length >= wanted) break;
    if (occupied.has(cellKey(candidate.low)) || occupied.has(cellKey(candidate.high))) continue;
    picked.push(candidate);
    occupied.add(cellKey(candidate.low));
    occupied.add(cellKey(candidate.high));
  }
  return picked;
}

function buildCaveRises(loc: GameLocation): {
  readonly elevation: number[];
  readonly stairs: DungeonCaveStairsPiece[];
} {
  const elevation = new Array<number>(loc.size * loc.size).fill(0);
  const picked = selectCaveRises(loc);

  for (const rise of picked) for (const cell of rise.component) elevation[cell]!++;
  const stairs = picked.map((rise): DungeonCaveStairsPiece => ({
    model: 'stairs',
    x: (rise.low.x + rise.high.x) / 2,
    z: (rise.low.z + rise.high.z) / 2,
    turn: rise.dir,
    level: elevation[idx(loc.size, rise.low.x, rise.low.z)]!,
    low: rise.low,
    high: rise.high,
    cells: [rise.low, rise.high],
  }));
  return { elevation, stairs };
}

function gateTurn(dir: DungeonEdgeDir): number {
  return dir === 0 || dir === 2 ? 0 : 1;
}

function gateAt(edge: DungeonEdge): { readonly x: number; readonly z: number } {
  const [dx, dz] = EDGE_DIRS[edge.dir]!;
  return { x: edge.x + dx * 0.5, z: edge.z + dz * 0.5 };
}

function buildCaveRooms(loc: GameLocation, elevation: readonly number[]): DungeonCaveRoomPiece[] {
  return (loc.caveRooms ?? []).map((room) => ({
    ...room,
    model: caveRoomModel(room.kind, loc.seed, room.x, room.z),
    level: elevation[idx(loc.size, room.x, room.z)]!,
    cells: caveRoomCells(room),
    secret: false,
  }));
}

/** 0 на проходе, 1 у его стенки и дальше — Манхэттенская глубина породы. */
export function caveRockDistance(loc: Pick<GameLocation, 'size' | 'blocked'>): Int16Array {
  const distance = new Int16Array(loc.size * loc.size).fill(-1);
  const queue = new Int32Array(loc.size * loc.size);
  let tail = 0;
  for (let cell = 0; cell < loc.blocked.length; cell++) {
    if (loc.blocked[cell]) continue;
    distance[cell] = 0;
    queue[tail++] = cell;
  }
  for (let head = 0; head < tail; head++) {
    const cell = queue[head]!;
    const x = cell % loc.size;
    const z = (cell / loc.size) | 0;
    for (const [dx, dz] of EDGE_DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      if (!inBounds(loc.size, nx, nz)) continue;
      const next = idx(loc.size, nx, nz);
      if (distance[next] >= 0) continue;
      distance[next] = distance[cell]! + 1;
      queue[tail++] = next;
    }
  }
  return distance;
}

/**
 * Порода заполняет не только рамку, а всё непроходимое пространство карты.
 * Несколько независимо смещённых кластеров на клетку превращают `blocked`
 * в каменный объём; тайная комната исключена, потому что за воротами уже
 * рисуется её готовая оболочка и позже эти клетки станут проходимыми.
 */
function buildCaveBoundary(loc: GameLocation): DungeonCaveBoundaryPiece[] {
  if (loc.tier < 2) return [];
  const out: DungeonCaveBoundaryPiece[] = [];
  const rockDistance = caveRockDistance(loc);
  const secret = new Set((loc.caveSecretRooms ?? []).flatMap((room) => caveRoomCells(room).map(cellKey)));
  const rockCell = (x: number, z: number): boolean => inBounds(loc.size, x, z)
    && loc.blocked[idx(loc.size, x, z)] !== 0
    && !secret.has(`${x}:${z}`);
  const mass = new Set<string>();

  // Крупные массы укладываются только глубже первого слоя породы. У прохода
  // остаётся мелкая осыпь: силуэт читается неровно и большая модель не
  // нависает над игровой клеткой. Чем глубже квадрат, тем чаще он цельный.
  for (let z = 0; z < loc.size - 1; z++) for (let x = 0; x < loc.size - 1; x++) {
    const cells = [{ x, z }, { x: x + 1, z }, { x, z: z + 1 }, { x: x + 1, z: z + 1 }];
    if (cells.some((cell) => !rockCell(cell.x, cell.z) || mass.has(cellKey(cell)))) continue;
    const depth = Math.min(...cells.map((cell) => rockDistance[idx(loc.size, cell.x, cell.z)]!));
    if (depth < 2) continue;
    const skipBelow = depth === 2 ? 2 : 1;
    if (mix(loc.seed, x, z, 0x7750) % 5 < skipBelow) continue;
    out.push({ model: 'template-floor-big', x: x + 0.5, z: z + 0.5, turn: mix(loc.seed, x, z, 0x7751) % 4, level: 0 });
    for (const cell of cells) mass.add(cellKey(cell));
  }

  for (let z = 0; z < loc.size; z++) for (let x = 0; x < loc.size; x++) {
    if (!rockCell(x, z)) continue;
    const edge = x === 0 || z === 0 || x === loc.size - 1 || z === loc.size - 1;
    const depth = rockDistance[idx(loc.size, x, z)]!;
    const clusters = edge ? 4
      : mass.has(`${x}:${z}`) ? 1
        : depth <= 1 ? 3
          : depth === 2 ? 2
            : 1 + (mix(loc.seed, x, z, 0x7752) % 3 === 0 ? 1 : 0);
    for (let cluster = 0; cluster < clusters; cluster++) {
      const salt = 0x7760 + cluster * 0x101;
      out.push({
        model: 'template-detail',
        x: x + ((mix(loc.seed, x, z, salt + 1) & 1023) / 1023 - 0.5) * 0.64,
        z: z + ((mix(loc.seed, x, z, salt + 2) & 1023) / 1023 - 0.5) * 0.64,
        turn: mix(loc.seed, x, z, salt + 3) % 4,
        level: 0,
      });
    }
  }
  return out;
}

function buildCaveGates(
  loc: GameLocation,
  elevation: readonly number[],
  stairs: readonly DungeonCaveStairsPiece[],
): { readonly gates: DungeonCaveGatePiece[]; readonly secretRooms: DungeonCaveRoomPiece[] } {
  if (loc.tier < 2) return { gates: [], secretRooms: [] };
  const stairCells = new Set(stairs.flatMap((piece) => piece.cells.map(cellKey)));
  const secretGateCells = new Set((loc.caveSecretRooms ?? []).map((room) => cellKey(room.gate)));
  const openCandidates: { edge: DungeonEdge; score: number }[] = [];
  const closedCandidates: { edge: DungeonEdge; room: CaveRoom; score: number }[] = (loc.caveSecretRooms ?? []).map((room) => ({
    edge: { x: room.gate.x, z: room.gate.z, dir: room.dir },
    room,
    score: loc.backSteps[idx(loc.size, room.gate.x, room.gate.z)]! * 0x100000,
  }));

  for (let z = 1; z < loc.size - 1; z++) for (let x = 1; x < loc.size - 1; x++) {
    if (loc.blocked[idx(loc.size, x, z)] !== 0 || stairCells.has(`${x}:${z}`) || secretGateCells.has(`${x}:${z}`)) continue;
    const depth = loc.backSteps[idx(loc.size, x, z)]!;
    const openings = cellOpenings(loc, x, z);
    for (const dir of openings) {
      // Каждую открытую грань берём один раз.
      if (dir !== 1 && dir !== 2) continue;
      const [dx, dz] = EDGE_DIRS[dir]!;
      const nx = x + dx;
      const nz = z + dz;
      if (stairCells.has(`${nx}:${nz}`) || secretGateCells.has(`${nx}:${nz}`)) continue;
      if (elevation[idx(loc.size, x, z)] !== elevation[idx(loc.size, nx, nz)]) continue;
      if (Math.min(depth, loc.backSteps[idx(loc.size, nx, nz)]!) < 5) continue;
      openCandidates.push({
        edge: { x, z, dir },
        score: depth * 0x100000 + (mix(loc.seed, x, z, 0x7730 + dir) & 0xfffff),
      });
    }
  }

  const out: DungeonCaveGatePiece[] = [];
  const occupied = new Set<string>();
  const take = (candidate: { edge: DungeonEdge }, state: DungeonGateState): void => {
    const edge = candidate.edge;
    const at = gateAt(edge);
    const barrier = state === 'closed'
      ? pick(CAVE_GATE_BARRIERS, loc.seed, edge.x, edge.z, 0x7740)
      : null;
    out.push({
      state,
      barrier,
      x: at.x,
      z: at.z,
      turn: gateTurn(edge.dir),
      level: elevation[idx(loc.size, edge.x, edge.z)]!,
      edge,
    });
    occupied.add(`${edge.x}:${edge.z}`);
    const [dx, dz] = EDGE_DIRS[edge.dir]!;
    occupied.add(`${edge.x + dx}:${edge.z + dz}`);
  };

  openCandidates.sort((a, b) => b.score - a.score);
  const openWanted = loc.tier === 3 ? 2 : 1;
  for (const candidate of openCandidates) {
    if (out.filter((gate) => gate.state === 'open').length >= openWanted) break;
    const edge = candidate.edge;
    const [dx, dz] = EDGE_DIRS[edge.dir]!;
    if (occupied.has(`${edge.x}:${edge.z}`) || occupied.has(`${edge.x + dx}:${edge.z + dz}`)) continue;
    take(candidate, 'open');
  }

  closedCandidates.sort((a, b) => b.score - a.score);
  const closed = closedCandidates.find((candidate) => !occupied.has(`${candidate.edge.x}:${candidate.edge.z}`));
  if (closed !== undefined) take(closed, 'closed');
  const secretRooms = closed === undefined ? [] : [{
    ...closed.room,
    model: caveRoomModel('small', loc.seed, closed.room.x, closed.room.z),
    level: elevation[idx(loc.size, closed.edge.x, closed.edge.z)]!,
    cells: caveRoomCells(closed.room),
    secret: true,
  } satisfies DungeonCaveRoomPiece];
  return { gates: out, secretRooms };
}

function buildCaves(
  loc: GameLocation,
  elevation: readonly number[],
): DungeonCavePiece[] {
  const out: DungeonCavePiece[] = [];
  const roomCells = new Set((loc.caveRooms ?? []).flatMap((room) => caveRoomCells(room).map(cellKey)));
  for (let z = 0; z < loc.size; z++) for (let x = 0; x < loc.size; x++) {
    if (loc.blocked[idx(loc.size, x, z)] !== 0 || roomCells.has(`${x}:${z}`)) continue;
    const openings = cellOpenings(loc, x, z);
    const model: CaveModuleModel = openings.length <= 1
      ? 'corridor-end'
      : openings.length === 2
        ? ((openings[0]! + 2) % 4 === openings[1]! ? 'corridor' : 'corridor-corner')
        : openings.length === 3
          ? 'corridor-junction'
          : 'corridor-intersection';
    out.push({
      model,
      x,
      z,
      turn: caveTurn(model, openings),
      level: elevation[idx(loc.size, x, z)]!,
      openings,
    });
  }
  return out;
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
  const rise = buildCaveRises(loc);
  const rooms = buildCaveRooms(loc, rise.elevation);
  const gateLayer = buildCaveGates(loc, rise.elevation, rise.stairs);
  return {
    floors,
    walls: buildWalls(loc, edges),
    pillars: buildPillars(loc, edges),
    stairs: buildStairs(loc),
    caves: buildCaves(loc, rise.elevation),
    caveRooms: [...rooms, ...gateLayer.secretRooms],
    caveBoundary: buildCaveBoundary(loc),
    caveStairs: rise.stairs,
    caveGates: gateLayer.gates,
    elevation: rise.elevation,
  };
}
