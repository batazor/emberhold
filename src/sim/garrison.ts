/**
 * Кто в замке (§6.1.6, §6.1.6.1). Трое родом: смена у ворот и на обходе,
 * стрелок, который иногда выходит на стену, и жильцы двора. Локация замка
 * до этого стояла пустой намеренно — постройка была, а живущих в ней
 * не было, — и первое, чем её наполняют, это не добыча и не бой, а то,
 * что показывает: замок чей-то.
 *
 * **Все трое считаются одним способом, и это решение.** Сперва жильцы были
 * написаны отдельным модулем со своим состоянием, которое кто-то обязан
 * продвигать шагом; двух систем ходьбы в одной локации не бывает — одну
 * из них перестанут понимать. Жильцы переписаны здесь и тем же способом:
 * чистой функцией времени.
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
 * **Маршрут — петля от ворот вокруг стены, и это выведено, а не выбрано.**
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
import { mulberry32, randInt, type Rng } from '../core/rng';
import {
  CASTLE_CELL,
  CASTLE_PATROL_GAP,
  DIRS,
  deckOf,
  keyOf,
  partOf,
  type Castle,
  type Piece,
  type Spot,
} from './castle';
import { keepApart } from './crowd';
import { idx } from './grid';
import { findPath } from './pathfinding';
import type { Cell, GameLocation } from './types';

/* ---------- числа ---------- */

/**
 * Сколько клеток локации между следом замка и тропой обхода. Две занимает
 * ров, третья выносит дозор на сухой внешний берег. Дальше лежит пояс
 * скал и деревьев, поэтому маршрут остаётся между водой и окружением.
 */
export const PATROL_GAP = CASTLE_PATROL_GAP;

/**
 * Скорость обхода, клеток в секунду. Медленнее героя (2,6): он идёт по делу,
 * а отряд стоит в карауле. Медленнее вдвое было бы уже не ходьбой — клип
 * ходьбы растягивается под скорость, и на 0,8 ноги начинают шаркать.
 */
export const PATROL_SPEED = 1.5;

/** Сколько рыцарей в гарнизоне: две смены по двое. */
export const SQUAD = 4;
export const PATROL_GROUPS = 2;
export const PATROL_PAIR = 2;

/** Сколько смена стоит у ворот перед тем, как уйти в обход или встать на пост. */
export const PATROL_HANDOFF = 5.2;

/**
 * Речь постовых: короткие пары строк. Это диалог людей, но без обращения
 * к игроку; в пузыре слышно, что смена живая, а не рассказывается правило.
 */
export const GARRISON_TEXT = {
  quiet: 'У ворот тихо',
  quietBack: 'Тихо тоже служба',
  lantern: 'Фонарь коптит',
  lanternBack: 'Зато тени честные',
  wall: 'Северная стена чиста',
  wallBack: 'Запишем как чудо',
  relief: 'Смена пришла',
  reliefBack: 'Ноги голосуют за пост',
  bushes: 'Кусты шуршат по уставу',
  bushesBack: 'Пусть шуршат строем',
} as const;

const GARRISON_DIALOGS: readonly (readonly [keyof typeof GARRISON_TEXT, keyof typeof GARRISON_TEXT])[] = [
  ['quiet', 'quietBack'],
  ['lantern', 'lanternBack'],
  ['wall', 'wallBack'],
  ['relief', 'reliefBack'],
  ['bushes', 'bushesBack'],
];

const GARRISON_TALK_CYCLE = 31;
const GARRISON_TALK_LINE = 2.4;

/**
 * Полоса пары. В смене двое идут рядом, а не в одну точку, и стоят у ворот
 * по двум сторонам прохода. Больше разводить нельзя: обход идёт вплотную
 * к стене, а поле вокруг замка всего четыре клетки.
 */
const PAIR_LANE = 0.32;
const POST_RELIEF = 0.28;

/**
 * Покачивание — свойство **тропы**, а не идущего: волна одна на всех, и её
 * фаза берётся от места на тропе, а не от пройденного пути. Своя фаза
 * у каждого съедала бы просвет между полосами ровно там, где он нужен, —
 * в момент, когда двое поравнялись.
 */
const PATROL_SWAY = 0.16;
const PATROL_SWAY_LEN = 8.0;
/**
 * На скольких клетках у угла направление сдвига поворачивается. Число не
 * косметическое: чем короче поворот, тем большую дугу описывает внешняя
 * полоса и тем заметнее рыцарь на ней разгоняется. На 1,6 клетки внешний
 * шёл вдвое быстрее ходьбы, на 2,6 — в полтора раза.
 */
const PATROL_CORNER = 2.6;



/**
 * Потолок шага между кадрами, долями от `PATROL_SPEED`. Не единица: рыцарь
 * идёт не по тропе, а по своей полосе, и на повороте внешняя полоса описывает
 * дугу длиннее тропы — идущий по ней проходит за кадр больше. Число снято
 * замером по сотне сидов, а не выбрано на глаз.
 *
 * Кадр, на котором рядом кто-то ближе `BODY`, этим потолком не мерится:
 * там работает разведение (`sim/crowd.ts`), и его сдвиг — отдельное
 * обещание с отдельной меркой. См. правило про непрерывность шага.
 */
