/**
 * Гарнизон замка (§6.1.6): отряд, обходящий периметр, и стрелок, который
 * иногда выходит на стену. Локация замка до этого стояла пустой намеренно —
 * постройка была, а живущих в ней не было, — и первое, чем её наполняют,
 * это не добыча и не бой, а то, что показывает: замок чей-то.
 *
 * **Гарнизон ничего не решает и ничем не грозит.** Он не занимает клеток,
 * не мешает ходьбе, не дерётся и не попадает в `GameLocation.enemies`:
 * замок остаётся прогулкой, а не сделкой (§4). Поэтому и файл такой: здесь
 * нет состояния, которое кто-то обязан продвигать шагом, — есть чистые
 * функции времени. `patrolAt(g, t)` и `archerAt(g, t)` при одном сиде и одном
 * `t` дают одно и то же, сколько бы раз их ни позвали и в каком угодно
 * порядке. Отсюда и проверяемость: правила гоняют весь час обхода в Node,
 * не заводя ни кадра.
 *
 * **Маршрут — прямоугольник снаружи стены, и это выведено, а не выбрано.**
 * Кольца по верху стены не существует: ход рвётся на воротах и на каждой
 * башне (это измерено, §6.1.6), и «обойти периметр поверху» нельзя ни в одном
 * замке. Двор камера прячет за стеной — она выше героя вдвое. Снаружи же
 * поле шириной четыре клетки свободно по построению площадки, и обход по нему
 * замкнут при любом плане, включая вырезанные углы: прямоугольник охватывает
 * след замка целиком.
 *
 * **Стрелок ходит там, где ходить можно.** Клетки верха берутся тем же
 * правилом, что и в лагере: у детали есть площадка и есть хоть одно открытое
 * ребро. Разрывы получаются сами — башня и ворота их и делают, — и стрелок
 * появляется на краю участка, у самого разрыва: выйти на стену иначе как
 * из башни или с лестницы неоткуда, и появление посреди прогона читалось бы
 * как подмена кадра.
 */
import { mulberry32, randInt } from '../core/rng';
import {
  CASTLE_CELL,
  DIRS,
  deckOf,
  keyOf,
  partOf,
  type Castle,
  type Piece,
  type Spot,
} from './castle';

/* ---------- числа ---------- */

/**
 * Сколько клеток локации между следом замка и тропой обхода. Единица —
 * это вплотную к стене: отряд идёт по её подножию, а не гуляет по полю.
 * Больше поле не позволяет с запасом: его четыре клетки, и последняя
 * из них — лес.
 */
export const PATROL_GAP = 1;

/**
 * Скорость обхода, клеток в секунду. Медленнее героя (2,6): он идёт по делу,
 * а отряд стоит в карауле. Медленнее вдвое было бы уже не ходьбой — клип
 * ходьбы растягивается под скорость, и на 0,8 ноги начинают шаркать.
 */
export const PATROL_SPEED = 1.5;

/** Сколько рыцарей в отряде и на сколько клеток они растянуты в колонне. */
export const SQUAD = 4;
export const SQUAD_STEP = 1.3;

/**
 * Скорость стрелка по стене, клеток локации в секунду. Он идёт по узкому
 * ходу, и идёт неспешно. Мерка та же, что у отряда, — клетка локации,
 * а не клетка набора: шаг по стене длиной в две клетки локации, и считать
 * его единицей значило бы гнать стрелка вдвое быстрее объявленного.
 */
export const ARCHER_SPEED = 1.2;

/**
 * Смена стрелка. Цикл один на все смены, и внутри него стрелка нет дольше,
 * чем есть: «иногда» — это отсутствие как состояние по умолчанию, а не
 * пауза между появлениями.
 *
 * `ARCHER_CYCLE` — период, `ARCHER_REST` — сколько от начала цикла стены
 * пусты, `ARCHER_STAND` — сколько стрелок стоит на месте, `ARCHER_STEPS` —
 * насколько далеко он уходит от разрыва, откуда вышел, в клетках набора.
 */
export const ARCHER_CYCLE = 48;
export const ARCHER_REST = 17;
export const ARCHER_STAND = 14;
export const ARCHER_STEPS = 4;

/* ---------- то, что считается один раз ---------- */

/** Точка стены, на которой можно стоять: клетка локации и высота хода. */
export interface Post {
  readonly x: number;
  readonly z: number;
  /** Высота площадки в клетках локации. */
  readonly y: number;
  /** Куда смотреть с неё наружу, в радианах. */
  readonly facing: number;
}

/** Участок хода без разрывов: по нему стрелок и ходит. */
export interface Run {
  readonly posts: readonly Post[];
}

export interface Garrison {
  readonly seed: number;
  /** Тропа обхода: замкнутая ломаная по углам прямоугольника. */
  readonly route: readonly { readonly x: number; readonly z: number }[];
  /** Длина тропы в клетках локации. */
  readonly length: number;
  /** По часовой стрелке или против — решает сид. */
  readonly way: 1 | -1;
  /** Участки верха стены. Пусто — стрелку выходить некуда. */
  readonly runs: readonly Run[];
}

