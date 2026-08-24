/**
 * Модель строительства стен и генератор замка на наборе Kenney Castle Kit
 * (§6.1.6). Головой не выдумано ничего: и сетка, и высоты, и то, какой
 * стороной деталь пускает соседа, сняты обмером — `npm run models --
 * --pack=castle` пишет их в каталог набора, а `castle.rules.ts` сверяет
 * с этим каталогом каждое число отсюда.
 *
 * **Модель стройки в одну фразу.** Стена — замкнутая цепь клеток, у каждой
 * ровно два соседа по цепи, и деталь выбирается тем, где эти соседи стоят:
 * напротив — прямая, рядом — угол. Поворот при этом не выбирается вовсе,
 * а выводится: у детали измерено, какие её рёбра открыты под соседа, и
 * поворот — единственная четверть, при которой открытые рёбра смотрят
 * на соседей. Отсюда следствие, ради которого модель и стоило записывать:
 * **новую деталь набора достаточно измерить, чтобы она встала в стройку** —
 * ни выбирать ей поворот, ни описывать её форму словами не нужно.
 *
 * Сетка модуля тоже измерена, а не назначена: клетка — единица, этаж — 1,01,
 * ход поверху — 1,18, верх стены — 1,31. Стена набора — не панель на ребре
 * клетки, а сплошной блок в клетку: по ней ходят поверху, и потому у неё
 * есть зубцы и есть проход.
 *
 * Файл живёт в `sim/`, а не в `render/`, намеренно: генератор — это числа,
 * а не картинка. Он не знает ни про three, ни про DOM, гоняется в Node
 * и проверяется правилами; страница артбука (`castleart.html`) берёт у него
 * список деталей и рисует его сама.
 */
import { mulberry32, randInt, type Rng } from '../core/rng';

/* ---------- сетка ---------- */

/** Клетка плана. */
export interface Spot {
  readonly x: number;
  readonly z: number;
}

/**
 * Направления в том же порядке, в каком обмер пишет открытые рёбра детали:
 * −x, +x, −z, +z. Порядок — контракт с `catalog.json`, и его стережёт правило.
 */
export const DIRS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Куда уезжает направление за одну четверть поворота вокруг вертикали.
 * Поворот на +90° переводит точку (x, z) в (z, −x), отсюда и таблица:
 * −x → +z → +x → −z → −x.
 */
const QUARTER: readonly number[] = [3, 2, 0, 1];

/** Направление после `turn` четвертей. */
export function turnDir(dir: number, turn: number): number {
  let at = dir;
  for (let i = 0; i < ((turn % 4) + 4) % 4; i++) at = QUARTER[at]!;
  return at;
}

/* ---------- деталь ---------- */

/**
 * Деталь набора в терминах стройки: имя модели и то, какие рёбра клетки она
 * оставляет открытыми. Оба поля — из каталога, оба сверяются правилом.
 */
export interface Part {
  readonly model: string;
  /** Открытые рёбра в порядке DIRS. */
  readonly open: readonly boolean[];
}

const part = (model: string, ...open: readonly number[]): Part => ({
  model,
  open: DIRS.map((_, i) => open.includes(i)),
});

/**
 * Форма стыка — всё, чем деталь описывается в стройке. Считается по числу
 * и расположению соседей, и больше ни от чего не зависит.
 */
export type Joint = 'одиночная' | 'тупик' | 'прямая' | 'угол' | 'тройник' | 'перекрёсток';

/**
 * Словарь конструктора: какие детали набора умеют встать на каждую форму
 * стыка. Открытые рёбра здесь **объявлены по обмеру**, а не придуманы, и
 * правило сверяет каждую строку с `catalog.json`.
 *
 * По две-три детали на роль — не украшение: без чередования стена выходит
 * гребёнкой из одинаковых зубцов, и глаз читает её как текстуру,
 * а не как постройку.
 *
 * Перекрёсток пуст, и это ответ набора, а не пропуск: детали, у которой
 * ход шёл бы на все четыре стороны на высоте стены, в наборе нет —
 * единственная деталь с четырьмя открытыми рёбрами (`tower-top`) высотой
 * в одну восьмую стены. Поэтому на перекрёстке встаёт башня, и ход
 * там кончается.
 */
export const PARTS: Readonly<Record<Joint, readonly Part[]>> = {
  'одиночная': [part('tower-square')],
  'тупик': [part('wall-to-narrow', 3)],
  'прямая': [part('wall', 2, 3), part('wall-pillar', 2, 3)],
  'угол': [
    part('wall-corner', 0, 3),
    part('wall-corner-slant', 0, 3),
    part('wall-corner-half', 0, 3),
    part('wall-corner-half-tower', 1, 3),
  ],
  'тройник': [part('wall-half', 1, 2, 3)],
  'перекрёсток': [],
};

/** Прямые участки — они же вход для кода, которому нужна одна деталь. */
export const STRAIGHT = PARTS['прямая'];
export const CORNER = PARTS['угол'];

/** Лестница со двора на стену: ход у неё выходит одним ребром, −z. */
export const STAIRS = part('wall-narrow-stairs', 2);

/**
 * Лестница с перилами — тот же один ход, но открыт у модели в +z.
 * Поворот по-прежнему выводит `fitTurn`: генератор не знает,
 * с какой стороны автор нарисовал подъём.
 */
export const STAIRS_RAIL = part('wall-narrow-stairs-rail', 3);
export const STAIR_PARTS: readonly Part[] = [STAIRS, STAIRS_RAIL];

/**
 * Башня: нижний этаж, ярусы над ним и завершение. Ярусы бывают глухими,
 * с окнами и открытой галереей; выбор делается сидом, чтобы две башни рядом
 * не были близнецами. Дверной нижний ярус отделен: он имеет смысл только у донжона.
 */
export const TOWER = {
  base: 'tower-square-base',
  /** Дверь нужна только на земле донжона, а не на верхнем ярусе. */
  keepBase: 'tower-square-mid-door',
  body: ['tower-square-mid', 'tower-square-mid-windows', 'tower-square-mid-open'],
  cap: 'tower-square-top',
  roofs: [
    'tower-square-top-roof',
    'tower-square-top-roof-high',
    'tower-square-top-roof-rounded',
    'tower-square-top-roof-high-windows',
  ],
  flags: ['flag', 'flag-wide'],
} as const;

/**
 * Шестигранная башня — отдельное семейство, а не ещё один вариант квадратного
 * яруса. У него своя высота основания (ровно высота стены) и короткий средний
 * ярус, поэтому складывать его через `FLOOR` нельзя.
 */