export const PATROL_STEP_MAX = 1.8;

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

/**
 * Жильцы двора. Гарнизон стережёт, а живёт в замке кто-то ещё, и отличить
 * одно от другого можно только силуэтом — тем же правилом, каким различаются
 * скелеты (§15) и сам гарнизон: снаряжение, а не порода.
 *
 * ВРЕМЕННОЕ, §0.1: рабочие подписи, а не имена мира.
 */
export type DwellerLook = 'поселенец' | 'поселенка' | 'торговец' | 'кузнец' | 'охотник';

/**
 * Кем выходят гуляющие. Торговца в списке нет намеренно: он не выбирается
 * очередью, а ставится отдельно и единственный — стоящий (§13.5).
 * Кузнеца и охотника нет по той же причине: они не гуляющие из очереди,
 * а ремесленники со своим местом у края двора и короткой отлучкой от него.
 */
export const DWELLER_LOOKS: readonly DwellerLook[] = ['поселенец'];

/** Ремесленники: своё место у дела, долгая стоянка на нём и короткий круг. */
export const CRAFT_LOOKS: ReadonlySet<DwellerLook> = new Set(['кузнец', 'охотник']);

/**
 * Сколько ремесленник стоит на клетке дела между отлучками. Против пары
 * десятков секунд хода по кольцу это большая часть цикла: двор читает его
 * занятым делом, которое иногда отпускает, — а не четвёртым поселенцем.
 */
export const CRAFT_REST = 26;

/**
 * Шаг жильца — медленнее и гарнизона, и героя (1,67 клетки в секунду,
 * §17.4). Дозор идёт по делу, герой тем более; жилец никуда не идёт,
 * он тут живёт.
 */
export const DWELLER_SPEED = 0.85;

/** Сколько жилец стоит на углу обхода. Ровно затем, чтобы стоящего было
 *  видно стоящим: обход без остановок — конвейер, а не жизнь двора. */
export const DWELLER_STAND = 2.4;

/** Свободных клеток двора на одного жильца. Как и привидения на кладбище
 *  (§6.1.7.1), жильцы считаются плотностью: двор выпадает разный, и число,
 *  верное на одном, на другом означало бы толпу или пустоту. */
const DWELLER_TILES = 34;
const DWELLERS_MIN = 2;
const DWELLERS_MAX = 4;

/** Углов у обхода. Два дали бы хождение по отрезку туда-обратно, четыре
 *  на тесном дворе не находят места друг от друга. */
const YARD_CORNERS = 3;

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

/** Обход жильца: замкнутая ломаная по клеткам двора и углы, на которых
 *  он останавливается постоять. */
export interface YardWalk {
  readonly look: DwellerLook;
  readonly path: readonly Cell[];
  /** Индексы вершин `path`, на которых жилец стоит по прибытии. */
  readonly stops: readonly number[];
  /** Полный круг в секундах — ход плюс все стоянки. */
  readonly cycle: number;
  /**
   * Стоянка на клетке дела — `path[0]` — вместо обычной `DWELLER_STAND`.
   * Есть только у ремесленников: их круг — это не прогулка, а отлучка,
   * и большую часть цикла они проводят дома.
   */
  readonly rest?: number;
}

