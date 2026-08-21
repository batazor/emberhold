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
import {
  CASTLE_CELL,
  DIRS,
  STAIRS,
  TOWER_MAX,
  buildTower,
  buildWall,
  fitTurn,
  keyOf,
  type Piece,
  type Spot,
} from './castle';
import {
  FENCE_MATERIALS,
  buildFence,
  type FenceMaterial,
  type FencePiece,
} from './fence';
import { canAfford, spend, type Resources } from './resources';
import { mulberry32 } from '../core/rng';

/** Что можно поставить. Карточки панели стройки — ровно этот список. */
export type WallTool = 'стена' | 'ограда' | 'дорога' | 'фонарь' | 'башня' | 'ворота' | 'лестница' | 'снос';

export const WALL_TOOLS: readonly WallTool[] = [
  'стена', 'ограда', 'дорога', 'фонарь', 'башня', 'ворота', 'лестница', 'снос',
];

/**
 * Состояние стен лагеря. Хранится клетками, а не деталями: деталь — вывод,
 * и хранить вывод значит завести второй источник правды. Пересобрать детали
 * из клеток стоит меньше миллисекунды.
 */
export interface CampWalls {
  /** Клетки стены: ключ `keyOf`. */
  cells: string[];
  /**
   * Клетки ограды (§6.1.7). Отдельным списком, а не пометкой на клетке стены:
   * ограда и стена — разные постройки, и в одной клетке им тесно. Старые
   * сохранения этого поля не знают, поэтому везде читается через `fenceCells`.
   */
  fences?: string[];
  /** Материал ограды, общий на весь лагерь: четыре ограды рядом читались бы
   *  не оградой, а забором из того, что было. */
  fence?: FenceMaterial;
  /**
   * Клетки дощатого настила (§6.1.12). Как ограда — отдельным списком:
   * дорога не занимает клетку, по ней ходят, и класть её в общий список
   * значило бы сделать её стеной. Старые сохранения поля не знают,
   * поэтому везде читается через `roadCells`.
   */
  roads?: string[];
  /** Клетки с фонарями (§6.1.12). Тоже позже сохранений: через `lampCells`. */
  lamps?: string[];
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

export const emptyWalls = (): CampWalls => ({
  cells: [],
  fences: [],
  fence: 'дерево',
  roads: [],
  lamps: [],
  towers: {},
  gates: [],
  stairs: {},
  work: null,
});

/** Клетки ограды — с оглядкой на сохранения, которые их не знают. */
export const fenceCells = (walls: CampWalls): string[] => (walls.fences ??= []);

/** Клетки дороги — той же оглядкой: поле моложе сохранений. */
export const roadCells = (walls: CampWalls): string[] => (walls.roads ??= []);

/** Клетки фонарей — так же. */
export const lampCells = (walls: CampWalls): string[] => (walls.lamps ??= []);

/** Материал ограды. По умолчанию дерево: оно дешевле всех и его добывают. */
export const fenceMaterial = (walls: CampWalls): FenceMaterial => walls.fence ?? 'дерево';

/** Следующий материал по кругу: карточка ограды перебирает их тапом. */
export function cycleFence(walls: CampWalls): FenceMaterial {
  const at = FENCE_MATERIALS.indexOf(fenceMaterial(walls));
  const next = FENCE_MATERIALS[(at + 1) % FENCE_MATERIALS.length]!;
  walls.fence = next;
  return next;
}

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
  /**
   * У ограды своя цена, `FENCE_COST`: она берётся не целой единицей за клетку,
   * и ресурс у неё зависит от материала. Это поле оставлено ради формы
   * таблицы и в счёт не идёт.
   */
  'ограда': 1,
  /** У дороги — то же: своя цена `ROAD_COST`, дробная и деревом. */
  'дорога': 1,
  /** Фонарь платится деревом: столб и есть бревно. Единица — за постройку. */
  'фонарь': 1,
  'башня': 2,
  'ворота': 3,
  'лестница': 1,
};

/**
 * Цена клетки настила — та же, что у дощатой ограды: единица дерева
 * на четыре клетки. Мерка одна и взята оттуда же (`npm run fence`,
 * замер §6.1.7): доска есть доска, и полотно под ногами не должно стоить
 * иначе, чем та же доска, поставленная на ребро. Дорога при этом ничего
 * не загораживает — она дешёвая именно потому, что она облик, а не защита.
 */
export const ROAD_COST = { resource: 'wood' as const, perCell: 0.25 };

/** Сколько дерева стоит мазок настила. Округление вверх — на мазок. */
export const roadAmount = (cells: number): number =>
  cells <= 0 ? 0 : Math.ceil(cells * ROAD_COST.perCell);