export const HEX_TOWER = {
  base: 'tower-hexagon-base',
  body: 'tower-hexagon-mid',
  tops: ['tower-hexagon-top', 'tower-hexagon-top-wood'],
  roofs: ['tower-hexagon-roof', 'tower-hexagon-roof-secondary'],
  baseHeight: 1.31,
  bodyHeight: 0.46,
  topHeight: [0.13, 0.46],
  roofHeight: [0.83, 0.75],
} as const;

/** Узкие внутренние укрепления: каменная и деревянная семьи. */
export const INNER_WALLS = {
  stone: ['wall-narrow', 'wall-doorway', 'wall-half-modular', 'wall-narrow-gate'],
  wood: ['wall-narrow-wood', 'wall-narrow-wood-fence'],
} as const;

/** Створки ворот. `gate` остаётся старым вариантом, два остальных — новые. */
export const GATE_LEAVES = ['gate', 'door', 'metal-gate'] as const;

/** Настенные знамёна, отдельные лестницы и мостовые опоры. */
export const WALL_BANNERS = ['flag-banner-short', 'flag-banner-long'] as const;
export const FREE_STAIRS = ['stairs-stone', 'stairs-stone-square'] as const;
export const FIXED_BRIDGES = ['bridge-straight', 'bridge-straight-pillar'] as const;

/** Модели окружения выбирает площадка мира, но рисует общий набор замка. */
export const CASTLE_SURROUNDINGS = ['rocks-large', 'rocks-small', 'tree-large', 'tree-small'] as const;

/** Высота зубцов над последним этажом. Измерена, как и всё остальное. */
export const CAP = 0.3;

/**
 * Высота площадки хода у каждой принятой детали, в её собственных единицах.
 * `null` — ходить по ней не по чему.
 *
 * Числа не назначены: их снимает `npm run models` растеризацией рельефа
 * и пишет в `catalog.json` полем `deck`. Здесь они повторены затем, что
 * симуляции нужен ответ в Node без чтения каталога, — и что списки не
 * разошлись, проверяет `castle.rules.ts` тем же циклом, каким сверяет `open`.
 *
 * Таблица отдельная, а не поле в `Part`, потому что настил нужен и у деталей,
 * которые `Part` не являются: арку ворот, надвратную шапку и створку ставит
 * `wallPieces` руками.
 */
export const DECK: Readonly<Record<string, number | null>> = {
  'wall': 1.18,
  'wall-pillar': 1.18,
  'wall-corner': 1.18,
  'wall-corner-slant': 1.18,
  'wall-corner-half': 1.18,
  'wall-corner-half-tower': 1.31,
  'wall-half': 1.18,
  'wall-to-narrow': 1.18,
  'tower-square': 1.18,
  'wall-narrow-stairs': 1.18,
  'wall-narrow-stairs-rail': 1.18,
  'tower-square-base': null,
  'tower-square-mid-door': null,
  'tower-square-mid': null,
  'tower-square-mid-windows': null,
  'tower-square-mid-open': 0.96,
  'tower-square-arch': null,
  'tower-square-top': 0.17,
  'tower-square-top-roof': 0.87,
  'tower-square-top-roof-high': null,
  'tower-square-top-roof-rounded': 0.79,
  'tower-square-top-roof-high-windows': 1,
  'tower-hexagon-base': null,
  'tower-hexagon-mid': null,
  'tower-hexagon-top': 0.09,
  'tower-hexagon-top-wood': null,
  'tower-hexagon-roof': 0.71,
  'tower-hexagon-roof-secondary': 0.46,
  'wall-narrow': 1.18,
  'wall-doorway': 1.18,
  'wall-half-modular': 1.18,
  'wall-narrow-gate': 1.18,
  'wall-narrow-wood': 1.15,
  'wall-narrow-wood-fence': 1.15,
  'stairs-stone': 0.51,
  'stairs-stone-square': 0.51,
  'bridge-draw': 0.03,
  'bridge-straight': 1.04,
  'bridge-straight-pillar': 1.04,
  'gate': 0.8,
  'door': 0.44,
  'metal-gate': null,
  'flag': null,
  'flag-wide': null,
  'flag-pennant': null,
  'flag-banner-short': 0.73,
  'flag-banner-long': 2.12,
  'rocks-large': 0.38,
  'rocks-small': 0.3,
  'tree-large': 1.68,
  'tree-small': 1.21,
};

/** Настил детали или `null`. Незнакомая деталь — тоже `null`: не выдумываем. */
export const deckOf = (model: string): number | null => DECK[model] ?? null;

/** Деталь словаря по имени модели: нужна всем, кому нужен её обмер. */
export function partOf(model: string): Part | undefined {
  for (const bag of Object.values(PARTS)) {
    const hit = bag.find((p) => p.model === model);
    if (hit !== undefined) return hit;
  }
  return STAIR_PARTS.find((p) => p.model === model);
}

/**
 * Потолок роста башни — три яруса, и это не круглое число.
 *
 * Апгрейд башни здесь **только вверх**: след на земле не меняется никогда,
 * поэтому надстройка не может ни задеть соседнюю стену, ни перегородить двор.
 * Всё, что растёт, — высота, и она же единственное, чем уровень читается:
 * ярус — это 1,01 в единицах набора, то есть 2,02 в клетках локации,
 * полтора роста героя. Подписи уровню не нужно.
 *
 * Ограничивает рост камера. Она смотрит с 30°, и башня высотой H прячет
 * за собой H · ctg 30° ≈ 1,73H клеток земли. На третьем ярусе башня
 * закрывает двор самого большого замка целиком; четвёртый закрывал бы двор
 * **любого**. Считает это правило в `models.rules.ts`, а не глаз.
 */
export const TOWER_MAX = 3;

/** Высота башни в ярусах — в единицах набора. */
export const towerHeight = (level: number): number => FLOOR * level + CAP;

/**
 * Башня в `level` ярусов. Ярусы складываются по измеренной высоте этажа,
 * завершение встаёт поверх последнего. Крыша — для донжона: он не боевая
 * площадка, и зубцы ему ни к чему.
 */
