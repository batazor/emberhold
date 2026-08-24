import { mulberry32, randInt } from '../core/rng';
import type { Rng } from '../core/rng';
import {
  BOTTOM_GUARD_LEVELS,
  ENEMY_DEPTH_SHARE,
  GOLD_CHEST_CHANCE,
  MATURE_LEAD_LEVEL_BONUS,
  SOFT_TIER_VISITS,
  tierEnemyLevel,
} from './balance';
import { TIER_CONTAINERS, TIER_CONTAINER_BASE, TIER_DEPTH_VALUE, TIER_SIZE } from './config';
import { TIER_ROSTER, enemyStats } from './enemies';
import { distanceField, idx, inBounds, NEIGHBORS_4 } from './grid';
import { rollLoot } from './resources';
import { supplyBoxAt } from './lootbox';
import { STONES, scatterStones } from './stones';
import { buildDungeonEnemyPatrols } from './dungeonNpc';
import type {
  CaveRoom,
  CaveGenerationChoice,
  CaveRoomGraph,
  CaveRoomKind,
  CaveRoomPlanEdge,
  CaveRoomPlanNode,
  CaveSecretRoom,
  CaveStairHint,
  Cell,
  Container,
  Enemy,
  GameLocation,
  Tier,
} from './types';

/**
 * Локация целиком выводится из пары (seed, tier) — никаких скрытых состояний.
 * Это условие воспроизводимости багов из §6 и будущей серверной валидации.
 *
 * Форма локации подчинена единственному решению игры — идти глубже или назад,
 * — и строится из четырёх частей:
 *
 * 1. До единой координаты строится семантический граф: критический маршрут,
 *    роли залов, ответвления и петли. Размер комнаты следует роли.
 * 2. Узлы графа получают непересекающиеся места, а его рёбра — коридоры.
 *    Поэтому связь существует из-за решения в плане, а не близости штампов.
 * 3. Двери вырезаются на стенах по направлению к соседнему залу, а короткий
 *    путь между ними прокладывается в породе, обходя остальные комнаты.
 * 4. На глубочайшем ярусе появляется один дополнительный маршрут; секретный
 *    зал остаётся отдельным тупиком за закрытыми воротами.
 *
 * Прежний генератор разбрасывал случайные кляксы камня. Он давал проходимую
 * пещеру, но бесформенную: ни направления, ни развилок, ни мест, где
 * принимают решение.
 */

const ROOM_SIZE: Readonly<Record<CaveRoomKind, readonly [number, number]>> = {
  small: [3, 3],
  wide: [5, 3],
  large: [5, 5],
};

function planNode(
  id: number,
  kind: CaveRoomKind,
  role: CaveRoomPlanNode['role'],
  criticalDepth: number,
): CaveRoomPlanNode {
  return { id, kind, role, criticalDepth };
}

/**
 * Смысловой план не знает ни размера сетки, ни координат. Он фиксирует
 * критический путь и назначение каждого помещения до геометрии.
 */
export function buildCaveRoomGraph(tier: Tier): CaveRoomGraph {
  const nodes: readonly (readonly CaveRoomPlanNode[])[] = [
    [planNode(0, 'small', 'entry', 0), planNode(1, 'small', 'objective', 1)],
    [
      planNode(0, 'small', 'entry', 0),
      planNode(1, 'wide', 'hub', 1),
      planNode(2, 'small', 'arena', 2),
      planNode(3, 'small', 'objective', 2),
    ],
    [
      planNode(0, 'small', 'entry', 0),
      planNode(1, 'large', 'hub', 1),
      planNode(2, 'wide', 'arena', 2),
      planNode(3, 'small', 'treasure', 2),
      planNode(4, 'small', 'objective', 3),
    ],
    [
      planNode(0, 'small', 'entry', 0),
      planNode(1, 'large', 'hub', 1),
      planNode(2, 'wide', 'arena', 2),
      planNode(3, 'large', 'landmark', 3),
      planNode(4, 'wide', 'objective', 4),
      planNode(5, 'small', 'treasure', 3),
    ],
  ];
  const edges: readonly (readonly CaveRoomPlanEdge[])[] = [
    [{ a: 0, b: 1, kind: 'critical' }],
    [
      { a: 0, b: 1, kind: 'critical' },
      { a: 1, b: 3, kind: 'critical' },
      { a: 1, b: 2, kind: 'branch' },
    ],
    [
      { a: 0, b: 1, kind: 'critical' },
      { a: 1, b: 2, kind: 'critical' },
      { a: 2, b: 4, kind: 'critical' },
      { a: 1, b: 3, kind: 'branch' },
    ],
    [
      { a: 0, b: 1, kind: 'critical' },
      { a: 1, b: 2, kind: 'critical' },
      { a: 2, b: 3, kind: 'critical' },
      { a: 3, b: 4, kind: 'critical' },
      { a: 2, b: 5, kind: 'branch' },
      { a: 5, b: 3, kind: 'loop' },
    ],
  ];
  const criticalPath = [
    [0, 1],
    [0, 1, 3],
    [0, 1, 2, 4],
    [0, 1, 2, 3, 4],
  ] as const;
  return {
    nodes: nodes[tier]!,
    edges: edges[tier]!,
    entry: 0,
    objective: criticalPath[tier]!.at(-1)!,
    criticalPath: criticalPath[tier]!,
  };
}

function caveRoomSize(kind: CaveRoomKind, turn: number): readonly [number, number] {
  const [width, depth] = ROOM_SIZE[kind];
  return turn % 2 === 0 ? [width, depth] : [depth, width];
}

function caveRoomFootprint(room: CaveRoom): Cell[] {
  const [width, depth] = caveRoomSize(room.kind, room.turn);
  const cells: Cell[] = [];
  for (let z = room.z - (depth - 1) / 2; z <= room.z + (depth - 1) / 2; z++) {
    for (let x = room.x - (width - 1) / 2; x <= room.x + (width - 1) / 2; x++) cells.push({ x, z });
  }
  return cells;
}

/** Прямоугольный footprint совпадает с готовой оболочкой Kenney. */
function carveRoom(size: number, floor: Uint8Array, room: CaveRoom): void {
  for (const cell of caveRoomFootprint(room)) floor[idx(size, cell.x, cell.z)] = 1;
}

const EDGE_DIRS = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
] as const;

function layoutHash(seed: number, x: number, z: number, salt: number): number {
  let n = (seed ^ Math.imul(x + 0x51ed, 0x9e3779b1) ^ Math.imul(z + 0x7f4a, 0x85ebca77) ^ salt) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
}

/** Число проходимых соседей по четырём сторонам. */
function degree(size: number, blocked: Uint8Array, x: number, z: number): number {
  let n = 0;
  for (const [dx, dz] of NEIGHBORS_4) {
    if (inBounds(size, x + dx, z + dz) && !blocked[idx(size, x + dx, z + dz)]) n++;
  }
  return n;
}

interface RoomBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function roomBounds(room: CaveRoom): RoomBounds {
  const [width, depth] = caveRoomSize(room.kind, room.turn);
  return {
    minX: room.x - (width - 1) / 2,
    maxX: room.x + (width - 1) / 2,
    minZ: room.z - (depth - 1) / 2,
    maxZ: room.z + (depth - 1) / 2,
  };
}

function roomsApart(a: CaveRoom, b: CaveRoom, gap: number): boolean {
  const aa = roomBounds(a);
  const bb = roomBounds(b);
  return aa.maxX + gap < bb.minX || bb.maxX + gap < aa.minX
    || aa.maxZ + gap < bb.minZ || bb.maxZ + gap < aa.minZ;
}