export interface Garrison {
  readonly seed: number;
  /** Тропа обхода: замкнутая ломаная от ворот вокруг стены. */
  readonly route: readonly { readonly x: number; readonly z: number }[];
  /** Длина тропы в клетках локации. */
  readonly length: number;
  /** Сколько длится одна служба: выйти в обход, вернуться к воротам, сдать пост. */
  readonly shift: number;
  /** Сидовый сдвиг часов: при входе игрок не видит караул всегда в одной фазе. */
  readonly start: number;
  /** По часовой стрелке или против — решает сид. */
  readonly way: 1 | -1;
  /** Две клетки поста у ворот, по одной на человека смены. */
  readonly posts: readonly { readonly x: number; readonly z: number; readonly facing: number }[];
  /** Линия наружу от ворот: нужна постовым, чтобы смотреть в поле. */
  readonly gateOut: readonly [number, number];
  /** Личный сдвиг каждого рыцаря: двое в смене идут рядом, а не в одну точку. */
  readonly gait: readonly { readonly lane: number }[];
  /** Участки верха стены. Пусто — стрелку выходить некуда. */
  readonly runs: readonly Run[];
  /** Обходы жильцов двора. Пусто — двор не даёт замкнуть ни одного кольца. */
  readonly yard: readonly YardWalk[];
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

/* ---------- двор ---------- */

/** Свободные клетки двора в клетках локации. */
function yardTiles(castle: Castle, at: Spot, loc: GameLocation): Cell[] {
  const out: Cell[] = [];
  for (const spot of castle.yard) {
    for (let dz = 0; dz < CASTLE_CELL; dz++) {
      for (let dx = 0; dx < CASTLE_CELL; dx++) {
        const x = at.x + spot.x * CASTLE_CELL + dx;
        const z = at.z + spot.z * CASTLE_CELL + dz;
        if (x < 0 || z < 0 || x >= loc.size || z >= loc.size) continue;
        if (loc.blocked[idx(loc.size, x, z)] === 0) out.push({ x, z });
      }
    }
  }
  return out;
}

/**
 * Обходы жильцов. Считаются по **маске двора, а не по всей локации**:
 * проезд под воротами проходим, и кратчайший путь между двумя углами двора
 * имел бы полное право выйти наружу и вернуться. Жилец, гуляющий по лесу
 * вокруг замка, — не жилец замка, а второй дозор.
 *
 * Путь ищет тот же `findPath`, которым ходит герой: другой поиск дал бы
 * жильцу право пройти там, где герой не пройдёт, и это читалось бы
 * как ошибка стены, а не как выбор маршрута.
 */
function yardWalks(
  castle: Castle,
  at: Spot,
  loc: GameLocation,
  trader: Cell | null,
): YardWalk[] {
  const tiles = yardTiles(castle, at, loc);
  if (tiles.length === 0) return [];

  const mask = new Uint8Array(loc.size * loc.size).fill(1);
  for (const t of tiles) mask[idx(loc.size, t.x, t.z)] = 0;
  /**
   * Клетка торговца закрыта для чужих обходов. Разведение тел (`sim/crowd.ts`)
   * тут не помощник, а помеха: торговец неподвижен, и жилец, чей круг проложен
   * прямо сквозь него, каждый заход отталкивался бы от него в сторону — на
   * подходе в одну, на отходе в другую. Дорога, проложенная мимо, снимает
   * вопрос там, где он возникает.
   */
  if (trader !== null) mask[idx(loc.size, trader.x, trader.z)] = 1;

  const rng = mulberry32(castle.seed ^ 0x5f0c);
  const count = Math.max(
    DWELLERS_MIN,
    Math.min(DWELLERS_MAX, Math.round(tiles.length / DWELLER_TILES)),
  );
  // Порог «врозь» — половина стороны двора. На тесном дворе он недостижим,
  // и тогда берётся что нашлось: пусть жилец ходит мало, чем не ходит.
  const apart = Math.max(2, Math.round(Math.sqrt(tiles.length) / 2));

  const out: YardWalk[] = [];

  /**
   * Торговец (§13.5) — один из жильцов, и стоит он на месте. До сих пор
   * лавка была точкой без тела: во дворе, где никого нет, невидимый торговец
   * никому не мешал. С жильцами он стал единственным невидимым человеком
   * среди видимых — игрок подходил бы к магу и ничего не получал, а панель
   * открывалась бы от пустого места.
   *
   * **Стоящий и есть указатель.** Во дворе, где остальные гуляют, тот, кто
   * не двигается, — это тот, к кому подходят; панель на подходе только
   * подтверждает прочитанное. Второго органа — значка над головой,
   * подсветки — не заводится: жест здесь один, как и в вылазке.
   */
  if (trader !== null) {
    out.push({
      look: 'торговец',
      path: [trader],
      stops: [0],
      cycle: DWELLER_STAND,
    });
  }

  /**
   * Кузнец и охотник — при деле, а не на прогулке. Место каждого — **у края
   * двора**, не на проходе: стоящий посреди двора читается указателем — тем
   * самым, каким торговец зовёт к обмену (§13.5), — а стоящий у стены
   * читается занятым делом. Но дело отпускает: раз в цикл ремесленник
   * обходит пару углов двора и возвращается — короткая отлучка
   * (`CRAFT_REST` дома против пары десятков секунд хода), а не четвёртый
   * поселенец. Клетка дела закрывается для чужих обходов по той же причине,
   * что у торговца: подолгу стоящего не расталкивают, его обходят дорогой.
   */
  const edge = tiles.filter((c) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
      const x = c.x + dx!;
      const z = c.z + dz!;
      return x < 0 || z < 0 || x >= loc.size || z >= loc.size
        || mask[idx(loc.size, x, z)] !== 0;
    }));
  /** Гуляющих считает плотность двора; стоящие ремесленники в её счёт
   *  не входят, иначе тесный двор остался бы вовсе без движения. */
  const walkersFrom = out.length;
  for (const look of ['кузнец', 'охотник'] as const) {
    const spots = (edge.length > 0 ? edge : tiles).filter(
      (c) => mask[idx(loc.size, c.x, c.z)] === 0
        && out.every((w) => Math.hypot(w.path[0]!.x - c.x, w.path[0]!.z - c.z) >= apart),
    );
    if (spots.length === 0) continue;
    const home = spots[randInt(rng, spots.length)]!;

    // Отлучка: короткое кольцо от дела через два угла двора и обратно.
    // Углы ближе, чем у поселенцев (`apart / 2`): это обход своего угла
    // двора, а не прогулка по всему. Не замкнулось — ремесленник просто
    // стоит: пусть двор потеряет отлучку, чем кузнеца.
    let path: Cell[] = [home];
    let stops: number[] = [0];
    let length = 0;
    for (let attempt = 0; attempt < 8 && length === 0; attempt++) {
      const corners: Cell[] = [home];
      for (let c = 0; c < 2; c++) {
        let pick: Cell | null = null;
        for (let tries = 0; tries < 24 && pick === null; tries++) {
          const cand = tiles[randInt(rng, tiles.length)]!;
          // Угол отлучки не дальше `apart` от дела: кольцо обходит свой
          // угол двора, а не весь двор.
          if (mask[idx(loc.size, cand.x, cand.z)] === 0
            && Math.hypot(home.x - cand.x, home.z - cand.z) <= apart
            && corners.every((s) => Math.hypot(s.x - cand.x, s.z - cand.z) >= Math.max(2, apart / 2))) {
            pick = cand;
          }
        }
        if (pick !== null) corners.push(pick);
      }
      if (corners.length < 3) continue;
      const legs: Cell[] = [home];
      const ends: number[] = [];
      let broken = false;
      for (let c = 0; c < corners.length; c++) {
        const leg = findPath(loc.size, mask, corners[c]!, corners[(c + 1) % corners.length]!);
        if (leg.length === 0) {
          broken = true;
          break;
        }
        legs.push(...leg);
        ends.push(legs.length - 1);
      }
      if (broken) continue;
      legs.pop();
      let laps = 0;
      for (let k = 0; k < legs.length; k++) {
        const a = legs[k]!;
        const b = legs[(k + 1) % legs.length]!;
        laps += Math.hypot(b.x - a.x, b.z - a.z);
      }
      // Отлучка короче дела по построению: кольцо, на которое уходит
      // больше `CRAFT_REST` хода, — уже прогулка, и такая попытка бракуется.
      if (laps / DWELLER_SPEED > CRAFT_REST) continue;
      path = legs;
      stops = ends.map((v) => v % legs.length);
      length = laps;
    }

    mask[idx(loc.size, home.x, home.z)] = 1;
    out.push({
      look,
      path,
      stops,
      // Стоянки на углах — обычные, дома — долгая: отлучка, а не прогулка.
      cycle: length / DWELLER_SPEED + (stops.length - 1) * DWELLER_STAND + CRAFT_REST,
      rest: CRAFT_REST,
    });
  }

  /**
   * Занятое чужими кругами. Круги разводятся по клеткам, а не по телам:
   * двое, идущие навстречу по одной дорожке, расталкиваются каждый кадр,
   * и направление толчка на встречном курсе разворачивается почти мгновенно —
   * со стороны это дрожь, а не «разошлись». Дорожки, проложенные врозь,
   * снимают вопрос там, где он возникает.
   *
   * Если врозь не вышло — двор тесен, — круг прокладывается по общей маске:
   * пусть двое пересекаются и расходятся телами, чем двор останется пустым.
   */
  const taken = Uint8Array.from(mask);

  for (let i = walkersFrom; i < count; i++) {
    // Углы выбираются с попытками: круг, проложенный врозь с чужими, находится
    // не с первого набора углов, а жилец, потерянный из-за неудачного набора,
    // оставил бы двор пустее обещанного.
    let corners: Cell[] = [];
    let path: Cell[] = [];
    let stops: number[] = [];
    let broken = true;
    for (let attempt = 0; attempt < 8 && broken; attempt++) {
      corners = [];
      for (let c = 0; c < YARD_CORNERS; c++) {
        let pick: Cell | null = null;
        for (let tries = 0; tries < 24 && pick === null; tries++) {
          const cand = tiles[randInt(rng, tiles.length)]!;
          if (corners.every((s) => Math.hypot(s.x - cand.x, s.z - cand.z) >= apart)) pick = cand;
        }
        corners.push(pick ?? tiles[randInt(rng, tiles.length)]!);
      }

      // Сперва врозь с чужими кругами, и только если так не вышло —
      // по общей маске: пусть двое пересекаются, чем двор останется пустым.
      const boards = attempt < 6 ? [taken] : [taken, mask];
      for (const board of boards) {
        if (corners.some((c) => board[idx(loc.size, c.x, c.z)] !== 0)) continue;
        path = [corners[0]!];
        stops = [];
        broken = false;
        for (let c = 0; c < corners.length; c++) {
          const leg = findPath(loc.size, board, corners[c]!, corners[(c + 1) % corners.length]!);
          if (leg.length === 0) {
            broken = true;
            break;
          }
          path.push(...leg);
          // Угол — последняя клетка отрезка: дошёл до неё, значит обход повернул.
          stops.push(path.length - 1);
        }
        if (!broken) break;
      }
    }
    // Кольцо кончается там же, где началось: последняя клетка совпадает
    // с первой, и держать её дважды незачем.
    if (broken || path.length < 2) continue;
    path.pop();

    let length = 0;
    for (let k = 0; k < path.length; k++) {
      const a = path[k]!;
      const b = path[(k + 1) % path.length]!;
      length += Math.hypot(b.x - a.x, b.z - a.z);
    }
    for (const c of path) taken[idx(loc.size, c.x, c.z)] = 1;
    const trimmed = stops.map((v) => v % path.length);
    out.push({
      look: DWELLER_LOOKS[i % DWELLER_LOOKS.length]!,
      path,
      stops: trimmed,
      cycle: length / DWELLER_SPEED + trimmed.length * DWELLER_STAND,
    });
  }
  return out;
}