/** Клетка локации, в которую попадает клетка плана: центр её квадрата. */
const centerOf = (at: Spot, spot: Spot): { x: number; z: number } => ({
  x: at.x + spot.x * CASTLE_CELL + (CASTLE_CELL - 1) / 2,
  z: at.z + spot.z * CASTLE_CELL + (CASTLE_CELL - 1) / 2,
});

/**
 * Деталь, стоящая на клетке плана в основании. Ярусы башни и шапка ворот
 * лежат выше нуля и на вопрос «по чему тут ходят» не отвечают: ходят
 * по той детали, что стоит на земле.
 */
function baseAt(castle: Castle, spot: Spot): Piece | undefined {
  return castle.pieces.find((p) => p.x === spot.x && p.z === spot.z && p.y === 0 && p.role !== 'двор');
}

/**
 * Проходима ли клетка стены поверху. Правило то же, что у верха лагеря
 * (§6.1.6), и второй его копии тут нет по существу: у детали есть площадка
 * и есть хоть одно открытое ребро. Незнакомая деталь — не проходима:
 * арка ворот, шапка над ней и башня отвечают «нет» именно так.
 */
function deckOfSpot(castle: Castle, spot: Spot): number | null {
  const piece = baseAt(castle, spot);
  if (piece === undefined) return null;
  const deck = deckOf(piece.model);
  const part = partOf(piece.model);
  if (deck === null || part === undefined || !part.open.some(Boolean)) return null;
  return deck;
}

/**
 * Куда клетка стены смотрит наружу. Наружу — та сторона, за которой нет
 * ни двора, ни стены: двор известен планом, и гадать не приходится. У угла
 * таких сторон две, и берётся первая — обе одинаково наружу.
 *
 * Диагонали перебираются после сторон, и это не запас на всякий случай.
 * Стена считается по восьми направлениям (§6.1.6), поэтому у внутреннего
 * угла выреза все четыре стороны заняты стеной и двором, а снаружи он
 * граничит только углом. Без диагоналей такая клетка «смотрела» бы на север.
 */
function outwardOf(castle: Castle, spot: Spot): number {
  const ring = new Set(castle.ring.map(keyOf));
  const yard = new Set(castle.yard.map(keyOf));
  const outside = (dx: number, dz: number): boolean => {
    const key = `${spot.x + dx}:${spot.z + dz}`;
    return !ring.has(key) && !yard.has(key);
  };
  for (const [dx, dz] of DIRS) if (outside(dx, dz)) return Math.atan2(dx, dz);
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) if (outside(dx, dz)) return Math.atan2(dx, dz);
  }
  return 0;
}

/**
 * Участки хода: обход кольца режется разрывами на цепочки. Кольцо приходит
 * замкнутым и упорядоченным (`castle.ring`), поэтому список сначала
 * прокручивается до первого разрыва — иначе участок, лежащий на стыке
 * начала и конца списка, распался бы надвое на пустом месте.
 */
function runsOf(castle: Castle, at: Spot): Run[] {
  const ring = castle.ring;
  const decks = ring.map((spot) => deckOfSpot(castle, spot));
  const start = decks.findIndex((d) => d === null);
  // Разрыва нет вовсе — такого замка не бывает (ворота его и делают), но
  // выдумывать на этот случай нечего: одного участка на всё кольцо хватит.
  if (start < 0) {
    return [{ posts: ring.map((spot, i) => postOf(castle, at, spot, decks[i]!)) }];
  }

  const runs: Run[] = [];
  let current: Post[] = [];
  for (let i = 1; i <= ring.length; i++) {
    const index = (start + i) % ring.length;
    const deck = decks[index]!;
    if (deck === null) {
      if (current.length > 0) runs.push({ posts: current });
      current = [];
      continue;
    }
    current.push(postOf(castle, at, ring[index]!, deck));
  }
  if (current.length > 0) runs.push({ posts: current });
  return runs;
}

const postOf = (castle: Castle, at: Spot, spot: Spot, deck: number): Post => ({
  ...centerOf(at, spot),
  y: deck * CASTLE_CELL,
  facing: outwardOf(castle, spot),
});

/**
 * Гарнизон площадки. Считается один раз на заход: ни одно из этих чисел
 * не меняется, пока стоит замок.
 */
export function garrisonOf(site: { castle: Castle; at: Spot }): Garrison {
  const { castle, at } = site;
  const x0 = at.x - PATROL_GAP;
  const z0 = at.z - PATROL_GAP;
  const x1 = at.x + castle.width * CASTLE_CELL - 1 + PATROL_GAP;
  const z1 = at.z + castle.depth * CASTLE_CELL - 1 + PATROL_GAP;
  const route = [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ];
  const length = 2 * (x1 - x0) + 2 * (z1 - z0);
  const rng = mulberry32(castle.seed ^ 0x6c07);
  return {
    seed: castle.seed,
    route,
    length,
    way: randInt(rng, 2) === 0 ? 1 : -1,
    runs: runsOf(castle, at),
  };
}

