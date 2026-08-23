import { mulberry32, randInt, type Rng } from '../core/rng';
import { keepApart } from './crowd';
import { ENEMY_STATS } from './enemies';
import { idx, inBounds } from './grid';
import { findPath } from './pathfinding';
import type {
  Cell,
  Enemy,
  EnemyPatrol,
  EnemyPatrolLeg,
  GameLocation,
  RaidEnemyKind,
  RaidState,
} from './types';

/**
 * Реплики скелетов — событие полосы, а не диалог: они не обращаются к игроку,
 * просто выдают подземелью звук жизни, пока бой ещё не начался.
 */
export const DUNGEON_NPC_TEXT = {
  'minion-ribs': 'Скелет считает рёбра: «Раз, два, снова два»',
  'minion-teeth': 'Скелет щёлкает зубами: «Тише, страшно»',
  'minion-elbow': 'Скелет ищет локоть и делает вид, что так надо',
  'warrior-helmet': 'Скелет-воин примеряет шлем на плечо',
  'warrior-axe': 'Скелет-воин стучит топором: «Порядок костяной»',
  'warrior-vacation': 'Скелет-воин ворчит: «Каска опять ушла в отпуск»',
  'mage-spell': 'Скелет-маг бормочет: «Абрак... нет, не то»',
  'mage-square': 'Скелет-маг чертит круг и выходит квадрат',
  'mage-staff': 'Скелет-маг глядит в посох: «Опять нет связи»',
} as const;

type DungeonNpcTextId = keyof typeof DUNGEON_NPC_TEXT;

const TEXT_BY_KIND: Readonly<Record<RaidEnemyKind, readonly DungeonNpcTextId[]>> = {
  minion: ['minion-ribs', 'minion-teeth', 'minion-elbow'],
  warrior: ['warrior-helmet', 'warrior-axe', 'warrior-vacation'],
  mage: ['mage-spell', 'mage-square', 'mage-staff'],
};

export const DUNGEON_NPC_MIN_WAIT = 3.2;
const DUNGEON_NPC_RADIUS: Readonly<Record<RaidEnemyKind, number>> = {
  minion: 3,
  warrior: 3,
  mage: 2,
};

const RAID_KINDS: readonly RaidEnemyKind[] = ['minion', 'warrior', 'mage'];

function isRaidEnemyKind(kind: Enemy['kind']): kind is RaidEnemyKind {
  return RAID_KINDS.includes(kind as RaidEnemyKind);
}

