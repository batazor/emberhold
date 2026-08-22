/**
 * Валуны (§13.4) — второй источник, который платится временем, и первый,
 * который лежит не только в вылазке.
 *
 * Что это. На проходимых клетках лежат камни набора (§6.1.1) — те же модели,
 * которыми сложена стена вылазки, но ростом по колено и клетку они не
 * занимают. Тап по валуну — герой подходит и разбивает его за тридцать
 * замахов; получается 3–5 камней. Жест тот же, что у топора и у всего
 * остального в локации: ни кайла в руках, ни кнопки «добывать».
 *
 * Почему этому источнику можно быть. Довод тот же, что у вырубки (§13.3):
 * валун стоит **секунд, потраченных стоя**, а не дороги, не провианта
 * и не ставки. К нему добавляется второй, которого у леса нет: **камень
 * занимает место в рюкзаке**, и в вылазке он спорит с железом и кристаллом
 * за ту же вместимость. И третий, самый важный, — вид ресурса: из четырёх
 * §13 камень единственный, чья роль в том и состоит, чтобы быть в избытке.
 * Лишний источник железа сдвинул бы кривую построек, лишний кристалл отменил
 * бы глубину; лишний камень усиливает то, что и так объявлено.
 *
 * Что валун конечен. Он падает один раз и не возвращается — ни в лагере,
 * ни в вылазке. Бесконечна только кромка леса (§13.3), и это её отдельное
 * свойство, а не общее правило источников, которые платятся временем.
 *
 * Где лежат — `STONES` ниже. Замах, досягаемость и остаток секунд общие
 * с топором и живут в `work.ts`.
 */
import { mulberry32, randInt } from '../core/rng';
import { idx, inBounds } from './grid';
import { RESOURCE_NAME } from './resources';
import type { Resources } from './resources';
import { SWING_SECONDS, inReach, startWork, stepWork, workProgress } from './work';
import type { Work, WorkBlock, Worker } from './work';
import type { Cell, RaidState } from './types';

/**
 * Камня за один валун — ровно как брусков за дерево (§13.3): расколотый
 * валун — это несколько камней. Сколько именно, решает сам валун, а не
 * бросок кубика на замахе: награда выводится из его клетки (`mineYield`),
 * и тот же валун при повторном заходе в локацию отдал бы столько же.
 */
export const MINE_STONE_MIN = 3;
export const MINE_STONE_MAX = 5;

/** Средняя награда — ею правила считают цену камня кайлом. */
export const MINE_STONE_AVG = (MINE_STONE_MIN + MINE_STONE_MAX) / 2;

/** Камней с валуна на этой клетке. Детерминировано его координатой. */
export function mineYield(stone: Stone): number {
  const rng = mulberry32((stone.x * 19349663) ^ (stone.z * 83492791) ^ 0x51f0e5);
  return MINE_STONE_MIN + randInt(rng, MINE_STONE_MAX - MINE_STONE_MIN + 1);
}

/**
 * Замахов на валун. Столько же, сколько на дерево, и это не совпадение:
 * замах один и тот же клип, и цена у него одна — награда 3–5 подняла
 * замахи с десяти у обоих. Проверяется требованием «добыча медленнее
 * подбора» на каждом сиде (`stones.rules.ts`) и ценой единицы против
 * находки — тем же способом, что у топора.
 */
export const MINE_SWINGS = 30;

/** Сколько секунд разбивается один валун. */
export const MINE_SECONDS = SWING_SECONDS * MINE_SWINGS;

/**
 * Сколько валунов где лежит.
 *
 * Числа не про красоту кадра, а про то, чем место занято. **Больше всего
 * в вылазке**: там камень — сама порода, из него сложены стены, и валун
 * на полу читается как отколовшийся от них. Вглубь их больше по той же
 * причине, по которой глубже больше находок, — ярус растёт весь целиком.
 *
 * В лагере их мало и они разовые: площадка не месторождение, а поляна,
 * которую расчищают под постройки. У замка — опушка и поле перед стеной:
 * камень там читается как то, из чего стену и сложили.
 *
 * Поляны пролога в списке нет намеренно. В первые три минуты жест ровно
 * один — тап, — и учит ему кольцо подсказки над бруском; второй предмет,
 * по которому надо стучать, отнимал бы у кольца внимание ради ресурса,
 * который в прологе некуда потратить. Кладбища нет по своей причине: это
 * прогулка, и добывать на ней нечего (`graveSite.ts`).
 */
