/**
 * Стены лагеря (§12, §20.4) — та же стройка, что в замке (§6.1.6), но клетки
 * выбирает игрок, а не сид. Детали, повороты и высоты приходят из
 * `castle.ts`: второй копии правил стройки нет и быть не должно.
 *
 * **Сетка у стены своя, и шаг у неё два.** Это не выбор, а следствие замера:
 * деталь набора занимает две клетки лагеря (`CASTLE_CELL`), потому что иначе
 * стена выходит вровень с героем — забором, а не стеной. Отсюда и вся
 * арифметика этого файла: игрок тычет в клетку лагеря, а строится клетка
 * стены, и их не одна и та же.
 *
 * Площадь лагеря растёт со Штабом (6×6 … 10×10), поэтому и поле стены растёт:
 * 3×3 при Штабе ур. 1, 5×5 при ур. 5. Нечётный остаток площади под стену
 * не идёт — половину детали поставить некуда.
 *
 * **Что здесь не решено и решаться будет не здесь.** Чем стройка стены
 * платится, сколько идёт по времени и что стена даёт, — вопросы §12 и замера
 * (`npm run measure`), а не этого файла. Здесь стена возводится и сносится
 * мгновенно и бесплатно, и это честнее, чем поставить наугад придуманное
 * число и потом спорить с ним как с решением.
 */
import { CASTLE_CELL, TOWER_MAX, buildTower, buildWall, keyOf, type Piece, type Spot } from './castle';
import { mulberry32 } from '../core/rng';

/** Что можно поставить. Карточки панели стройки — ровно этот список. */
export type WallTool = 'стена' | 'башня' | 'ворота' | 'лестница' | 'снос';

export const WALL_TOOLS: readonly WallTool[] = ['стена', 'башня', 'ворота', 'лестница', 'снос'];

/**
 * Состояние стен лагеря. Хранится клетками, а не деталями: деталь — вывод,
 * и хранить вывод значит завести второй источник правды. Пересобрать детали
 * из клеток стоит меньше миллисекунды.
 */
export interface CampWalls {
  /** Клетки стены: ключ `keyOf`. */
  cells: string[];
  /** Клетки с башнями и их ярусы. */
  towers: Record<string, number>;
  /** Клетки с воротами. */
  gates: string[];
  /** Клетки с лестницами: ключ клетки и четверть поворота. */
  stairs: Record<string, number>;
}

export const emptyWalls = (): CampWalls => ({ cells: [], towers: {}, gates: [], stairs: {} });

/**
 * Сторона поля стены в клетках стены. Принимает площадь лагеря, а не уровень
 * Штаба: иначе `campWalls` пришлось бы знать про `camp`, а `camp` уже знает
 * про стены — и импорты сомкнулись бы в кольцо.
 */
export const wallGrid = (area: number): number => Math.floor(area / CASTLE_CELL);

/** Клетка стены по клетке лагеря — целочисленным делением, а не округлением. */
export const wallSpotOf = (x: number, z: number): Spot => ({
  x: Math.floor(x / CASTLE_CELL),
  z: Math.floor(z / CASTLE_CELL),
});

/** Левый верхний угол клетки стены в клетках лагеря. */
export const campCellOf = (spot: Spot): Spot => ({
  x: spot.x * CASTLE_CELL,
  z: spot.z * CASTLE_CELL,
});

const parse = (key: string): Spot => {
  const [x, z] = key.split(':');
  return { x: Number(x), z: Number(z) };
};

export const wallSpots = (walls: CampWalls): Spot[] => walls.cells.map(parse);

/**
 * Почему сюда нельзя. Строка, а не `false`: панель обязана сказать, что
 * не так, — «нельзя» без причины читается как поломка интерфейса.
 */
export type WallBlock = 'ok' | 'вне площади' | 'занято зданием' | 'нет стены' | 'не прямая' | 'снаружи';

/** Занята ли клетка стены зданием: здание 2×2 и клетка стены 2×2 — ровно одна. */
function onBuilding(
  spot: Spot,
  layout: Readonly<Record<string, { x: number; z: number }>>,
  levels: Readonly<Record<string, number>>,
): boolean {
  const cell = campCellOf(spot);
  for (const id of Object.keys(layout)) {
    if ((levels[id] ?? 0) <= 0) continue;
    const p = layout[id]!;
    // Пересечение двух квадратов 2×2 по клеткам лагеря.
    if (Math.abs(p.x - cell.x) < CASTLE_CELL && Math.abs(p.z - cell.z) < CASTLE_CELL) return true;
  }
  return false;
}

