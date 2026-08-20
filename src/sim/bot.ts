import { TICK } from '../core/loop';
import { mulberry32, randInt } from '../core/rng';
import type { Rng } from '../core/rng';
import {
  BUILDING_ORDER,
  BUILD_COST,
  MAX_LEVEL,
  completeIfDue,
  createCamp,
  kitchenFood,
  startUpgrade,
  storageCapacity,
  tierBlock,
  upgradeBlock,
} from './camp';
import type { BuildingId, CampState } from './camp';
import { FOOD_COST, HERO_KNOWLEDGE, visionRadius } from './config';
import { FORAGE_FOOD, TRAIL_STEP_DISCOUNT } from './heroes';
import { distanceField, idx } from './grid';
import { findPath, nearestWalkable } from './pathfinding';
import { commandMove, createRaid, raidResult, stepFoodCost, stepRaid, useSkill } from './raid';
import type { RaidOptions } from './raid';
import type { RaidResult, RaidState } from './raid';
import { addResources, totalOf } from './resources';
import type { Cell, Tier } from './types';

/**
 * Бот, играющий в настоящую симуляцию. Нужен затем, что все прежние замеры
 * баланса были приближениями: жадный обход по полю расстояний и стоимость
 * по формуле. Бот проходит через stepRaid со всем, что там есть, — боем,
 * ранами, замедлением от веса, голодом.
 *
 * Чего бот НЕ проверяет: интересно ли играть. Он отвечает на другие вопросы —
 * встаёт ли прогресс, не доминирует ли одна стратегия, существуют ли
 * тупиковые состояния, какой ресурс становится горлышком.
 */

export type PolicyName = 'cautious' | 'balanced' | 'greedy' | 'sloppy';

interface Policy {
  /** Запас провианта, который бот держит сверх дороги домой. */
  readonly margin: number;
  /** Доля рюкзака, после которой бот уходит. */
  readonly bagStop: number;
  /** Вероятность лишнего крюка: моделирует неидеальный маршрут живого игрока. */
  readonly wander: number;
  /** На сколько клеток обходить врага. 0 — прёт напролом. */
  readonly keepAway: number;
  /** При скольких оставшихся ранах разворачивается домой. */
  readonly retreatAt: number;
}

export const POLICIES: Record<PolicyName, Policy> = {
  cautious: { margin: 14, bagStop: 0.6, wander: 0.05, keepAway: 2, retreatAt: 1 },
  balanced: { margin: 6, bagStop: 0.9, wander: 0.15, keepAway: 2, retreatAt: 1 },
  greedy: { margin: 0, bagStop: 1, wander: 0.15, keepAway: 1, retreatAt: 0 },
  sloppy: { margin: 6, bagStop: 0.9, wander: 0.45, keepAway: 0, retreatAt: 0 },
};

/**
 * Сетка с запретом ходить рядом с врагом. Обходятся только те, кого игрок
 * видит: бодрствующие и попавшие в радиус обзора. Обходить то, о чём не знаешь,
 * — не игра, а ясновидение, и бот перестал бы быть моделью игрока.
 */
function dangerGrid(state: RaidState, keepAway: number, vision: number): Uint8Array {
  const { loc, hero } = state;
  const size = loc.size;
  const grid = Uint8Array.from(loc.blocked);
  if (keepAway <= 0) return grid;
  for (const e of loc.enemies) {
    if (e.wounds <= 0) continue;
    const seen = e.awake || Math.hypot(e.x - hero.x, e.z - hero.z) <= vision;
    if (!seen) continue;
    for (let z = e.z - keepAway; z <= e.z + keepAway; z++) {
      for (let x = e.x - keepAway; x <= e.x + keepAway; x++) {
        if (x < 0 || z < 0 || x >= size || z >= size) continue;
        grid[idx(size, x, z)] = 1;
      }
    }
  }
  return grid;
}

/**
 * Маршрут в обход опасности. Если обхода нет — идём напрямик: живой игрок
 * в тупике тоже дерётся, а не стоит на месте.
 */
function moveAvoiding(state: RaidState, target: Cell, danger: Uint8Array): boolean {
  const { loc, hero } = state;
  const start = { x: Math.round(hero.x), z: Math.round(hero.z) };
  const goal = nearestWalkable(loc.size, danger, target);
  if (goal !== null && danger[idx(loc.size, start.x, start.z)] === 0) {
    const path = findPath(loc.size, danger, start, goal);
    if (path.length > 0) {
      state.path = path;
      return true;
    }
  }
  return commandMove(state, target);
}

