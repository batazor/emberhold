/**
 * Кто в замке (§6.1.6, §6.1.6.1). Трое родом: отряд, обходящий периметр,
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
import { keepApart } from './crowd';
import { idx } from './grid';
import { findPath } from './pathfinding';
import type { Cell, GameLocation } from './types';

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
 * Личный ход рыцаря. Отряд шёл одной скоростью и одним интервалом — четверо
 * в ряд, как зубья одной шестерни, — и читался не караулом, а деталью
 * механизма. Живым его делают три вещи, и все три считаются от времени,
 * а не хранятся: **шаг со стоянками**, **своя полоса** и **обгон**.
 *
 * Стоянка и ход одинаковой длины у всех, а фаза у каждого своя. Это не
 * мелочь, а условие: разная средняя скорость растащила бы колонну по всему
 * периметру за пару кругов, и «отряд — это те, кто идёт вместе» перестало бы
 * быть правдой. Одинаковая средняя при разных фазах держит их вместе
 * и при этом даёт обгон: стоящего обходит тот, кто сзади.
 *
 * Замеренный разброс колонны — 7,6 клетки при периметре в семьдесят: интервал
 * между крайними плюс то, что успевает пройти идущий, пока стоит соседний.
 * Число снято по двум сотням сидов, а не выбрано; округлено вверх.
 */
export const PATROL_SPREAD_MAX = 7.8;

export const PATROL_WALK = 9.5;
export const PATROL_STAND = 2.6;

/**
 * Своя полоса и покачивание. Полоса — постоянный сдвиг вбок: без неё обгон
 * означал бы проход сквозь товарища. Покачивание поверх неё — то, зачем оно
 * и нужно: рыцарь идёт не по нитке.
 *
 * У угла и то и другое сходит на нет: тропа там поворачивает на прямой угол,
 * и сдвиг вбок, повернувшись вместе с ней, дёрнул бы рыцаря на полклетки
 * поперёк. `PATROL_SWAY_FADE` — на скольких клетках до угла ход выпрямляется.
 */
/**
 * Полосы обхода: каждый рыцарь идёт по своему кольцу, а кольца разведены
 * на ширину фигуры. Обгон при этом остаётся обгоном, а не проходом насквозь.
 *
 * Только наружу: внутрь до замка одна клетка, наружу поле свободно на три.
 * Дальний идёт в 1,6 клетки от тропы — это ещё поле, а не лес.
 */
const PATROL_LANE_FIRST = 0.15;
const PATROL_LANE_STEP = 0.47;

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
export const PATROL_STEP_MAX = 1.6;

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
export type DwellerLook = 'поселенец' | 'торговец' | 'кузнец' | 'охотник';

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
  /** Тропа обхода: замкнутая ломаная по углам прямоугольника. */
  readonly route: readonly { readonly x: number; readonly z: number }[];
  /** Длина тропы в клетках локации. */
  readonly length: number;
  /** По часовой стрелке или против — решает сид. */
  readonly way: 1 | -1;
  /** Личный ход каждого рыцаря: фаза шага, полоса и фаза покачивания. */
  readonly gait: readonly { readonly phase: number; readonly lane: number }[];
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

/**
 * Гарнизон площадки. Считается один раз на заход: ни одно из этих чисел
 * не меняется, пока стоит замок.
 */
export function garrisonOf(site: {
  castle: Castle;
  at: Spot;
  loc: GameLocation;
  trader?: Cell | null;
}): Garrison {
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
  // Раздача полос: перестановка номеров, а не их порядок.
  const order = Array.from({ length: SQUAD }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return {
    seed: castle.seed,
    route,
    length,
    way: randInt(rng, 2) === 0 ? 1 : -1,
    // Фаза шага у каждого своя, длины хода и стоянки — общие: разная средняя
    // скорость растащила бы колонну по периметру. Полосы разведены по номеру
    // в колонне и качнуты сидом: две одинаковые означали бы обгон насквозь.
    gait: Array.from({ length: SQUAD }, (_, i) => ({
      // Фаза мала намеренно. Она сдвигает не только момент стоянки, но
      // и место: сдвиг на весь цикл — это четырнадцать клеток пути, и колонна
      // расползлась бы на четверть периметра. Стоянки хватает, чтобы задний
      // обошёл переднего (3,9 клетки против интервала в 1,3).
      phase: rng() * PATROL_STAND,
      // Полоса своя у каждого и разведена на ширину фигуры: обгон обязан
      // быть обгоном, а не проходом насквозь. Кто в какой — решает сид,
      // поэтому в двух заходах ближе к стене идут разные.
      lane: -(PATROL_LANE_FIRST + order[i]! * PATROL_LANE_STEP),
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
    const head = Math.min(left, PATROL_CORNER) / PATROL_CORNER;
    const tail = Math.min(side - left, PATROL_CORNER) / PATROL_CORNER;
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

/**
 * Сколько рыцарь `i` прошёл ногами к моменту `t` и идёт ли он сейчас.
 * Ход и стоянка чередуются, длины у всех одни, фаза у каждого своя.
 * Функция монотонна: назад никто не пятится ни на одном кадре.
 */
function walkedBy(g: Garrison, i: number, t: number): { u: number; walking: boolean } {
  const cycle = PATROL_WALK + PATROL_STAND;
  const at = t + g.gait[i]!.phase;
  const laps = Math.floor(at / cycle);
  const local = at - laps * cycle;
  const walked = laps * PATROL_WALK + Math.min(local, PATROL_WALK);
  return { u: PATROL_SPEED * walked - i * SQUAD_STEP, walking: local < PATROL_WALK };
}

/**
 * Отряд на момент `t` секунд от входа в локацию. Колонна, а не цепь по всему
 * периметру: отряд — это те, кто идёт вместе, и растянутый на четыре стороны
 * он читался бы четырьмя одиночками.
 *
 * Лицо берётся не у отрезка тропы, а у самого движения — разностью двух
 * близких точек пути. Отрезок тропы врал дважды: при обходе против часовой
 * весь отряд пятился, а со сдвигом вбок рыцарь смотрел бы прямо, вихляя
 * поперёк. Разность честна в обоих случаях и стоит двух вызовов `pointAt`.
 */
export function patrolAt(g: Garrison, t: number): Patrolman[] {
  // Окно взгляда — ровно шаг одного кадра вперёд. Симметричное окно на углу
  // врало: оно смотрело в обе стороны поворота разом, а рыцарь за кадр
  // проходит только одну из них.
  const eps = PATROL_SPEED / 30;
  const out: Patrolman[] = [];
  for (let i = 0; i < SQUAD; i++) {
    const { u, walking } = walkedBy(g, i, t);
    const lane = g.gait[i]!.lane;
    const here = pointAt(g, u * g.way, lane);
    const ahead = pointAt(g, (u + eps) * g.way, lane);
    out.push({
      x: here.x,
      z: here.z,
      facing: Math.atan2(ahead.x - here.x, ahead.z - here.z),
      walking,
      along: u,
    });
  }
  // Полосы разводят обход на прямой, но на углу кольца срезаются и просвет
  // между ними сжимается. Остаток снимает расталкивание — сдвиг там малый,
  // потому что основную работу уже сделали полосы.
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