export function buildTower(
  spot: Spot,
  level: number,
  rng: Rng = mulberry32(1),
  roof = false,
  entrance = false,
  entranceTurn?: number,
): Piece[] {
  const floors = Math.max(1, Math.min(TOWER_MAX, Math.round(level)));
  const bodyTurn = entranceTurn ?? randInt(rng, 4);
  const out: Piece[] = [
    {
      model: entrance ? TOWER.keepBase : TOWER.base,
      x: spot.x,
      z: spot.z,
      y: 0,
      turn: entrance ? entranceTurn ?? randInt(rng, 4) : 0,
      role: 'башня',
    },
  ];
  for (let i = 1; i < floors; i++) {
    // Ярусы читаются снизу вверх, а не бросаются независимо: у донжона
    // сначала окна, затем глухая опора крыши; у боевой башни верхний ярус
    // — открытая галерея, а нижние остаются защищёнными.
    const model = roof
      ? (i === 1 ? 'tower-square-mid-windows' : 'tower-square-mid')
      : (i === floors - 1 ? 'tower-square-mid-open' : 'tower-square-mid-windows');
    out.push({
      model,
      x: spot.x,
      z: spot.z,
      y: FLOOR * i,
      turn: bodyTurn,
      role: 'башня',
    });
  }
  out.push({
    model: roof ? TOWER.roofs[randInt(rng, TOWER.roofs.length)]! : TOWER.cap,
    x: spot.x,
    z: spot.z,
    y: FLOOR * floors,
    turn: 0,
    role: 'башня',
  });
  return out;
}

/**
 * Шестигранная башня стены. Основание уже высотой со всю стену; сид может
 * добавить один короткий ярус, затем ставит деревянную или каменную шапку
 * и одну из двух крыш. Высоты берутся из обмера семейства выше.
 */
export function buildHexTower(spot: Spot, rng: Rng = mulberry32(1), raised = false): Piece[] {
  const out: Piece[] = [
    { model: HEX_TOWER.base, x: spot.x, z: spot.z, y: 0, turn: 0, role: 'башня' },
  ];
  let y = HEX_TOWER.baseHeight;
  if (raised) {
    out.push({ model: HEX_TOWER.body, x: spot.x, z: spot.z, y, turn: randInt(rng, 4), role: 'башня' });
    y += HEX_TOWER.bodyHeight;
  }
  const topAt = randInt(rng, HEX_TOWER.tops.length);
  out.push({ model: HEX_TOWER.tops[topAt]!, x: spot.x, z: spot.z, y, turn: 0, role: 'башня' });
  y += HEX_TOWER.topHeight[topAt]!;
  out.push({
    // Деревянная шапка получает вторичную крышу, каменная — основную:
    // независимо выбранные пары выглядели двумя наборами, склеенными рядом.
    model: HEX_TOWER.roofs[topAt]!,
    x: spot.x,
    z: spot.z,
    y,
    turn: randInt(rng, 4),
    role: 'башня',
  });
  return out;
}

/** Форма стыка по направлениям на соседей. */
export function jointOf(dirs: readonly number[]): Joint {
  if (dirs.length === 0) return 'одиночная';
  if (dirs.length === 1) return 'тупик';
  if (dirs.length >= 4) return 'перекрёсток';
  if (dirs.length === 3) return 'тройник';
  const a = DIRS[dirs[0]!]!;
  const b = DIRS[dirs[1]!]!;
  return a[0] === -b[0] && a[1] === -b[1] ? 'прямая' : 'угол';
}

/* ---------- высоты ---------- */

/**
 * Высоты набора в его же единицах. Все три измерены, ни одна не назначена:
 * этаж — высота яруса башни, ход — высота площадки под зубцами, верх — самая
 * высокая точка стены. Парапет — их разность, 0,13, и он тут не нужен: ярусы
 * складываются по этажу.
 */
export const FLOOR = 1.01;
export const WALK = 1.18;
export const WALL_TOP = 1.31;

/**
 * Клетка набора в клетках локации. Двойка выбрана по замеру, а не на глаз.
 *
 * Герой игры — 1,38 в клетках локации (мерка снимается с самой модели,
 * `models.rules.ts`). Стена набора — 1,31 в его единицах, ход поверху — 1,18.
 * При масштабе один стена вышла бы 1,31 — вровень с человеком, то есть
 * забором; при двойке она 2,62, а ход по ней 2,36, и оба числа проходят
 * над макушкой. Это и есть требование, которое держит правило: **не «вдвое
 * выше»** — 2,62 к 1,38 это 1,9, — а «через стену не заглянуть, и по ней
 * ходят над головой».
 *
 * Тройку не берём: локация выросла бы до сорока клеток в поперечнике при
 * двадцати у самого глубокого яруса, и замок пришлось бы обходить дольше,
 * чем всю вылазку.
 *
 * Цена двойки — клетка замка занимает четыре клетки локации. Для стены это
 * не потеря, а свойство: крепостная стена и должна быть толстой.
 */
export const CASTLE_CELL = 2;

/* ---------- поставленная деталь ---------- */

export interface Piece {
  readonly model: string;
  readonly x: number;
  readonly z: number;
  /** Ярус в единицах набора. */
  readonly y: number;
  /** Четверти поворота вокруг вертикали, 0..3. */
  readonly turn: number;
  /** Зачем деталь стоит: конструкция, проход, украшение или окружение. */
  readonly role: Role;
}

export type Role =
  | 'стена'
  | 'угол'
  | 'ворота'
  | 'мост'
  | 'башня'
  | 'лестница'
  | 'знамя'
  | 'укрепление'
  | 'окружение'
  | 'двор';

export type TowerStyle = 'квадратные' | 'шестигранные';

export interface Castle {
  readonly seed: number;
  readonly width: number;
  readonly depth: number;
  /** Стены в порядке обхода: соседи по списку — соседи по сетке. */
  readonly ring: readonly Spot[];
  readonly yard: readonly Spot[];
  readonly gate: Spot;
  /** Внешний пояс воды; клетка ворот освобождена мостом. */
  readonly moat: readonly Spot[];
  readonly towerStyle: TowerStyle;
  /** Углы, которым достался угол с башенкой. */
  readonly towers: readonly Spot[];
  readonly pieces: readonly Piece[];
}

/**
 * Поворот, при котором открытые рёбра детали смотрят ровно на соседей.
 * Возвращает −1, если такой четверти нет: деталь не той формы, и это
 * не повод её вертеть — это повод её не ставить.
 */
export function fitTurn(open: readonly boolean[], want: readonly number[]): number {
  for (let turn = 0; turn < 4; turn++) {
    let ok = true;
    for (let dir = 0; dir < 4; dir++) {
      const opened = open[dir] === true;
      if (opened !== want.includes(turnDir(dir, turn))) {
        ok = false;
        break;
      }
    }
    if (ok) return turn;
  }
  return -1;
}

/* ---------- план ---------- */

const at = (w: number, x: number, z: number): number => z * w + x;