/** Где жилец на момент `t` и идёт ли он. */
export interface Dweller extends Marcher {
  readonly look: DwellerLook;
  readonly walking: boolean;
}

/**
 * Жильцы двора на момент `t` секунд от входа в локацию. Как и всё в этом
 * модуле — чистая функция: один сид и одно `t` дают один кадр, сколько бы
 * раз их ни позвали и в каком угодно порядке.
 */
export function dwellersAt(g: Garrison, t: number): Dweller[] {
  const folk = g.yard.map((w) => walkYard(w, t));
  // Торговец неподвижен и в разведении: сдвинуть его значило бы увести
  // точку обмена (§13.5). Ремесленник податлив всегда, даже когда стоит
  // у дела: «неподвижен, пока стоит» здесь пробовалось и рвало соседям
  // непрерывность шага — жёсткость, включающаяся на полпути, отдаёт
  // весь накопленный сдвиг одним кадром. Толкают его всё равно редко:
  // клетка дела закрыта для чужих обходов.
  keepApart(folk, { fixed: (i) => folk[i]!.look === 'торговец' });
  return folk;
}

function walkYard(w: YardWalk, t: number): Dweller {
  const stops = new Set(w.stops);
  let left = w.cycle <= 0 ? 0 : ((t % w.cycle) + w.cycle) % w.cycle;
  for (let i = 0; i < w.path.length; i++) {
    const from = w.path[i]!;
    const to = w.path[(i + 1) % w.path.length]!;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    const walk = dist / DWELLER_SPEED;
    const facing = Math.atan2(dx, dz);
    if (left < walk) {
      const share = dist === 0 ? 0 : left / walk;
      return { x: from.x + dx * share, z: from.z + dz * share, facing, walking: true, look: w.look };
    }
    left -= walk;
    const next = (i + 1) % w.path.length;
    if (stops.has(next)) {
      // Дома ремесленник стоит дольше, чем на углу: стоянка на `path[0]` —
      // это его дело, а не передышка обхода.
      const pause = next === 0 ? (w.rest ?? DWELLER_STAND) : DWELLER_STAND;
      if (left < pause) {
        return { x: to.x, z: to.z, facing, walking: false, look: w.look };
      }
      left -= pause;
    }
  }
  // Сюда не приходят: сумма отрезков и стоянок и есть цикл. Но вернуть
  // начало честнее, чем ничего.
  const home = w.path[0]!;
  return { x: home.x, z: home.z, facing: 0, walking: false, look: w.look };
}

