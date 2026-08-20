/**
 * Пролог (§16.1): поляна, по которой герой бродит, пока не кончится провиант.
 *
 * Это не вылазка. Здесь нет ни противников, ни выхода: провиант перестаёт
 * быть бюджетом на дорогу назад (§11.1) и работает часами.
 *
 * Собирать здесь есть что: на поляне лежат бруски дерева, из которых потом
 * встаёт палатка. Это второе, чему кадр учит, — «здание стоит принесённого»,
 * и учит он этому до лагеря, а не после: лагерь, выросший из ничего, научил
 * бы обратному молчанием. Подбор стоит провианта (`FOOD_COST.container`),
 * поэтому часы и сумка не спорят за внимание, а связаны: собранное видно
 * в сумке, потраченное — в полосе провианта.
 *
 * Возвращается обычная GameLocation, потому что ходьба, шаг и расход
 * провианта уже написаны в `raid.ts`: пролог отличается от вылазки
 * содержимым локации, а не правилами движения по ней.
 */
import { mulberry32 } from '../core/rng';
import { distanceField, idx } from './grid';
import type { Cell, Container, GameLocation } from './types';

/**
 * Поляна больше любой вылазки (дно — 20×20): её не проходят, по ней бродят,
 * и упереться в кромку за отпущенный провиант нельзя.
 */
export const GLADE_SIZE = 24;

/**
 * Доля клеток под деревьями. Больше — чаща, в которой некуда идти; меньше —
 * пустое поле, на котором лес не читается вовсе.
 */
const TREE_SHARE = 0.16;

/**
 * Провиант пролога. Кухни в нём ещё нет, поэтому число своё, а не из §11.1:
 * это то, что герой унёс с собой.
 *
 * Было 20 — до того, как на поляну легли бруски. Подбор стоит
 * `FOOD_COST.container` = 5, и два подбора съедали половину бюджета:
 * прогулка сокращалась вдвое, а на неудачных сидах провиант кончался
 * раньше второго бруска. Замер на 60 сидах (`prologue.rules.ts`): игрок,
 * идущий от бруска к бруску, тратит 21–31 провианта и укладывается
 * в 7,8–13,7 с. Сорок оставляет самому неудачному сиду 9 шагов запаса
 * на то, чтобы побродить, — это и есть разница между 32 и 40.
 */
export const GLADE_FOOD = 40;

export const gladeFood = (): number => GLADE_FOOD;

/**
 * Сумка в прологе. Число своё, как и провиант: Склада ещё нет, а
 * `storageCapacity(0)` — это его нулевой уровень, то есть уже лагерная
 * экономика. Здесь сумка — то, с чем герой вышел из леса.
 */
export const GLADE_BAG = 3;

export const gladeCapacity = (): number => GLADE_BAG;

/**
 * Сколько дерева уходит на палатку. Столько же брусков и лежит на поляне:
 * подсвечено ровно то, что понадобится, — иначе подсветка учит собирать
 * всё подряд, а собирать всё подряд рюкзак и не даёт.
 */
export const TENT_WOOD = 2;

/**
 * Кольцо, в котором лежат бруски: дальше — прогулка вместо подбора, ближе —
 * подбор без прогулки. Границы в шагах от старта.
 */
const LOG_NEAR = 4;
const LOG_FAR = 7;

/**
 * Поляна по сиду. Кромка — сплошной лес: уйти с поляны нельзя, и это
 * то же решение, что «вход и точка эвакуации — одно место» (§12.1) —
 * кадр обязан кончаться провиантом, а не краем карты.
 */
export function generateGlade(seed: number): GameLocation {
  const size = GLADE_SIZE;
  const rng = mulberry32(seed ^ 0x1a2b3c4d);
  const blocked = new Uint8Array(size * size);
  const start: Cell = { x: size >> 1, z: size >> 1 };

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      if (x === 0 || z === 0 || x === size - 1 || z === size - 1) {
        blocked[idx(size, x, z)] = 1;
        continue;
      }
      // Круг под ногами чист: первый тап обязан сработать в любую сторону.
      if (Math.max(Math.abs(x - start.x), Math.abs(z - start.z)) <= 1) continue;
      if (rng() < TREE_SHARE) blocked[idx(size, x, z)] = 1;
    }
  }

  // Отрезанный лесом угол — тоже лес. Иначе тап по нему оставляет героя
  // стоять на месте, и единственный жест кадра читается как поломка.
  const reach = distanceField(size, blocked, start);
  for (let i = 0; i < size * size; i++) if (reach[i] === -1) blocked[i] = 1;

  return {
    seed,
    tier: 0,
    size,
    blocked,
    evac: start,
    containers: gladeLogs(size, reach, rng),
    enemies: [],
    backSteps: distanceField(size, blocked, start),
  };
}