/** Одно решение бота — ради разбора, почему забег кончился так. */
export interface Decision {
  readonly kind: 'container' | 'wander' | 'evac';
  readonly foodLeft: number;
  readonly backSteps: number;
}

export interface BotRaid extends RaidResult {
  readonly decisions: readonly Decision[];
  /** Потратил ли бот умение (§11.7). Умение, которое не срабатывает,
   *  и умение, которое ничего не меняет, — разные диагнозы. */
  readonly skillUsed: boolean;
  /** Отношение пройденных шагов к длине пути до самой дальней точки и обратно.
   *  Та самая величина, которую в балансе я задавал предположением ×1,4. */
  readonly detour: number;
}

const MAX_SECONDS = 600;

function heroCell(state: RaidState): { x: number; z: number } {
  return { x: Math.round(state.hero.x), z: Math.round(state.hero.z) };
}

/**
 * Когда бот тратит умение (§11.7). Момент выбран так, чтобы умение решало
 * то, ради чего дано, а не сгорало впустую:
 *
 * - **Прикорм** — когда провианта осталось меньше, чем на дорогу назад
 *   с запасом политики: именно там +20 превращаются в лишнюю комнату.
 * - **Заслон** — когда противник уже вплотную: пять секунд неуязвимости
 *   стоят ровно столько, сколько ран они снимают.
 * - **Тропа** — на развороте домой, потому что дешевеет путь назад.
 *
 * Бот с умением — модель игрока, который понял, зачем оно. Разница между
 * прогонами с ним и без него и есть ответ на вопрос «читается ли умение».
 */
function maybeUseSkill(
  state: RaidState,
  policy: Policy,
  goingHome: boolean,
  toHere: Int32Array,
): void {
  if (state.skillUsed) return;
  const skill = state.loadout.skill;
  const back = state.loc.backSteps[idx(state.loc.size, Math.round(state.hero.x), Math.round(state.hero.z))] ?? 0;

  if (skill === 'forage' && state.food < back * FOOD_COST.step + policy.margin + FORAGE_FOOD) {
    useSkill(state);
    return;
  }
  if (skill === 'guard') {
    const close = state.loc.enemies.some(
      (e) => e.wounds > 0 && e.awake && Math.hypot(e.x - state.hero.x, e.z - state.hero.z) <= 1.6,
    );
    if (close) useSkill(state);
    return;
  }
  if (skill === 'trail') {
    // Тропа тратится не на разворот, а на то, ради чего она дана: дотянуться
    // до находки, которая без скидки не по карману. Применение «когда пошёл
    // домой» звучит логично и не даёт ничего — дорога назад уже оплачена
    // решением, принятым раньше.
    const full = FOOD_COST.step;
    const cheap = full * (1 - TRAIL_STEP_DISCOUNT);
    const size = state.loc.size;
    const reachable = state.loc.containers.some((c) => {
      if (c.opened) return false;
      const dTo = toHere[idx(size, c.x, c.z)] ?? -1;
      if (dTo < 0) return false;
      const dHome = state.loc.backSteps[idx(size, c.x, c.z)] ?? 0;
      const withoutSkill = state.food - (dTo * full + FOOD_COST.container + dHome * full);
      const withSkill = state.food - (dTo * cheap + FOOD_COST.container + dHome * cheap);
      return withoutSkill < policy.margin && withSkill >= policy.margin;
    });
    if (reachable || (goingHome && back > 8)) useSkill(state);
  }
}