/**
 * Цена клетки ограды — **измерена, а не назначена** (`npm run fence`).
 *
 * Вопрос был такой: все четыре материала загораживают одинаково, разница
 * между ними — облик и ресурс. Значит выбор материала обязан быть выбором
 * облика, а не выбором цены: если один дешевле, три других становятся
 * украшением панели. Сравнивать в единицах ресурса при этом нельзя — камень
 * и дерево добываются по-разному и стоят игроку разного времени.
 *
 * Замер приводит всё к секунде игрока. Заход яруса 0 идёт 10,2 с и выносит
 * 4,1 камня и 1,7 дерева; находка стоит 1,8 с; доли в таблице добычи (§13) —
 * 0,70 камня и 0,30 дерева. Отсюда **камень 2,5 с за единицу, дерево 5,9 с**
 * (рубка §13.3 дороже — 8,0 с, и потому в цену не идёт: игрок берёт дешёвое).
 * Дерево дороже камня в 2,33 раза.
 *
 * Первая версия этого файла брала по единице за клетку с любого материала,
 * и замер это отменил: дощатое кольцо выходило 46,8 с против 20,1 с у
 * каменного — разброс 57%. Дощатая ограда была не дешёвым материалом,
 * а мёртвым.
 *
 * Из пяти перебранных пар только одна удержала оба условия — материалы
 * в пределах 15% друг от друга и кольцо дешевле стенного: **единица дерева
 * на четыре клетки, единица камня на две**. Кольцо при Жилье ур. 1 (восемь
 * клеток) выходит 11,7 с дощатой против 10,0 с каменной, разброс 14%,
 * и это 0,58 кольца стены.
 *
 * Проверяет обе величины `campWalls.rules.ts`, и проверяет по той же
 * таблице добычи, а не по переписанным сюда числам.
 */
export const FENCE_COST: Readonly<Record<FenceMaterial, { readonly resource: 'wood' | 'stone'; readonly perCell: number }>> = {
  'дерево': { resource: 'wood', perCell: 0.25 },
  'ковка': { resource: 'stone', perCell: 0.5 },
  'кирпич': { resource: 'stone', perCell: 0.5 },
  'камень': { resource: 'stone', perCell: 0.5 },
};

/** Чем платят за ограду. Дерево у дощатой, камень у остальных трёх. */
export const fenceResource = (material: FenceMaterial): 'wood' | 'stone' =>
  FENCE_COST[material].resource;

/** Сколько стоит мазок ограды. Округление вверх — на мазок, а не на клетку. */
export const fenceAmount = (material: FenceMaterial, cells: number): number =>
  cells <= 0 ? 0 : Math.ceil(cells * FENCE_COST[material].perCell);

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
  /**
   * Время идёт за ценой — той же связкой, какой §6.1.6 связало их у стены
   * («стоит примерно как улучшение и строится примерно столько же»).
   * Кольцо ограды стоит 0,58 кольца стены, клетка стены — 20 с, отсюда
   * 11,7 с, округлённые до читаемой пятёрки. Считает это `npm run fence`.
   */
  'ограда': 10,
  /** Настил вдвое быстрее ограды: класть доску проще, чем ставить её. */
  'дорога': 5,
  /** Фонарь — столб с плафоном: как лестница, постройка на одну клетку. */
  'фонарь': 20,
  'башня': 60,
  'ворота': 60,
  'лестница': 20,
};

/**
 * Цена мазка или постройки. В камне у всего, кроме дощатой ограды: она одна
 * платится деревом, и материал приходит сюда именно за этим.
 */
export const wallPrice = (
  tool: Exclude<WallTool, 'снос'>,
  cells: number,
  material: FenceMaterial = 'дерево',
): Partial<Resources> => {
  if (tool === 'дорога') return { wood: roadAmount(Math.max(1, cells)) };
  if (tool === 'фонарь') return { wood: WALL_COST['фонарь'] * Math.max(1, cells) };
  if (tool !== 'ограда') return { stone: WALL_COST[tool] * Math.max(1, cells) };
  const amount = fenceAmount(material, cells);
  return fenceResource(material) === 'wood' ? { wood: amount } : { stone: amount };
};

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
 * Почему сюда нельзя. Причина, а не `false`: панель обязана сказать, что
 * не так, — «нельзя» без причины читается как поломка интерфейса.
 *
 * Причины назывались русскими строками и были одновременно текстом для
 * панели; §23.3 это отменил — слова живут ниже, в `WALL_REASON`, и одни
 * на всех. Заодно ушёл член `'снаружи'`: его не возвращал никто, а слова
 * под него пришлось бы придумывать для случая, которого не бывает.
 */