function mix(value: number): number {
  let x = value | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function firstDungeonNpcLineAt(seed: number): number {
  return 6 + (mix(seed ^ 0x51a7) % 5);
}

function nextDungeonNpcLineAt(seed: number, now: number): number {
  return now + 8 + (mix(seed ^ Math.floor(now * 10) ^ 0x9c2b) % 7);
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function pathLength(from: Cell, path: readonly Cell[]): number {
  let out = 0;
  let prev = from;
  for (const cell of path) {
    out += Math.hypot(cell.x - prev.x, cell.z - prev.z);
    prev = cell;
  }
  return out;
}

function pointOn(from: Cell, path: readonly Cell[], distance: number): { readonly x: number; readonly z: number } {
  let left = distance;
  let prev = from;
  for (const cell of path) {
    const len = Math.hypot(cell.x - prev.x, cell.z - prev.z);
    if (left <= len || cell === path[path.length - 1]) {
      const t = len <= 1e-6 ? 0 : Math.min(1, Math.max(0, left / len));
      return { x: prev.x + (cell.x - prev.x) * t, z: prev.z + (cell.z - prev.z) * t };
    }
    left -= len;
    prev = cell;
  }
  return { x: prev.x, z: prev.z };
}

function endOf(leg: EnemyPatrolLeg): Cell {
  return leg.path[leg.path.length - 1] ?? leg.at;
}

function patrolSpeed(kind: RaidEnemyKind): number {
  const speed = ENEMY_STATS[kind].speed;
  return kind === 'mage' ? 0.35 : Math.max(0.5, Math.min(0.8, speed * 0.35));
}

function reservedCells(loc: GameLocation, owner: Enemy): Set<number> {
  const busy = new Set<number>([
    idx(loc.size, loc.evac.x, loc.evac.z),
    ...loc.containers.map((c) => idx(loc.size, c.x, c.z)),
    ...loc.stones.filter((s) => !s.taken).map((s) => idx(loc.size, s.x, s.z)),
  ]);
  for (const enemy of loc.enemies) {
    if (enemy.id === owner.id || enemy.hp <= 0) continue;
    busy.add(idx(loc.size, Math.round(enemy.x), Math.round(enemy.z)));
  }
  return busy;
}

function localCells(loc: GameLocation, enemy: Enemy, rng: Rng, relaxed: boolean): Cell[] {
  if (!isRaidEnemyKind(enemy.kind)) return [];
  const start = { x: Math.round(enemy.x), z: Math.round(enemy.z) };
  if (!inBounds(loc.size, start.x, start.z) || loc.blocked[idx(loc.size, start.x, start.z)]) return [];

  const radius = DUNGEON_NPC_RADIUS[enemy.kind];
  const startBack = loc.backSteps[idx(loc.size, start.x, start.z)] ?? 0;
  const busy = reservedCells(loc, enemy);
  const out: Cell[] = [];
  for (let z = start.z - radius; z <= start.z + radius; z++) {
    for (let x = start.x - radius; x <= start.x + radius; x++) {
      if (!inBounds(loc.size, x, z)) continue;
      const cell = idx(loc.size, x, z);
      if (loc.blocked[cell] || busy.has(cell)) continue;
      const back = loc.backSteps[cell] ?? -1;
      // Генератор ставит противников глубоко (§11.3); мирный обход не должен
      // выползать к выходу и превращать безопасный вход в случайную засаду.
      if (back <= 2 || back < startBack - (relaxed ? 1 : 0) || back > startBack + 2) continue;
      const dist = Math.hypot(x - start.x, z - start.z);
      if (dist < 1 || dist > radius) continue;
      out.push({ x, z });
    }
  }
  return shuffle(rng, out);
}

function routePoints(loc: GameLocation, enemy: Enemy, rng: Rng): Cell[] {
  const start = { x: Math.round(enemy.x), z: Math.round(enemy.z) };
  const picks: Cell[] = [start];
  const want = 2 + randInt(rng, 2);
  const cells = localCells(loc, enemy, rng, false);
  const candidates = cells.length > 0 ? cells : localCells(loc, enemy, rng, true);
  for (const cell of candidates) {
    if (picks.some((p) => Math.hypot(p.x - cell.x, p.z - cell.z) < 1.1)) continue;
    picks.push(cell);
    if (picks.length >= want) break;
  }
  if (picks.length < 2) return picks;
  const rest = picks.slice(1).sort((a, b) =>
    Math.atan2(a.z - start.z, a.x - start.x) - Math.atan2(b.z - start.z, b.x - start.x));
  if (rng() < 0.5) rest.reverse();
  return [start, ...rest];
}

function stationaryPatrol(loc: GameLocation, enemy: Enemy, rng: Rng): EnemyPatrol | null {
  if (!isRaidEnemyKind(enemy.kind)) return null;
  const at = { x: Math.round(enemy.x), z: Math.round(enemy.z) };
  if (!inBounds(loc.size, at.x, at.z) || loc.blocked[idx(loc.size, at.x, at.z)]) return null;
  const legs: EnemyPatrolLeg[] = Array.from({ length: 3 }, () => ({
    at,
    path: [at],
    length: 0,
    wait: DUNGEON_NPC_MIN_WAIT + rng() * 2,
  }));
  return {
    enemy: enemy.id,
    legs,
    cycle: legs.reduce((sum, leg) => sum + leg.wait, 0),
    speed: patrolSpeed(enemy.kind),
  };
}

function dungeonEnemyPatrol(loc: GameLocation, enemy: Enemy, order: number): EnemyPatrol | null {
  if (!isRaidEnemyKind(enemy.kind) || enemy.relentless === true) return null;
  const rng = mulberry32(loc.seed ^ (enemy.id * 0x9e3779b1) ^ (order * 0x85ebca6b));
  const points = routePoints(loc, enemy, rng);
  if (points.length < 2) return stationaryPatrol(loc, enemy, rng);

  const speed = patrolSpeed(enemy.kind);
  const legs: EnemyPatrolLeg[] = [];
  for (let i = 0; i < points.length; i++) {
    const at = points[i]!;
    const to = points[(i + 1) % points.length]!;
    const path = findPath(loc.size, loc.blocked, at, to);
    if (path.length === 0) continue;
    legs.push({
      at,
      path,
      length: pathLength(at, path),
      wait: DUNGEON_NPC_MIN_WAIT + rng() * 2,
    });
  }

  if (legs.length < 2) return stationaryPatrol(loc, enemy, rng);
  const cycle = legs.reduce((sum, leg) => sum + leg.length / speed + leg.wait, 0);
  return cycle > 0 ? { enemy: enemy.id, legs, cycle, speed } : null;
}

export function buildDungeonEnemyPatrols(loc: GameLocation): EnemyPatrol[] {
  const out: EnemyPatrol[] = [];
  loc.enemies.forEach((enemy, i) => {
    const patrol = dungeonEnemyPatrol(loc, enemy, i);
    if (patrol !== null) out.push(patrol);
  });
  return out;
}

export function dungeonNpcAt(patrol: EnemyPatrol, seconds: number): { readonly x: number; readonly z: number } {
  let t = ((seconds % patrol.cycle) + patrol.cycle) % patrol.cycle;
  for (const leg of patrol.legs) {
    const walk = leg.length / patrol.speed;
    if (t < walk) return pointOn(leg.at, leg.path, t * patrol.speed);
    t -= walk;
    if (t < leg.wait) return endOf(leg);
    t -= leg.wait;
  }
  const first = patrol.legs[0]!;
  return { x: first.at.x, z: first.at.z };
}

function lineFor(kind: RaidEnemyKind, seed: number, salt: number): string {
  const ids = TEXT_BY_KIND[kind];
  return DUNGEON_NPC_TEXT[ids[mix(seed ^ salt) % ids.length]!];
}

function maybeSpeak(state: RaidState): void {
  if (state.elapsed + 1e-6 < state.nextNpcLine) return;
  state.nextNpcLine = nextDungeonNpcLineAt(state.loc.seed, state.elapsed);
  if (state.events.length > 0) return;

  const limit = Math.max(4, state.vision + 2);
  const heard = state.loc.enemies.filter((enemy) => {
    if (!isRaidEnemyKind(enemy.kind) || enemy.hp <= 0 || enemy.awake || enemy.relentless === true) return false;
    return Math.hypot(enemy.x - state.hero.x, enemy.z - state.hero.z) <= limit;
  });
  if (heard.length === 0) return;

  const salt = Math.floor(state.elapsed * 10) ^ (state.steps * 0x45d9f3b);
  const speaker = heard[mix(state.loc.seed ^ salt) % heard.length]!;
  state.events.push(lineFor(speaker.kind as RaidEnemyKind, state.loc.seed, salt ^ speaker.id));
}

export function stepDungeonNpcs(state: RaidState): void {
  const patrols = state.loc.enemyPatrols;
  if (state.battle !== null || state.inFight || patrols === undefined || patrols.length === 0) return;

  const moved: Enemy[] = [];
  for (const patrol of patrols) {
    const enemy = state.loc.enemies.find((e) => e.id === patrol.enemy);
    if (
      enemy === undefined
      || !isRaidEnemyKind(enemy.kind)
      || enemy.hp <= 0
      || enemy.awake
      || enemy.relentless === true
    ) continue;

    const at = dungeonNpcAt(patrol, state.elapsed);
    enemy.prevX = enemy.x;
    enemy.prevZ = enemy.z;
    enemy.x = at.x;
    enemy.z = at.z;
    moved.push(enemy);
  }

  if (moved.length > 1) {
    const crowd = [...moved, state.hero];
    keepApart(crowd, {
      fixed: (i: number) => i === crowd.length - 1,
      free: (x: number, z: number) => {
        const rx = Math.round(x);
        const rz = Math.round(z);
        return inBounds(state.loc.size, rx, rz) && state.loc.blocked[idx(state.loc.size, rx, rz)] === 0;
      },
    });
  }

  maybeSpeak(state);
}
