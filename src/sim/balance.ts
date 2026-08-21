import type { EnemyKind, Tier } from './types';

/**
 * Базовые стоимости живут здесь, а не в config: модель на них опирается,
 * а config их переэкспортирует. Иначе получается кольцевая зависимость —
 * config тянет модель ради ярусов, модель тянет config ради стоимостей.
 */

/** §11.1 — расход провианта. */
export const FOOD_COST = {
  step: 1,
  fight: 3,
  container: 5,
} as const;

/** §11.3 — здоровье героя это раны, а не полоска. */
export const HERO_WOUNDS = 3;

/**
 * Модель баланса яруса. Числа не назначаются руками, а выводятся из описания
 * сложности — иначе правка одного яруса ломает соседние, что и происходило.
 *
 * Все коэффициенты ниже измерены на настоящей симуляции ботом (§22), а не
 * подобраны. Если генератор или бой поменяются, коэффициенты нужно
 * перемерить — но формулы останутся.
 */

/* ---------- измеренные постоянные ---------- */

/** Глубина локации в шагах на единицу стороны: D ≈ 1.6·N. */
export const DEPTH_PER_N = 1.6;
/** Перегон между соседними находками: s ≈ 0.58·N. */
export const HOP_PER_N = 0.58;
/** Крюк живого игрока: 1.0 у аккуратного, 1.38 у небрежного. Планируем по среднему. */
export const DETOUR = 1.15;

/**
 * Цена доведённой до конца дуэли: герой убивает простого скелета раньше первого
 * удара, воин успевает ударить раз за счёт длины топора, маг — дважды.
 * Значения детерминированы, 150 замеров из 150 совпали.
 *
 * Для модели эти числа не годятся, и это важный урок: дуэль не равна вылазке.
 */
export const WOUND_COST: Record<EnemyKind, number> = {
  minion: 0,
  warrior: 1,
  mage: 2,
};

/**
 * Цена присутствия врага в настоящей вылазке — с обходами, отступлениями
 * и тем, что до дальних просто не доходят. Меряется `npm run encounter`.
 *
 * Расхождение с дуэлью принципиальное, и §22 на нём стоит: обход врага —
 * часть игры. Модель, считавшая по дуэли, делала третий ярус легче второго —
 * ошибку нашёл замер, из формул она не видна.
 *
 * **Берётся цена первого, а не средняя по стае, и вот почему.** «Ран
 * за вылазку» упирается в потолок ран героя: мёртвый больше не получает.
 * Поэтому чем смертельнее локация, тем дешевле она выглядит — прибор
 * насыщается ровно там, где интереснее всего. Модель складывает цену штука
 * за штукой, то есть спрашивает предельную цену, и её даёт прогон с одним
 * врагом, ещё не тронутый насыщением. Скелет — исключение: поодиночке он
 * не стоит ничего и ставится только группой, поэтому у него взята цена
 * в группе.
 *
 * Числа сняты заново после §11.3 и §14.3 и почти вернулись к прежним —
 * 0,06 / 0,73 / 0,85. Это и есть главный вывод перемера: модель боя
 * заменена целиком, а цена врага осталась той же, на которой калибровался
 * §20.3. Сдвинулся только маг, и в понятную сторону: он стал стрелком,
 * а вместе с ним появилась линия видимости, и «обходится по кругу» из §15
 * впервые стало правдой, а не обещанием.
 */
export const ENCOUNTER_WOUND: Record<EnemyKind, number> = {
  minion: 0.04,
  warrior: 0.73,
  mage: 0.77,
};

/* ---------- вход ---------- */

export interface TierSpec {
  /** Сторона локации. Единственный источник геометрии. */
  readonly size: number;
  /** Сколько находок разложить. */
  readonly containers: number;
  /** Щедрость провианта, 0..1: 0 — едва хватает дойти до дна и вернуться,
   *  1 — почти хватает обойти всё. Главный регулятор напряжения. */
  readonly generosity: number;
  /** Связь рюкзака с добычей. 1 — оба ограничения связывают поровну,
   *  <1 — чаще упирается рюкзак, >1 — чаще провиант. */
  readonly capacityRatio: number;
  /** Доля ран героя, которую забирает средний забег. Задаёт состав врагов. */
  readonly woundBudget: number;
  /** Во сколько раз находка у дна ценнее находки у входа. */
  readonly depthValue: number;
  /** Доля добычи, теряемая при провале. */
  readonly risk: number;
  /** Базовая величина находки у входа. */
  readonly base: number;
}

export interface TierNumbers {
  readonly food: number;
  readonly capacity: number;
  readonly containers: number;
  readonly roster: readonly EnemyKind[];
  readonly geometry: { depth: number; hop: number; deepAndBack: number; fullTour: number };
  readonly expected: { haul: number; reachable: number; woundsTaken: number };
  readonly checks: { deepReachable: boolean; fullTourImpossible: boolean; survivable: boolean };
}

