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
 * Площадь лагеря растёт со Жильёом (6×6 … 10×10), поэтому и поле стены растёт:
 * 3×3 при Жилье ур. 1, 5×5 при ур. 5. Нечётный остаток площади под стену
 * не идёт — половину детали поставить некуда.
 *
 * **Стена стоит камня и требует времени** (§20.1, §20.3). Числа выведены
 * из замера, а не назначены, — см. `WALL_COST` и `WALL_SECONDS`.
 *
 * Стройка стены занимает **тот же единственный слот**, что и улучшение здания.
 * §20.1 требует одного слота не ради экономии, а ради вопроса «что дальше»:
 * второй слот под стены снял бы этот вопрос ровно там, где он появился —
 * стена и здание впервые спорят за одно и то же.
 *
 * Чего стена **даёт**, здесь по-прежнему нет: это вопрос §12 и отдельного
 * замера, а не стройки.
 */
import { CASTLE_CELL, TOWER_MAX, buildTower, buildWall, keyOf, type Piece, type Spot } from './castle';
import { canAfford, spend, type Resources } from './resources';
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
  /** Стройка, которая идёт. Занимает тот же слот, что улучшение здания. */
  work?: WallWork | null;
}

/**
 * Стройка, которая идёт прямо сейчас. Хранится тем, что она **сделает**,
 * а не тем, что уже сделано: пока таймер идёт, стены в лагере нет, и её
 * не должно быть видно ни в списке клеток, ни в деталях.
 */
export interface WallWork {
  readonly tool: Exclude<WallTool, 'снос'>;
  /** Клетки мазка; у башни, ворот и лестницы — ровно одна. */
  readonly cells: readonly string[];
  /** Ярус, до которого растёт башня. */
  readonly level?: number;
  readonly startedAt: number;
  readonly endsAt: number;
  /** Что списано: снос вернёт ровно это. */
  readonly paid: Partial<Resources>;
}

export interface CampWallsWork {
  work: WallWork | null;
}

export const emptyWalls = (): CampWalls => ({ cells: [], towers: {}, gates: [], stairs: {}, work: null });

/**
 * Цена в камне. Выведена из замера (`npm run measure`), а не назначена.
 *
 * Замер: вылазка яруса 0 приносит **4,5 камня**, а улучшение здания до ур. 2
 * стоит 7 камня и 4 дерева — по §11.5 это 1,43 вылазки. Первое кольцо стены
 * при Жилье ур. 1 — восемь клеток (поле 3×3, периметр 8), и требование
 * к цене одно: **кольцо должно стоить примерно как одно улучшение**. Иначе
 * оно либо мелочь, за которую не жалко единственный слот, либо карьера.
 *
 * Отсюда клетка стены — 1 камень: кольцо 8, улучшение 7. Ярус башни вдвое
 * дороже клетки, ворота втрое: башня и ворота — это здание в стене,
 * а не её кусок.
 */
export const WALL_COST: Record<Exclude<WallTool, 'снос'>, number> = {
  'стена': 1,
  'башня': 2,
  'ворота': 3,
  'лестница': 1,
};

/**
 * Сколько идёт стройка, в секундах на клетку. Та же мерка, что у цены:
 * **кольцо строится примерно столько же, сколько идёт одно улучшение**.
 * Улучшение до ур. 2 — три минуты (§20.2), кольцо — восемь клеток,
 * отсюда 22 секунды на клетку, округлённые до 20.
 *
 * Мазок — **одна стройка**: у него один таймер на все клетки, а не таймер
 * на клетку. Двадцать таймеров подряд не оставили бы от §20.1 ничего.
 */
export const WALL_SECONDS: Record<Exclude<WallTool, 'снос'>, number> = {
  'стена': 20,
  'башня': 60,
  'ворота': 60,
  'лестница': 20,
};

/** Цена мазка или постройки — в камне и ни в чём другом. */
export const wallPrice = (tool: Exclude<WallTool, 'снос'>, cells: number): Partial<Resources> => ({
  stone: WALL_COST[tool] * Math.max(1, cells),
});

/** Сколько идёт стройка целиком. */
export const wallSeconds = (tool: Exclude<WallTool, 'снос'>, cells: number): number =>
  WALL_SECONDS[tool] * Math.max(1, cells);

/**
 * Сторона поля стены в клетках стены. Принимает площадь лагеря, а не уровень
 * Жилья: иначе `campWalls` пришлось бы знать про `camp`, а `camp` уже знает
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

const parseKey = (key: string): Spot => {
  const [x, z] = key.split(':');
  return { x: Number(x), z: Number(z) };
};

export const wallSpots = (walls: CampWalls): Spot[] => walls.cells.map(parseKey);

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
  /** Площадь лагеря в клетках (§20.4): её задаёт Жильё. */
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

/** Клетки мазка, которые действительно встанут: без занятых и без повторов. */
export function strokeFit(walls: CampWalls, site: WallSite, path: readonly Spot[]): Spot[] {
  const set = new Set(walls.cells);
  const out: Spot[] = [];
  for (const spot of strokeCells(path)) {
    if (wallBlock(site, spot) !== 'ok') continue;
    if (set.has(keyOf(spot))) continue;
    set.add(keyOf(spot));
    out.push(spot);
  }
  return out;
}

/**
 * Возвести мазок немедленно. Остаётся для правил и для случая, когда цена
 * и время уже уплачены: сама панель ставит стройку в слот, а не строит сразу.
 */