type GateSide = 'north' | 'east' | 'south' | 'west';

function routeLength(route: readonly { readonly x: number; readonly z: number }[]): number {
  let out = 0;
  for (let i = 0; i < route.length; i++) {
    const a = route[i]!;
    const b = route[(i + 1) % route.length]!;
    out += Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
  }
  return out;
}

function enrichRoute(
  route: readonly { readonly x: number; readonly z: number }[],
  rng: Rng,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): { readonly x: number; readonly z: number }[] {
  const out: { x: number; z: number }[] = [];
  let added = 0;
  let fallback: { readonly at: number; readonly points: readonly { readonly x: number; readonly z: number }[]; readonly len: number } | null = null;
  for (let i = 0; i < route.length; i++) {
    const from = route[i]!;
    const to = route[(i + 1) % route.length]!;
    out.push(from);
    const len = Math.abs(to.x - from.x) + Math.abs(to.z - from.z);
    if (len < 7) continue;
    const normal: readonly [number, number] | null =
      from.z === to.z && from.z === z0 ? [0, -1]
        : from.z === to.z && from.z === z1 ? [0, 1]
          : from.x === to.x && from.x === x0 ? [-1, 0]
          : from.x === to.x && from.x === x1 ? [1, 0]
              : null;
    if (normal === null) continue;
    const a = 0.24 + rng() * 0.28;
    const b = Math.min(0.86, a + 0.16 + rng() * 0.18);
    const depth = 1.1 + rng() * 0.7;
    const nearA = {
      x: from.x + (to.x - from.x) * a,
      z: from.z + (to.z - from.z) * a,
    };
    const nearB = {
      x: from.x + (to.x - from.x) * b,
      z: from.z + (to.z - from.z) * b,
    };
    const farA = {
      x: nearA.x + normal[0] * depth,
      z: nearA.z + normal[1] * depth,
    };
    const farB = {
      x: nearB.x + normal[0] * depth,
      z: nearB.z + normal[1] * depth,
    };
    const points = [nearA, farA, farB, nearB] as const;
    if (fallback === null || len > fallback.len) fallback = { at: out.length, points, len };
    if (rng() < 0.25) continue;
    out.push(...points);
    added++;
  }
  if (added === 0 && fallback !== null) out.splice(fallback.at, 0, ...fallback.points);
  return out;
}