/* ---------- вывод ---------- */

export function deriveTier(spec: TierSpec): TierNumbers {
  const depth = DEPTH_PER_N * spec.size;
  const hop = HOP_PER_N * spec.size;

  // Дойти до дна и вернуться: путь туда-обратно с крюком плюс вскрытие.
  const deepAndBack = 2 * depth * DETOUR + FOOD_COST.container;
  // Обойти всё: выход к дну, перегоны между находками, возврат.
  const fullTour = 2 * depth + (spec.containers - 1) * hop + spec.containers * FOOD_COST.container;

  // §12.2 — запас обязан лежать между этими границами. Нижняя со зазором 0.85,
  // иначе дно недостижимо; верхняя строгая, иначе локацию можно зачистить.
  const floor = deepAndBack / 0.85;
  const ceil = fullTour;
  const food = Math.round(floor + Math.max(0, Math.min(1, spec.generosity)) * Math.max(0, ceil - floor));

  // Сколько находок реально успеть: после дороги до дна остаток делится
  // на перегон плюс вскрытие.
  const reachable = Math.max(1, Math.min(spec.containers, Math.floor((food - 2 * depth * DETOUR) / (hop + FOOD_COST.container)) + 1));
  // Средняя ценность находки: кривая глубины линейна, среднее — в середине.
  const meanValue = spec.base * (1 + (spec.depthValue - 1) / 2);
  const haul = reachable * meanValue;

  // Рюкзак связывает ровно тогда, когда его вместимость сравнима с тем,
  // что позволяет унести провиант. Это и есть «оба ограничения живые».
  const capacity = Math.max(4, Math.round(haul * spec.capacityRatio));

  // Состав врагов. Раны и провиант набираются раздельно: воины и маги
  // до бюджета ран, простые скелеты — сколько нужно давления на провиант.
  // Бюджет считается ценой присутствия, а не дуэли: иначе непреследующий
  // маг съедает вдвое больше бюджета, чем стоит на деле.
  const woundPoints = spec.woundBudget * HERO_WOUNDS;
  const roster: EnemyKind[] = [];
  let spent = 0;
  while (spent + ENCOUNTER_WOUND.mage <= woundPoints && spec.size >= 18) {
    roster.push('mage');
    spent += ENCOUNTER_WOUND.mage;
  }
  while (spent + ENCOUNTER_WOUND.warrior <= woundPoints) {
    roster.push('warrior');
    spent += ENCOUNTER_WOUND.warrior;
  }
  // Простые скелеты: по одному на каждые полтора перегона — столько стычек,
  // сколько маршрут естественно пересекает. Ран почти не стоят, но едят
  // провиант по 3 за стычку, и это их роль.
  const minions = Math.max(1, Math.round(reachable * 0.8));
  for (let i = 0; i < minions; i++) roster.push('minion');
  spent += minions * ENCOUNTER_WOUND.minion;

  const woundsTaken = spent;

  return {
    food,
    capacity,
    containers: spec.containers,
    roster,
    geometry: {
      depth: +depth.toFixed(1),
      hop: +hop.toFixed(1),
      deepAndBack: Math.round(deepAndBack),
      fullTour: Math.round(fullTour),
    },
    expected: { haul: +haul.toFixed(1), reachable, woundsTaken: +woundsTaken.toFixed(2) },
    checks: {
      deepReachable: deepAndBack <= food * 0.85,
      fullTourImpossible: fullTour > food,
      // Забег обязан переживаться: если ожидаемые раны дотягивают до потолка,
      // провал становится не риском, а расписанием.
      survivable: woundsTaken < HERO_WOUNDS - 0.5,
    },
  };
}

/* ---------- теория игр: когда идти дальше ---------- */

/**
 * Правило остановки. Игрок продолжает, пока ожидаемая ценность продолжения
 * выше синицы в руке:
 *
 *   EV(идти) = (B + g)·(1 − p·ρ)      EV(уйти) = B
 *   идти, если  g > B·p·ρ / (1 − p·ρ)
 *
 * где B — уже собранное, g — ценность следующей находки, p — вероятность
 * не дойти, ρ — доля добычи, теряемая при провале.
 *
 * Отсюда условие живого решения: **точка безразличия обязана попадать внутрь
 * забега.** Если g всегда больше порога — игрок всегда идёт дальше, и решения
 * нет; если всегда меньше — он уходит сразу, и глубины нет. Ставка ρ и кривая
 * ценности μ связаны через это неравенство и не настраиваются порознь.
 */
export function shouldContinue(bag: number, gain: number, failChance: number, risk: number): boolean {
  const pr = failChance * risk;
  if (pr >= 1) return false;
  return gain > (bag * pr) / (1 - pr);
}