function placeRoom(
  size: number,
  node: CaveRoomPlanNode,
  placed: readonly (CaveRoom | undefined)[],
  graph: CaveRoomGraph,
  rng: Rng,
): CaveRoom | null {
  const kind = node.kind;
  const anchors = graph.edges
    .filter((edge) => edge.a === node.id || edge.b === node.id)
    .map((edge) => edge.a === node.id ? edge.b : edge.a)
    .map((other) => placed[other])
    .filter((room): room is CaveRoom => room !== undefined);
  const existing = placed.filter((room): room is CaveRoom => room !== undefined);
  const criticalAt = graph.criticalPath.indexOf(node.id);
  const criticalParent = criticalAt > 0 ? placed[graph.criticalPath[criticalAt - 1]!] : undefined;
  const targetStep = size <= 8 ? 3 : Math.max(5, Math.ceil(size / 3) + 1);
  const candidates: { room: CaveRoom; score: number }[] = [];
  for (let turn = 0; turn < (kind === 'wide' ? 2 : 1); turn++) {
    const [width, depth] = caveRoomSize(kind, turn);
    for (let z = 1 + (depth - 1) / 2; z <= size - 2 - (depth - 1) / 2; z++) {
      for (let x = 1 + (width - 1) / 2; x <= size - 2 - (width - 1) / 2; x++) {
        const room: CaveRoom = {
          nodeId: node.id,
          kind,
          role: node.role,
          x,
          z,
          turn: turn as 0 | 1,
        };
        const gap = size <= 8 ? 0 : 1;
        if (existing.some((other) => !roomsApart(other, room, gap))) continue;
        const nearest = Math.min(...existing.map((other) => Math.abs(other.x - x) + Math.abs(other.z - z)));
        const anchorError = anchors.reduce((sum, anchor) => (
          sum + Math.abs(Math.abs(anchor.x - x) + Math.abs(anchor.z - z) - targetStep)
        ), 0);
        const entryDistance = Math.abs(placed[0]!.x - x) + Math.abs(placed[0]!.z - z);
        const desiredDepth = Math.min((size - 4) * 2, node.criticalDepth * targetStep);
        const depthError = Math.abs(entryDistance - desiredDepth);
        const parentEntryDistance = criticalParent === undefined ? 0
          : Math.abs(placed[0]!.x - criticalParent.x) + Math.abs(placed[0]!.z - criticalParent.z);
        const progressShortfall = criticalParent === undefined ? 0 : Math.max(0, parentEntryDistance + 2 - entryDistance);
        // Соседние в плане комнаты держатся на разумной дистанции, а узлы
        // критического пути последовательно уходят от входа. Небольшой бонус
        // разнесения не даёт залам собраться одной тесной гроздью.
        const score = -anchorError * 0x100000 - depthError * 0x10000 - progressShortfall * 0x400000
          + nearest * 0x1000 + randInt(rng, 0x1000);
        candidates.push({ room, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length === 0) return null;
  const band = size <= 8 ? 0.5 : 0.03;
  return candidates[randInt(rng, Math.max(1, Math.ceil(candidates.length * band)))]!.room;
}

function doorToward(room: CaveRoom, target: Cell): { readonly door: Cell; readonly outside: Cell } {
  const box = roomBounds(room);
  const dx = target.x - room.x;
  const dz = target.z - room.z;
  if (Math.abs(dx) >= Math.abs(dz)) {
    const sign = dx >= 0 ? 1 : -1;
    const door = { x: sign > 0 ? box.maxX : box.minX, z: Math.max(box.minZ, Math.min(box.maxZ, target.z)) };
    return { door, outside: { x: door.x + sign, z: door.z } };
  }
  const sign = dz >= 0 ? 1 : -1;
  const door = { x: Math.max(box.minX, Math.min(box.maxX, target.x)), z: sign > 0 ? box.maxZ : box.minZ };
  return { door, outside: { x: door.x, z: door.z + sign } };
}

/** Парные сокеты: при перекрывающихся проекциях обе двери стоят на одной оси. */
function doorsBetween(
  a: CaveRoom,
  b: CaveRoom,
): {
  readonly from: { readonly door: Cell; readonly outside: Cell };
  readonly to: { readonly door: Cell; readonly outside: Cell };
} {
  const aa = roomBounds(a);
  const bb = roomBounds(b);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (Math.abs(dx) >= Math.abs(dz)) {
    const sign = dx >= 0 ? 1 : -1;
    const low = Math.max(aa.minZ, bb.minZ);
    const high = Math.min(aa.maxZ, bb.maxZ);
    if (low <= high) {
      const z = Math.max(low, Math.min(high, Math.round((a.z + b.z) / 2)));
      const fromDoor = { x: sign > 0 ? aa.maxX : aa.minX, z };
      const toDoor = { x: sign > 0 ? bb.minX : bb.maxX, z };
      return {
        from: { door: fromDoor, outside: { x: fromDoor.x + sign, z } },
        to: { door: toDoor, outside: { x: toDoor.x - sign, z } },
      };
    }
  } else {
    const sign = dz >= 0 ? 1 : -1;
    const low = Math.max(aa.minX, bb.minX);
    const high = Math.min(aa.maxX, bb.maxX);
    if (low <= high) {
      const x = Math.max(low, Math.min(high, Math.round((a.x + b.x) / 2)));
      const fromDoor = { x, z: sign > 0 ? aa.maxZ : aa.minZ };
      const toDoor = { x, z: sign > 0 ? bb.minZ : bb.maxZ };
      return {
        from: { door: fromDoor, outside: { x, z: fromDoor.z + sign } },
        to: { door: toDoor, outside: { x, z: toDoor.z - sign } },
      };
    }
  }
  return { from: doorToward(a, b), to: doorToward(b, a) };
}

interface CorridorRouteNode {
  readonly key: number;
  readonly cell: number;
  readonly dir: number;
  readonly run: number;
  readonly turns: number;
  readonly cost: number;
  readonly estimate: number;
}

function pushRouteNode(heap: CorridorRouteNode[], node: CorridorRouteNode): void {
  heap.push(node);
  let at = heap.length - 1;
  while (at > 0) {
    const parent = (at - 1) >> 1;
    if (heap[parent]!.estimate <= node.estimate) break;
    heap[at] = heap[parent]!;
    at = parent;
  }
  heap[at] = node;
}

function popRouteNode(heap: CorridorRouteNode[]): CorridorRouteNode | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (first === undefined || last === undefined || heap.length === 0) return first;
  let at = 0;
  while (true) {
    const left = at * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && heap[right]!.estimate < heap[left]!.estimate ? right : left;
    if (heap[child]!.estimate >= last.estimate) break;
    heap[at] = heap[child]!;
    at = child;
  }
  heap[at] = last;
  return first;
}

function adjacentMaskCells(size: number, cell: number, mask: ReadonlySet<number> | undefined): number {
  if (mask === undefined) return 0;
  const x = cell % size;
  const z = (cell / size) | 0;
  let count = 0;
  for (const [dx, dz] of EDGE_DIRS) {
    if (mask.has(idx(size, x + dx, z + dz))) count++;
  }
  return count;
}

/**
 * Направленный A*: в отличие от BFS он оценивает не только длину, но и
 * читаемость тоннеля. Два-три прямых плеча дешевле частой лесенки; слишком
 * длинная прямая, касание стены комнаты и параллельный готовому ход дороже.
 */
export function caveCorridorPath(
  size: number,
  from: Cell,
  to: Cell,
  forbiddenMask: ReadonlySet<number>,
  salt: number,
  corridorMask?: ReadonlySet<number>,
  roomMask?: ReadonlySet<number>,
  allowCorridorCrossing = false,
): Cell[] | null {
  const start = idx(size, from.x, from.z);
  const goal = idx(size, to.x, to.z);
  if (start === goal) return [from];
  const RUN_CAP = 8;
  const TURN_CAP = 3;
  const TURN_STATES = TURN_CAP + 1;
  const stride = 4 * RUN_CAP * TURN_STATES;
  const stateKey = (cell: number, dir: number, run: number, turns: number): number => (
    ((cell * 4 + dir) * RUN_CAP + run - 1) * TURN_STATES + turns
  );
  const best = new Map<number, number>();
  const previous = new Map<number, number>();
  const heap: CorridorRouteNode[] = [];
  let goalKey = -1;

  const offer = (
    cell: number,
    dir: number,
    run: number,
    turns: number,
    cost: number,
    parent: number,
  ): void => {
    const key = stateKey(cell, dir, run, turns);
    if (cost >= (best.get(key) ?? Number.POSITIVE_INFINITY)) return;
    best.set(key, cost);
    previous.set(key, parent);
    const x = cell % size;
    const z = (cell / size) | 0;
    pushRouteNode(heap, {
      key, cell, dir, run, turns, cost,
      estimate: cost + (Math.abs(to.x - x) + Math.abs(to.z - z)) * 100,
    });
  };

  for (let dir = 0; dir < 4; dir++) {
    const [dx, dz] = EDGE_DIRS[dir]!;
    const nx = from.x + dx;
    const nz = from.z + dz;
    if (nx < 1 || nz < 1 || nx >= size - 1 || nz >= size - 1) continue;
    const next = idx(size, nx, nz);
    if (next !== goal && (forbiddenMask.has(next) || (!allowCorridorCrossing && corridorMask?.has(next)))) continue;
    const nearRoom = adjacentMaskCells(size, next, roomMask);
    const nearCorridor = adjacentMaskCells(size, next, corridorMask);
    const cost = 100 + nearRoom * 120 + nearCorridor * 95 + (layoutHash(salt, nx, nz, dir) & 7);
    offer(next, dir, 1, 0, cost, -1);
  }

  while (heap.length > 0) {
    const current = popRouteNode(heap)!;
    if (current.cost !== best.get(current.key)) continue;
    if (current.cell === goal) {
      goalKey = current.key;
      break;
    }
    const x = current.cell % size;
    const z = (current.cell / size) | 0;
    for (let dir = 0; dir < 4; dir++) {
      if (dir === ((current.dir + 2) & 3)) continue;
      const [dx, dz] = EDGE_DIRS[dir]!;
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 1 || nz < 1 || nx >= size - 1 || nz >= size - 1) continue;
      const next = idx(size, nx, nz);
      if (next !== goal && (forbiddenMask.has(next) || (!allowCorridorCrossing && corridorMask?.has(next)))) continue;
      const turned = dir !== current.dir;
      const turns = Math.min(TURN_CAP, current.turns + (turned ? 1 : 0));
      const run = turned ? 1 : Math.min(RUN_CAP, current.run + 1);
      const turnCost = turned ? (current.turns < 2 ? 115 : 360) : 0;
      const longStraightCost = !turned && current.run >= 6 ? 60 : 0;
      const nearRoom = adjacentMaskCells(size, next, roomMask);
      const nearCorridor = adjacentMaskCells(size, next, corridorMask);
      const crossingCost = corridorMask?.has(next) ? 900 : 0;
      const cost = current.cost + 100 + turnCost + longStraightCost
        + nearRoom * 120 + nearCorridor * 95 + crossingCost
        + (layoutHash(salt, nx, nz, dir + turns * 17) & 7);
      offer(next, dir, run, turns, cost, current.key);
    }
  }
  // Существующий проход нельзя пересекать без причины: такое пересечение
  // молча добавляет случайный цикл. Если он действительно рассёк всю породу,
  // второй проход разрешает стык и карта всё равно остаётся связной.
  if (goalKey < 0 && corridorMask !== undefined && !allowCorridorCrossing) {
    return caveCorridorPath(size, from, to, forbiddenMask, salt, corridorMask, roomMask, true);
  }
  if (goalKey < 0) return null;
  const path: Cell[] = [];
  for (let at = goalKey; at >= 0; at = previous.get(at) ?? -1) {
    const cell = Math.floor(at / stride);
    path.push({ x: cell % size, z: (cell / size) | 0 });
  }
  path.push(from);
  path.reverse();
  return path.filter((cell, at) => at === 0 || cell.x !== path[at - 1]!.x || cell.z !== path[at - 1]!.z);
}

/** Манхэттенский distance transform: 0 — готовый пол, дальше — глубина породы. */
function caveRockDistance(size: number, floor: Uint8Array): Int16Array {
  const distance = new Int16Array(size * size).fill(-1);
  const queue = new Int32Array(size * size);
  let tail = 0;
  for (let cell = 0; cell < floor.length; cell++) {
    if (!floor[cell]) continue;
    distance[cell] = 0;
    queue[tail++] = cell;
  }
  for (let head = 0; head < tail; head++) {
    const cell = queue[head]!;
    const x = cell % size;
    const z = (cell / size) | 0;
    for (const [dx, dz] of EDGE_DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      if (!inBounds(size, nx, nz)) continue;
      const next = idx(size, nx, nz);
      if (distance[next] >= 0) continue;
      distance[next] = distance[cell]! + 1;
      queue[tail++] = next;
    }
  }
  return distance;
}

function caveValueNoise(seed: number, x: number, z: number, scale: number, salt: number): number {
  const gx = Math.floor(x / scale);
  const gz = Math.floor(z / scale);
  const fx0 = x / scale - gx;
  const fz0 = z / scale - gz;
  const fx = fx0 * fx0 * (3 - 2 * fx0);
  const fz = fz0 * fz0 * (3 - 2 * fz0);
  const sample = (sx: number, sz: number): number => (
    (layoutHash(seed, sx, sz, salt) & 0xffff) / 0x7fff - 1
  );
  const north = sample(gx, gz) * (1 - fx) + sample(gx + 1, gz) * fx;
  const south = sample(gx, gz + 1) * (1 - fx) + sample(gx + 1, gz + 1) * fx;
  return north * (1 - fz) + south * fz;
}

function caveGeologyNoise(seed: number, x: number, z: number): number {
  return caveValueNoise(seed, x, z, 4, 0x6a09e667) * 0.7
    + caveValueNoise(seed, x, z, 9, 0xbb67ae85) * 0.3;
}

/**
 * Геология идёт только после комнат и связей. Она выедает короткие ниши и
 * локальные расширения из первого слоя породы, но каждая новая клетка имеет
 * ровно одного открытого соседа. Поэтому постпроцесс не соединяет маршруты,
 * не создаёт случайных дверей и не меняет смысловой граф.
 */
export function shapeCaveGeology(
  seed: number,
  tier: Tier,
  size: number,
  floor: Uint8Array,
  rooms: readonly CaveRoom[],
  secrets: readonly CaveSecretRoom[],
): Cell[] {
  if (tier < 2) return [];
  const base = Uint8Array.from(floor);
  const rockDistance = caveRockDistance(size, base);
  const roomAt = new Int16Array(size * size).fill(-1);
  for (const room of rooms) for (const cell of caveRoomFootprint(room)) {
    roomAt[idx(size, cell.x, cell.z)] = room.nodeId;
  }
  const protectedRock = new Set<number>();
  for (const secret of secrets) for (const cell of caveRoomFootprint(secret)) {
    protectedRock.add(idx(size, cell.x, cell.z));
    for (const [dx, dz] of EDGE_DIRS) {
      if (inBounds(size, cell.x + dx, cell.z + dz)) protectedRock.add(idx(size, cell.x + dx, cell.z + dz));
    }
  }
  const openNeighbors = (cell: number, source: Uint8Array): number[] => {
    const x = cell % size;
    const z = (cell / size) | 0;
    const out: number[] = [];
    for (const [dx, dz] of EDGE_DIRS) {
      const next = idx(size, x + dx, z + dz);
      if (source[next]) out.push(next);
    }
    return out;
  };
  const candidates: { cell: number; score: number }[] = [];
  for (let z = 1; z < size - 1; z++) for (let x = 1; x < size - 1; x++) {
    const cell = idx(size, x, z);
    if (base[cell] || rockDistance[cell] !== 1 || protectedRock.has(cell)) continue;
    const neighbors = openNeighbors(cell, base);
    if (neighbors.length !== 1) continue;
    const anchor = neighbors[0]!;
    const roomBonus = roomAt[anchor]! >= 0 ? 0.12 : 0;
    candidates.push({
      cell,
      score: caveGeologyNoise(seed, x, z) + roomBonus + (layoutHash(seed, x, z, 0x3c6ef372) & 255) / 4096,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const originalOpen = base.reduce((sum, open) => sum + (open ? 1 : 0), 0);
  const budget = Math.max(2, Math.round(originalOpen * (tier === 3 ? 0.075 : 0.06)));
  const carved = new Set<number>();
  let added = 0;
  for (const candidate of candidates) {
    if (added >= budget) break;
    const mouth = candidate.cell;
    if (adjacentMaskCells(size, mouth, carved) > 0) continue;
    const neighbors = openNeighbors(mouth, floor);
    if (neighbors.length !== 1) continue;
    floor[mouth] = 1;
    carved.add(mouth);
    added++;

    // Сильный непрерывный шум иногда углубляет нишу ещё на клетку. Это даёт
    // карманы в породе, но остаётся тупиковым отростком того же маршрута.
    if (added >= budget || candidate.score < 0.42) continue;
    const anchor = neighbors[0]!;
    const mx = mouth % size;
    const mz = (mouth / size) | 0;
    const ax = anchor % size;
    const az = (anchor / size) | 0;
    const dx = mx - ax;
    const dz = mz - az;
    const deepX = mx + dx;
    const deepZ = mz + dz;
    if (deepX < 1 || deepZ < 1 || deepX >= size - 1 || deepZ >= size - 1) continue;
    const deep = idx(size, deepX, deepZ);
    if (floor[deep] || rockDistance[deep] !== 2 || protectedRock.has(deep)) continue;
    if (openNeighbors(deep, floor).length !== 1) continue;
    floor[deep] = 1;
    carved.add(deep);
    added++;
  }
  return [...carved].map((cell) => ({ x: cell % size, z: (cell / size) | 0 }));
}

function carveConnection(
  size: number,
  floor: Uint8Array,
  rooms: readonly CaveRoom[],
  a: CaveRoom,
  b: CaveRoom,
  salt: number,
): void {
  const { from, to } = doorsBetween(a, b);
  const roomMask = new Set(rooms.flatMap((room) => caveRoomFootprint(room).map((cell) => idx(size, cell.x, cell.z))));
  const routeMask = new Set(roomMask);
  // Проходы обходят внешний пояс каждой комнаты. Иначе коридор к одному
  // узлу может задеть бок другого зала и молча создать незапланированную
  // дверь, цикл или срез критического маршрута.
  for (const room of rooms) {
    // У двух соединяемых залов допускаем короткий подход вдоль собственной
    // стены: когда двери стоят по диагонали через клетку, иначе пояс сам
    // замыкает единственный возможный путь. Чужих комнат это не касается.
    if (room === a || room === b) continue;
    for (const cell of caveRoomFootprint(room)) {
      for (const [dx, dz] of EDGE_DIRS) {
        if (inBounds(size, cell.x + dx, cell.z + dz)) routeMask.add(idx(size, cell.x + dx, cell.z + dz));
      }
    }
  }
  routeMask.delete(idx(size, from.outside.x, from.outside.z));
  routeMask.delete(idx(size, to.outside.x, to.outside.z));
  const corridorMask = new Set<number>();
  for (let cell = 0; cell < floor.length; cell++) {
    if (floor[cell] !== 0 && !roomMask.has(cell)) corridorMask.add(cell);
  }
  corridorMask.delete(idx(size, from.outside.x, from.outside.z));
  corridorMask.delete(idx(size, to.outside.x, to.outside.z));
  const path = caveCorridorPath(size, from.outside, to.outside, routeMask, salt, corridorMask, roomMask);
  floor[idx(size, from.door.x, from.door.z)] = 1;
  floor[idx(size, to.door.x, to.door.z)] = 1;
  for (const cell of path ?? [from.outside, to.outside]) floor[idx(size, cell.x, cell.z)] = 1;
}

type RoomEdge = readonly [number, number];
type Triangle = readonly [number, number, number];

function circleContains(points: readonly Cell[], triangle: Triangle, point: Cell): boolean {
  const a = points[triangle[0]]!;
  const b = points[triangle[1]]!;
  const c = points[triangle[2]]!;
  const d = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
  if (Math.abs(d) < 1e-8) return false;
  const aa = a.x * a.x + a.z * a.z;
  const bb = b.x * b.x + b.z * b.z;
  const cc = c.x * c.x + c.z * c.z;
  const ux = (aa * (b.z - c.z) + bb * (c.z - a.z) + cc * (a.z - b.z)) / d;
  const uz = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d;
  const radius2 = (ux - a.x) ** 2 + (uz - a.z) ** 2;
  const distance2 = (ux - point.x) ** 2 + (uz - point.z) ** 2;
  return distance2 <= radius2 + 1e-7;
}

/**
 * Bowyer–Watson: комнаты становятся вершинами триангуляции Делоне. Это
 * ограничивает возможные связи геометрически близкими соседями и не даёт
 * графу соединять два далёких зала сквозь всю карту только из-за броска RNG.
 */
export function delaunayRoomEdges(rooms: readonly CaveRoom[]): RoomEdge[] {
  if (rooms.length < 2) return [];
  if (rooms.length === 2) return [[0, 1]];
  const centers: Cell[] = rooms.map(({ x, z }) => ({ x, z }));
  const xs = centers.map((p) => p.x);
  const zs = centers.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const span = Math.max(1, maxX - minX, maxZ - minZ);
  const superAt = centers.length;
  centers.push(
    { x: minX - span * 16, z: minZ - span * 4 },
    { x: maxX + span * 16, z: minZ - span * 4 },
    { x: (minX + maxX) / 2, z: maxZ + span * 16 },
  );
  let triangles: Triangle[] = [[superAt, superAt + 1, superAt + 2]];

  for (let pointAt = 0; pointAt < rooms.length; pointAt++) {
    const bad = triangles.filter((triangle) => circleContains(centers, triangle, centers[pointAt]!));
    const edgeCount = new Map<string, { edge: RoomEdge; count: number }>();
    for (const triangle of bad) {
      const edges: RoomEdge[] = [
        [triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]],
      ];
      for (const edge of edges) {
        const sorted: RoomEdge = edge[0] < edge[1] ? edge : [edge[1], edge[0]];
        const key = `${sorted[0]}:${sorted[1]}`;
        const old = edgeCount.get(key);
        edgeCount.set(key, { edge: sorted, count: (old?.count ?? 0) + 1 });
      }
    }
    const removed = new Set(bad);
    triangles = triangles.filter((triangle) => !removed.has(triangle));
    for (const { edge, count } of edgeCount.values()) {
      if (count === 1) triangles.push([edge[0], edge[1], pointAt]);
    }
  }

  const edges = new Map<string, RoomEdge>();
  for (const triangle of triangles) {
    if (triangle.some((at) => at >= rooms.length)) continue;
    for (const raw of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]] as RoomEdge[]) {
      const edge: RoomEdge = raw[0] < raw[1] ? raw : [raw[1], raw[0]];
      edges.set(`${edge[0]}:${edge[1]}`, edge);
    }
  }
  return [...edges.values()];
}

function carveRoomNetwork(
  size: number,
  floor: Uint8Array,
  rng: Rng,
  tier: Tier,
  evac: Cell,
): { readonly graph: CaveRoomGraph; readonly rooms: CaveRoom[]; readonly secrets: CaveSecretRoom[] } {
  const graph = buildCaveRoomGraph(tier);
  const entryNode = graph.nodes[graph.entry]!;
  const entry: CaveRoom = {
    nodeId: entryNode.id,
    kind: entryNode.kind,
    role: entryNode.role,
    x: 2,
    z: 2,
    turn: 0,
  };
  const placed: (CaveRoom | undefined)[] = [entry];
  // Сначала резервируем весь критический маршрут. Боковой зал не имеет
  // права занять единственное глубокое место и вытолкнуть цель обратно.
  const placementOrder = [
    ...graph.criticalPath.slice(1),
    ...graph.nodes.map((node) => node.id).filter((id) => !graph.criticalPath.includes(id)),
  ];
  for (const nodeId of placementOrder) {
    const node = graph.nodes[nodeId]!;
    const room = placeRoom(size, node, placed, graph, rng);
    if (room !== null) placed[node.id] = room;
  }
  const rooms = placed.filter((room): room is CaveRoom => room !== undefined);

  for (const room of rooms) carveRoom(size, floor, room);

  // Делоне остаётся геометрическим контролем качества: плановые связи,
  // попавшие в триангуляцию, гарантированно соединяют близких соседей.
  // Но автором топологии теперь является смысловой граф, а не геометрия.
  const triangulation = delaunayRoomEdges(rooms);
  const spatialEdges = new Set(triangulation.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`));
  const graphEdges = new Set<string>();
  const treeEdges = graph.edges.filter((edge) => edge.kind !== 'loop');
  for (const edge of treeEdges) {
    const key = `${Math.min(edge.a, edge.b)}:${Math.max(edge.a, edge.b)}`;
    const spatialSalt = spatialEdges.has(key) ? 0x200 : 0x600;
    carveConnection(size, floor, rooms, rooms[edge.a]!, rooms[edge.b]!, spatialSalt + edge.a * 17 + edge.b * 31);
    graphEdges.add(key);
  }

  for (const edge of graph.edges.filter((candidate) => candidate.kind === 'loop')) {
    const trial = Uint8Array.from(floor);
    carveConnection(size, trial, rooms, rooms[edge.a]!, rooms[edge.b]!, 0x400 + edge.a * 17 + edge.b * 31);
    const trialBlocked = trial.map((open) => open ? 0 : 1);
    const trialBack = distanceField(size, trialBlocked, evac);
    // Дополнительный обход не покупается ценой перепадов: если цикл съел
    // один из двух мостов Дна, пробуем следующее ребро или остаёмся с остовом.
    const wantedStairs = tier < 2 ? 0 : tier === 3 ? 2 : 1;
    if (reserveCaveStairs(0, tier, size, trialBlocked, trialBack, rooms, []).length < wantedStairs) continue;
    floor.set(trial);
    graphEdges.add(`${Math.min(edge.a, edge.b)}:${Math.max(edge.a, edge.b)}`);
  }

  const secrets: CaveSecretRoom[] = [];
  if (tier >= 2) {
    const candidates: {
      room: CaveRoom;
      source: CaveRoom;
      dir: 0 | 1 | 2 | 3;
      gate: Cell;
      before: Cell;
      lateral: readonly Cell[];
      from: { readonly door: Cell; readonly outside: Cell };
      path: readonly Cell[];
      score: number;
    }[] = [];
    for (let z = 2; z < size - 2; z++) for (let x = 2; x < size - 2; x++) {
      const room: CaveRoom = { nodeId: -1, kind: 'small', role: 'secret', x, z, turn: 0 };
      const footprint = caveRoomFootprint(room);
      if (footprint.some((cell) => floor[idx(size, cell.x, cell.z)] !== 0)) continue;
      const sources = rooms.slice(1);
      const source = sources.reduce((best, old) => (
        Math.abs(old.x - x) + Math.abs(old.z - z) < Math.abs(best.x - x) + Math.abs(best.z - z) ? old : best
      ), sources[0]!);
      for (let dir = 0; dir < 4; dir++) {
        const [dx, dz] = EDGE_DIRS[dir]!;
        const gate = { x: x - dx * 2, z: z - dz * 2 };
        const before = { x: gate.x - dx, z: gate.z - dz };
        if (before.x < 1 || before.z < 1 || before.x >= size - 1 || before.z >= size - 1) continue;
        const left = EDGE_DIRS[(dir + 1) & 3]!;
        const right = EDGE_DIRS[(dir + 3) & 3]!;
        const lateral = [
          { x: gate.x + left[0], z: gate.z + left[1] },
          { x: gate.x + right[0], z: gate.z + right[1] },
        ];
        if ([gate, before, ...lateral].some((cell) => floor[idx(size, cell.x, cell.z)] !== 0)) continue;
        const from = doorToward(source, before);
        const mask = new Set(rooms.flatMap((old) => caveRoomFootprint(old).map((cell) => idx(size, cell.x, cell.z))));
        for (const cell of [...footprint, ...lateral, gate]) mask.add(idx(size, cell.x, cell.z));
        if (mask.has(idx(size, from.outside.x, from.outside.z))) continue;
        const path = caveCorridorPath(size, from.outside, before, mask, 0x7331 + tier + x * 7 + z * 11 + dir * 13);
        if (path === null) continue;
        candidates.push({
          room, source, dir: dir as 0 | 1 | 2 | 3, gate, before, lateral, from, path,
          score: (Math.abs(x - evac.x) + Math.abs(z - evac.z)) * 0x10000 + randInt(rng, 0x10000),
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates[0];
    if (chosen !== undefined) {
      const { room, dir, gate, from, path } = chosen;
      floor[idx(size, from.door.x, from.door.z)] = 1;
      for (const cell of path) floor[idx(size, cell.x, cell.z)] = 1;
      floor[idx(size, gate.x, gate.z)] = 1;
      secrets.push({ ...room, turn: dir, gate, dir });
    }
  }

  // Выход — часть входной комнаты, не отдельная клякса или хвост коридора.
  floor[idx(size, evac.x, evac.z)] = 1;
  return { graph, rooms, secrets };
}

function cellsBeyondBridge(
  size: number,
  blocked: Uint8Array,
  low: Cell,
  high: Cell,
): Set<number> | null {
  const start = idx(size, high.x, high.z);
  const stop = idx(size, low.x, low.z);
  const seen = new Set<number>([start]);
  const queue = [start];
  for (let at = 0; at < queue.length; at++) {
    const cell = queue[at]!;
    if (cell === stop) return null;
    const x = cell % size;
    const z = (cell / size) | 0;
    for (const [dx, dz] of EDGE_DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      if (!inBounds(size, nx, nz) || blocked[idx(size, nx, nz)] !== 0) continue;
      if ((x === low.x && z === low.z && nx === high.x && nz === high.z)
        || (x === high.x && z === high.z && nx === low.x && nz === low.z)) continue;
      const next = idx(size, nx, nz);
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function reserveCaveStairs(
  seed: number,
  tier: Tier,
  size: number,
  blocked: Uint8Array,
  backSteps: Int32Array,
  rooms: readonly CaveRoom[],
  secrets: readonly CaveSecretRoom[],
): CaveStairHint[] {
  if (tier < 2) return [];
  const roomCells = new Set(rooms.flatMap((room) => caveRoomFootprint(room).map((cell) => idx(size, cell.x, cell.z))));
  const forbidden = new Set(secrets.map((room) => idx(size, room.gate.x, room.gate.z)));
  const candidates: { hint: CaveStairHint; depth: number; score: number }[] = [];
  for (let z = 1; z < size - 1; z++) for (let x = 1; x < size - 1; x++) {
    if (blocked[idx(size, x, z)] !== 0) continue;
    const low: Cell = { x, z };
    const lowAt = idx(size, x, z);
    const lowDepth = backSteps[lowAt]!;
    if (lowDepth < 3 || forbidden.has(lowAt)) continue;
    for (let dir = 0; dir < 4; dir++) {
      const [dx, dz] = EDGE_DIRS[dir]!;
      const high: Cell = { x: x + dx, z: z + dz };
      const highAt = idx(size, high.x, high.z);
      if (blocked[highAt] !== 0 || backSteps[highAt]! <= lowDepth || forbidden.has(highAt)) continue;
      if (cellsBeyondBridge(size, blocked, low, high) === null) continue;
      const roomPenalty = roomCells.has(lowAt) || roomCells.has(highAt) ? 0x10000000 : 0;
      candidates.push({
        hint: { low, high, dir: dir as 0 | 1 | 2 | 3 },
        depth: lowDepth,
        score: lowDepth * 0x100000 + (layoutHash(seed, x, z, 0x7720) & 0xfffff) - roomPenalty,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const wanted = tier === 3 ? 2 : 1;
  const picked: typeof candidates = [];
  const occupied = new Set<number>();
  const take = (separate: boolean): void => {
    for (const candidate of candidates) {
      if (picked.length >= wanted) break;
      const lowAt = idx(size, candidate.hint.low.x, candidate.hint.low.z);
      const highAt = idx(size, candidate.hint.high.x, candidate.hint.high.z);
      if (occupied.has(lowAt) || occupied.has(highAt)) continue;
      if (separate && picked.some((old) => Math.abs(old.depth - candidate.depth) < 4)) continue;
      picked.push(candidate);
      occupied.add(lowAt);
      occupied.add(highAt);
    }
  };
  take(true);
  take(false);
  return picked.map((candidate) => candidate.hint);
}

export const CAVE_LAYOUT_CANDIDATES = 12;

interface CaveLayoutCandidate {
  readonly at: number;
  readonly floor: Uint8Array;
  readonly blocked: Uint8Array;
  readonly backSteps: Int32Array;
  readonly network: ReturnType<typeof carveRoomNetwork>;
  readonly stairHints: readonly CaveStairHint[];
  /** Проходимые визуальные ниши: содержимое остаётся на структурном полу. */
  readonly geology: readonly Cell[];
  readonly valid: boolean;
  readonly score: number;
}

const MIN_CAVE_DEPTH = [7, 14, 21, 28] as const;
const TARGET_OPEN_SHARE = [0.28, 0.31, 0.3, 0.29] as const;
const CANDIDATE_IMPROVEMENT_GATE = [80, 300, 400, 120] as const;

/**
 * Жёсткие правила сначала отбрасывают сломанные варианты. Среди оставшихся
 * выигрывает не самая большая карта, а та, где цель глубока, смысловые связи
 * локальны, боковая ветвь начинается не у входа и площадь близка к бюджету.
 */
function scoreCaveLayout(
  seed: number,
  tier: Tier,
  size: number,
  evac: Cell,
  at: number,
  floor: Uint8Array,
  network: ReturnType<typeof carveRoomNetwork>,
  geology: readonly Cell[],
): CaveLayoutCandidate {
  const blocked = floor.map((open) => open ? 0 : 1);
  const backSteps = distanceField(size, blocked, evac);
  const wantedStairs = tier < 2 ? 0 : tier === 2 ? 1 : 2;
  const stairHints = reserveCaveStairs(seed, tier, size, blocked, backSteps, network.rooms, network.secrets);
  const graph = network.graph;
  const criticalDepths = graph.criticalPath.map((nodeId) => {
    const room = network.rooms[nodeId];
    return room === undefined ? -1 : backSteps[idx(size, room.x, room.z)]!;
  });
  const maxDepth = Math.max(...backSteps);
  const objectiveDepth = criticalDepths.at(-1) ?? -1;
  const openCells = floor.reduce((sum, open) => sum + (open ? 1 : 0), 0);
  const openShare = openCells / floor.length;

  let failures = 0;
  if (network.rooms.length !== graph.nodes.length) failures++;
  if (tier >= 2 ? network.secrets.length !== 1 : network.secrets.length !== 0) failures++;
  if (stairHints.length !== wantedStairs) failures++;
  if (maxDepth < MIN_CAVE_DEPTH[tier]!) failures++;
  if (objectiveDepth < maxDepth * 0.6) failures++;
  if (criticalDepths.some((depth, i) => depth < 0 || (i > 0 && depth < criticalDepths[i - 1]!))) failures++;
  for (let cell = 0; cell < floor.length; cell++) {
    if (floor[cell] && backSteps[cell] < 0) {
      failures++;
      break;
    }
  }
  for (let edge = 0; edge < size; edge++) {
    if (floor[idx(size, edge, 0)] || floor[idx(size, edge, size - 1)]
      || floor[idx(size, 0, edge)] || floor[idx(size, size - 1, edge)]) {
      failures++;
      break;
    }
  }

  const triangulation = new Set(delaunayRoomEdges(network.rooms).map(([a, b]) => (
    `${Math.min(a, b)}:${Math.max(a, b)}`
  )));
  let delaunayFit = 0;
  let edgeError = 0;
  const targetEdge = size <= 8 ? 3 : Math.max(5, Math.ceil(size / 3) + 1);
  for (const edge of graph.edges) {
    const a = network.rooms[edge.a];
    const b = network.rooms[edge.b];
    if (a === undefined || b === undefined) continue;
    if (triangulation.has(`${Math.min(edge.a, edge.b)}:${Math.max(edge.a, edge.b)}`)) delaunayFit++;
    edgeError += Math.abs(Math.abs(a.x - b.x) + Math.abs(a.z - b.z) - targetEdge);
  }

  const critical = new Set(graph.criticalPath);
  const branchDepths = graph.nodes
    .filter((node) => !critical.has(node.id))
    .map((node) => {
      const room = network.rooms[node.id];
      return room === undefined ? 0 : backSteps[idx(size, room.x, room.z)]!;
    });
  const branchError = branchDepths.reduce((sum, depth) => sum + Math.abs(depth - maxDepth * 0.6), 0);
  const progress = criticalDepths.length < 2 ? objectiveDepth
    : criticalDepths.slice(1).reduce((sum, depth, i) => sum + Math.max(0, depth - criticalDepths[i]!), 0);
  const objectiveRatio = maxDepth > 0 ? objectiveDepth / maxDepth : 0;

  const softScore = Math.round(
    objectiveRatio * 1400
    + objectiveDepth * 35
    + progress * 25
    + delaunayFit * 160
    - edgeError * 18
    - branchError * 12
    - Math.abs(openShare - TARGET_OPEN_SHARE[tier]!) * 5000,
  ) + (layoutHash(seed, at, tier, 0x19e3779b) & 0x3f);
  return {
    at,
    floor,
    blocked,
    backSteps,
    network,
    stairHints,
    geology,
    valid: failures === 0,
    score: softScore - failures * 1_000_000,
  };
}

function chooseCaveLayout(seed: number, tier: Tier, size: number, evac: Cell): {
  readonly chosen: CaveLayoutCandidate;
  readonly choice: CaveGenerationChoice;
} {
  const contentSeed = seed ^ (tier * 0x9e3779b9);
  const candidates: CaveLayoutCandidate[] = [];
  for (let at = 0; at < CAVE_LAYOUT_CANDIDATES; at++) {
    const layoutSeed = at === 0
      ? contentSeed ^ 0x6d2b79f5
      : layoutHash(contentSeed, at, tier, 0x45d9f3b);
    const floor = new Uint8Array(size * size);
    const network = carveRoomNetwork(size, floor, mulberry32(layoutSeed), tier, evac);
    const geology = shapeCaveGeology(layoutSeed, tier, size, floor, network.rooms, network.secrets);
    candidates.push(scoreCaveLayout(seed, tier, size, evac, at, floor, network, geology));
  }
  // №0 — стабильная геометрия прежнего генератора. Альтернатива обязана
  // выиграть у неё с заметным запасом, иначе мелкая разница оценки не стоит
  // смены знакомой карты. Бонус участвует только в конкурсе, не в геометрии.
  const selectionScores = candidates.map((candidate) => (
    candidate.score + (candidate.at === 0 ? CANDIDATE_IMPROVEMENT_GATE[tier]! : 0)
  ));
  const chosen = candidates.reduce((best, candidate) => (
    selectionScores[candidate.at]! > selectionScores[best.at]! ? candidate : best
  ));
  return {
    chosen,
    choice: {
      evaluated: candidates.length,
      selected: chosen.at,
      scores: selectionScores,
      valid: candidates.filter((candidate) => candidate.valid).length,
    },
  };
}

/**
 * @param lootMul множитель содержимого контейнеров: истощение локации
 *   на карте мира (§4). По умолчанию 1 — вылазка вне карты (пролог, замеры,
 *   золотой мастер) обязана считаться ровно так, как её калибровали (§20.3).
 */
export function generateLocation(
  seed: number,
  tier: Tier,
  lootMul = 1,
  /**
   * Множитель числа противников от события (§11.6). Единица по умолчанию:
   * бот, калибровка §20.3 и золотой мастер считают локацию без событий.
   * Роспись состава при этом не меняется — ростер яруса повторяется по кругу,
   * то есть «врагов больше» значит «тех же больше», а не «пришли другие».
   */
  enemyMul = 1,
  /**
   * §22.6б — номер захода на ярус: первые `SOFT_TIER_VISITS` встречают тела
   * уровнем ниже. По умолчанию бесконечность — полная сила: пролог, замеры
   * и золотой мастер без счётчика считаются по зрелому ярусу.
   */
  visit = Infinity,
): GameLocation {
  const size = TIER_SIZE[tier];
  // Выход в углу: «путь назад» обязан расти вместе с глубиной захода,
  // а из центра карты любая точка одинаково близка.
  const evac: Cell = { x: 1, z: 1 };
  const contentSeed = seed ^ (tier * 0x9e3779b9);
  // Форма и содержимое получают независимые потоки: новый поворот карты не
  // должен молча перебрасывать вид добычи, засаду и состав противников.
  const rng = mulberry32(contentSeed);

  const layout = chooseCaveLayout(seed, tier, size, evac);
  const network = layout.chosen.network;
  const caveGeneration = layout.choice;
  const caveGeology = layout.chosen.geology;
  const caveRoomGraph = network.graph;
  const caveRooms = network.rooms;
  const caveSecretRooms = network.secrets;

  const blocked = Uint8Array.from(layout.chosen.blocked);

  // Страховка: недостижимое замуровывается. Добыча в кармане, куда нет прохода,
  // читается игроком как баг генератора, а не как решение.
  const reach = distanceField(size, blocked, evac);
  for (let i = 0; i < size * size; i++) if (reach[i] === -1) blocked[i] = 1;

  const backSteps = distanceField(size, blocked, evac);
  const caveStairHints = layout.chosen.stairHints;
  const geologicalNiches = new Set(layout.chosen.geology.map((cell) => idx(size, cell.x, cell.z)));
  const reservedStairCells = new Set<number>(caveStairHints.flatMap((hint) => [
    idx(size, hint.low.x, hint.low.z), idx(size, hint.high.x, hint.high.z),
  ]));
  const open: number[] = [];
  for (let i = 0; i < size * size; i++) {
    if (!blocked[i] && backSteps[i]! > 2 && !geologicalNiches.has(i)) open.push(i);
  }
  open.sort((a, b) => backSteps[b]! - backSteps[a]!);

  const taken = new Set<number>(reservedStairCells);
  const takeFrom = (pool: readonly number[], reject?: (cell: number) => boolean): number | null => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const c = pool[randInt(rng, pool.length)];
      if (c === undefined || taken.has(c)) continue;
      if (reject !== undefined && reject(c)) continue;
      taken.add(c);
      return c;
    }
    return null;
  };

  // Тупики — главная приманка: заход туда стоит вдвое, и добыча в них
  // должна это оправдывать.
  const deadEnds = open.filter((i) => degree(size, blocked, i % size, (i / size) | 0) === 1);
  const chokes = open.filter((i) => {
    const d = degree(size, blocked, i % size, (i / size) | 0);
    return d === 2 && backSteps[i]! > 4;
  });

  const containers: Container[] = [];
  const containerCount = TIER_CONTAINERS[tier];
  const maxBack = open.length > 0 ? backSteps[open[0]!]! : 0;

  for (let i = 0; i < containerCount; i++) {
    // Половина находок — в тупиках, остальные полосами по всей глубине:
    // у игрока должна быть и дешёвая добыча по пути, и дорогая в стороне.
    const useDeadEnd = deadEnds.length > 0 && i % 2 === 0;
    const lo = Math.floor((open.length * i) / containerCount);
    const hi = Math.max(lo + 1, Math.floor((open.length * (i + 1)) / containerCount));
    const cell = useDeadEnd ? takeFrom(deadEnds) : takeFrom(open.slice(lo, hi));
    if (cell === null) continue;
    // §12.1: ценность — функция глубины, а не случайное число по ярусу.
    const depth = maxBack > 0 ? backSteps[cell]! / maxBack : 0;
    const scale = 1 + (TIER_DEPTH_VALUE[tier] - 1) * depth;
    // Истощение множит содержимое, а не выбрасывает контейнеры: пустая
    // локация читалась бы как сломанная, а бедная — как выработанная.
    const full = Math.round(TIER_CONTAINER_BASE[tier] * scale) + randInt(rng, 3) - 1;
    const amount = Math.max(1, Math.round(full * lootMul));
    containers.push({
      id: i,
      x: cell % size,
      z: (cell / size) | 0,
      amount,
      kind: rollLoot(rng, tier),
      opened: false,
    });
  }

  // Ларец не добавляет добычу поверх росписи: он заменяет самую глубокую
  // обычную находку. Отдельный RNG в `supplyBoxAt` не переставляет карту.
  if (supplyBoxAt(seed, tier, visit) && containers.length > 0) {
    let deepest = 0;
    for (let i = 1; i < containers.length; i++) {
      const a = containers[i]!;
      const b = containers[deepest]!;
      if (backSteps[idx(size, a.x, a.z)]! > backSteps[idx(size, b.x, b.z)]!) deepest = i;
    }
    containers[deepest] = { ...containers[deepest]!, look: 'сундук', supply: true };
  }

  /**
   * Золотой сундук (§13.6) — редкая находка яруса 3, и только его: выше
   * уровня игра пока не знает, а ниже кристалл не лежит. «Иногда» — меньше
   * половины заходов: сундук обязан оставаться событием, а не строкой
   * росписи. Стоит в глубокой части, как всё дорогое (§12.1), кристаллом —
   * единственным ресурсом, которого нет в обычной росписи contained яруса.
   *
   * Цена написана не на карточке, а в засаде: вскрытие поднимает из земли
   * 1–3 скелетов-воинов (`Container.ambush`, спавн — `raid.ts`). Сундук
   * закрыт крышкой — единственный контейнер, не показывающий содержимого, —
   * и это честно: что внутри, известно (кристалл), неизвестна цена.
   */
  if (tier === 3 && rng() < GOLD_CHEST_CHANCE) {
    // Сначала тупик, но тупики к этому ходу обычно разобраны находками —
    // тогда глубокая треть локации: «редкий» обязан значить «бросок выше»,
    // а не «бросок выше и повезло с клеткой».
    const cell =
      takeFrom(deadEnds) ?? takeFrom(open.slice(0, Math.max(1, Math.ceil(open.length * 0.3))));
    if (cell !== null) {
      containers.push({
        id: containerCount,
        x: cell % size,
        z: (cell / size) | 0,
        amount: Math.max(1, Math.round((4 + randInt(rng, 3)) * lootMul)),
        kind: 'crystal',
        opened: false,
        look: 'золотой',
        ambush: { kind: 'warrior', count: 1 + randInt(rng, 3) },
      });
    }
  }

  // «Обходится по кругу» — обещание, которое обязано выполняться: узкий
  // проход годится магу только если обход существует. Замер ловил обратное
  // как 80 смертей от мага на ярусе 3: он вставал в единственный проход,
  // и обойти его было нельзя — только умереть об него.
  const mageChokes =
    TIER_ROSTER[tier].includes('mage')
      ? chokes.filter((c) => hasDetour(size, blocked, evac, containers, c % size, (c / size) | 0))
      : chokes;

  /**
   * §15 — маг перекрывает маршрут, но не отрезает его. Разница существенная:
   * узкий проход, который можно обойти кругом, — это решение; единственный
   * проход к добыче — это стена, притворяющаяся врагом.
   *
   * Клетка проверяется: если, замуровав зону мага 3×3, хоть один контейнер
   * становится недостижим от выхода, клетка отбрасывается.
   */
  const mageBlocksLoot = (cell: number): boolean => {
    const walled = Uint8Array.from(blocked);
    const gx = cell % size;
    const gz = (cell / size) | 0;
    for (let z = gz - 1; z <= gz + 1; z++) {
      for (let x = gx - 1; x <= gx + 1; x++) {
        if (inBounds(size, x, z)) walled[idx(size, x, z)] = 1;
      }
    }
    const reach = distanceField(size, walled, evac);
    return containers.some((c) => reach[idx(size, c.x, c.z)]! < 0);
  };

  /**
   * §11.3 — **риск обязан расти с глубиной**, и ставится это здесь, а не
   * настраивается числами боя.
   *
   * Находки раскладывались полосами по глубине с самого начала, а противники
   * брались из всей локации подряд — то есть с равной вероятностью вставали
   * и у входа. Замер показал, чем это кончается: гибли на трети локации,
   * возвращались с половины, дальше выходило безопаснее, чем ближе. Решение
   * «глубже или назад» (§22.5) принимал не игрок, а встреча у входа —
   * и вся ставка §11.2 обещала не то, что берёт.
   *
   * Поэтому противники берутся из глубокой части, как и находки. Мелкая
   * часть остаётся дорогой внутрь: там игрок решает, идти ли дальше,
   * а не отбивается.
   *
   * Доля назначена не на глаз — она подобрана `npm run measure` по вердикту
   * §11.3 «провал глубже половины локации» и меняется вместе с ним.
   */
  // Доля отдельная для каждого графа: одинаковая геометрическая полоса при
  // разном числе ветвей даёт разную фактическую частоту встреч.
  const enemyDepthShare = ENEMY_DEPTH_SHARE[tier];
  const deep = open.slice(0, Math.max(1, Math.ceil(open.length * enemyDepthShare)));

  const enemies: Enemy[] = [];
  const roster = TIER_ROSTER[tier];
  const count = Math.max(0, Math.round(roster.length * enemyMul));
  const scaled = Array.from({ length: count }, (_, i) => roster[i % roster.length]!);
  // §22.6 — ярус задаёт уровень тел, статы уровня считает enemyStats;
  // первые заходы смягчены (§22.6б).
  const level = tierEnemyLevel(tier, visit);
  scaled.forEach((kind, i) => {
    const enemyLevel = i === 0 && visit >= SOFT_TIER_VISITS
      ? level + MATURE_LEAD_LEVEL_BONUS[tier]
      : level;
    const stats = enemyStats(kind, enemyLevel);
    // §15 — маг перекрывает маршрут, а не гонится. Значит его место
    // в узком проходе: там обход стоит шагов, а прорыв — ран.
    // Проходы для мага фильтруются по той же глубине: узкий проход у входа
    // перекрывает не маршрут, а вход, и обходить его игроку ещё нечем.
    const deepChokes = mageChokes.filter((c) => deep.includes(c));
    const pool = kind === 'mage' && deepChokes.length > 0 ? deepChokes : deep;
    const cell =
      kind === 'mage'
        ? takeFrom(pool, mageBlocksLoot) ?? takeFrom(deep, mageBlocksLoot)
        : takeFrom(pool);
    if (cell === null) return;
    const x = cell % size;
    const z = (cell / size) | 0;
    enemies.push({
      id: i,
      kind,
      level: enemyLevel,
      x,
      z,
      prevX: x,
      prevZ: z,
      hp: stats.hp,
      awake: false,
      telegraph: 0,
      cooldown: 0,
    });
  });

  /**
   * §11.3 — **глубина охраняется.** Обычное тело переносится в последнюю
   * значимую полосу и получает `BOTTOM_GUARD_LEVELS` к уровню. На компактных
   * картах это дно; на Дне — примерно 78%, куда осторожный игрок ещё доходит.
   *
   * Это ответ на вторую половину главного правила боя: павшие не могут быть
   * мельче дошедших, пока гибель распределена по глубокой части ровно.
   * Глубина дошедшего обрывается на его пределе — провиантом или рюкзаком, —
   * поэтому средняя гибель обязана приходиться **дальше** этого предела,
   * а туда доходят не все. Сильное тело в глубокой полосе делает последний
   * значимый шаг решением, а не формальностью.
   *
   * Тело переносится, а не добавляется: число врагов задаёт бюджет ран (§22),
   * и вставлять сюда лишнего значило бы тратить бюджет, которого прибор
   * не выделял.
   *
   * Маг стражем не становится (§15): его место — узкий проход, где обход
   * существует, а глубокая комната таким проходом не является.
   */
  const guardCandidates = enemies
    .map((e, i) => ({ i, back: backSteps[idx(size, e.x, e.z)] ?? 0, kind: e.kind }))
    .filter((e) => e.kind !== 'mage')
    .sort((a, b) => a.back - b.back);
  // На ветвящемся ярусе 2 берём тело из ближней трети: перенос сдвигает
  // угрозу к цели, но не вычищает весь ранний риск. На остальных ярусах
  // сохраняем прежнего глубочайшего кандидата.
  const guarded = BOTTOM_GUARD_LEVELS[tier] <= 0 ? undefined
    : tier === 2 ? guardCandidates[Math.floor((guardCandidates.length - 1) / 3)] : guardCandidates.at(-1);
  const containerCells = new Set(containers.map((c) => idx(size, c.x, c.z)));
  const deepest = Math.max(...backSteps);
  // На Дне абсолютный хвост длиннее предела осторожного игрока. Страж там
  // не участвует в ставке вообще, поэтому он встречает игрока в глубокой
  // полосе около 78%, не у входа и не за обычной точкой возврата.
  const guardPool = tier === 3
    ? open.filter((cell) => backSteps[cell]! <= deepest * 0.78)
    : open;
  const guardCell = guardPool.find((cell) => !containerCells.has(cell) && !reservedStairCells.has(cell));
  if (guarded !== undefined && guardCell !== undefined) {
    const was = enemies[guarded.i]!;
    const lvl = Math.max(1, tierEnemyLevel(tier, visit) + BOTTOM_GUARD_LEVELS[tier]);
    const x = guardCell % size;
    const z = (guardCell / size) | 0;
    enemies[guarded.i] = {
      ...was,
      level: lvl,
      hp: enemyStats(was.kind, lvl).hp,
      x,
      z,
      prevX: x,
      prevZ: z,
    };
  }

  /**
   * Валуны (§13.4) — последними и от своего потока случайности. Порядок
   * здесь не вкусовщина: подмешавшись в общий `rng`, камни сдвинули бы
   * всё, что бросается после них, и золотой мастер разошёлся бы с прежним
   * на локациях, где ничего, кроме камней, не менялось.
   *
   * Клетки находок и противников исключены. Валун их не загораживает —
   * он не занимает клетку, — но тап по такой клетке стал бы спорным:
   * игрок целился в добычу, а герой взялся за кайло.
   */
  const busy = new Set<number>([
    idx(size, evac.x, evac.z),
    ...reservedStairCells,
    ...containers.map((c) => idx(size, c.x, c.z)),
    ...enemies.map((e) => idx(size, e.x, e.z)),
  ]);
  const stones = scatterStones(
    seed ^ (tier * 0x2545f491),
    size,
    blocked,
    STONES.raid[tier]!,
    (x, z) => !busy.has(idx(size, x, z)),
  );

  const loc: GameLocation = {
    seed, tier, size, blocked, caveRoomGraph, caveGeneration, caveGeology, caveRooms, caveSecretRooms, caveStairHints,
    evac, containers, stones, enemies, backSteps,
  };
  return { ...loc, enemyPatrols: buildDungeonEnemyPatrols(loc) };
}

/**
 * Есть ли путь в обход клетки: перекрываем её вместе с ближайшими соседями
 * (маг занимает не точку, а зону досягаемости) и проверяем, что от точки
 * возвращения по-прежнему достижим каждый контейнер.
 */
function hasDetour(
  size: number,
  blocked: Uint8Array,
  evac: Cell,
  containers: readonly Container[],
  gx: number,
  gz: number,
): boolean {
  const walled = Uint8Array.from(blocked);
  for (let z = gz - 1; z <= gz + 1; z++) {
    for (let x = gx - 1; x <= gx + 1; x++) {
      if (inBounds(size, x, z)) walled[idx(size, x, z)] = 1;
    }
  }
  if (walled[idx(size, evac.x, evac.z)]) return false;
  const reach = distanceField(size, walled, evac);
  return containers.every((c) => reach[idx(size, c.x, c.z)]! >= 0);
}

/** Проходимые соседи клетки — нужен генератору и отладке. */
export function walkableNeighbors(loc: GameLocation, x: number, z: number): number {
  return degree(loc.size, loc.blocked, x, z);
}