function gateSide(
  gate: Cell,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): GateSide {
  const gx = gate.x + (CASTLE_CELL - 1) / 2;
  const gz = gate.z + (CASTLE_CELL - 1) / 2;
  const sides: readonly { readonly side: GateSide; readonly dist: number }[] = [
    { side: 'north', dist: Math.abs(gz - z0) },
    { side: 'east', dist: Math.abs(gx - x1) },
    { side: 'south', dist: Math.abs(gz - z1) },
    { side: 'west', dist: Math.abs(gx - x0) },
  ];
  return [...sides].sort((a, b) => a.dist - b.dist)[0]!.side;
}

const gateOut = (side: GateSide): readonly [number, number] =>
  side === 'north' ? [0, -1]
    : side === 'east' ? [1, 0]
      : side === 'south' ? [0, 1]
        : [-1, 0];

function patrolRoute(
  gate: Cell,
  rng: Rng,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): { readonly route: readonly { readonly x: number; readonly z: number }[]; readonly out: readonly [number, number] } {
  const side = gateSide(gate, x0, z0, x1, z1);
  const gx = Math.max(x0, Math.min(x1, gate.x + (CASTLE_CELL - 1) / 2));
  const gz = Math.max(z0, Math.min(z1, gate.z + (CASTLE_CELL - 1) / 2));
  const xm = (x0 + x1) / 2;
  const zm = (z0 + z1) / 2;
  const start =
    side === 'north' ? { x: gx, z: z0 }
      : side === 'east' ? { x: x1, z: gz }
        : side === 'south' ? { x: gx, z: z1 }
          : { x: x0, z: gz };
  const route = side === 'north'
    ? [start, { x: x1, z: z0 }, { x: x1, z: zm }, { x: x1, z: z1 }, { x: xm, z: z1 }, { x: x0, z: z1 }, { x: x0, z: zm }, { x: x0, z: z0 }]
    : side === 'east'
      ? [start, { x: x1, z: z1 }, { x: xm, z: z1 }, { x: x0, z: z1 }, { x: x0, z: zm }, { x: x0, z: z0 }, { x: xm, z: z0 }, { x: x1, z: z0 }]
      : side === 'south'
        ? [start, { x: x0, z: z1 }, { x: x0, z: zm }, { x: x0, z: z0 }, { x: xm, z: z0 }, { x: x1, z: z0 }, { x: x1, z: zm }, { x: x1, z: z1 }]
        : [start, { x: x0, z: z0 }, { x: xm, z: z0 }, { x: x1, z: z0 }, { x: x1, z: zm }, { x: x1, z: z1 }, { x: xm, z: z1 }, { x: x0, z: z1 }];
  return { route: enrichRoute(route, rng, x0, z0, x1, z1), out: gateOut(side) };
}

function gatePosts(
  route: readonly { readonly x: number; readonly z: number }[],
  out: readonly [number, number],
): readonly { readonly x: number; readonly z: number; readonly facing: number }[] {
  const start = route[0]!;
  const side: readonly [number, number] = [-out[1], out[0]];
  const x = start.x + out[0] * 0.65;
  const z = start.z + out[1] * 0.65;
  return [
    { x: x - side[0] * 0.55, z: z - side[1] * 0.55, facing: Math.atan2(out[0], out[1]) },
    { x: x + side[0] * 0.55, z: z + side[1] * 0.55, facing: Math.atan2(out[0], out[1]) },
  ];
}

/**
 * Гарнизон площадки. Считается один раз на заход: ни одно из этих чисел
 * не меняется, пока стоит замок.
 */
export function garrisonOf(site: {
  castle: Castle;
  at: Spot;
  loc: GameLocation;
  gate?: Cell;
  trader?: Cell | null;
}): Garrison {
  const { castle, at } = site;
  const x0 = at.x - PATROL_GAP;
  const z0 = at.z - PATROL_GAP;
  const x1 = at.x + castle.width * CASTLE_CELL - 1 + PATROL_GAP;
  const z1 = at.z + castle.depth * CASTLE_CELL - 1 + PATROL_GAP;
  const gate = site.gate ?? { x: at.x + castle.gate.x * CASTLE_CELL, z: at.z + castle.gate.z * CASTLE_CELL };
  const rng = mulberry32(castle.seed ^ 0x6c07);
  const { route, out } = patrolRoute(gate, rng, x0, z0, x1, z1);
  const length = routeLength(route);
  const shift = length / PATROL_SPEED + PATROL_HANDOFF;
  const laneSign = randInt(rng, 2) === 0 ? 1 : -1;
  return {
    seed: castle.seed,
    route,
    length,
    shift,
    start: rng() * shift * PATROL_GROUPS,
    way: randInt(rng, 2) === 0 ? 1 : -1,
    posts: gatePosts(route, out),
    gateOut: out,
    // В каждой смене двое идут плечом к плечу. Знак сидовый: в разных замках
    // ближе к стене оказывается то левый, то правый рыцарь.
    gait: Array.from({ length: SQUAD }, (_, i) => ({
      lane: ((i % PATROL_PAIR === 0 ? -PAIR_LANE : PAIR_LANE) * laneSign),
    })),
    runs: runsOf(castle, at),
    yard: yardWalks(castle, at, site.loc, site.trader ?? null),
  };
}