/**
 * Бруски на поляне. Кладутся не где попало, а в кольцо `LOG_NEAR..LOG_FAR`
 * шагов от старта: до первого нужно дойти, а не наступить на него, и оба
 * обязаны уложиться в провиант вместе с подбором — это меряется
 * в `prologue.rules.ts`, а не обещается здесь.
 *
 * Второй брусок берётся самым дальним от первого из того же кольца: два
 * бруска рядом читались бы как одна находка, и прогулки между ними
 * не случилось бы.
 */
function gladeLogs(size: number, reach: Int32Array, rng: () => number): Container[] {
  const ring: number[] = [];
  for (let i = 0; i < size * size; i++) {
    const d = reach[i]!;
    if (d >= LOG_NEAR && d <= LOG_FAR) ring.push(i);
  }
  if (ring.length === 0) return [];

  const cellOf = (i: number): Cell => ({ x: i % size, z: (i / size) | 0 });
  const first = ring[Math.floor(rng() * ring.length)]!;
  const a = cellOf(first);
  let second = first;
  let far = -1;
  for (const i of ring) {
    const c = cellOf(i);
    const d = Math.hypot(c.x - a.x, c.z - a.z);
    if (d > far) { far = d; second = i; }
  }

  const cells = second === first ? [first] : [first, second];
  return cells.slice(0, TENT_WOOD).map((i, n) => ({
    id: n,
    x: i % size,
    z: (i / size) | 0,
    // По одному бруску в находке: сумка на три и палатка за два — числа,
    // которые игрок должен сосчитать глазами, а не прочитать в полосе.
    amount: 1,
    kind: 'wood' as const,
    opened: false,
  }));
}

/**
 * Куда показать точку тапа в прологе — на ближайший несобранный брусок.
 * Раньше здесь бралась клетка в трёх шагах просто затем, чтобы жесту было
 * куда показать; теперь показывать есть на что, и кольцо ведёт к делу.
 *
 * Когда бруски кончились, кадр ещё не кончился: остаток провианта дохаживают
 * свободно, и подсказка возвращается к прежнему поведению.
 */
export function firstGladeCell(loc: GameLocation, from: Cell): Cell | null {
  const dist = distanceField(loc.size, loc.blocked, {
    x: Math.round(from.x),
    z: Math.round(from.z),
  });
  let best: Cell | null = null;
  let bestDist = Infinity;
  for (const c of loc.containers) {
    if (c.opened) continue;
    const d = dist[idx(loc.size, c.x, c.z)]!;
    if (d < 0 || d >= bestDist) continue;
    bestDist = d;
    best = { x: c.x, z: c.z };
  }
  if (best !== null) return best;

  for (let z = 0; z < loc.size; z++) {
    for (let x = 0; x < loc.size; x++) {
      if (dist[idx(loc.size, x, z)] === 3) return { x, z };
    }
  }
  return null;
}

/** Почему сюда нельзя поставить здание. 'ok' — можно. */
export type SiteBlock = 'ok' | 'tree' | 'busy' | 'hero';

/**
 * Можно ли ставить здание на клетку. Возвращается причина, а не булево,
 * по той же причине, что и в лагере (`camp.ts`): игрок должен видеть, что
 * мешает, а не молчащий красный квадрат.
 *
 * Расстояния до героя в правиле нет намеренно: лагерь ставится там, где
 * игрок решил остаться, и «слишком далеко» здесь ничего не защищает.
 */
export function siteBlock(
  loc: GameLocation,
  taken: readonly Cell[],
  hero: Cell,
  cell: Cell,
): SiteBlock {
  const { size, blocked } = loc;
  if (cell.x < 0 || cell.z < 0 || cell.x >= size || cell.z >= size) return 'tree';
  if (blocked[idx(size, cell.x, cell.z)]) return 'tree';
  if (taken.some((t) => t.x === cell.x && t.z === cell.z)) return 'busy';
  if (Math.round(hero.x) === cell.x && Math.round(hero.z) === cell.z) return 'hero';
  return 'ok';
}