export type WallBlock = 'ok' | 'off' | 'busy' | 'none' | 'bent' | 'nowhere';

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

/**
 * Стоит ли на **клетке лагеря** хоть что-то из построенного. Ворота считаются
 * стоящими: арка — постройка, и второй раз на неё ничего не встаёт.
 */
export function wallAt(walls: CampWalls, x: number, z: number): boolean {
  const key = keyOf(wallSpotOf(x, z));
  return walls.cells.includes(key)
    || fenceCells(walls).includes(key)
    || walls.stairs[key] !== undefined;
}

/**
 * Закрыта ли **клетка лагеря** для ходьбы. Отличается от `wallAt` ровно
 * воротами: **ворота — проход**, ради этого их и ставят. Стена без ворот
 * запирает двор наглухо, и тогда ворота были бы украшением на стене.
 *
 * Лестница закрыта: по ней поднимаются на стену, а подниматься в плоской
 * сетке некуда — пока это просто постройка.
 */
export function walkBlocked(walls: CampWalls, x: number, z: number): boolean {
  const key = keyOf(wallSpotOf(x, z));
  if (walls.stairs[key] !== undefined) return true;
  if (walls.gates.includes(key)) return false;
  return walls.cells.includes(key);
}

/** Можно ли поставить стену в эту клетку. */
export function wallBlock(site: WallSite, spot: Spot): WallBlock {
  const grid = wallGrid(site.area);
  if (spot.x < 0 || spot.z < 0 || spot.x >= grid || spot.z >= grid) return 'off';
  if (onBuilding(spot, site.layout, site.levels)) return 'busy';
  return 'ok';
}

/**
 * Можно ли поставить ограду. Всё то же, что у стены, плюс одно: **ограда
 * не встаёт на стену и стена не встаёт на ограду**. Обе занимают клетку
 * целиком, и вложить одну в другую значило бы получить постройку,
 * которой в наборе нет.
 */
export function fenceBlock(walls: CampWalls, site: WallSite, spot: Spot): WallBlock {
  const why = wallBlock(site, spot);
  if (why !== 'ok') return why;
  const key = keyOf(spot);
  if (walls.cells.includes(key) || walls.stairs[key] !== undefined) return 'busy';
  return 'ok';
}

/**
 * Можно ли положить настил. Всё, что у стены, плюс одно: настил не идёт
 * под то, что стоит, — стену, ограду, лестницу. Ворота тоже в списке:
 * под аркой у набора свой проезд, вторая плита дала бы пол на полу.
 */
export function roadBlock(walls: CampWalls, site: WallSite, spot: Spot): WallBlock {
  const why = wallBlock(site, spot);
  if (why !== 'ok') return why;
  const key = keyOf(spot);
  if (walls.cells.includes(key) || fenceCells(walls).includes(key)
    || walls.stairs[key] !== undefined) return 'busy';
  return 'ok';
}

/**
 * Можно ли поставить фонарь. Те же занятости, что у настила, плюс сам
 * фонарь: два столба в одной клетке — не свет, а частокол. На настил
 * фонарь встаёт: столб на досках — обычный уличный жест.
 */
export function lampBlock(walls: CampWalls, site: WallSite, spot: Spot): WallBlock {
  const why = roadBlock(walls, site, spot);
  if (why !== 'ok') return why;
  if (lampCells(walls).includes(keyOf(spot))) return 'busy';
  return 'ok';
}

/**
 * Ворота встают только в клетку стены, у которой ровно два соседа и они
 * напротив: арка в углу упёрлась бы в поворот хода. Это то же правило,
 * которым ворота ставит генератор замка, — и оно здесь одно на двоих.
 */
export function gateBlock(walls: CampWalls, spot: Spot): WallBlock {
  const set = new Set(walls.cells);
  if (!set.has(keyOf(spot))) return 'none';
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ].filter(([dx, dz]) => set.has(keyOf({ x: spot.x + dx!, z: spot.z + dz! })));
  if (dirs.length !== 2) return 'bent';
  const [a, b] = dirs as [number[], number[]];
  return a[0] === -b[0]! && a[1] === -b[1]! ? 'ok' : 'bent';
}

/**
 * Куда лестница выведет, если встанет в эту клетку: сосед-стена, по верху
 * которого ходят. `null` — вести некуда.
 *
 * Соседа-стены мало: рядом может стоять башня, у которой зубцы по всем
 * четырём рёбрам, и подъём упрётся в глухую площадку. Игрок заплатил бы
 * камень и время за лестницу в никуда.
 */
