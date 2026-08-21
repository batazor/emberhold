/**
 * Вырубка леса (§13.3) — источник дерева, который платится не риском,
 * а временем.
 *
 * Правило одно и держит всю механику: **срубленное дерево открывает клетку,
 * а кромка карты клетку не открывает никогда**. Отсюда и «рубка по краям
 * доступна вечно»: рамка локации обязана оставаться стеной (§12.1 — уйти
 * с поляны нельзя), поэтому упавшее на кромке дерево не оставляет прохода,
 * а за ним стоит следующее. Внутреннее дерево — одно дерево и падает один
 * раз; кромка — не дерево, а лес, и он не кончается.
 *
 * Чем это не подбор. Контейнер вскрывается шагом (`raid.ts`) и стоит дороги;
 * рубка стоит **секунд, стоя на месте**, и потому не трогает ни провиант,
 * ни ставку. Такой источник не может разогнать экономику — он может только
 * отнять у игрока время, — и ровно поэтому ему разрешено быть бесконечным.
 * Что рубка обязана быть медленнее подбора, проверяется замером
 * (`logging.rules.ts`), а не обещается здесь.
 *
 * Лес рубится не везде: в вылазке занятые клетки — камень (§6.1.1), и топор
 * там не о чем точить. Включается рубка локацией, которая стоит на поверхности
 * (`RaidState.logging`), а не флагом рендера: правило про клетки, а не про то,
 * какую модель на них поставили.
 *
 * Замах, досягаемость и остаток секунд живут в `work.ts` — они же у кайла
 * (§13.4). Здесь остаётся ровно то, что про лес: что стоит на клетке и что
 * ложится в рюкзак.
 */
import { distanceField, idx } from './grid';
import { commandMove } from './raid';
import { RESOURCE_NAME } from './resources';
import { SWING_SECONDS, inReach as reaches, startWork, stepWork, workProgress } from './work';
import type { Work, WorkBlock } from './work';
import type { Cell, GameLocation, RaidState } from './types';

export { SWING_SECONDS } from './work';

/** Дерева за одно дерево. Один брусок — то же, что лежит на поляне. */
export const CHOP_WOOD = 1;

/**
 * Замахов на дерево. Число не назначено, а выведено из требования «рубка
 * медленнее подбора» (`logging.rules.ts`): жадный маршрут за тремя брусками
 * занимает 6,8–10,2 с, рубка тех же трёх — 16,4–28,2, и худший запас между
 * ними 7,1 секунды. На восьми замахах запас ужимался до двух секунд,
 * то есть до дрожания генератора.
 */
export const CHOP_SWINGS = 10;

/** Сколько секунд падает одно дерево. */
export const CHOP_SECONDS = SWING_SECONDS * CHOP_SWINGS;

/** Почему рубить нельзя. Словарь общий с добычей камня — см. `work.ts`. */
export type ChopBlock = WorkBlock;

/** Работа топором. Тот же тип, что у кайла: разница не в замахе. */
export type Chop = Work;

/** Кромка локации — рамка в одну клетку. Она же граница мира (§12.1). */
export function isEdge(loc: GameLocation, cell: Cell): boolean {
  return cell.x <= 0 || cell.z <= 0 || cell.x >= loc.size - 1 || cell.z >= loc.size - 1;
}

/** Стоит ли на клетке дерево. В лесной локации занятая клетка и есть дерево. */
export function treeAt(loc: GameLocation, cell: Cell): boolean {
  if (cell.x < 0 || cell.z < 0 || cell.x >= loc.size || cell.z >= loc.size) return false;
  return loc.blocked[idx(loc.size, cell.x, cell.z)] === 1;
}

/** Дотягивается ли герой до клетки топором. */
export function inReach(state: RaidState, cell: Cell): boolean {
  return reaches(state.hero, cell);
}

/**
 * Можно ли рубить это дерево прямо сейчас. Проверяется в двух местах —
 * на тапе и на каждом тике работы, — потому что помешать может не только
 * игрок: рюкзак наполняется подбором, а герой отходит по своей же команде.
 */
export function chopBlock(state: RaidState, cell: Cell): ChopBlock {
  if (!state.logging) return 'off';
  if (!treeAt(state.loc, cell)) return 'gone';
  if (state.bagTotal >= state.capacity) return 'bag';
  if (!inReach(state, cell)) return 'far';
  return 'ok';
}

export const startChop = (cell: Cell): Chop => startWork(cell, CHOP_SWINGS);

/**
 * Взяться за дерево: дойти до него или встать, если топор уже достаёт.
 *
 * Дорогу тут не строят заново — её строит `commandMove`, тот же, что водит
 * героя по тапу: до занятой клетки пути нет, и он ведёт к ближайшей
 * проходимой, то есть вплотную к стволу. Второй маршрутизатор разошёлся бы
 * с первым молча.
 *
 * Стоящему рядом путь обнуляется, а не задаётся: иначе тап по соседнему
 * дереву гонял бы героя на клетку, которую выбрал `nearestWalkable`, —
 * шаг, которого игрок не просил.
 */
export function aimChop(state: RaidState, cell: Cell): Chop {
  if (inReach(state, cell)) state.path.length = 0;
  else commandMove(state, cell);
  return startChop(cell);
}

/** Доля сделанной работы, 0..1 — её и показывает кольцо на клетке. */
export const chopProgress = (chop: Chop): number => workProgress(chop);

export interface ChopStep {
  /** На этом тике случился замах. */
  readonly swing: boolean;
  /** Дерево упало, и оно уже в сумке. */
  readonly felled: boolean;
  /** Работа прервана и почему; null — идёт или ещё идут к дереву. */
  readonly stopped: ChopBlock | null;
}

/**
 * Тик работы. Пока герой идёт к дереву, время не тратится: рубит тот, кто
 * дошёл, — иначе дерево падало бы от одного намерения.
 */
export function stepChop(state: RaidState, chop: Chop, dt: number): ChopStep {
  if (state.status !== 'running') {
    return { swing: false, felled: false, stopped: 'gone' };
  }
  const step = stepWork(
    state.hero,
    state.path.length > 0,
    chop,
    dt,
    chopBlock(state, chop.cell),
  );
  if (!step.done) return { swing: step.swing, felled: false, stopped: step.stopped };
  fell(state, chop.cell);
  return { swing: step.swing, felled: true, stopped: null };
}

/**
 * Дерево падает: брусок в сумку, клетка освобождается. На кромке — только
 * брусок: рамка остаётся стеной, и это то же решение, что «выхода с поляны
 * нет» (§12.1), а не поблажка рубке.
 *
 * Путь назад пересчитывается здесь же. Он посчитан один раз на входе
 * (§11.1) и после просеки соврал бы — а число «до выхода N шагов» стоит
 * на экране и им пользуются.
 */
export function fell(state: RaidState, cell: Cell): boolean {
  if (chopBlock(state, cell) !== 'ok') return false;
  const { loc } = state;
  const taken = Math.min(CHOP_WOOD, state.capacity - state.bagTotal);
  state.bag.wood += taken;
  state.bagTotal += taken;
  state.events.push(`+${taken} · ${RESOURCE_NAME.wood}`);
  if (isEdge(loc, cell)) return true;
  loc.blocked[idx(loc.size, cell.x, cell.z)] = 0;
  loc.backSteps.set(distanceField(loc.size, loc.blocked, loc.evac));
  return true;
}
