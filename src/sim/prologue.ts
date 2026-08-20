/**
 * Пролог: поляна, по которой герой бродит, пока не кончится провиант.
 *
 * Это не вылазка. Здесь нет ни противников, ни контейнеров, ни выхода:
 * провиант перестаёт быть бюджетом на дорогу назад (§11.1) и работает
 * часами — единственной механикой, которую кадр обязан показать до того,
 * как игрок впервые увидит лагерь.
 *
 * Возвращается обычная GameLocation, потому что ходьба, шаг и расход
 * провианта уже написаны в `raid.ts`: пролог отличается от вылазки
 * содержимым локации, а не правилами движения по ней.
 */
import { mulberry32 } from '../core/rng';
import { distanceField, idx } from './grid';
import type { Cell, GameLocation } from './types';

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
 * это то, что герой унёс с собой. Двадцать шагов — кадр на одну механику,
 * его длину меряет `scripts/measure.ts`, а не эта строка.
 */
export const GLADE_FOOD = 20;

export const gladeFood = (): number => GLADE_FOOD;

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
    containers: [],
    enemies: [],
    backSteps: distanceField(size, blocked, start),
  };
}

/**
 * Куда показать точку тапа в прологе. В вылазке её ставит `firstTapCell`
 * по ближайшему контейнеру — на поляне контейнеров нет, поэтому берётся
 * просто клетка в трёх шагах: жест обязан быть показан, а куда идти,
 * игрок здесь решает сам.
 */
export function firstGladeCell(loc: GameLocation, from: Cell): Cell | null {
  const dist = distanceField(loc.size, loc.blocked, {
    x: Math.round(from.x),
    z: Math.round(from.z),
  });
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