export function stairsTarget(walls: CampWalls, spot: Spot, tops: ReadonlySet<string>): number {
  const set = new Set(walls.cells);
  return DIRS.findIndex(([dx, dz]) => {
    const key = keyOf({ x: spot.x + dx, z: spot.z + dz });
    return set.has(key) && tops.has(key);
  });
}

/**
 * Лестница встаёт на пустую клетку, у которой есть сосед с ходом поверху.
 * `tops` — клетки, по верху которых ходят; их считает `campTop.ts`, и знать
 * про него здесь не нужно, достаточно ответа.
 */
export function stairsBlock(
  walls: CampWalls,
  site: WallSite,
  spot: Spot,
  tops?: ReadonlySet<string>,
): WallBlock {
  const set = new Set(walls.cells);
  if (set.has(keyOf(spot))) return 'busy';
  if (wallBlock(site, spot) !== 'ok') return wallBlock(site, spot);
  const near = DIRS.some(([dx, dz]) => set.has(keyOf({ x: spot.x + dx, z: spot.z + dz })));
  if (!near) return 'none';
  // Башню могут поставить и после лестницы — запретить это нельзя, и проверка
  // панели остаётся лучшим усилием. Граф верха отработает верно в любом случае.
  if (tops !== undefined && stairsTarget(walls, spot, tops) < 0) return 'nowhere';
  return 'ok';
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

/**
 * Клетки мазка, которые действительно встанут: без занятых и без повторов.
 * `tool` различает стену и ограду: занятость у них общая, а вставать одна
 * в клетку другой не имеет права.
 */
export function strokeFit(
  walls: CampWalls,
  site: WallSite,
  path: readonly Spot[],
  tool: 'стена' | 'ограда' | 'дорога' = 'стена',
): Spot[] {
  // У настила своя занятость: доска не спорит со стеной за клетку —
  // ей нельзя лишь под стоящее и на саму себя.
  const set = tool === 'дорога'
    ? new Set(roadCells(walls))
    : new Set([...walls.cells, ...fenceCells(walls)]);
  const out: Spot[] = [];
  for (const spot of strokeCells(path)) {
    const why = tool === 'ограда' ? fenceBlock(walls, site, spot)
      : tool === 'дорога' ? roadBlock(walls, site, spot)
        : wallBlock(site, spot);
    if (why !== 'ok') continue;
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
export type StartBlock = 'ok' | 'slot' | 'resources' | 'empty' | 'top' | WallBlock;

/**
 * Слова причины — рядом с причиной (§23.3). `empty` и `top` приходят
 * не отсюда, а от сноса и башни в цикле: сносить нечего и выше некуда —
 * такие же отказы стройки стен, и держать их слова отдельно значило бы
 * завести вторую таблицу.
 */
export const WALL_REASON: Record<Exclude<StartBlock, 'ok'>, string> = {
  off: 'Вне площадки',
  busy: 'Занято зданием',
  none: 'Рядом нет стены',
  bent: 'Ход должен быть прямым',
  nowhere: 'Вести некуда',
  slot: 'Слот занят другой стройкой',
  resources: 'Не хватает камня',
  empty: 'Здесь ничего не стоит',
  top: 'Выше некуда — снимается сносом',
};

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
  if (busy || walls.work != null) return 'slot';
  if (cells.length === 0) return 'off';
  const price = wallPrice(tool, cells.length, fenceMaterial(walls));
  if (!canAfford(resources, price)) return 'resources';
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
  } else if (work.tool === 'ограда') {
    const cells = fenceCells(walls);
    for (const spot of spots) if (!cells.includes(keyOf(spot))) cells.push(keyOf(spot));
  } else if (work.tool === 'дорога') {
    const cells = roadCells(walls);
    for (const spot of spots) if (!cells.includes(keyOf(spot))) cells.push(keyOf(spot));
  } else if (work.tool === 'фонарь') {
    const cells = lampCells(walls);
    const spot = spots[0]!;
    if (!cells.includes(keyOf(spot))) cells.push(keyOf(spot));
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
export function putStairs(
  walls: CampWalls,
  site: WallSite,
  spot: Spot,
  tops?: ReadonlySet<string>,
): boolean {
  const key = keyOf(spot);
  if (walls.stairs[key] !== undefined) {
    delete walls.stairs[key];
    return true;
  }
  if (stairsBlock(walls, site, spot, tops) !== 'ok') return false;
  const set = new Set(walls.cells);
  // Сосед с ходом поверху предпочтительнее любого: лестница обязана вести
  // на площадку, а не в глухую башню.
  const dir = tops === undefined
    ? DIRS.findIndex(([dx, dz]) => set.has(keyOf({ x: spot.x + dx, z: spot.z + dz })))
    : stairsTarget(walls, spot, tops);
  if (dir < 0) return false;
  // Ход у лестницы выходит одним ребром, −z; поворот — тот, при котором это
  // ребро смотрит на стену. Считает его `fitTurn` — тот же, что в замке,
  // а не своя таблица: две копии одного вывода разошлись бы молча.
  const turn = fitTurn(STAIRS.open, [dir]);
  if (turn < 0) return false;
  walls.stairs[key] = turn;
  return true;
}

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
    if (lampCells(walls).includes(key)) resources.wood += WALL_COST['фонарь'];
    if (roadCells(walls).includes(key)) {
      // Возврат за настил — предельный, как у ограды и по той же дыре:
      // цена дробная, ресурс целый (см. ограду ниже).
      const had = roadCells(walls).length;
      resources.wood += roadAmount(had) - roadAmount(had - 1);
    }
    if (fenceCells(walls).includes(key)) {
      /**
       * Возврат за ограду — **предельный**, а не поклеточный, и это не
       * придирка: цена дробная (единица дерева на четыре клетки), а ресурс
       * целый. Клетка возвращает разницу между ценой всей ограды до сноса
       * и после: мазок в четыре клетки стоил единицу — и вернёт единицу,
       * сколько бы клеток его ни сносили по одной.
       *
       * Поклеточный возврат по округлённой вверх цене был бы дырой ровно
       * вчетверо: построил мазком, снёс по клетке, заработал.
       */
      const material = fenceMaterial(walls);
      const had = fenceCells(walls).length;
      resources[fenceResource(material)] += fenceAmount(material, had) - fenceAmount(material, had - 1);
    }
  }
  return razeAt(walls, spot);
}

/** Снести без возврата: тем же кодом пользуются правила и старые вызовы. */
function razeAt(walls: CampWalls, spot: Spot): boolean {
  const key = keyOf(spot);
  const at = walls.cells.indexOf(key);
  const fences = fenceCells(walls);
  const fenceAt = fences.indexOf(key);
  const roads = roadCells(walls);
  const roadAt = roads.indexOf(key);
  const lamps = lampCells(walls);
  const lampAt = lamps.indexOf(key);
  const had = at >= 0 || fenceAt >= 0 || roadAt >= 0 || lampAt >= 0
    || walls.stairs[key] !== undefined;
  if (at >= 0) walls.cells.splice(at, 1);
  if (fenceAt >= 0) fences.splice(fenceAt, 1);
  if (roadAt >= 0) roads.splice(roadAt, 1);
  if (lampAt >= 0) lamps.splice(lampAt, 1);
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

/**
 * Детали ограды лагеря. Тот же конструктор, что обносит кладбище: клетки →
 * отрезки между соседними → панель на отрезок. Второй копии правил нет.
 *
 * Сид фиксирован по той же причине, что у стены: две одинаковые ограды
 * обязаны выглядеть одинаково, иначе достроенная клетка перекрашивала бы
 * половину уже стоящего.
 */
export function fencePieces(walls: CampWalls): FencePiece[] {
  const cells = fenceCells(walls).map(parseKey);
  if (cells.length === 0) return [];
  return buildFence(cells, fenceMaterial(walls), { rng: mulberry32(1) });
}

/** Клетки настила — для рендера: форму плиток выводит `roads.ts`. */
export const roadSpots = (walls: CampWalls): Spot[] => roadCells(walls).map(parseKey);

/** Клетки фонарей — для рендера. */
export const lampSpots = (walls: CampWalls): Spot[] => lampCells(walls).map(parseKey);

/** Сколько чего стоит в лагере — для панели стройки. */
export function wallCount(
  walls: CampWalls,
): Record<Exclude<WallTool, 'снос'>, number> {
  return {
    'стена': walls.cells.length - Object.keys(walls.towers).length - walls.gates.length,
    'ограда': fenceCells(walls).length,
    'дорога': roadCells(walls).length,
    'фонарь': lampCells(walls).length,
    'башня': Object.keys(walls.towers).length,
    'ворота': walls.gates.length,
    'лестница': Object.keys(walls.stairs).length,
  };
}

/** Башня из клеток — тем же кодом, что и в замке. Нужен рендеру и панели. */
export const towerAt = (spot: Spot, level: number): Piece[] => buildTower(spot, level, mulberry32(1));