/* ---------- обход ---------- */

/** Где идущий, прошедший `s` клеток от угла тропы, и куда он смотрит. */
export interface Marcher {
  readonly x: number;
  readonly z: number;
  readonly facing: number;
}

function alongRoute(g: Garrison, s: number): Marcher {
  let left = ((s % g.length) + g.length) % g.length;
  for (let i = 0; i < g.route.length; i++) {
    const from = g.route[i]!;
    const to = g.route[(i + 1) % g.route.length]!;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const side = Math.abs(dx) + Math.abs(dz);
    if (left > side) {
      left -= side;
      continue;
    }
    const share = left / side;
    return {
      x: from.x + dx * share,
      z: from.z + dz * share,
      facing: Math.atan2(Math.sign(dx), Math.sign(dz)),
    };
  }
  // Сюда не приходят: сумма сторон и есть длина. Но угол вернуть честнее,
  // чем ничего.
  return { x: g.route[0]!.x, z: g.route[0]!.z, facing: 0 };
}

/**
 * Отряд на момент `t` секунд от входа в локацию. Колонна, а не цепь по всему
 * периметру: отряд — это те, кто идёт вместе, и растянутый на четыре стороны
 * он читался бы четырьмя одиночками.
 */
export function patrolAt(g: Garrison, t: number): Marcher[] {
  const head = t * PATROL_SPEED * g.way;
  const out: Marcher[] = [];
  for (let i = 0; i < SQUAD; i++) out.push(alongRoute(g, head - i * SQUAD_STEP * g.way));
  return out;
}

/* ---------- стрелок ---------- */

/** Стрелок на стене: где стоит и идёт ли. */
export interface Archer extends Post {
  readonly walking: boolean;
}

/**
 * Смена стрелка на момент `t`. `null` — стены пусты, и это состояние по
 * умолчанию: цикл длиннее смены.
 *
 * Смена собирается сидом от номера цикла, поэтому она не хранится: второй
 * заход в тот же замок даст ту же очередь смен, а перемотка времени вперёд
 * и назад — один и тот же кадр.
 */
export function archerAt(g: Garrison, t: number): Archer | null {
  if (g.runs.length === 0 || t < 0) return null;
  const cycle = Math.floor(t / ARCHER_CYCLE);
  const local = t - cycle * ARCHER_CYCLE;
  if (local < ARCHER_REST) return null;

  const rng = mulberry32((g.seed ^ 0x51ed) + cycle * 0x9e37);
  const run = g.runs[randInt(rng, g.runs.length)]!;
  // С какого конца участка вышел: у разрыва стоит башня или ворота, и выйти
  // на стену можно только оттуда.
  const fromEnd = randInt(rng, 2) === 0;
  const posts = fromEnd ? [...run.posts].reverse() : run.posts;
  // Куда дошёл. Дальше `ARCHER_STEPS` не уходит: смена — это выйти на свой
  // участок, а не обойти замок.
  const steps = Math.min(posts.length - 1, 1 + randInt(rng, ARCHER_STEPS));

  // Секунда на клетку набора: клетка набора — это `CASTLE_CELL` клеток
  // локации, и без множителя стрелок шёл бы вдвое быстрее объявленного.
  const perPost = CASTLE_CELL / ARCHER_SPEED;
  const walk = steps * perPost;
  const since = local - ARCHER_REST;
  if (since > 2 * walk + ARCHER_STAND) return null;

  // Стоит: на своей клетке и лицом наружу.
  if (since >= walk && since <= walk + ARCHER_STAND) {
    return { ...posts[steps]!, walking: false };
  }

  // Идёт: туда от края, обратно — к краю.
  const passed = (since < walk ? since : 2 * walk + ARCHER_STAND - since) / perPost;
  const back = since >= walk;
  const cell = Math.min(posts.length - 1, Math.floor(passed));
  const next = Math.min(posts.length - 1, cell + 1);
  const share = passed - cell;
  const from = posts[cell]!;
  const to = posts[next]!;
  const x = from.x + (to.x - from.x) * share;
  const z = from.z + (to.z - from.z) * share;
  const dx = (to.x - from.x) * (back ? -1 : 1);
  const dz = (to.z - from.z) * (back ? -1 : 1);
  return {
    x,
    z,
    y: from.y + (to.y - from.y) * share,
    // На последней клетке участка идти уже некуда, и направление берётся
    // у той стороны, откуда пришли: ноль развернул бы стрелка на север.
    facing: dx === 0 && dz === 0 ? from.facing : Math.atan2(dx, dz),
    walking: true,
  };
}