/**
 * Стены — клетки участка, у которых есть сосед снаружи **по восьми**
 * направлениям, а не по четырём. Разница не косметическая: у плана
 * с вырезанным углом внутренний угол стены соприкасается с наружным
 * по диагонали, и по четырём направлениям цепь там рвётся.
 */
function wallMask(w: number, d: number, inside: Uint8Array): Uint8Array {
  const wall = new Uint8Array(w * d);
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      if (!inside[at(w, x, z)]) continue;
      let edge = false;
      for (let dz = -1; dz <= 1 && !edge; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= d || !inside[at(w, nx, nz)]) {
            edge = true;
            break;
          }
        }
      }
      if (edge) wall[at(w, x, z)] = 1;
    }
  }
  return wall;
}

/** Соседи клетки по цепи стен. */
function ringNeighbors(w: number, d: number, wall: Uint8Array, x: number, z: number): number[] {
  const out: number[] = [];
  for (let dir = 0; dir < 4; dir++) {
    const nx = x + DIRS[dir]![0];
    const nz = z + DIRS[dir]![1];
    if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
    if (wall[at(w, nx, nz)]) out.push(dir);
  }
  return out;
}

/**
 * Цепь замкнута и проста: у каждой клетки стены ровно два соседа, и обход
 * из любой клетки возвращается в неё, обойдя все. Проверяется здесь же,
 * потому что вырез угла способен разорвать цепь, и тогда вырез отменяется,
 * а не чинится.
 */
function walkRing(w: number, d: number, wall: Uint8Array): Spot[] | null {
  const cells: Spot[] = [];
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) if (wall[at(w, x, z)]) cells.push({ x, z });
  }
  if (cells.length < 8) return null;
  for (const c of cells) {
    if (ringNeighbors(w, d, wall, c.x, c.z).length !== 2) return null;
  }

  const ring: Spot[] = [cells[0]!];
  const seen = new Set<number>([at(w, cells[0]!.x, cells[0]!.z)]);
  for (;;) {
    const cur = ring[ring.length - 1]!;
    let moved = false;
    for (const dir of ringNeighbors(w, d, wall, cur.x, cur.z)) {
      const nx = cur.x + DIRS[dir]![0];
      const nz = cur.z + DIRS[dir]![1];
      if (seen.has(at(w, nx, nz))) continue;
      ring.push({ x: nx, z: nz });
      seen.add(at(w, nx, nz));
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return ring.length === cells.length ? ring : null;
}

/** Клетки участка, которые не стена, — двор. */
function yardOf(w: number, d: number, inside: Uint8Array, wall: Uint8Array): Spot[] {
  const out: Spot[] = [];
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) if (inside[at(w, x, z)] && !wall[at(w, x, z)]) out.push({ x, z });
  }
  return out;
}

/**
 * Двор односвязен: из любой его клетки достижима любая другая, не выходя
 * из двора. Проверка не косметическая — она ловит **перемычку**: два выреза
 * с одной стороны способны оставить между собой полосу шириной в клетку,
 * и тогда вся полоса становится стеной, а двор распадается надвое. Кольцо
 * при этом остаётся честным кольцом, и по нему такой замок не отличить
 * от нормального.
 */
function yardWhole(w: number, yard: readonly Spot[]): boolean {
  if (yard.length === 0) return false;
  const inYard = new Set(yard.map((s) => at(w, s.x, s.z)));
  const seen = new Set<number>([at(w, yard[0]!.x, yard[0]!.z)]);
  const queue: Spot[] = [yard[0]!];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const [dx, dz] of DIRS) {
      const key = at(w, cur.x + dx, cur.z + dz);
      if (!inYard.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push({ x: cur.x + dx, z: cur.z + dz });
    }
  }
  return seen.size === yard.length;
}

/**
 * Проходим ли двор, если часть его клеток занята. Донжон и лестница стоят
 * во дворе и занимают клетку целиком, и в узком дворе они способны
 * перегородить его надвое: двор в две клетки шириной перекрывается одной
 * башней. Пока по замку не ходили, это ничего не значило; локация (§4)
 * сделала это ошибкой, которую видно ногами.
 */
function yardPassable(w: number, yard: readonly Spot[], taken: readonly Spot[]): boolean {
  const busy = new Set(taken.map((s) => at(w, s.x, s.z)));
  const free = yard.filter((s) => !busy.has(at(w, s.x, s.z)));
  return free.length > 0 && yardWhole(w, free);
}

/**
 * Участок: прямоугольник, у которого сид вырезает до двух углов. Вырез —
 * единственный источник непрямых планов, и он же единственное место, где
 * генератор умеет отказаться: если после выреза цепь стен перестаёт быть
 * цепью или двор распадается надвое, вырез просто не применяется.
 */
function plan(
  rng: Rng,
  w: number,
  d: number,
): { inside: Uint8Array; wall: Uint8Array; ring: Spot[]; yard: Spot[] } {
  const inside = new Uint8Array(w * d).fill(1);
  let wall = wallMask(w, d, inside);
  let ring = walkRing(w, d, wall)!;
  let yard = yardOf(w, d, inside, wall);

  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const;
  const cuts = randInt(rng, 3);
  const used = new Set<number>();
  for (let i = 0; i < cuts; i++) {
    const which = randInt(rng, 4);
    if (used.has(which)) continue;
    used.add(which);
    const cw = 2 + randInt(rng, 2);
    const cd = 2 + randInt(rng, 2);
    // Вырез не имеет права съесть сторону целиком: три клетки прямого участка —
    // это минимум, на котором стена ещё читается стеной, а не углом.
    if (w - cw < 3 || d - cd < 3) continue;
    const [fx, fz] = corners[which]!;
    const next = Uint8Array.from(inside);
    for (let z = 0; z < cd; z++) {
      for (let x = 0; x < cw; x++) {
        next[at(w, fx ? w - 1 - x : x, fz ? d - 1 - z : z)] = 0;
      }
    }
    const nextWall = wallMask(w, d, next);
    const nextRing = walkRing(w, d, nextWall);
    if (nextRing === null) continue;
    const nextYard = yardOf(w, d, next, nextWall);
    if (!yardWhole(w, nextYard)) continue;
    inside.set(next);
    wall = nextWall;
    ring = nextRing;
    yard = nextYard;
  }
  return { inside, wall, ring, yard };
}

/** Перемешанная копия: порядок перебора решает сид, а не порядок в списке. */
function shuffled<T>(rng: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const swap = out[i]!;
    out[i] = out[j]!;
    out[j] = swap;
  }
  return out;
}

