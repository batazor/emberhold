import { mulberry32, randInt } from '../core/rng';
import { TIER_CONTAINER_BASE, TIER_DEPTH_VALUE, TIER_SIZE } from './config';
import { ENEMY_STATS, TIER_ROSTER } from './enemies';
import { distanceField, idx, inBounds, NEIGHBORS_4 } from './grid';
import { rollLoot } from './resources';
import type { Cell, Container, Enemy, GameLocation, Tier } from './types';

/**
 * Локация целиком выводится из пары (seed, tier) — никаких скрытых состояний.
 * Это условие воспроизводимости багов из §6 и будущей серверной валидации.
 */
/**
 * Раскладка камней одной попытки. Вынесена отдельно, потому что попыток может
 * быть несколько: см. generateLocation.
 */
function carveBlocked(size: number, tier: Tier, evac: Cell, rng: () => number, density: number): Uint8Array {
  const blocked = new Uint8Array(size * size);
  const clusters = Math.round(size * size * density);
  for (let i = 0; i < clusters; i++) {
    const cx = randInt(rng, size);
    const cz = randInt(rng, size);
    const radius = 1 + randInt(rng, tier >= 2 ? 2 : 1);
    for (let z = cz - radius; z <= cz + radius; z++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (!inBounds(size, x, z)) continue;
        if (Math.hypot(x - cx, z - cz) > radius + rng() * 0.5) continue;
        blocked[idx(size, x, z)] = 1;
      }
    }
  }

  for (let i = 0; i < size; i++) {
    blocked[idx(size, i, 0)] = 1;
    blocked[idx(size, i, size - 1)] = 1;
    blocked[idx(size, 0, i)] = 1;
    blocked[idx(size, size - 1, i)] = 1;
  }
  for (let z = evac.z - 1; z <= evac.z + 1; z++) {
    for (let x = evac.x - 1; x <= evac.x + 1; x++) {
      if (inBounds(size, x, z) && x > 0 && z > 0 && x < size - 1 && z < size - 1) {
        blocked[idx(size, x, z)] = 0;
      }
    }
  }
  return blocked;
}

/** Доля проходимых клеток внутри рамки, достижимых от эвакуации. */
function reachableShare(size: number, blocked: Uint8Array, evac: Cell): number {
  const dist = distanceField(size, blocked, evac);
  let reachable = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i]! >= 0) reachable++;
  const inner = (size - 2) * (size - 2);
  return reachable / inner;
}

/**
 * Локация целиком выводится из пары (seed, tier) — никаких скрытых состояний.
 * Это условие воспроизводимости багов из §6 и будущей серверной валидации.
 *
 * Плотность камней подбирается попытками: на малых картах (§11.1: ярус 0 — это
 * всего 8×8) один неудачный кластер запечатывает эвакуацию, и после отсечения
 * недостижимого локация превращается в глухой карман. Проверять долю
 * достижимого дешевле, чем ловить это как баг генератора у игрока.
 */
export function generateLocation(seed: number, tier: Tier): GameLocation {
  const size = TIER_SIZE[tier];
  // Эвакуация в углу: «путь назад» обязан расти вместе с глубиной захода,
  // а из центра карты любая точка одинаково близка.
  const evac: Cell = { x: 1, z: 1 };
  const MIN_SHARE = 0.45;

  let rng = mulberry32(seed ^ (tier * 0x9e3779b9));
  let blocked = carveBlocked(size, tier, evac, rng, 0.06);
  for (let attempt = 0; attempt < 8; attempt++) {
    // Каждая попытка — свой поток чисел, иначе повтор даёт ту же раскладку.
    rng = mulberry32((seed ^ (tier * 0x9e3779b9)) + attempt * 0x85ebca6b);
    const density = 0.06 - attempt * 0.007;
    blocked = carveBlocked(size, tier, evac, rng, Math.max(0.015, density));
    if (reachableShare(size, blocked, evac) >= MIN_SHARE) break;
  }

  // Недостижимые клетки замуровываются: добыча в кармане, куда нет прохода,
  // читается игроком как баг генератора, а не как решение.
  const reachable = distanceField(size, blocked, evac);
  for (let i = 0; i < size * size; i++) {
    if (reachable[i] === -1) blocked[i] = 1;
  }

  const backSteps = distanceField(size, blocked, evac);
  const open: number[] = [];
  for (let i = 0; i < size * size; i++) {
    if (!blocked[i] && backSteps[i]! > 2) open.push(i);
  }
  // Дальние клетки — первыми: и добыча, и враги должны стоять там, куда идти
  // страшно, иначе глубина ничего не значит.
  open.sort((a, b) => backSteps[b]! - backSteps[a]!);

  const containers: Container[] = [];
  const containerCount = 3 + tier * 2;
  const enemies: Enemy[] = [];
  const roster = TIER_ROSTER[tier];

  const taken = new Set<number>();
  const takeCell = (poolFrom: number, poolTo: number): number | null => {
    const span = Math.max(1, poolTo - poolFrom);
    for (let attempt = 0; attempt < 40; attempt++) {
      const c = open[poolFrom + randInt(rng, span)];
      if (c === undefined || taken.has(c)) continue;
      taken.add(c);
      return c;
    }
    return null;
  };

  // open отсортирован по убыванию пути назад, поэтому дальняя клетка — первая.
  const maxBack = open.length > 0 ? backSteps[open[0]!]! : 0;

  for (let i = 0; i < containerCount; i++) {
    // Полосы по всей глубине, от дальней к ближней: если все находки лежат
    // глубоко, кривая ценности не с чем сравнивается, а у игрока нет дешёвой
    // добычи, ради которой можно уйти рано. Выбор «взять мелочь и выйти»
    // обязан существовать, иначе решения об эвакуации не возникает.
    const lo = Math.floor((open.length * i) / containerCount);
    const hi = Math.floor((open.length * (i + 1)) / containerCount);
    const cell = takeCell(lo, Math.max(lo + 1, hi));
    if (cell === null) continue;
    // §12.1: ценность — функция глубины, а не случайное число по ярусу.
    // Разброс ±1 оставлен, чтобы находки не были одинаковыми, но он мельче
    // шага кривой и не смазывает её.
    const depth = maxBack > 0 ? backSteps[cell]! / maxBack : 0;
    const scale = 1 + (TIER_DEPTH_VALUE[tier] - 1) * depth;
    const amount = Math.max(1, Math.round(TIER_CONTAINER_BASE[tier] * scale) + randInt(rng, 3) - 1);
    containers.push({
      id: i,
      x: cell % size,
      z: (cell / size) | 0,
      amount,
      kind: rollLoot(rng, tier),
      opened: false,
    });
  }

  roster.forEach((kind, i) => {
    const stats = ENEMY_STATS[kind];
    const cell = takeCell(0, Math.max(1, Math.floor(open.length * 0.8)));
    if (cell === null) return;
    const x = cell % size;
    const z = (cell / size) | 0;
    enemies.push({
      id: i,
      kind,
      x,
      z,
      prevX: x,
      prevZ: z,
      wounds: stats.wounds,
      awake: false,
      telegraph: 0,
      cooldown: 0,
    });
  });

  return { seed, tier, size, blocked, evac, containers, enemies, backSteps };
}

/** Проходимые соседи клетки — нужен генератору и отладке. */
export function walkableNeighbors(loc: GameLocation, x: number, z: number): number {
  let n = 0;
  for (const [dx, dz] of NEIGHBORS_4) {
    if (inBounds(loc.size, x + dx, z + dz) && !loc.blocked[idx(loc.size, x + dx, z + dz)]) n++;
  }
  return n;
}
