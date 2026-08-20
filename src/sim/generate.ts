import { mulberry32, randInt } from '../core/rng';
import type { Rng } from '../core/rng';
import { TIER_CONTAINER_BASE, TIER_DEPTH_VALUE, TIER_SIZE } from './config';
import { ENEMY_STATS, TIER_ROSTER } from './enemies';
import { distanceField, idx, inBounds, NEIGHBORS_4 } from './grid';
import { rollLoot } from './resources';
import type { Cell, Container, Enemy, GameLocation, Tier } from './types';

/**
 * Локация целиком выводится из пары (seed, tier) — никаких скрытых состояний.
 * Это условие воспроизводимости багов из §6 и будущей серверной валидации.
 *
 * Форма локации подчинена единственному решению игры — идти глубже или назад,
 * — и строится из четырёх частей:
 *
 * 1. Спинной ход от эвакуации к дальнему углу. Глубина обязана быть
 *    направлением, а не следствием блужданий: без него «дальше» ничего
 *    не значит и путь назад не читается.
 * 2. Залы вдоль хода. Ориентиры: без них игрок не понимает, где был,
 *    и не может оценить, сколько прошёл.
 * 3. Ответвления в тупики. Заход в тупик стоит вдвое — туда и обратно,
 *    — и это та же жадность, что и вся игра, но в миниатюре.
 * 4. Циклы с яруса 2. Второй путь назад превращает возврат в выбор,
 *    а не в обратную перемотку.
 *
 * Прежний генератор разбрасывал случайные кляксы камня. Он давал проходимую
 * пещеру, но бесформенную: ни направления, ни развилок, ни мест, где
 * принимают решение.
 */

interface Pt {
  x: number;
  z: number;
}

/** Круглая кисть: пещера, а не коридор с прямыми углами. */
function carveDisc(size: number, floor: Uint8Array, cx: number, cz: number, r: number): void {
  const r2 = (r + 0.35) * (r + 0.35);
  for (let z = cz - r; z <= cz + r; z++) {
    for (let x = cx - r; x <= cx + r; x++) {
      // Рамка не вскрывается никогда: край карты обязан оставаться стеной.
      if (x < 1 || z < 1 || x > size - 2 || z > size - 2) continue;
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz <= r2) floor[idx(size, x, z)] = 1;
    }
  }
}

/**
 * Ход от точки к точке со случайным отклонением. Возвращает пройденные клетки:
 * они же — места, откуда потом растут ответвления.
 */
function carvePath(
  size: number,
  floor: Uint8Array,
  rng: Rng,
  from: Pt,
  to: Pt,
  radius: number,
  chamberEvery: number,
  chamberRadius: number,
): Pt[] {
  const pts: Pt[] = [];
  const cur: Pt = { x: from.x, z: from.z };
  const limit = size * 6;

  for (let step = 0; step < limit; step++) {
    carveDisc(size, floor, cur.x, cur.z, radius);
    pts.push({ x: cur.x, z: cur.z });
    if (chamberEvery > 0 && step > 0 && step % chamberEvery === 0) {
      carveDisc(size, floor, cur.x, cur.z, chamberRadius);
    }
    if (cur.x === to.x && cur.z === to.z) break;

    const dx = Math.sign(to.x - cur.x);
    const dz = Math.sign(to.z - cur.z);
    // 0.88 к цели, остальное вбок: ход виляет, но всегда приходит.
    // Чистая случайность дала бы клубок, чистая прямая — коридор.
    if (rng() < 0.88 && (dx !== 0 || dz !== 0)) {
      if (dx !== 0 && (dz === 0 || rng() < 0.5)) cur.x += dx;
      else cur.z += dz;
    } else if (rng() < 0.5) {
      cur.x += rng() < 0.5 ? 1 : -1;
    } else {
      cur.z += rng() < 0.5 ? 1 : -1;
    }
    cur.x = Math.max(1, Math.min(size - 2, cur.x));
    cur.z = Math.max(1, Math.min(size - 2, cur.z));
  }
  return pts;
}

/**
 * Сглаживание, которое только добавляет пол. Убирает одиночные зубцы стены,
 * торчащие в проход, и не может разорвать связность — в отличие от обычного
 * клеточного автомата, после которого пришлось бы чинить карту.
 */
function smoothFloor(size: number, floor: Uint8Array): void {
  const add: number[] = [];
  for (let z = 2; z < size - 2; z++) {
    for (let x = 2; x < size - 2; x++) {
      const i = idx(size, x, z);
      if (floor[i]) continue;
      let n = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          if (floor[idx(size, x + dx, z + dz)]) n++;
        }
      }
      if (n >= 7) add.push(i);
    }
  }
  for (const i of add) floor[i] = 1;
}

/** Число проходимых соседей по четырём сторонам. */
function degree(size: number, blocked: Uint8Array, x: number, z: number): number {
  let n = 0;
  for (const [dx, dz] of NEIGHBORS_4) {
    if (inBounds(size, x + dx, z + dz) && !blocked[idx(size, x + dx, z + dz)]) n++;
  }
  return n;
}