/**
 * Внешний пояс участка: расширяем занятый замком след на одну клетку по
 * восьми направлениям и вычитаем сам след. Диагонали нужны, чтобы у углов
 * воды не оставались квадратные прорехи.
 */
export function moatOf(ring: readonly Spot[], yard: readonly Spot[]): Spot[] {
  const inside = new Set([...ring, ...yard].map(keyOf));
  const moat = new Map<string, Spot>();
  for (const spot of [...ring, ...yard]) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const next = { x: spot.x + dx, z: spot.z + dz };
        const key = keyOf(next);
        if (!inside.has(key)) moat.set(key, next);
      }
    }
  }
  return [...moat.values()].sort((a, b) => a.z - b.z || a.x - b.x);
}

/* ---------- конструктор ---------- */

/** Что получилось из набора клеток. */
export interface Built {
  readonly pieces: readonly Piece[];
  /** Клетка, форма стыка и деталь, которая на неё встала. */
  readonly joints: readonly {
    readonly spot: Spot;
    readonly joint: Joint;
    readonly model: string;
    /** Ярусов, если на клетке башня. */
    readonly tower?: number;
  }[];
}

/** Ключ клетки в наборе башен: башни задаются местом, а не порядком. */
export const keyOf = (spot: Spot): string => `${spot.x}:${spot.z}`;

/**
 * **Конструктор стен.** Вход — любые клетки, хоть кольцо генератора, хоть
 * то, что наметил игрок. Выход — поставленные детали.
 *
 * Правило одно на все случаи и то же, что в §6.1.6: у клетки считаются
 * соседи среди тех же клеток, форма стыка выводится из их расположения,
 * деталь берётся по форме, поворот — по замеру. Ни одного условия
 * вида «если игрок строит буквой Г» здесь нет и быть не может: буква Г —
 * это два угла и прямая, и они получаются сами.
 *
 * Перекрёсток — единственное место, где набор отвечает «нет»: детали, у
 * которой ход шёл бы на все четыре стороны, в нём нет. Там встаёт башня,
 * и это не заглушка, а то, что на перекрёстке стен и стоит.
 */
export function buildWall(
  cells: readonly Spot[],
  rng: Rng = mulberry32(1),
  /** Клетки с башнями: ключ `keyOf`, значение — ярусы. */
  towers: ReadonlyMap<string, number> = new Map(),
): Built {
  const set = new Set(cells.map(keyOf));
  const pieces: Piece[] = [];
  const joints: { spot: Spot; joint: Joint; model: string; tower?: number }[] = [];

  for (const spot of cells) {
    const dirs = DIRS.map((d, i) => (set.has(`${spot.x + d[0]}:${spot.z + d[1]}`) ? i : -1))
      .filter((i) => i >= 0);
    const joint = jointOf(dirs);
    const bag = PARTS[joint];

    // Башня ставится там, где её поставили, — и на перекрёстке, где иначе
    // ставить нечего. Ход по стене на ней кончается: у шапки зубцы по всем
    // четырём рёбрам, и это измерено, а не решено.
    const level = towers.get(keyOf(spot));
    if (level !== undefined || bag.length === 0) {
      const floors = level ?? 1;
      pieces.push(...buildTower(spot, floors, rng));
      joints.push({ spot, joint, model: TOWER.base, tower: Math.max(1, Math.min(TOWER_MAX, floors)) });
      continue;
    }

    const choice = bag[randInt(rng, bag.length)]!;
    const turn = fitTurn(choice.open, dirs);
    if (turn < 0) continue;
    pieces.push({
      model: choice.model,
      x: spot.x,
      z: spot.z,
      y: 0,
      turn,
      role: joint === 'угол' ? 'угол' : 'стена',
    });
    joints.push({ spot, joint, model: choice.model });
  }
  return { pieces, joints };
}

/* ---------- осмысленное кольцо замка ---------- */

interface StraightRun {
  readonly spots: readonly Spot[];
}

/** Форма каждой клетки кольца — независимо от выбранной модели. */
function ringJoints(ring: readonly Spot[]): Map<string, Joint> {
  const set = new Set(ring.map(keyOf));
  return new Map(ring.map((spot) => {
    const dirs = DIRS.map((d, i) => set.has(`${spot.x + d[0]}:${spot.z + d[1]}`) ? i : -1)
      .filter((i) => i >= 0);
    return [keyOf(spot), jointOf(dirs)];
  }));
}

/** Последовательные прямые фасады кольца; первый и последний тоже соседи. */
function straightRuns(ring: readonly Spot[], joints: ReadonlyMap<string, Joint>): StraightRun[] {
  if (ring.length === 0) return [];
  const breakAt = ring.findIndex((spot) => joints.get(keyOf(spot)) !== 'прямая');
  if (breakAt < 0) return [{ spots: [...ring] }];
  const out: StraightRun[] = [];
  let current: Spot[] = [];
  for (let step = 1; step <= ring.length; step++) {
    const spot = ring[(breakAt + step) % ring.length]!;
    if (joints.get(keyOf(spot)) === 'прямая') {
      current.push(spot);
    } else if (current.length > 0) {
      out.push({ spots: current });
      current = [];
    }
  }
  if (current.length > 0) out.push({ spots: current });
  return out;
}

/** Наружная сторона клетки стены: там нет ни двора, ни другой стены. */
function outsideOf(spot: Spot, ring: ReadonlySet<string>, yard: ReadonlySet<string>): number {
  return DIRS.findIndex(([dx, dz]) =>
    !ring.has(`${spot.x + dx}:${spot.z + dz}`) && !yard.has(`${spot.x + dx}:${spot.z + dz}`));
}

/**
 * Ворота стоят в середине самого длинного фасада. Сид меняет предпочитаемую
 * сторону только при близких по длине вариантах: короткая задняя стенка не
 * выигрывает у парадного пролёта одной случайностью.
 */
function chooseGate(seed: number, ring: readonly Spot[], yard: readonly Spot[], joints: ReadonlyMap<string, Joint>): Spot {
  const ringSet = new Set(ring.map(keyOf));
  const yardSet = new Set(yard.map(keyOf));
  const preferred = seed >>> 3 & 3;
  let best: { spot: Spot; score: number } | null = null;
  for (const run of straightRuns(ring, joints)) {
    if (run.spots.length < 3) continue;
    const middles = run.spots.length % 2 === 0
      ? [run.spots[run.spots.length / 2 - 1]!, run.spots[run.spots.length / 2]!]
      : [run.spots[(run.spots.length / 2) | 0]!];
    for (const spot of middles) {
      const outside = outsideOf(spot, ringSet, yardSet);
      if (outside < 0) continue;
      const tie = ((spot.x * 17 + spot.z * 31 + seed) >>> 0) % 7;
      const score = run.spots.length * 100 + (outside === preferred ? 12 : 0) + tie;
      if (best === null || score > best.score) best = { spot, score };
    }
  }
  return best?.spot ?? ring.find((spot) => joints.get(keyOf(spot)) === 'прямая') ?? ring[0]!;
}