/** Один забег: бот ставит цель, симуляция её отрабатывает, бот решает заново. */
export function playRaid(
  /**
   * Вход вылазки целиком плюс то, что касается только бота. Литерал полей
   * не переписывается: снаряжение (§14) — уже второе поле после класса,
   * которое иначе пришлось бы добавлять дважды и однажды забыть.
   */
  opts: RaidOptions & {
    /** Тратит ли бот умение. По умолчанию нет: базовая линия §22 снята
     *  без умений, и включать их молча значило бы сдвинуть её задним числом. */
    useSkills?: boolean;
  },
  policy: Policy,
  rng: Rng,
): BotRaid {
  const state = createRaid(opts);
  const { loc } = state;
  const size = loc.size;
  const decisions: Decision[] = [];
  let seconds = 0;

  const knowledge = opts.loadout?.knowledge ?? HERO_KNOWLEDGE;
  const vision = visionRadius(knowledge, true, true);

  while (state.status === 'running' && seconds < MAX_SECONDS) {
    const from = heroCell(state);
    const back = loc.backSteps[idx(size, from.x, from.z)] ?? 0;
    const toHere = distanceField(size, loc.blocked, from);
    const danger = dangerGrid(state, policy.keepAway, vision);

    let target: { x: number; z: number } | null = null;
    let kind: Decision['kind'] = 'evac';

    // Раненый уходит. Это не оптимизация, а поведение: живой игрок с одной
    // раной не идёт за последним сундуком, он идёт к выходу.
    const hurt = state.hero.wounds <= policy.retreatAt;
    const bagFull = state.bagTotal >= state.capacity * policy.bagStop;
    if (!bagFull && !hurt) {
      let bestScore = 0;
      for (const c of loc.containers) {
        if (c.opened) continue;
        const dTo = toHere[idx(size, c.x, c.z)] ?? -1;
        if (dTo < 0) continue;
        const dHome = loc.backSteps[idx(size, c.x, c.z)] ?? 0;
        // Цена шага берётся текущая: под Тропой дорога и туда, и обратно
        // дешевле, и именно на этом умение обязано превращаться в добычу.
        const step = stepFoodCost(state);
        const cost = dTo * step + FOOD_COST.container;
        // Главное правило бота: он никогда не берёт то, после чего не дойдёт
        // до выхода. Провал должен быть следствием жадности в оценке,
        // а не арифметической ошибки.
        if (state.food - cost - dHome * step < policy.margin) continue;
        // Находка рядом с врагом не запрещена, а хуже: живой игрок рискнёт,
        // если больше нечего брать. Жёсткий запрет превращал бота в труса,
        // который уходил пустым, — и это тоже была бы неверная модель.
        const risky = policy.keepAway > 0 && danger[idx(size, c.x, c.z)] === 1;
        const gain = Math.min(c.amount, state.capacity - state.bagTotal);
        const score = (gain / (cost + Math.max(0, dHome - back))) * (risky ? 0.35 : 1);
        if (score > bestScore) {
          bestScore = score;
          target = { x: c.x, z: c.z };
          kind = 'container';
        }
      }
    }

    // Крюк: живой игрок не ходит по оптимуму. Доля крюков — параметр политики,
    // и именно она превращает бота в модель игрока, а не в решатель задачи.
    if (target !== null && rng() < policy.wander) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const cell = randInt(rng, size * size);
        if (loc.blocked[cell]) continue;
        const d = toHere[cell] ?? -1;
        const home = loc.backSteps[cell] ?? 0;
        if (d < 2 || d > 8) continue;
        const wanderStep = stepFoodCost(state);
        if (state.food - d * wanderStep - home * wanderStep < policy.margin) continue;
        target = { x: cell % size, z: (cell / size) | 0 };
        kind = 'wander';
        break;
      }
    }

    if (target === null) {
      target = { x: loc.evac.x, z: loc.evac.z };
      kind = 'evac';
    }

    decisions.push({ kind, foodLeft: state.food, backSteps: back });
    if (opts.useSkills === true) maybeUseSkill(state, policy, kind === 'evac', toHere);
    if (!moveAvoiding(state, target, danger)) break;

    // Крутим симуляцию до цели, пересматривая решение по мере продвижения:
    // враг мог проснуться, и маршрут, безопасный минуту назад, уже не такой.
    //
    // Пересмотр считается в пройденных клетках, а не в секундах. По времени
    // он ломал движение: клетка проходится за 0,6 с, и путь подменялся раньше,
    // чем шаг завершался, — герой топтался на месте, делая два шага за десять
    // минут.
    let guard = 0;
    const stepsAtPlan = state.steps;
    while (state.status === 'running' && state.path.length > 0 && guard < 60 * 120) {
      stepRaid(state, TICK, true, knowledge);
      seconds += TICK;
      guard++;
      if (seconds >= MAX_SECONDS) break;
      if (policy.keepAway > 0 && state.steps - stepsAtPlan >= 3) break;
    }
    if (guard === 0) break;
  }

  const result = raidResult(state);
  const ideal = Math.max(1, result.maxBack * 2);
  return {
    ...result,
    decisions,
    skillUsed: state.skillUsed,
    detour: +(result.steps / ideal).toFixed(2),
  };
}