export interface WallSite {
  /** Площадь лагеря в клетках (§20.4): её задаёт Штаб. */
  readonly area: number;
  readonly layout: Readonly<Record<string, { x: number; z: number }>>;
  readonly levels: Readonly<Record<string, number>>;
}

/** Можно ли поставить стену в эту клетку. */
export function wallBlock(site: WallSite, spot: Spot): WallBlock {
  const grid = wallGrid(site.area);
  if (spot.x < 0 || spot.z < 0 || spot.x >= grid || spot.z >= grid) return 'вне площади';
  if (onBuilding(spot, site.layout, site.levels)) return 'занято зданием';
  return 'ok';
}

/**
 * Ворота встают только в клетку стены, у которой ровно два соседа и они
 * напротив: арка в углу упёрлась бы в поворот хода. Это то же правило,
 * которым ворота ставит генератор замка, — и оно здесь одно на двоих.
 */
export function gateBlock(walls: CampWalls, spot: Spot): WallBlock {
  const set = new Set(walls.cells);
  if (!set.has(keyOf(spot))) return 'нет стены';
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ].filter(([dx, dz]) => set.has(keyOf({ x: spot.x + dx!, z: spot.z + dz! })));
  if (dirs.length !== 2) return 'не прямая';
  const [a, b] = dirs as [number[], number[]];
  return a[0] === -b[0]! && a[1] === -b[1]! ? 'ok' : 'не прямая';
}

/** Лестница встаёт на пустую клетку, у которой есть сосед-стена. */
export function stairsBlock(walls: CampWalls, site: WallSite, spot: Spot): WallBlock {
  const set = new Set(walls.cells);
  if (set.has(keyOf(spot))) return 'занято зданием';
  if (wallBlock(site, spot) !== 'ok') return wallBlock(site, spot);
  const near = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ].some(([dx, dz]) => set.has(keyOf({ x: spot.x + dx!, z: spot.z + dz! })));
  return near ? 'ok' : 'нет стены';
}

/**
 * Мазок: клетки, через которые провели пальцем. Диагональные шаги достраиваются
 * лесенкой — сначала по x, потом по z, — потому что конструктору нужна
 * четырёхсвязная цепь, а палец ходит как угодно. Без этого стена рвалась бы
 * ровно там, где игрок вёл быстрее всего.
 */
export function strokeCells(path: readonly Spot[]): Spot[] {
  const out: Spot[] = [];
  const seen = new Set<string>();
  const push = (spot: Spot): void => {
    if (seen.has(keyOf(spot))) return;
    seen.add(keyOf(spot));
    out.push(spot);
  };
  for (let i = 0; i < path.length; i++) {
    const cur = path[i]!;
    if (i === 0) {
      push(cur);
      continue;
    }
    const prev = path[i - 1]!;
    let x = prev.x;
    let z = prev.z;
    while (x !== cur.x) {
      x += Math.sign(cur.x - x);
      push({ x, z });
    }
    while (z !== cur.z) {
      z += Math.sign(cur.z - z);
      push({ x, z });
    }
  }
  return out;
}

/** Возвести мазок. Возвращает, сколько клеток встало: ноль — весь мазок мимо. */
export function raiseWall(walls: CampWalls, site: WallSite, path: readonly Spot[]): number {
  const set = new Set(walls.cells);
  let put = 0;
  for (const spot of strokeCells(path)) {
    if (wallBlock(site, spot) !== 'ok') continue;
    if (set.has(keyOf(spot))) continue;
    set.add(keyOf(spot));
    walls.cells.push(keyOf(spot));
    put++;
  }
  return put;
}

/**
 * Башня: первый тап ставит, следующие поднимают ярус. Дойдя до потолка,
 * следующий тап снимает башню и оставляет стену — иначе до первого уровня
 * пришлось бы возвращаться сносом.
 */
export function cycleTower(walls: CampWalls, site: WallSite, spot: Spot): number | null {
  if (wallBlock(site, spot) !== 'ok') return null;
  const key = keyOf(spot);
  if (!walls.cells.includes(key)) walls.cells.push(key);
  const level = walls.towers[key];
  if (level === undefined) {
    walls.towers[key] = 1;
    return 1;
  }
  if (level < TOWER_MAX) {
    walls.towers[key] = level + 1;
    return level + 1;
  }
  delete walls.towers[key];
  return null;
}