/**
 * Кольцо крепости использует тот же обмер стыков, что `buildWall`, но выбирает
 * варианты по роли. Контрфорсы держат ритм длинного фасада и обрамляют ворота,
 * внешние углы получают башни, вогнутые углы — одну согласованную семью.
 */
function buildCastleRing(
  seed: number,
  ring: readonly Spot[],
  yard: readonly Spot[],
  gate: Spot,
  towerStyle: TowerStyle,
  joints: ReadonlyMap<string, Joint>,
): { built: Built; towers: Spot[] } {
  const ringSet = new Set(ring.map(keyOf));
  const yardSet = new Set(yard.map(keyOf));
  const runs = straightRuns(ring, joints);
  const runAt = new Map<string, { at: number; length: number }>();
  for (const run of runs) run.spots.forEach((spot, at) => runAt.set(keyOf(spot), { at, length: run.spots.length }));
  const gateAt = ring.findIndex((spot) => keyOf(spot) === keyOf(gate));
  const ringAt = new Map(ring.map((spot, at) => [keyOf(spot), at]));
  const gateFrames = new Set([
    keyOf(ring[(gateAt + ring.length - 1) % ring.length]!),
    keyOf(ring[(gateAt + 1) % ring.length]!),
  ]);
  const outerCorners = ring.filter((spot) => {
    if (joints.get(keyOf(spot)) !== 'угол') return false;
    return DIRS.every(([dx, dz]) => !yardSet.has(`${spot.x + dx}:${spot.z + dz}`));
  });
  const towerKeys = new Set(outerCorners.map(keyOf));
  const theme = seed % 3;
  const pieces: Piece[] = [];
  const records: Built['joints'][number][] = [];

  for (const spot of ring) {
    const dirs = DIRS.map((d, i) => ringSet.has(`${spot.x + d[0]}:${spot.z + d[1]}`) ? i : -1)
      .filter((i) => i >= 0);
    const joint = joints.get(keyOf(spot))!;
    if (towerKeys.has(keyOf(spot))) {
      records.push({ spot, joint, model: towerStyle === 'шестигранные' ? HEX_TOWER.base : TOWER.base, tower: 1 });
      continue;
    }

    let choice: Part | undefined;
    if (joint === 'угол') {
      const model = ['wall-corner', 'wall-corner-slant', 'wall-corner-half'][theme]!;
      choice = PARTS['угол'].find((p) => p.model === model);
    } else if (joint === 'прямая') {
      const run = runAt.get(keyOf(spot));
      const position = ringAt.get(keyOf(spot)) ?? 0;
      const toGate = Math.min(Math.abs(position - gateAt), ring.length - Math.abs(position - gateAt));
      const buttress = gateFrames.has(keyOf(spot))
        || (toGate > 2 && run !== undefined && run.length >= 5
          && run.at > 0 && run.at < run.length - 1 && run.at % 3 === 2);
      choice = PARTS['прямая'].find((p) => p.model === (buttress ? 'wall-pillar' : 'wall'));
    } else {
      choice = PARTS[joint][0];
    }
    if (choice === undefined) continue;
    const turn = fitTurn(choice.open, dirs);
    if (turn < 0) continue;
    pieces.push({ model: choice.model, x: spot.x, z: spot.z, y: 0, turn, role: joint === 'угол' ? 'угол' : 'стена' });
    records.push({ spot, joint, model: choice.model });
  }
  return { built: { pieces, joints: records }, towers: outerCorners };
}

/* ---------- сборка ---------- */

/**
 * Замок по сиду. Один и тот же сид даёт один и тот же список деталей —
 * на этом держится и правило, и страница артбука, которая показывает
 * не «пример», а конкретный номер.
 */
