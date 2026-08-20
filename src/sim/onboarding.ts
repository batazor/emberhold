import type { BuildingId, CampState } from './camp';
import { MAX_LEVEL } from './camp';
import { findPath } from './pathfinding';
import type { Cell, GameLocation, RaidState } from './types';

/**
 * Первые три минуты — раскадровка `onboarding.html`, десять кадров.
 * §16 ставит их в начало кривой: «0–3 мин · вылазка, лагерь, Кухня».
 *
 * Правило, из которого выведено всё остальное: ни одного экрана меню до того,
 * как игрок сыграет. Приложение открывается сразу в вылазке, лагерь появляется
 * как награда за неё, а не как стартовая комната. Поэтому онбординг — не набор
 * подсказок поверх готовой игры, а порядок, в котором игра включает саму себя:
 * каждая полоса HUD появляется в тот момент, когда ей есть что показать.
 *
 * Модуль намеренно headless: он решает «какой сейчас кадр и что открыто»,
 * ничего не зная ни про DOM, ни про сцену. Отсюда `onboarding.rules.ts` —
 * порядок кадров проверяется без браузера.
 */
export type OnbStep =
  /** 0:00 — герой в локации, одна подсвеченная точка на полу. */
  | 'move'
  /** 0:20 — первый падальщик, бой идёт сам собой. */
  | 'approach'
  /** 0:40 — скриптовая рана: урон показан до того, как стал опасным. */
  | 'wound'
  /** 1:00 — первая добыча, появляется рюкзак. */
  | 'loot'
  /** 1:15 — выход подсвечен, появляется цена возврата. */
  | 'back'
  /** 1:30 — приманка: второй сундук в стороне от выхода, ставка вводится нулём. */
  | 'bait'
  /** 1:50 — эвакуация, красная кнопка. */
  | 'evac'
  /** 2:05 — экран возврата, единственный путь — в лагерь. */
  | 'return'
  /** 2:30 — лагерь, одно подсвеченное место просит здание. */
  | 'build'
  /** 2:50 — Кухня выросла и открыла следующий ярус. */
  | 'tier'
  /** Онбординг пройден: игра работает как обычно. */
  | 'done';

export const ONB_ORDER: readonly OnbStep[] = [
  'move', 'approach', 'wound', 'loot', 'back', 'bait', 'evac',
  'return', 'build', 'tier', 'done',
];

export const stepIndex = (step: OnbStep): number => ONB_ORDER.indexOf(step);

/** Кадр идёт в вылазке — значит, при перезапуске его придётся начинать заново:
 *  вылазка перезапуск не переживает (см. `save.ts`). */
export const isRaidStep = (step: OnbStep): boolean =>
  stepIndex(step) <= stepIndex('evac');

/**
 * Что открыто на этом кадре. «Одна механика на кадр»: полосы включаются по
 * одной и больше не гаснут — исчезнувшая полоса читалась бы как поломка.
 */
export interface Reveal {
  readonly food: boolean;
  readonly wounds: boolean;
  readonly bag: boolean;
  readonly back: boolean;
  /** Строка «под угрозой». На нулевом ярусе она показывает ноль — и в этом
   *  весь смысл кадра 6: риск существует, но пока ничего не стоит. */
  readonly risk: boolean;
  readonly evac: boolean;
  /** Поворот, зум, ночь, умение. В первой вылазке жест ровно один — тап. */
  readonly controls: boolean;
}

export function reveal(step: OnbStep): Reveal {
  const i = stepIndex(step);
  const done = step === 'done';
  return {
    food: true,
    wounds: done || i >= stepIndex('wound'),
    bag: done || i >= stepIndex('loot'),
    back: done || i >= stepIndex('back'),
    risk: done || i >= stepIndex('bait'),
    evac: done || i >= stepIndex('evac'),
    controls: done,
  };
}

/**
 * Единственная строка подсказки. Всплывающих окон с «Понятно» нет ни одного:
 * обучение идёт жестом и подсвеченной точкой, текст только называет жест.
 */
export const ONB_HINT: Partial<Record<OnbStep, string>> = {
  move: 'Коснитесь земли, чтобы идти',
  approach: 'Подойдите ближе',
  bait: 'Дальше — ещё один сундук',
  build: 'Поставьте Кухню',
};

/**
 * Пауза между двумя соседними открытиями. Кадры 4–6 идут подряд по одному
 * событию — добыче, — и без паузы три полосы появились бы разом, нарушив
 * правило «одна механика на кадр».
 */
