/**
 * Верх крепостной стены (§6.1.6) — второй ярус лагеря. Ходят по нему так же,
 * как по земле, но попасть туда можно **только по лестнице**.
 *
 * **Ничего нового здесь не измеряется.** Граф верха целиком выводится из того,
 * что обмер уже записал в каталог набора: у детали есть площадка (`DECK`)
 * и есть открытые рёбра (`Part.open`), а `fitTurn` при стройке повернул её так,
 * что открытые рёбра смотрят ровно на соседей. Отсюда правило проходимости
 * в одну строку: **клетка проходима поверху, если у её детали есть площадка
 * и есть хоть одно открытое ребро.**
 *
 * Из этого правила сам собой получается разрыв на башнях и воротах. У шапки
 * башни площадка есть — и она на той же высоте, что у стены, — но зубцы стоят
 * по всем четырём рёбрам, и войти на неё неоткуда. Площадка, до которой нельзя
 * дойти, — не место, и в граф она не входит.
 *
 * **Разрешение — клетки стены, а не клетки лагеря.** Клетка стены это четыре
 * клетки лагеря, и крайние из них — парапет: по ним не ходят, по ним стоят
 * зубцы. Герой идёт по осевой линии хода, то есть по середине клетки стены.
 * Заодно это готовит оборону: «на какой клетке стены стоит стрелок и куда
 * эта клетка смотрит наружу» становится координатой, а не выводом.
 *
 * **Лестница — портал, а не клетка хода.** Причина не в удобстве: лестница
 * лежит в своём словаре (`walls.stairs`), а не в `walls.cells`, и потому
 * соседняя стена её соседом не считает — она повёрнута закрытым ребром к ней.
 * Если бы связь ярусов считалась пересечением открытых рёбер, наверх нельзя
 * было бы попасть ни при какой планировке. Портал же связывает ровно то, что
 * измерено: единственное открытое ребро лестницы и клетку стены за ним.
 */
import {
  CASTLE_CELL,
  DIRS,
  buildWall,
  deckOf,
  keyOf,
  partOf,
  turnDir,
  type Spot,
} from './castle';
import { wallGrid, wallSpots, type CampWalls } from './campWalls';
import { mulberry32 } from '../core/rng';
import { idx } from './grid';
import type { Cell } from './types';

/** Ярус: земля или верх стены. Третьего нет — весь верх набора на одной высоте. */
export type Level = 'земля' | 'верх';

/**
 * Подъём на стену. Хранится тем, что связывает: клетка земли у подножия,
 * клетка стены наверху и высота, на которую поднимаются.
 */
export interface Portal {
  /** Клетка стены, в которой стоит лестница. */
  readonly stairs: Spot;
  /** Клетка лагеря у подножия — с неё заходят на лестницу. */
  readonly foot: Cell;
  /** Клетка стены, на которую выходят наверху. */
  readonly landing: Spot;
  /** Высота площадки в клетках лагеря. */
  readonly rise: number;
}

export interface WallTop {
  /** Сторона поля стены в клетках стены. */
  readonly grid: number;
  /** Занятость верха для поиска пути: 1 — по этой клетке стены не ходят. */
  readonly blocked: Uint8Array;
  /** Высота площадки в клетках лагеря; 0 там, где хода нет. */
  readonly deck: Float64Array;
  /** Открытые рёбра после поворота, битовая маска по DIRS. Задел под оборону. */
  readonly links: Uint8Array;
  /** Подъёмы. Пусто — наверх не попасть, и это нормальное состояние. */
  readonly portals: readonly Portal[];
}

/** Центр клетки стены в координатах лагеря — там же, где её рисует `CampView`. */
export const topCenter = (spot: Spot): Cell => ({
  x: spot.x * CASTLE_CELL + (CASTLE_CELL - 1) / 2,
  z: spot.z * CASTLE_CELL + (CASTLE_CELL - 1) / 2,
});

const parseKey = (key: string): Spot => {
  const [x, z] = key.split(':');
  return { x: Number(x), z: Number(z) };
};

/**
 * Верх стены по состоянию лагеря. Считается, а не хранится: стену строят
 * и сносят, и вторая копия графа разошлась бы с первой на первом же сносе.
 *
 * `ground` — занятость земли: по ней ищется свободное подножие лестницы.
 */