export function generateCastle(seed: number): Castle {
  const rng = mulberry32(seed);
  // Стиль башен выбирается отдельным потоком: добавление варианта силуэта
  // не должно молча переставлять ворота и донжон у уже знакомого сида.
  const styleRng = mulberry32(seed ^ 0x48e7a6);
  const towerStyle: TowerStyle = randInt(styleRng, 2) === 0 ? 'квадратные' : 'шестигранные';
  const width = 6 + randInt(rng, 4);
  const depth = 6 + randInt(rng, 4);
  const { wall, ring, yard } = plan(rng, width, depth);
  const joints = ringJoints(ring);
  const gate = chooseGate(seed, ring, yard, joints);

  // Стыки остаются общими с пользовательской стройкой, но готовая крепость
  // получает архитектурную грамматику: ритм опор, усиленные внешние углы
  // и парадный пролёт вместо независимого броска на каждой клетке.
  const smart = buildCastleRing(seed, ring, yard, gate, towerStyle, joints);
  const built = smart.built;
  const pieces: Piece[] = [...built.pieces];
  const kind = new Map(built.joints.map((j) => [at(width, j.spot.x, j.spot.z), j.joint]));
  const towers: Spot[] = smart.towers;

  const raised = [...towers]
    .sort((a, b) => Math.abs(a.x - gate.x) + Math.abs(a.z - gate.z)
      - Math.abs(b.x - gate.x) - Math.abs(b.z - gate.z))
    .slice(0, 2);
  const raisedKeys = new Set(raised.map(keyOf));
  if (towerStyle === 'шестигранные') {
    towers.forEach((spot) => pieces.push(...buildHexTower(spot, styleRng, raisedKeys.has(keyOf(spot)))));
  } else {
    // Две башни ближайшего к воротам фронта выше: вход получает силуэт,
    // остальные углы остаются вровень со стеной и не превращают двор в лес.
    towers.forEach((spot) => pieces.push(...buildTower(spot, raisedKeys.has(keyOf(spot)) ? 2 : 1, styleRng)));
  }

  /* ---------- ворота ---------- */

  // Ворота встают только там, где стена прямая и соседи её тоже прямые:
  // арка в углу упёрлась бы в поворот хода.
  const gateDirs = ringNeighbors(width, depth, wall, gate.x, gate.z);
  // Створка перекрывает проезд, а он идёт поперёк стены: если стена тянется
  // вдоль z, ехать через неё можно только вдоль x.
  const alongZ = gateDirs.includes(2);
  for (let i = pieces.length - 1; i >= 0; i--) {
    if (pieces[i]!.x === gate.x && pieces[i]!.z === gate.z) pieces.splice(i, 1);
  }
  pieces.push({ model: 'tower-square-arch', x: gate.x, z: gate.z, y: 0, turn: 0, role: 'ворота' });
  const gateLeaf = towerStyle === 'шестигранные'
    ? 'metal-gate'
    : Math.min(width, depth) <= 6 ? 'door' : 'gate';
  pieces.push({
    // Створка продолжает язык всей крепости: металл у гексагонального
    // военного стиля, малая дверь у компактного, широкие ворота у большого.
    model: gateLeaf,
    x: gate.x,
    z: gate.z,
    y: 0,
    turn: alongZ ? 0 : 1,
    role: 'ворота',
  });
  pieces.push({ model: 'tower-square-top', x: gate.x, z: gate.z, y: FLOOR, turn: 0, role: 'ворота' });

  // Подъёмный мост лежит от центра ворот наружу. У модели ноль стоит
  // на петле, а полотно уходит в −x; поэтому нужен только поворот,
  // а не смещение, подобранное на глаз. Направление наружу — противоположно
  // соседней клетке двора.
  const inward = DIRS.findIndex((dir) => yard.some((s) => s.x === gate.x + dir[0] && s.z === gate.z + dir[1]));
  const opposite = [1, 0, 3, 2] as const;
  const outward = inward < 0 ? (alongZ ? 0 : 2) : opposite[inward]!;
  const bridgeTurn = fitTurn([true, false, false, false], [outward]);
  pieces.push({ model: 'bridge-draw', x: gate.x, z: gate.z, y: 0, turn: bridgeTurn, role: 'мост' });
  const bridgeSpot = { x: gate.x + DIRS[outward]![0], z: gate.z + DIRS[outward]![1] };
  const fixedBridge = gateLeaf === 'metal-gate' ? 'bridge-straight-pillar' : 'bridge-straight';
  pieces.push({
    model: fixedBridge,
    x: bridgeSpot.x,
    z: bridgeSpot.z,
    // У прямого моста настил на 1,04: опускаем опоры так, чтобы настил
    // совпал с дорогой и подъёмным полотном на нуле.
    y: -DECK[fixedBridge]!,
    turn: alongZ ? 1 : 0,
    role: 'мост',
  });
  const moat = moatOf(ring, yard);
  const gateInside = yard.find((s) => Math.abs(s.x - gate.x) + Math.abs(s.z - gate.z) === 1) ?? null;

  /* ---------- двор ---------- */

  // Двор мостится плитой набора — двумя треугольниками на клетку. Без неё
  // замок висит в пустоте: стены есть, а земли под ними нет, и кадр читается
  // не постройкой, а набором деталей.
  for (const spot of yard) {
    pieces.push({ model: 'ground', x: spot.x, z: spot.z, y: 0, turn: 0, role: 'двор' });
  }

  // Лестница: клетка двора у прямой стены, ход выходит к этой стене.
  const landings = yard.filter((s) =>
    (gateInside === null || keyOf(s) !== keyOf(gateInside)) && DIRS.some((dir) => {
      const nx = s.x + dir[0];
      const nz = s.z + dir[1];
      return (
        nx >= 0 && nz >= 0 && nx < width && nz < depth
        && wall[at(width, nx, nz)]
        && kind.get(at(width, nx, nz)) === 'прямая'
        && !(nx === gate.x && nz === gate.z)
      );
    }),
  );
  // Кандидаты перебираются в случайном порядке, и берётся первый, который
  // не запирает двор. Отказ тоже возможен: во дворе в одну клетку лестнице
  // места нет, и её просто не будет.
  const taken: Spot[] = [];
  for (const spot of shuffled(rng, landings)) {
    if (!yardPassable(width, yard, [spot])) continue;
    const toWall = DIRS.findIndex((dir) => {
      const nx = spot.x + dir[0];
      const nz = spot.z + dir[1];
      return nx >= 0 && nz >= 0 && nx < width && nz < depth && wall[at(width, nx, nz)];
    });
    const stair = STAIR_PARTS[randInt(rng, STAIR_PARTS.length)]!;
    const turn = fitTurn(stair.open, [toWall]);
    if (turn < 0) continue;
    pieces.push({ model: stair.model, x: spot.x, z: spot.z, y: 0, turn, role: 'лестница' });
    taken.push(spot);
    break;
  }

  /* ---------- донжон ---------- */

  // Башня во дворе, а не в кольце: башня глухая со всех сторон — это измерено, —
  // и, встав в кольцо, она разорвала бы ход поверху.
  const middle = (c: Spot): number =>
    Math.abs(c.x - (width - 1) / 2) + Math.abs(c.z - (depth - 1) / 2);
  const keep = [...yard]
    .sort((a, b) => middle(a) - middle(b))
    .find((s) => !taken.some((t) => t.x === s.x && t.z === s.z)
      && (gateInside === null || keyOf(s) !== keyOf(gateInside))
      && yardPassable(width, yard, [...taken, s])) ?? null;
  if (keep !== null) {
    taken.push(keep);
    // Отдельная каменная лестница стоит у входа донжона. Она выбирается
    // только среди соседних свободных клеток и не имеет права рассечь двор.
    const yardKeys = new Set(yard.map(keyOf));
    let keepStep: Spot | null = null;
    let entranceTurn: number | undefined;
    for (const dir of shuffled(rng, [0, 1, 2, 3])) {
      const spot = { x: keep.x + DIRS[dir]![0], z: keep.z + DIRS[dir]![1] };
      if (!yardKeys.has(keyOf(spot)) || taken.some((s) => keyOf(s) === keyOf(spot))) continue;
      if (gateInside !== null && keyOf(spot) === keyOf(gateInside)) continue;
      if (!yardPassable(width, yard, [...taken, spot])) continue;
      keepStep = spot;
      // Дверь и высокий край лестницы в исходных моделях смотрят в +z.
      entranceTurn = fitTurn([false, false, false, true], [dir]);
      const toKeep = [1, 0, 3, 2][dir]!;
      const stairTurn = fitTurn([false, false, false, true], [toKeep]);
      pieces.push({
        model: FREE_STAIRS[randInt(rng, FREE_STAIRS.length)]!,
        x: spot.x,
        z: spot.z,
        y: 0,
        turn: stairTurn,
        role: 'лестница',
      });
      taken.push(spot);
      break;
    }
    // Донжон выше стены всегда: в один ярус он с ней сравнялся бы и перестал
    // быть донжоном. Крыша вместо зубцов — он не боевая площадка.
    const floors = 2 + randInt(rng, TOWER_MAX - 1);
    pieces.push(...buildTower(keep, floors, rng, true, true, entranceTurn));
    pieces.push({
      model: TOWER.flags[randInt(rng, TOWER.flags.length)]!,
      x: keep.x,
      z: keep.z,
      y: FLOOR * floors,
      turn: randInt(rng, 4),
      role: 'знамя',
    });
    void keepStep;
  }

  /* ---------- внутреннее укрепление ---------- */

  // Две соседние клетки дают маленькую поперечную стену, а не второе кольцо.
  // Кандидат принимается только если вместе с лестницами и донжоном оставляет
  // весь свободный двор одной областью.
  const free = new Set(yard
    .filter((s) => !taken.some((t) => keyOf(t) === keyOf(s)))
    .filter((s) => gateInside === null || keyOf(s) !== keyOf(gateInside))
    .map(keyOf));
  const lines: { spots: readonly [Spot, Spot]; dir: number }[] = [];
  for (const spot of yard) {
    if (!free.has(keyOf(spot))) continue;
    for (const dir of [1, 3]) {
      const next = { x: spot.x + DIRS[dir]![0], z: spot.z + DIRS[dir]![1] };
      if (free.has(keyOf(next))) lines.push({ spots: [spot, next], dir });
    }
  }
  // Вторая линия обороны ставится поперёк оси «ворота → донжон» и ближе
  // к её середине. Так это барьер перед башней, а не случайный забор во дворе.
  const axisX = keep !== null && gateInside !== null
    ? Math.abs(keep.x - gateInside.x) >= Math.abs(keep.z - gateInside.z)
    : true;
  const wantedDir = axisX ? 3 : 1;
  const target = keep !== null && gateInside !== null
    ? { x: (keep.x + gateInside.x) / 2, z: (keep.z + gateInside.z) / 2 }
    : { x: (width - 1) / 2, z: (depth - 1) / 2 };
  const orderedLines = [...lines].sort((a, b) => {
    const score = (line: typeof lines[number]): number => {
      const x = (line.spots[0].x + line.spots[1].x) / 2;
      const z = (line.spots[0].z + line.spots[1].z) / 2;
      return (line.dir === wantedDir ? 0 : 100) + Math.abs(x - target.x) + Math.abs(z - target.z);
    };
    return score(a) - score(b) || keyOf(a.spots[0]).localeCompare(keyOf(b.spots[0]));
  });
  for (const line of orderedLines) {
    if (!yardPassable(width, yard, [...taken, ...line.spots])) continue;
    const family = towerStyle === 'квадратные' ? INNER_WALLS.stone : INNER_WALLS.wood;
    const turn = line.dir === 1 ? 1 : 0;
    const offset = (seed + line.spots[0].x * 3 + line.spots[0].z * 5) % family.length;
    line.spots.forEach((spot, i) => pieces.push({
      model: family[(i + offset) % family.length]!,
      x: spot.x,
      z: spot.z,
      y: 0,
      turn,
      role: 'укрепление',
    }));
    taken.push(...line.spots);
    break;
  }

  // Знамёна на угловых башенках — на высоте верха стены, а не крыши: у угла
  // с башенкой крыши нет вовсе.
  for (const spot of towers) {
    let y = WALL_TOP;
    if (towerStyle === 'шестигранные') {
      const roof = pieces.find((p) =>
        p.x === spot.x && p.z === spot.z && (HEX_TOWER.roofs as readonly string[]).includes(p.model));
      const roofAt = roof === undefined ? -1 : (HEX_TOWER.roofs as readonly string[]).indexOf(roof.model);
      if (roof !== undefined && roofAt >= 0) y = roof.y + HEX_TOWER.roofHeight[roofAt]!;
    } else {
      const cap = pieces.find((p) => p.x === spot.x && p.z === spot.z && p.model === TOWER.cap);
      if (cap !== undefined) y = cap.y + CAP;
    }
    pieces.push({ model: 'flag-pennant', x: spot.x, z: spot.z, y, turn: 0, role: 'знамя' });
  }

  // Настенные баннеры стоят на внешней плоскости прямых участков. Полклетки
  // выводит их из камня на грань стены; дробная координата здесь намеренна.
  const gateAt = ring.findIndex((spot) => keyOf(spot) === keyOf(gate));
  const bannerSpots: Spot[] = [];
  // Пара на одинаковом расстоянии от ворот образует фасад. Если пролёт
  // короткий, список ниже добирает ближайшие прямые клетки по кольцу.
  for (const offset of [-2, 2]) {
    const spot = ring[(gateAt + ring.length + offset) % ring.length]!;
    if (kind.get(at(width, spot.x, spot.z)) === 'прямая') bannerSpots.push(spot);
  }
  for (let distance = 1; distance < ring.length && bannerSpots.length < 2; distance++) {
    for (const direction of [-1, 1]) {
      const spot = ring[(gateAt + ring.length + distance * direction) % ring.length]!;
      if (kind.get(at(width, spot.x, spot.z)) !== 'прямая') continue;
      if (bannerSpots.some((old) => keyOf(old) === keyOf(spot))) continue;
      bannerSpots.push(spot);
      if (bannerSpots.length === 2) break;
    }
  }
  const banners: Spot[] = [];
  for (const spot of bannerSpots) {
    banners.push(spot);
    if (banners.length === 2) break;
  }
  const bannerModel = WALL_BANNERS[(seed >>> 5) % WALL_BANNERS.length]!;
  for (const spot of banners) {
    const outside = DIRS.findIndex((dir) => {
      const x = spot.x + dir[0];
      const z = spot.z + dir[1];
      return !yard.some((s) => s.x === x && s.z === z) && !ring.some((s) => s.x === x && s.z === z);
    });
    if (outside < 0) continue;
    const model = bannerModel;
    pieces.push({
      model,
      x: spot.x + DIRS[outside]![0] * 0.51,
      z: spot.z + DIRS[outside]![1] * 0.51,
      // Оба полотна подвешены верхним краем к ходу стены. Длинное уходит
      // основанием ниже земли, и видимой остаётся ровно фасадная часть.
      y: WALL_TOP - (model === 'flag-banner-short' ? 0.78 : 2.17),
      turn: outside < 2 ? 0 : 1,
      role: 'знамя',
    });
  }

  return { seed, width, depth, ring, yard, gate, moat, towerStyle, towers, pieces };
}