/** Сколько добычи в рюкзаке делает следующий шаг невыгодным. */
export function indifferenceBag(gain: number, failChance: number, risk: number): number {
  const pr = failChance * risk;
  if (pr <= 0) return Infinity;
  return (gain * (1 - pr)) / pr;
}

/* ---------- готовые описания ярусов ---------- */

/**
 * Сложность растёт по трём независимым осям, а не одним числом:
 * размер (сколько идти), щедрость (насколько жмёт провиант) и бюджет ран
 * (насколько опасен бой). Ярус 0 обучающий — там щедрость намеренно высокая.
 */
export const TIER_SPEC: Record<Tier, TierSpec> = {
  0: { size: 8, containers: 3, generosity: 0.9, capacityRatio: 1.5, woundBudget: 0, depthValue: 1.4, risk: 0, base: 2 },
  1: { size: 12, containers: 5, generosity: 0.5, capacityRatio: 1.7, woundBudget: 0.25, depthValue: 1.8, risk: 0.3, base: 2 },
  2: { size: 16, containers: 7, generosity: 0.4, capacityRatio: 1.8, woundBudget: 0.5, depthValue: 2.6, risk: 0.6, base: 3 },
  3: { size: 20, containers: 9, generosity: 0.35, capacityRatio: 1.8, woundBudget: 0.6, depthValue: 3.5, risk: 1, base: 3 },
};

/**
 * Подобрано ботом, 120 забегов на точку. Все три параметра оказались
 * монотонными и почти независимыми — это и есть условие пригодности модели:
 *
 * λ  1.0 → рюкзак связывает в 98% забегов; 2.0 → провиант в 73%
 * ω  0.33 → 1% провалов; 0.67 → 22%; 1.0 → 44%
 * θ  двигает запас и вместе с ним добычу, не трогая двух остальных
 *
 * Поэтому ярус задаётся описанием сложности, а не четвёркой чисел,
 * подогнанных друг под друга.
 */

/* ---------- выведенные таблицы: единственный источник чисел яруса ---------- */

const derived = {
  0: deriveTier(TIER_SPEC[0]),
  1: deriveTier(TIER_SPEC[1]),
  2: deriveTier(TIER_SPEC[2]),
  3: deriveTier(TIER_SPEC[3]),
} as const;

export const TIER_SIZE: Record<Tier, number> = {
  0: TIER_SPEC[0].size, 1: TIER_SPEC[1].size, 2: TIER_SPEC[2].size, 3: TIER_SPEC[3].size,
};
export const TIER_RISK: Record<Tier, number> = {
  0: TIER_SPEC[0].risk, 1: TIER_SPEC[1].risk, 2: TIER_SPEC[2].risk, 3: TIER_SPEC[3].risk,
};
export const TIER_DEPTH_VALUE: Record<Tier, number> = {
  0: TIER_SPEC[0].depthValue, 1: TIER_SPEC[1].depthValue,
  2: TIER_SPEC[2].depthValue, 3: TIER_SPEC[3].depthValue,
};
export const TIER_CONTAINER_BASE: Record<Tier, number> = {
  0: TIER_SPEC[0].base, 1: TIER_SPEC[1].base, 2: TIER_SPEC[2].base, 3: TIER_SPEC[3].base,
};
export const TIER_CONTAINERS: Record<Tier, number> = {
  0: TIER_SPEC[0].containers, 1: TIER_SPEC[1].containers,
  2: TIER_SPEC[2].containers, 3: TIER_SPEC[3].containers,
};
export const TIER_ROSTER: Record<Tier, readonly EnemyKind[]> = {
  0: derived[0].roster, 1: derived[1].roster, 2: derived[2].roster, 3: derived[3].roster,
};
/** Запас провианта, который модель считает правильным для яруса. */
export const TIER_FOOD: Record<Tier, number> = {
  0: derived[0].food, 1: derived[1].food, 2: derived[2].food, 3: derived[3].food,
};

/**
 * Кривая Кухни выведена, а не назначена: ярусы открываются последовательными
 * уровнями, и запас на них обязан совпасть с модельным. Выведенные значения
 * 49 / 75 / 102 / 131 ложатся на прямую с шагом 27 — это и есть формула.
 */
export const KITCHEN_FOOD_BASE = 22;
export const KITCHEN_FOOD_STEP = 27;
export const modelKitchenFood = (level: number): number =>
  KITCHEN_FOOD_BASE + KITCHEN_FOOD_STEP * level;

/** Ярус k открывается Кухней k+1: запас на этом уровне и есть модельный. */
export const TIER_KITCHEN_GATE: Record<Tier, number> = { 0: 1, 1: 2, 2: 3, 3: 4 };