/* ---------- обход ---------- */

/** Где идущий и куда он смотрит. `walking` — идёт он или стоит на месте. */
export interface Marcher {
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly walking: boolean;
}

/**
 * Рыцарь отряда: тот же идущий плюс место на тропе. Жильцу двора это поле
 * не нужно — у него не тропа, а свой обход, — поэтому оно здесь, а не выше.
 */
export interface Patrolman extends Marcher {
  /** Сколько прошёл ногами от начала тропы. Растёт всегда, и по нему одному
   *  видно, кто кого обошёл: у обогнавшего число больше. */
  readonly along: number;
  /** Какая пара рыцарей: одна стоит у ворот, вторая идёт в обход. */
  readonly group: number;
  /** Сейчас он в обходе или на посту у ворот. */
  readonly duty: 'patrol' | 'post';
  /** Реплика над головой. `null` — в этот кадр молчит. */
  readonly talk: string | null;
}

/**
 * Точка тропы на расстоянии `s` от её начала, со сдвигом вбок `off`.
 * `s` приводится по кругу, поэтому годится и отрицательное, и большее длины.
 */
function pointAt(g: Garrison, s: number, lane: number): { x: number; z: number } {
  const s0 = ((s % g.length) + g.length) % g.length;
  let left = s0;
  for (let i = 0; i < g.route.length; i++) {
    const from = g.route[i]!;
    const to = g.route[(i + 1) % g.route.length]!;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const side = Math.abs(dx) + Math.abs(dz);
    if (side <= 1e-9) continue;
    if (left > side) {
      left -= side;
      continue;
    }
    const share = left / side;
    // Волна считается от места на всей тропе, а не внутри отрезка: внутри
    // отрезка она рвалась на каждом углу, и рыцарь дёргался на десятую клетки.
    // Длина волны подгоняется так, чтобы она делила периметр нацело, — иначе
    // разрыв просто переезжает в точку замыкания.
    const waves = Math.max(1, Math.round(g.length / PATROL_SWAY_LEN));
    const off = lane + PATROL_SWAY * Math.sin((2 * Math.PI * waves * s0) / g.length);

    /**
     * Направление сдвига у угла **поворачивается**, а не гаснет. Гашение
     * сводило все полосы в одну ровно на повороте — там, где отряд как раз
     * и сбивается в кучу. Поворот оставляет просвет: кольца остаются
     * концентрическими, и на углу они скруглены, а не сомкнуты.
     */
    const nx = (a: { x: number; z: number }, b: { x: number; z: number }): [number, number] => {
      const ux = Math.sign(b.x - a.x);
      const uz = Math.sign(b.z - a.z);
      return [-uz, ux];
    };
    const prev = g.route[(i - 1 + g.route.length) % g.route.length]!;
    const next = g.route[(i + 2) % g.route.length]!;
    let [ox, oz] = nx(from, to);
    const corner = Math.min(PATROL_CORNER, Math.max(1e-6, side / 2));
    const head = Math.min(left, corner) / corner;
    const tail = Math.min(side - left, corner) / corner;
    if (head < 1) {
      const [px, pz] = nx(prev, from);
      const w = 0.5 + 0.5 * head;
      ox = ox * w + px * (1 - w);
      oz = oz * w + pz * (1 - w);
    } else if (tail < 1) {
      const [qx, qz] = nx(to, next);
      const w = 0.5 + 0.5 * tail;
      ox = ox * w + qx * (1 - w);
      oz = oz * w + qz * (1 - w);
    }
    const len = Math.hypot(ox, oz) || 1;
    return {
      x: from.x + dx * share + (ox / len) * off,
      z: from.z + dz * share + (oz / len) * off,
    };
  }
  return { x: g.route[0]!.x, z: g.route[0]!.z };
}

function positiveMod(x: number, n: number): number {
  return ((x % n) + n) % n;
}

function talkAt(g: Garrison, group: number, member: number, t: number): string | null {
  const clock = t + g.start + g.seed * 0.017;
  const local = positiveMod(clock, GARRISON_TALK_CYCLE);
  const round = Math.floor(clock / GARRISON_TALK_CYCLE);
  const pair = GARRISON_DIALOGS[positiveMod(g.seed + group * 3 + round, GARRISON_DIALOGS.length)]!;
  if (local < GARRISON_TALK_LINE) return member === 0 ? GARRISON_TEXT[pair[0]] : null;
  if (local < GARRISON_TALK_LINE * 2) return member === 1 ? GARRISON_TEXT[pair[1]] : null;
  return null;
}