export function wallTop(walls: CampWalls, area: number, ground: Uint8Array): WallTop {
  const grid = wallGrid(area);
  const blocked = new Uint8Array(grid * grid).fill(1);
  // Float64, а не Float32: настил — измеренное число, и округление
  // до одной двадцатимиллионной сделало бы сверку с замером ложью.
  const deck = new Float64Array(grid * grid);
  const links = new Uint8Array(grid * grid);

  // Детали берутся у конструктора, а не у списка клеток: обещание §6.1.6 —
  // «новую деталь набора достаточно измерить» — держится только так.
  const gates = new Set(walls.gates);
  const cells = wallSpots(walls).filter((s) => !gates.has(keyOf(s)));
  const built = buildWall(cells, mulberry32(1), new Map(Object.entries(walls.towers)));

  for (const piece of built.pieces) {
    if (piece.x < 0 || piece.z < 0 || piece.x >= grid || piece.z >= grid) continue;
    const height = deckOf(piece.model);
    if (height === null) continue;
    const part = partOf(piece.model);
    if (part === undefined) continue;
    let mask = 0;
    for (let dir = 0; dir < 4; dir++) {
      if (part.open[dir] === true) mask |= 1 << turnDir(dir, piece.turn);
    }
    const at = idx(grid, piece.x, piece.z);
    // Площадка без единого открытого ребра — башня: войти на неё неоткуда.
    if (mask === 0) continue;
    links[at] = mask;
    deck[at] = (piece.y + height) * CASTLE_CELL;
    blocked[at] = 0;
  }

  const portals: Portal[] = [];
  for (const [key, turn] of Object.entries(walls.stairs)) {
    const stairs = parseKey(key);
    // Единственное открытое ребро лестницы — −z, индекс 2; после поворота
    // оно и показывает, на какую клетку стены с неё выходят.
    const up = turnDir(2, turn);
    const landing = { x: stairs.x + DIRS[up]![0], z: stairs.z + DIRS[up]![1] };
    if (landing.x < 0 || landing.z < 0 || landing.x >= grid || landing.z >= grid) continue;
    if (blocked[idx(grid, landing.x, landing.z)]) continue;

    // Подножие — клетка лагеря вплотную к противоположному ребру лестницы.
    const down = turnDir(3, turn);
    const centre = topCenter(stairs);
    const foot = {
      x: Math.round(centre.x + DIRS[down]![0] * CASTLE_CELL),
      z: Math.round(centre.z + DIRS[down]![1] * CASTLE_CELL),
    };
    if (foot.x < 0 || foot.z < 0 || foot.x >= area || foot.z >= area) continue;
    if (ground[idx(area, foot.x, foot.z)]) continue;

    portals.push({
      stairs,
      foot,
      landing,
      rise: deck[idx(grid, landing.x, landing.z)]!,
    });
  }

  return { grid, blocked, deck, links, portals };
}

/** Высота площадки клетки стены в клетках лагеря; 0 — хода нет. */
export const deckHeight = (top: WallTop, spot: Spot): number =>
  spot.x < 0 || spot.z < 0 || spot.x >= top.grid || spot.z >= top.grid
    ? 0
    : top.deck[idx(top.grid, spot.x, spot.z)]!;

/** Ходят ли по верху этой клетки. */
export const topWalkable = (top: WallTop, spot: Spot): boolean =>
  spot.x >= 0 && spot.z >= 0 && spot.x < top.grid && spot.z < top.grid
  && top.blocked[idx(top.grid, spot.x, spot.z)] === 0;

/**
 * Куда клетка стены смотрит наружу — рёбра, за которыми хода нет. Симуляции
 * это пока не нужно; заведено под оборону, ради которой верх и делается:
 * «куда стрелять со стены» обязано выводиться из обмера, а не назначаться.
 */
export function outward(top: WallTop, spot: Spot): number[] {
  if (!topWalkable(top, spot)) return [];
  const mask = top.links[idx(top.grid, spot.x, spot.z)]!;
  const out: number[] = [];
  for (let dir = 0; dir < 4; dir++) if ((mask & (1 << dir)) === 0) out.push(dir);
  return out;
}