export function generateLocation(seed: number, tier: Tier): GameLocation {
  const size = TIER_SIZE[tier];
  // Эвакуация в углу: «путь назад» обязан расти вместе с глубиной захода,
  // а из центра карты любая точка одинаково близка.
  const evac: Cell = { x: 1, z: 1 };
  const rng = mulberry32(seed ^ (tier * 0x9e3779b9));

  const floor = new Uint8Array(size * size);
  const far = size - 2;

  // 1. Спинной ход. Цель — дальний угол с небольшим разбросом, чтобы дно
  //    не оказывалось каждый раз в одной точке.
  const target: Pt = {
    x: far - randInt(rng, Math.max(1, (size / 4) | 0)),
    z: far - randInt(rng, Math.max(1, (size / 4) | 0)),
  };
  const chamberEvery = tier === 0 ? 6 : 10 + randInt(rng, 5);
  const spine = carvePath(size, floor, rng, evac, target, 0, chamberEvery, tier === 0 ? 1 : 2);
  carveDisc(size, floor, target.x, target.z, tier === 3 ? 3 : 2); // дно — самый большой зал

  // 2. Ответвления. Растут из дальней половины хода: тупик у самого входа
  //    ничего не стоит и не создаёт решения.
  const branchCount = [1, 3, 5, 7][tier]!;
  const cycles = tier >= 2 ? (tier === 3 ? 2 : 1) : 0;
  for (let b = 0; b < branchCount; b++) {
    const from = spine[Math.floor(spine.length * (0.3 + rng() * 0.65))] ?? spine[spine.length - 1]!;
    if (b < cycles && spine.length > 8) {
      // Цикл: ветка уходит и возвращается на ход далеко от места старта.
      const backTo = spine[Math.floor(spine.length * (0.15 + rng() * 0.35))]!;
      carvePath(size, floor, rng, from, backTo, 0, 0, 0);
      continue;
    }
    const len = 3 + randInt(rng, 4 + tier);
    const dir = randInt(rng, 4);
    const end: Pt = {
      x: Math.max(1, Math.min(size - 2, from.x + (dir === 0 ? len : dir === 1 ? -len : 0))),
      z: Math.max(1, Math.min(size - 2, from.z + (dir === 2 ? len : dir === 3 ? -len : 0))),
    };
    carvePath(size, floor, rng, from, end, 0, 0, 0);
    // Половина тупиков заканчивается залом — там место, ради которого шли.
    // Вторая половина обрывается голым проходом: он читается как ошибка
    // маршрута, и это тоже нужно, иначе каждый тупик выглядит наградой.
    if (rng() < 0.5) carveDisc(size, floor, end.x, end.z, 1);
  }

  smoothFloor(size, floor);

  const blocked = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) blocked[i] = floor[i] ? 0 : 1;
  carveDisc(size, floor, evac.x, evac.z, 1);
  blocked[idx(size, evac.x, evac.z)] = 0;

  // Страховка: недостижимое замуровывается. Добыча в кармане, куда нет прохода,
  // читается игроком как баг генератора, а не как решение.
  const reach = distanceField(size, blocked, evac);
  for (let i = 0; i < size * size; i++) if (reach[i] === -1) blocked[i] = 1;

  const backSteps = distanceField(size, blocked, evac);
  const open: number[] = [];
  for (let i = 0; i < size * size; i++) if (!blocked[i] && backSteps[i]! > 2) open.push(i);
  open.sort((a, b) => backSteps[b]! - backSteps[a]!);

  const taken = new Set<number>();
  const takeFrom = (pool: readonly number[]): number | null => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const c = pool[randInt(rng, pool.length)];
      if (c === undefined || taken.has(c)) continue;
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
  const containerCount = 3 + tier * 2;
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

  // «Обходится по кругу» — обещание, которое обязано выполняться: узкий
  // проход годится голему только если обход существует. Замер ловил обратное
  // как 80 смертей от голема на ярусе 3: он вставал в единственный проход,
  // и обойти его было нельзя — только умереть об него.
  const golemChokes =
    TIER_ROSTER[tier].includes('golem')
      ? chokes.filter((c) => hasDetour(size, blocked, evac, containers, c % size, (c / size) | 0))
      : chokes;

  const enemies: Enemy[] = [];
  TIER_ROSTER[tier].forEach((kind, i) => {
    const stats = ENEMY_STATS[kind];
    // §15 — голем перекрывает маршрут, а не гонится. Значит его место
    // в узком проходе: там обход стоит шагов, а прорыв — ран.
    const pool = kind === 'golem' && golemChokes.length > 0 ? golemChokes : open;
    const cell = takeFrom(pool);
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

/**
 * Есть ли путь в обход клетки: перекрываем её вместе с ближайшими соседями
 * (голем занимает не точку, а зону досягаемости) и проверяем, что от точки
 * эвакуации по-прежнему достижим каждый контейнер.
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