function postPoint(
  g: Garrison,
  group: number,
  member: number,
): { readonly x: number; readonly z: number; readonly facing: number } {
  const post = g.posts[member] ?? g.posts[0]!;
  const relief = (group === 0 ? -POST_RELIEF : POST_RELIEF);
  return {
    x: post.x + g.gateOut[0] * relief,
    z: post.z + g.gateOut[1] * relief,
    facing: post.facing,
  };
}

function restingPost(
  g: Garrison,
  group: number,
  member: number,
  t: number,
): { readonly x: number; readonly z: number; readonly facing: number } {
  const post = postPoint(g, group, member);
  const breathe = Math.sin((t + g.seed * 0.01 + group * 8 + member * 3) / 4.8) * 0.06;
  return {
    x: post.x + g.gateOut[0] * breathe,
    z: post.z + g.gateOut[1] * breathe,
    facing: post.facing,
  };
}

function postMan(g: Garrison, group: number, member: number, t: number, along: number): Patrolman {
  const post = restingPost(g, group, member, t);
  return {
    x: post.x,
    z: post.z,
    facing: post.facing,
    walking: false,
    along,
    group,
    duty: 'post',
    talk: talkAt(g, group, member, t),
  };
}

const mix = (
  a: { readonly x: number; readonly z: number },
  b: { readonly x: number; readonly z: number },
  share: number,
): { x: number; z: number } => ({
  x: a.x + (b.x - a.x) * share,
  z: a.z + (b.z - a.z) * share,
});

/**
 * Отряд на момент `t` секунд от входа в локацию. Это не один караван из
 * четырёх: замок живёт сменами. Одна пара держит ворота, вторая обходит
 * стены, затем у ворот они меняются ролями. Часы сдвинуты сидом (`start`),
 * поэтому игрок при каждом плане видит не одну и ту же картинку входа.
 *
 * Лицо берётся не у отрезка тропы, а у самого движения — разностью двух
 * близких точек пути. Отрезок тропы врал дважды: при обходе против часовой
 * весь отряд пятился, а со сдвигом вбок рыцарь смотрел бы прямо, вихляя
 * поперёк. Разность честна в обоих случаях и стоит двух вызовов `pointAt`.
 */
export function patrolAt(g: Garrison, t: number): Patrolman[] {
  // Окно взгляда — короткий шаг вперёд. Симметричное окно на углу врало:
  // оно смотрело в обе стороны поворота разом, а рыцарь за кадр проходит
  // только одну из них. Длинное окно тоже врёт на коротких проверочных
  // крюках, где за четверть клетки направление успевает смениться дважды.
  const eps = PATROL_SPEED / 120;
  const clock = t + g.start;
  const full = g.shift * PATROL_GROUPS;
  const lap = Math.floor(clock / full);
  const walkTime = g.length / PATROL_SPEED;
  const stand = PATROL_HANDOFF / 2;
  const approach = Math.min(0.8, stand / 2);
  const out: Patrolman[] = [];
  for (let i = 0; i < SQUAD; i++) {
    const group = Math.floor(i / PATROL_PAIR);
    const member = i % PATROL_PAIR;
    const local = positiveMod(clock + group * g.shift, full);
    const duty = local < g.shift ? 'patrol' : 'post';
    if (duty === 'post') {
      out.push(postMan(g, group, member, t, lap * g.length));
      continue;
    }

    const lane = g.gait[i]!.lane;
    const post = restingPost(g, group, member, t);
    const routeStart = pointAt(g, 0, lane);
    const walkEnd = stand + walkTime;
    let u = 0;
    let walking = false;
    let here: { x: number; z: number };
    let ahead: { x: number; z: number };
    if (local < stand) {
      if (local < stand - approach) {
        here = post;
        ahead = { x: post.x + g.gateOut[0], z: post.z + g.gateOut[1] };
      } else {
        const share = (local - (stand - approach)) / approach;
        here = mix(post, routeStart, share);
        ahead = mix(post, routeStart, Math.min(1, share + eps / approach));
        walking = true;
      }
    } else if (local < walkEnd) {
      const walkAt = local - stand;
      u = Math.max(0, Math.min(g.length, walkAt * PATROL_SPEED));
      here = pointAt(g, u * g.way, lane);
      ahead = pointAt(g, (Math.min(g.length, u + eps)) * g.way, lane);
      walking = true;
    } else {
      u = g.length;
      const endLocal = local - walkEnd;
      if (endLocal < approach) {
        const share = endLocal / approach;
        here = mix(routeStart, post, share);
        ahead = mix(routeStart, post, Math.min(1, share + eps / approach));
        walking = true;
      } else {
        here = post;
        ahead = { x: post.x + g.gateOut[0], z: post.z + g.gateOut[1] };
      }
    }
    out.push({
      x: here.x,
      z: here.z,
      facing: Math.atan2(ahead.x - here.x, ahead.z - here.z),
      walking,
      along: lap * g.length + u,
      group,
      duty,
      talk: null,
    });
  }
  // Полосы разводят пары на прямой, но у ворот две смены встречаются близко.
  // Остаток снимает расталкивание — сдвиг там малый, потому что основную
  // работу уже сделали посты и полосы.
  keepApart(out);
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