export interface ProgressionPoint {
  readonly raid: number;
  readonly day: number;
  readonly levels: Record<BuildingId, number>;
  readonly tier: Tier;
  readonly carried: number;
  readonly failed: boolean;
}

export interface ProgressionLog {
  readonly policy: PolicyName;
  readonly points: readonly ProgressionPoint[];
  readonly raids: number;
  readonly fails: number;
  readonly days: number;
  /** Ресурс, которого не хватало чаще всего — горлышко прогрессии. */
  readonly bottleneck: string;
  readonly finalLevels: Record<BuildingId, number>;
  readonly stalled: boolean;
  readonly medianDetour: number;
}

const DAY = 24 * 3600;

/** Во что вкладываться. Штаб поднимается только когда упёрлись в его потолок. */
function chooseUpgrade(camp: CampState): BuildingId | null {
  const order: BuildingId[] = ['kitchen', 'storage'];
  for (const id of order) {
    if (upgradeBlock(camp, id) === 'ok') return id;
  }
  const capped = order.some((id) => upgradeBlock(camp, id) === 'hq-cap');
  if (capped && upgradeBlock(camp, 'hq') === 'ok') return 'hq';
  return null;
}

/** Максимальный ярус, открытый Кухней. */
function bestTier(camp: CampState): Tier {
  let best: Tier = 0;
  for (const t of [1, 2, 3] as Tier[]) if (tierBlock(camp, t) === 'ok') best = t;
  return best;
}

export function playProgression(
  policyName: PolicyName,
  seed: number,
  maxRaids = 60,
): ProgressionLog {
  const rng = mulberry32(seed);
  const policy = POLICIES[policyName];
  const camp = createCamp();
  const points: ProgressionPoint[] = [];
  const missing: Record<string, number> = {};
  const detours: number[] = [];
  let now = 0;
  let fails = 0;
  let stalledStreak = 0;

  for (let raid = 1; raid <= maxRaids; raid++) {
    const tier = bestTier(camp);
    const r = playRaid(
      {
        seed: randInt(rng, 1e9),
        tier,
        kitchenLevel: camp.levels.kitchen,
        storageLevel: camp.levels.storage,
      },
      policy,
      rng,
    );
    addResources(camp.resources, r.carried);
    detours.push(r.detour);
    if (r.status === 'failed') fails++;
    now += Math.max(60, r.durationSec);
    completeIfDue(camp, now);

    const want = chooseUpgrade(camp);
    if (want !== null) {
      startUpgrade(camp, want, now);
      stalledStreak = 0;
    } else {
      // Не на что тратить: либо слот занят, либо не хватает ресурсов.
      // Ждём конца стройки — так же, как это сделал бы игрок.
      const c = camp.construction;
      if (c !== null) {
        now = Math.max(now, c.endsAt);
        completeIfDue(camp, now);
        stalledStreak = 0;
      } else {
        // Ресурсов не хватает и строить нечего — считаем, чего именно нет.
        for (const id of BUILDING_ORDER) {
          const next = camp.levels[id] + 1;
          if (next > MAX_LEVEL) continue;
          for (const [kind, need] of Object.entries(BUILD_COST[next] ?? {})) {
            if ((camp.resources as Record<string, number>)[kind]! < (need as number)) {
              missing[kind] = (missing[kind] ?? 0) + 1;
            }
          }
        }
        stalledStreak++;
      }
    }

    points.push({
      raid,
      day: +(now / DAY).toFixed(2),
      levels: { ...camp.levels },
      tier,
      carried: totalOf(r.carried),
      failed: r.status === 'failed',
    });
    if (stalledStreak > 12) break;
  }

  const sorted = detours.slice().sort((a, b) => a - b);
  const bottleneck =
    Object.entries(missing).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'нет';

  return {
    policy: policyName,
    points,
    raids: points.length,
    fails,
    days: +(now / DAY).toFixed(1),
    bottleneck,
    finalLevels: { ...camp.levels },
    stalled: stalledStreak > 12,
    medianDetour: sorted[Math.floor(sorted.length / 2)] ?? 1,
  };
}

/** Провиант и вместимость на текущих уровнях — для отчёта. */
export const campNumbers = (camp: CampState): { food: number; cap: number } => ({
  food: kitchenFood(camp.levels.kitchen),
  cap: storageCapacity(camp.levels.storage),
});