export const STONES = {
  /** Вылазка по ярусам: 8×8 клеток на подступах, 20×20 на дне. */
  raid: [4, 6, 8, 10],
  /** Лагерь: на всю площадку, включая ту, что откроется с ростом Жилья. */
  camp: 6,
  /** Замок: поле между лесом и стеной. */
  castle: 8,
} as const;

/**
 * Валун на клетке локации. `taken` — разбит: поле, а не удаление из списка,
 * ровно как `opened` у контейнера. Список нумерует рендер, и дырка в нумерации
 * стоила бы ему поиска по координатам каждый кадр.
 */
export interface Stone {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  taken: boolean;
}

/**
 * Разбросать валуны по проходимым клеткам.
 *
 * Свой поток случайности, а не общий с генератором локации: подмешавшись
 * в него, камни сдвинули бы всё, что бросается после них, — контейнеры,
 * противников, золотого мастера. Отсюда и порядок вызова: валуны берутся
 * последними и от своего сида.
 *
 * Разнос — не украшение. Два валуна в соседних клетках читаются как один,
 * и десять секунд работы над каждым игрок платит дважды за одну находку.
 */
export function scatterStones(
  seed: number,
  size: number,
  blocked: Uint8Array,
  count: number,
  free: (x: number, z: number) => boolean = () => true,
): Stone[] {
  const rng = mulberry32(seed ^ 0x5745b1e5);
  const open: number[] = [];
  for (let i = 0; i < size * size; i++) {
    if (blocked[i]) continue;
    if (!free(i % size, (i / size) | 0)) continue;
    open.push(i);
  }

  const stones: Stone[] = [];
  const APART = 2;
  // Попыток вдесятеро больше, чем валунов: на тесной локации разнос может
  // не даться, и тогда камней просто меньше — это лучше, чем куча в углу.
  for (let attempt = 0; attempt < count * 20 && stones.length < count; attempt++) {
    const cell = open[randInt(rng, open.length)];
    if (cell === undefined) break;
    const x = cell % size;
    const z = (cell / size) | 0;
    if (stones.some((s) => Math.abs(s.x - x) < APART && Math.abs(s.z - z) < APART)) continue;
    stones.push({ id: stones.length, x, z, taken: false });
  }
  return stones;
}

/** Валун на клетке — или его нет. Разбитый не считается: он уже не валун. */
export function stoneAt(stones: readonly Stone[], cell: Cell): Stone | null {
  return stones.find((s) => !s.taken && s.x === cell.x && s.z === cell.z) ?? null;
}

/**
 * Можно ли бить по валуну прямо сейчас. Проверяется и на тапе, и на каждом
 * тике: помешать может не только игрок — рюкзак наполняется подбором,
 * а герой отходит по своей же команде.
 *
 * `room` — есть ли куда положить. В вылазке это рюкзак, в лагере места
 * нет вовсе: там герой доносит камень до склада, потому что склад в двух
 * шагах.
 */
export function mineBlock(
  worker: Worker,
  stones: readonly Stone[],
  cell: Cell,
  room: boolean,
): WorkBlock {
  if (stoneAt(stones, cell) === null) return 'gone';
  if (!room) return 'bag';
  if (!inReach(worker, cell)) return 'far';
  return 'ok';
}

/** Слова причины — рядом с причиной (§23.3). Игрок видит камень, а не «работу по клетке». */
export const MINE_REASON: Record<Exclude<WorkBlock, 'ok'>, string> = {
  off: 'Здесь нечего добывать',
  gone: 'Камня здесь больше нет',
  far: 'К этому камню не подойти',
  bag: 'Рюкзак полон — камень некуда класть',
};

export const startMine = (cell: Cell): Work => startWork(cell, MINE_SWINGS);

/**
 * Куда встать, чтобы бить по валуну. Дерево стоит на занятой клетке,
 * и маршрутизатор сам приводит героя вплотную; валун лежит на проходимой,
 * и та же дорога привела бы героя **на** камень — он оказался бы стоящим
 * внутри того, по чему бьёт.
 *
 * Выбирается ближайшая к герою свободная соседняя клетка. Если свободной
 * нет вовсе, целью остаётся сам валун: отказывать по причине, которой
 * игрок не видит, хуже, чем встать на камень.
 */
