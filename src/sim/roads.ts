/**
 * Дороги (§6.1.12, набор craftpix). Дорога хранится клетками — как стена
 * (§6.1.6): клетка это решение игрока или генератора, а плитка — вывод.
 * Плиток в наборе четыре формы: прямая, поворот, тройник и крест, — и какую
 * ставить в клетку, целиком решают соседи. Здесь этот вывод и живёт, один
 * на замок и лагерь: две копии автотайлинга разошлись бы молча.
 *
 * Клетка дороги — клетка стены, `CASTLE_CELL` на `CASTLE_CELL` клеток
 * локации: плитка набора по ширине хода совпадает с проездом ворот, и своя
 * сетка дала бы дорогу, которая в ворота не попадает.
 *
 * Поворот `turn` — четверть оборота в ту же сторону, в какую поворачивают
 * детали замка: рендер ставит плитку через `rotation.y = turn * π/2`
 * и ничего не досчитывает. Словарь «форма → модель набора» тоже не здесь:
 * симуляции всё равно, камень плитка или доска.
 */
import type { Spot } from './castle';

export type RoadTile = 'прямая' | 'поворот' | 'тройник' | 'крест';

export interface RoadPiece extends Spot {
  readonly tile: RoadTile;
  /** Четверти поворота, 0–3: `rotation.y = turn * π/2`. */
  readonly turn: number;
}

/**
 * Стороны клетки: север (−z), восток (+x), юг (+z), запад (−x) — в этом
 * порядке они и нумеруются. Порядок — контракт с `turnFor`: поворот на
 * четверть против часовой (как её видит `rotation.y`) сдвигает индекс на −1.
 */
const DIRS: readonly Spot[] = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];

/**
 * Куда смотрит плитка каждой формы при `turn = 0`, индексами `DIRS`.
 * Это объявление о наборе, а не вывод: прямая идёт с севера на юг,
 * поворот сворачивает с юга на восток, тройник открыт всюду, кроме севера.
 */
const OPEN: Record<RoadTile, readonly number[]> = {
  'прямая': [0, 2],
  'поворот': [1, 2],
  'тройник': [1, 2, 3],
  'крест': [0, 1, 2, 3],
};

/** Сторона после поворота на `turn` четвертей: против часовой — индекс назад. */
const rot = (dir: number, turn: number): number => (dir + 3 * turn) % 4;

/**
 * Каким поворотом форма открывается ровно в затребованные стороны;
 * −1 — никаким (форма не та). Перебор четырёх поворотов, а не таблица:
 * таблицу пришлось бы держать согласованной с `OPEN` руками.
 */
export function turnFor(tile: RoadTile, want: ReadonlySet<number>): number {
  for (let turn = 0; turn < 4; turn++) {
    const open = OPEN[tile].map((d) => rot(d, turn));
    if (open.length === want.size && open.every((d) => want.has(d))) return turn;
  }
  return -1;
}

const keyOf = (spot: Spot): string => `${spot.x}:${spot.z}`;

/**
 * Плитки по клеткам. Форму клетке выбирают соседи: четыре соседа — крест,
 * три — тройник, два напротив — прямая, два под углом — поворот. Одинокая
 * клетка и тупик — прямая вдоль того, что есть: заглушки торца в наборе
 * нет, и обрубать дорогу честнее продолжением, чем выдумкой.
 */
export function roadPieces(cells: readonly Spot[]): RoadPiece[] {
  const set = new Set(cells.map(keyOf));
  return cells.map((cell) => {
    const near = new Set<number>();
    DIRS.forEach((d, at) => {
      if (set.has(keyOf({ x: cell.x + d.x, z: cell.z + d.z }))) near.add(at);
    });

    let tile: RoadTile;
    let want = near;
    if (near.size === 4) {
      tile = 'крест';
    } else if (near.size === 3) {
      tile = 'тройник';
    } else if (near.size === 2) {
      const [a, b] = [...near] as [number, number];
      tile = (a + 2) % 4 === b ? 'прямая' : 'поворот';
    } else {
      // Один сосед или ни одного: прямая вдоль соседа, без него — на юг.
      tile = 'прямая';
      const along = near.size === 1 ? [...near][0]! : 0;
      want = new Set([along, (along + 2) % 4]);
    }

    const turn = turnFor(tile, want);
    return { x: cell.x, z: cell.z, tile, turn: turn < 0 ? 0 : turn };
  });
}