export const REVEAL_PAUSE = 4;

/** Сколько ждём приманку, прежде чем показать выход. Игрок мог решить
 *  не жадничать — кадр 7 обязан наступить в любом случае. */
export const BAIT_TIMEOUT = 25;

export interface RaidSignals {
  /** Игрок сделал хотя бы шаг — значит, тап понят. */
  readonly moved: boolean;
  readonly wounded: boolean;
  /** Сколько контейнеров вскрыто. */
  readonly looted: number;
  readonly sinceStep: number;
}

/**
 * Следующий кадр вылазки или null, если ещё рано. Кадры двигаются событиями,
 * а не секундомером: полоса рюкзака вводится в момент, когда ей есть что
 * показать, а не на первой минуте по часам.
 */
export function nextRaidStep(step: OnbStep, s: RaidSignals): OnbStep | null {
  switch (step) {
    case 'move':
      return s.moved ? 'approach' : null;
    case 'approach':
      if (s.wounded) return 'wound';
      // Игрок обошёл противника и пошёл за добычей: кадр с раной пропускается,
      // но цепочка обязана идти дальше — иначе рюкзак не появится никогда.
      return s.looted >= 1 ? 'loot' : null;
    case 'wound':
      return s.looted >= 1 ? 'loot' : null;
    case 'loot':
      return s.sinceStep >= REVEAL_PAUSE ? 'back' : null;
    case 'back':
      return s.sinceStep >= REVEAL_PAUSE ? 'bait' : null;
    case 'bait':
      return s.looted >= 2 || s.sinceStep >= BAIT_TIMEOUT ? 'evac' : null;
    default:
      return null;
  }
}

/**
 * Куда показать точку тапа в кадре 1. Не случайная клетка: два шага по пути
 * к ближайшему контейнеру — тап учит идти туда, где что-то есть.
 */
export function firstTapCell(loc: GameLocation, from: Cell): Cell | null {
  let best: Cell[] = [];
  for (const c of loc.containers) {
    const path = findPath(loc.size, loc.blocked, from, { x: c.x, z: c.z });
    if (path.length === 0) continue;
    if (best.length === 0 || path.length < best.length) best = path;
  }
  if (best.length === 0) return null;
  return best[Math.min(2, best.length - 1)] ?? null;
}

/**
 * Скриптовая рана кадра 3. Первый противник обязан задеть героя: раны нужно
 * показать до того, как они станут опасными, иначе игрок узнает о них
 * в тот момент, когда терять уже есть что.
 *
 * Ровно одна и только в первой вылазке — дальше бой считается сам.
 */
export function scriptWound(state: RaidState): boolean {
  if (state.status !== 'running') return false;
  if (!state.inFight) return false;
  if (state.hero.wounds <= 1) return false;
  state.hero.wounds -= 1;
  state.events.push('Падальщик задел');
  return true;
}

/**
 * Открыть выход, когда он заслужен. Герой стартует на точке эвакуации,
 * поэтому в первой вылазке выход молчит до первой добычи: иначе тап рядом
 * со стартом уводит игрока домой с пустым рюкзаком — и вся раскадровка,
 * от боя до ставки, не случается вовсе.
 *
 * Условие — именно добыча, а не номер кадра: как только нести есть что,
 * решение «уйти сейчас или пойти за приманкой» обязано быть настоящим.
 * Ровно эту долю и меряет вторая метрика раскадровки.
 */
export function openEvacWhenEarned(state: RaidState, step: OnbStep): boolean {
  if (state.evacOpen) return false;
  if (state.bagTotal <= 0 && stepIndex(step) < stepIndex('evac')) return false;
  state.evacOpen = true;
  return true;
}

/**
 * Первая постройка — бесплатно и мгновенно (§20.2, §20.3: «уровень 1 —
 * мгновенно, онбординг» и «уровень 1 — бесплатно, онбординг»). Здание должно
 * вырасти на глазах: таймер и ценник на этом шаге научили бы ждать раньше,
 * чем игрок понял, ради чего ждать.
 *
 * Отдельная функция, а не флаг внутри `startUpgrade`, именно затем, чтобы
 * обычная экономика не знала об этом исключении: калибровка §20.3 и золотой
 * мастер петли считают стройку по полной цене и не могут сюда попасть.
 */
export function grantFirstBuilding(camp: CampState, id: BuildingId): boolean {
  if (camp.construction !== null) return false;
  if (camp.levels[id] >= MAX_LEVEL) return false;
  camp.levels[id] += 1;
  return true;
}