export function raiseWall(walls: CampWalls, site: WallSite, path: readonly Spot[]): number {
  const fit = strokeFit(walls, site, path);
  for (const spot of fit) walls.cells.push(keyOf(spot));
  return fit.length;
}

/** Почему стройку не начать. */
export type StartBlock = 'ok' | 'слот занят' | 'не хватает камня' | WallBlock;

/**
 * Поставить стройку в слот. Камень списывается на входе, а не по готовности:
 * иначе игрок мог бы поставить стройку, потратить камень на здание и получить
 * стену бесплатно.
 *
 * `busy` — идёт ли уже стройка здания: слот один на лагерь (§20.1), и знать
 * про здания этому файлу не нужно, достаточно ответа «занято».
 */
export function startWall(
  walls: CampWalls,
  resources: Resources,
  tool: Exclude<WallTool, 'снос'>,
  cells: readonly Spot[],
  now: number,
  busy: boolean,
): StartBlock {
  if (busy || walls.work != null) return 'слот занят';
  if (cells.length === 0) return 'вне площади';
  const price = wallPrice(tool, cells.length);
  if (!canAfford(resources, price)) return 'не хватает камня';
  spend(resources, price);
  walls.work = {
    tool,
    cells: cells.map(keyOf),
    startedAt: now,
    endsAt: now + wallSeconds(tool, cells.length),
    paid: price,
  };
  return 'ok';
}

/** Ярус, до которого дорастёт башня следующим тапом; null — башня снимается. */
export function nextTowerLevel(walls: CampWalls, spot: Spot): number | null {
  const level = walls.towers[keyOf(spot)];
  if (level === undefined) return 1;
  return level < TOWER_MAX ? level + 1 : null;
}

/** Поставить в слот рост башни. */
export function startTower(
  walls: CampWalls,
  site: WallSite,
  resources: Resources,
  spot: Spot,
  now: number,
  busy: boolean,
): StartBlock {
  const why: WallBlock = wallBlock(site, spot);
  if (why !== 'ok') return why;
  const level = nextTowerLevel(walls, spot);
  // Снять башню — не стройка: она разбирается тем же сносом, что и стена.
  if (level === null) return 'ok';
  const started = startWall(walls, resources, 'башня', [spot], now, busy);
  if (started === 'ok') walls.work = { ...walls.work!, level };
  return started;
}

/** Готова ли стройка, и применить её. Возвращает, что именно встало. */
export function completeWallIfDue(walls: CampWalls, now: number): WallWork | null {
  const work = walls.work;
  if (work == null || now < work.endsAt) return null;
  walls.work = null;
  const spots = work.cells.map(parseKey);
  if (work.tool === 'стена') {
    for (const spot of spots) if (!walls.cells.includes(keyOf(spot))) walls.cells.push(keyOf(spot));
  } else if (work.tool === 'башня') {
    const spot = spots[0]!;
    if (!walls.cells.includes(keyOf(spot))) walls.cells.push(keyOf(spot));
    walls.towers[keyOf(spot)] = work.level ?? 1;
  } else if (work.tool === 'ворота') {
    const spot = spots[0]!;
    if (!walls.gates.includes(keyOf(spot))) walls.gates.push(keyOf(spot));
  } else if (work.tool === 'лестница') {
    const spot = spots[0]!;
    walls.stairs[keyOf(spot)] = work.level ?? 0;
  }
  return work;
}

/** Доля готовности стройки, 0..1. Панели нужна полоса, а не секунды. */
export function wallProgress(walls: CampWalls, now: number): number {
  const work = walls.work;
  if (work == null) return 0;
  const span = work.endsAt - work.startedAt;
  return span <= 0 ? 1 : Math.max(0, Math.min(1, (now - work.startedAt) / span));
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

/**
 * Снести всё, что стоит в клетке, и вернуть за это камень. Возвращается
 * полная цена: снос — не наказание за пробу, иначе «попробовать» стоит
 * дороже, чем не пробовать, и планировку никто не тронет. Время при этом
 * не возвращается — оно и есть настоящая цена ошибки.
 */
export function razeWall(walls: CampWalls, spot: Spot, resources?: Resources): boolean {
  const key = keyOf(spot);
  if (resources !== undefined) {
    if (walls.towers[key] !== undefined) resources.stone += WALL_COST['башня'] * walls.towers[key]!;
    if (walls.gates.includes(key)) resources.stone += WALL_COST['ворота'];
    if (walls.stairs[key] !== undefined) resources.stone += WALL_COST['лестница'];
    if (walls.cells.includes(key)) resources.stone += WALL_COST['стена'];
  }
  return razeAt(walls, spot);
}

/** Снести без возврата: тем же кодом пользуются правила и старые вызовы. */
function razeAt(walls: CampWalls, spot: Spot): boolean {
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
    const spot = parseKey(key);
    const set = new Set(walls.cells);
    const alongZ = set.has(keyOf({ x: spot.x, z: spot.z - 1 }))
      || set.has(keyOf({ x: spot.x, z: spot.z + 1 }));
    out.push({ model: 'tower-square-arch', x: spot.x, z: spot.z, y: 0, turn: 0, role: 'ворота' });
    out.push({ model: 'gate', x: spot.x, z: spot.z, y: 0, turn: alongZ ? 0 : 1, role: 'ворота' });
    out.push({ model: 'tower-square-top', x: spot.x, z: spot.z, y: 1.01, turn: 0, role: 'ворота' });
  }

  for (const [key, turn] of Object.entries(walls.stairs)) {
    const spot = parseKey(key);
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