export function standNear(
  worker: Worker,
  cell: Cell,
  walkable: (x: number, z: number) => boolean,
): Cell {
  let best: Cell | null = null;
  let bestDist = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const spot = { x: cell.x + dx, z: cell.z + dz };
      if (!walkable(spot.x, spot.z)) continue;
      const d = Math.hypot(worker.x - spot.x, worker.z - spot.z);
      if (d < bestDist) {
        bestDist = d;
        best = spot;
      }
    }
  }
  return best ?? { x: cell.x, z: cell.z };
}

/** Доля сделанной работы, 0..1 — её и показывает пятно на клетке. */
export const mineProgress = (work: Work): number => workProgress(work);

export interface MineStep {
  /** На этом тике случился замах. */
  readonly swing: boolean;
  /** Валун разбит, и камень уже засчитан. */
  readonly taken: boolean;
  /** Работа прервана и почему; null — идёт или ещё идут к валуну. */
  readonly stopped: Exclude<WorkBlock, 'ok'> | null;
}

/**
 * Разбить валун: камень — в то, что подставили. Возвращает, сколько
 * засчиталось: в вылазке рюкзак может кончиться ровно на этом валуне.
 */
export function take(stone: Stone, into: Resources, room = Infinity): number {
  const taken = Math.min(mineYield(stone), room);
  stone.taken = true;
  into.stone += taken;
  return taken;
}

/**
 * Тик работы кайлом. Куда ложится камень, решает тот, кто зовёт: в вылазке
 * это рюкзак с потолком, в лагере — кладовая, у которой потолка нет. Ровно
 * этим два места и отличаются, и одной функции хватает на оба.
 */
export function stepMineInto(
  worker: Worker,
  walking: boolean,
  stones: readonly Stone[],
  work: Work,
  dt: number,
  into: Resources,
  room = Infinity,
): MineStep {
  const step = stepWork(worker, walking, work, dt, mineBlock(worker, stones, work.cell, room > 0));
  if (!step.done) return { swing: step.swing, taken: false, stopped: step.stopped };

  const stone = stoneAt(stones, work.cell);
  if (stone === null) return { swing: step.swing, taken: false, stopped: 'gone' };
  take(stone, into, room);
  return { swing: step.swing, taken: true, stopped: null };
}

/* ---------- вылазка ---------- */

/**
 * Взяться за валун в вылазке: дойти или встать, если кайло уже достаёт.
 * Дорогу строит тот же `commandMove`, что водит героя по тапу, — второй
 * маршрутизатор разошёлся бы с первым молча. Функция берёт его аргументом,
 * а не импортом: `raid.ts` зовёт стороной, и импорт замкнул бы круг.
 */
export function aimMine(
  state: RaidState,
  cell: Cell,
  move: (state: RaidState, cell: Cell) => boolean,
): Work {
  if (inReach(state.hero, cell)) state.path.length = 0;
  else {
    const { loc } = state;
    move(
      state,
      standNear(state.hero, cell, (x, z) =>
        inBounds(loc.size, x, z) && loc.blocked[idx(loc.size, x, z)] === 0),
    );
  }
  return startMine(cell);
}

/** Тик работы кайлом в вылазке: камень идёт в рюкзак и считается в вес. */
export function stepMine(state: RaidState, work: Work, dt: number): MineStep {
  if (state.status !== 'running') return { swing: false, taken: false, stopped: 'gone' };
  const before = state.bag.stone;
  const step = stepMineInto(
    state.hero,
    state.path.length > 0,
    state.loc.stones,
    work,
    dt,
    state.bag,
    state.capacity - state.bagTotal,
  );
  if (!step.taken) return step;
  const got = state.bag.stone - before;
  state.bagTotal += got;
  state.events.push(`+${got} · ${RESOURCE_NAME.stone}`);
  return step;
}

/** Валун вылазки по клетке — тапу нужен именно он, а не список. */
export const raidStoneAt = (state: RaidState, cell: Cell): Stone | null =>
  stoneAt(state.loc.stones, cell);