/** Ворота: ставятся и снимаются тем же тапом. */
export function toggleGate(walls: CampWalls, spot: Spot): boolean {
  if (gateBlock(walls, spot) !== 'ok') return false;
  const key = keyOf(spot);
  const at = walls.gates.indexOf(key);
  if (at >= 0) walls.gates.splice(at, 1);
  else walls.gates.push(key);
  return true;
}

/** Лестница: поворот выводится из того, к какой стене она примыкает. */
export function putStairs(walls: CampWalls, site: WallSite, spot: Spot): boolean {
  const key = keyOf(spot);
  if (walls.stairs[key] !== undefined) {
    delete walls.stairs[key];
    return true;
  }
  if (stairsBlock(walls, site, spot) !== 'ok') return false;
  const set = new Set(walls.cells);
  const dir = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ].findIndex(([dx, dz]) => set.has(keyOf({ x: spot.x + dx!, z: spot.z + dz! })));
  if (dir < 0) return false;
  // Ход у лестницы выходит одним ребром, −z; поворот — тот, при котором
  // это ребро смотрит на стену. Считает его тот же `fitTurn`, что и в замке.
  walls.stairs[key] = TURN_TO[dir]!;
  return true;
}

/** Четверть поворота лестницы по направлению на стену. Порядок — как в DIRS. */
const TURN_TO: readonly number[] = [1, 3, 0, 2];

/** Снести всё, что стоит в клетке. */
export function razeWall(walls: CampWalls, spot: Spot): boolean {
  const key = keyOf(spot);
  const at = walls.cells.indexOf(key);
  const had = at >= 0 || walls.stairs[key] !== undefined;
  if (at >= 0) walls.cells.splice(at, 1);
  delete walls.towers[key];
  delete walls.stairs[key];
  const gate = walls.gates.indexOf(key);
  if (gate >= 0) walls.gates.splice(gate, 1);
  return had;
}

/**
 * Детали лагерных стен. Собираются тем же конструктором, что кольцо замка:
 * клетки → форма стыка → деталь → поворот. Ворота и лестницы дописываются
 * поверх — они не форма стыка, а то, что игрок поставил намеренно.
 *
 * Сид фиксирован: две одинаковые стены обязаны выглядеть одинаково, иначе
 * перестройка соседней клетки перекрашивала бы полстены.
 */
export function wallPieces(walls: CampWalls): Piece[] {
  const towers = new Map(Object.entries(walls.towers));
  const gates = new Set(walls.gates);
  const cells = wallSpots(walls).filter((s) => !gates.has(keyOf(s)));
  const built = buildWall(cells, mulberry32(1), towers);
  const out: Piece[] = [...built.pieces];

  for (const key of walls.gates) {
    const spot = parse(key);
    const set = new Set(walls.cells);
    const alongZ = set.has(keyOf({ x: spot.x, z: spot.z - 1 }))
      || set.has(keyOf({ x: spot.x, z: spot.z + 1 }));
    out.push({ model: 'tower-square-arch', x: spot.x, z: spot.z, y: 0, turn: 0, role: 'ворота' });
    out.push({ model: 'gate', x: spot.x, z: spot.z, y: 0, turn: alongZ ? 0 : 1, role: 'ворота' });
    out.push({ model: 'tower-square-top', x: spot.x, z: spot.z, y: 1.01, turn: 0, role: 'ворота' });
  }

  for (const [key, turn] of Object.entries(walls.stairs)) {
    const spot = parse(key);
    out.push({ model: 'wall-narrow-stairs', x: spot.x, z: spot.z, y: 0, turn, role: 'лестница' });
  }
  return out;
}

/** Сколько чего стоит в лагере — для панели стройки. */
export function wallCount(walls: CampWalls): Record<'стена' | 'башня' | 'ворота' | 'лестница', number> {
  return {
    'стена': walls.cells.length - Object.keys(walls.towers).length - walls.gates.length,
    'башня': Object.keys(walls.towers).length,
    'ворота': walls.gates.length,
    'лестница': Object.keys(walls.stairs).length,
  };
}

/** Башня из клеток — тем же кодом, что и в замке. Нужен рендеру и панели. */
export const towerAt = (spot: Spot, level: number): Piece[] => buildTower(spot, level, mulberry32(1));
