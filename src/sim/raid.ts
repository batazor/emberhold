import { kitchenFood, storageCapacity } from './camp';
import {
  ENEMY_WAKE_SHARE,
  FOOD_COST,
  HERO_ATTACK_INTERVAL,
  HERO_REACH,
  HERO_SPEED,
  TIER_RISK,
  WEIGHT_SLOWDOWN,
  visionRadius,
} from './config';
import { ENEMY_STATS } from './enemies';
import { DEFAULT_LOADOUT, FORAGE_FOOD, SKILLS, TRAIL_STEP_DISCOUNT } from './heroes';
import type { HeroLoadout } from './heroes';
import { NO_MODS, gearMods } from './gear';
import type { GearState } from './gear';
import { generateLocation } from './generate';
import { RESOURCE_NAME, emptyResources } from './resources';
import type { ResourceKind, Resources } from './resources';
import { idx } from './grid';
import { findPath, nearestWalkable } from './pathfinding';
import type { Cell, GameLocation, RaidState, RaidStatus, Tier } from './types';

export interface RaidOptions {
  readonly seed: number;
  readonly tier: Tier;
  /** Уровни зданий лагеря: Кухня задаёт провиант, Склад — рюкзак (§2). */
  readonly kitchenLevel: number;
  readonly storageLevel: number;
  /**
   * Кем идём (§11.7). Не обязателен: замеры и старые прогоны продолжают
   * работать на прежнем безымянном герое, иначе их результаты стали бы
   * несравнимы с калибровкой §20.3.
   */
  readonly loadout?: HeroLoadout;
  /**
   * §14 — снаряжение из Кузницы. Тоже необязательное и по той же причине,
   * что и класс: без него вылазка обязана считаться ровно так, как её
   * измеряли при калибровке §20.3, иначе все прежние замеры несравнимы.
   */
  readonly gear?: GearState;
}

export function createRaid(opts: RaidOptions): RaidState {
  const loc = generateLocation(opts.seed, opts.tier);
  const loadout = opts.loadout ?? DEFAULT_LOADOUT;
  // Снаряжение сворачивается в числа один раз на входе: вылазке незачем
  // знать про слоты, ей нужны вместимость, раны и множители.
  const mods = opts.gear === undefined ? NO_MODS : gearMods(opts.gear);
  return {
    loc,
    loadout,
    mods,
    skillUsed: false,
    skillLeft: 0,
    hero: {
      x: loc.evac.x,
      z: loc.evac.z,
      prevX: loc.evac.x,
      prevZ: loc.evac.z,
      facing: 0,
      // Раны — от класса (§11.7) плюс броня (§14).
      wounds: loadout.wounds + mods.wounds,
      cooldown: 0,
    },
    food: kitchenFood(opts.kitchenLevel),
    foodMax: kitchenFood(opts.kitchenLevel),
    bag: emptyResources(),
    bagTotal: 0,
    // Рюкзак класса: Следопыт −25%, Солевар +30% (§11.7). Не меньше единицы,
    // иначе на Складе ур. 1 Следопыт не смог бы унести ничего.
    // Склад × класс, потом снаряжение: сумка прибавляет, оружие отнимает (§14).
    // Прибавка идёт после доли класса, иначе рюкзак Следопыта съедал бы
    // четверть выкованного короба, о чём игроку никто не говорил.
    capacity: Math.max(
      1,
      Math.floor(storageCapacity(opts.storageLevel) * loadout.bagMul) + mods.capacity,
    ),
    path: [],
    status: 'running',
    steps: 0,
    maxBack: 0,
    elapsed: 0,
    inFight: false,
    starve: 0,
    lastHitBy: null,
    events: [],
  };
}

/** §11.1 — «путь назад» в шагах, всегда на экране. */
export function backSteps(state: RaidState): number {
  const { loc, hero } = state;
  const cell = idx(loc.size, Math.round(hero.x), Math.round(hero.z));
  const d = loc.backSteps[cell];
  return d === undefined || d < 0 ? 0 : d;
}

/** Самая дальняя достижимая точка локации в шагах. Нужна, чтобы глубина
 *  захода читалась долей, а не абсолютом: ярусы разного размера. */
export function locationDepth(loc: GameLocation): number {
  let max = 0;
  for (let i = 0; i < loc.backSteps.length; i++) {
    const d = loc.backSteps[i]!;
    if (d > max) max = d;
  }
  return max;
}

/** §11.2 — под угрозой = ceil(добыча × доля яруса). */
export function atRisk(state: RaidState): number {
  // §11.2 — доля яруса, смягчённая кольцом (§14). Единственный предмет,
  // трогающий ставку: ей владеет один слот, иначе риск перестаёт быть риском.
  return Math.ceil(state.bagTotal * TIER_RISK[state.loc.tier] * state.mods.risk);
}

export function commandMove(state: RaidState, target: Cell): boolean {
  if (state.status !== 'running') return false;
  const { loc, hero } = state;
  const goal = nearestWalkable(loc.size, loc.blocked, {
    x: Math.round(target.x),
    z: Math.round(target.z),
  });
  if (goal === null) return false;
  const path = findPath(
    loc.size,
    loc.blocked,
    { x: Math.round(hero.x), z: Math.round(hero.z) },
    goal,
  );
  if (path.length === 0) return false;
  state.path = path;
  return true;
}

function heroSpeed(state: RaidState): number {
  // Вес добычи замедляет героя (§1) — цена жадности платится дорогой назад.
  const load = state.bagTotal / state.capacity;
  const starving = state.food <= 0 ? 0.6 : 1;
  return HERO_SPEED * state.loadout.speedMul * (1 - WEIGHT_SLOWDOWN * load) * starving;
}

/** Действует ли сейчас умение этого класса. */
function skillActive(state: RaidState, id: RaidState['loadout']['skill']): boolean {
  return state.skillLeft > 0 && state.loadout.skill === id;
}

/**
 * §11.7 — «Тропа»: путь назад −25% на 30 секунд.
 *
 * Путь назад измеряется шагами (§11.1), а каждый шаг стоит провианта,
 * поэтому «−25% пути» реализовано как −25% к цене шага, а не как срез
 * маршрута: срезать нечего, локация уже сгенерирована, а телепорт к выходу
 * обесценил бы эвакуацию. Проверяется телеметрией: если умение не меняет
 * глубину эвакуации, читается оно неправильно.
 */
function stepFoodCost(state: RaidState): number {
  // Тяжёлая броня дороже в дороге (§14): множители «Тропы» и брони
  // перемножаются — умение сокращает и утяжелённый шаг тоже.
  return (
    FOOD_COST.step *
    (skillActive(state, 'trail') ? 1 - TRAIL_STEP_DISCOUNT : 1) *
    state.mods.foodStep
  );
}

/** Умение применяется один раз за вылазку, отката нет (§11.7). */
export function useSkill(state: RaidState): boolean {
  if (state.status !== 'running' || state.skillUsed) return false;
  const def = SKILLS[state.loadout.skill];
  state.skillUsed = true;
  state.skillLeft = def.seconds;
  if (state.loadout.skill === 'forage') state.food += FORAGE_FOOD;
  state.events.push(`${def.name}: ${def.effect}`);
  return true;
}

function arriveAt(state: RaidState, cell: Cell): void {
  state.steps += 1;
  state.food -= stepFoodCost(state);

  const container = state.loc.containers.find(
    (c) => !c.opened && c.x === cell.x && c.z === cell.z,
  );
  if (container !== undefined) {
    if (state.bagTotal >= state.capacity) {
      state.events.push('Рюкзак полон — контейнер не вскрыт');
    } else {
      container.opened = true;
      state.food -= FOOD_COST.container;
      const taken = Math.min(container.amount, state.capacity - state.bagTotal);
      state.bag[container.kind] += taken;
      state.bagTotal += taken;
      state.events.push(`+${taken} · ${RESOURCE_NAME[container.kind]} · под угрозой ${atRisk(state)}`);
    }
  }

  if (cell.x === state.loc.evac.x && cell.z === state.loc.evac.z && state.steps > 0) {
    state.status = 'evacuated';
    state.path = [];
  }
}

function stepMovement(state: RaidState, dt: number): void {
  const { hero } = state;
  hero.prevX = hero.x;
  hero.prevZ = hero.z;
  if (state.path.length === 0) return;

  let budget = heroSpeed(state) * dt;
  while (budget > 0 && state.path.length > 0) {
    const node = state.path[0]!;
    const dx = node.x - hero.x;
    const dz = node.z - hero.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= 1e-6) {
      state.path.shift();
      arriveAt(state, node);
      continue;
    }
    hero.facing = Math.atan2(dx, dz);
    const move = Math.min(dist, budget);
    hero.x += (dx / dist) * move;
    hero.z += (dz / dist) * move;
    budget -= move;
    if (move >= dist - 1e-6) {
      hero.x = node.x;
      hero.z = node.z;
      state.path.shift();
      arriveAt(state, node);
      if (state.status !== 'running') return;
    }
  }
}

function stepCombat(state: RaidState, dt: number, vision: number): void {
  const { hero, loc } = state;
  let engaged = false;

  hero.cooldown = Math.max(0, hero.cooldown - dt);

  for (const enemy of loc.enemies) {
    if (enemy.wounds <= 0) continue;
    const stats = ENEMY_STATS[enemy.kind];
    enemy.prevX = enemy.x;
    enemy.prevZ = enemy.z;

    const dx = hero.x - enemy.x;
    const dz = hero.z - enemy.z;
    const dist = Math.hypot(dx, dz);

    // Игрок видит дальше, чем его видят: только так «проход через комнату»
    // становится платным решением, а не внезапной смертью (§15).
    if (!enemy.awake && dist <= vision * ENEMY_WAKE_SHARE) enemy.awake = true;
    if (!enemy.awake) continue;
    if (dist > vision + 2) {
      enemy.awake = false;
      enemy.telegraph = 0;
      continue;
    }

    if (dist <= stats.reach) {
      engaged = true;
      enemy.cooldown = Math.max(0, enemy.cooldown - dt);
      if (enemy.telegraph > 0) {
        enemy.telegraph -= dt;
        if (enemy.telegraph <= 0) {
          // §11.7 «Заслон» — не получает урон 5 секунд. Замах при этом
          // отыгрывается целиком: игрок должен видеть, что удар был отражён,
          // а не что противник перестал бить.
          if (skillActive(state, 'guard')) {
            state.events.push('Заслон держит');
          } else {
            hero.wounds -= 1;
            state.lastHitBy = enemy.kind;
            state.events.push(`${stats.name} бьёт`);
          }
          enemy.cooldown = stats.attackInterval;
        }
      } else if (enemy.cooldown <= 0) {
        enemy.telegraph = stats.telegraph;
      }
    } else {
      enemy.telegraph = 0;
      if (stats.chases && dist > 1e-3) {
        const step = Math.min(dist - stats.reach * 0.9, stats.speed * dt);
        if (step > 0) {
          const nx = enemy.x + (dx / dist) * step;
          const nz = enemy.z + (dz / dist) * step;
          if (!loc.blocked[idx(loc.size, Math.round(nx), Math.round(nz))]) {
            enemy.x = nx;
            enemy.z = nz;
          }
        }
      }
    }

    // Противник держит дистанцию своего оружия (reach × 0.9), поэтому герой
    // обязан доставать до неё. Иначе копейщик и голем не «бьют первым»
    // (§15), а просто неуязвимы: их досягаемость больше геройской, и удар
    // не проходит ни разу. Замер ловил это как 70% провалов в бою.
    const engageAt = Math.max(HERO_REACH, stats.reach);
    if (dist <= engageAt && hero.cooldown <= 0) {
      enemy.wounds -= 1;
      // §14 — оружие ускоряет зачистку, а не увеличивает урон: удар остаётся
      // одной раной, меняется только пауза между ударами.
      hero.cooldown = HERO_ATTACK_INTERVAL * state.mods.attackInterval;
      if (enemy.wounds <= 0) {
        enemy.awake = false;
        state.events.push(`${stats.name} падёт`);
      }
    }
  }

  // Провиант за стычку списывается один раз, а не каждый тик (§11.1).
  if (engaged && !state.inFight) {
    state.food -= FOOD_COST.fight;
    state.inFight = true;
  } else if (!engaged) {
    state.inFight = false;
  }
}

export function stepRaid(state: RaidState, dt: number, night: boolean, knowledge: number): void {
  if (state.status !== 'running') return;
  state.events.length = 0;
  state.elapsed += dt;
  if (state.skillLeft > 0) state.skillLeft = Math.max(0, state.skillLeft - dt);
  const back = backSteps(state);
  if (back > state.maxBack) state.maxBack = back;

  // Базовый фонарь героя (§11.4) остаётся у всех; выкованный фонарь
  // прибавляется сверху и потому не ужесточает ярусы задним числом.
  const vision = visionRadius(knowledge, night, true) + state.mods.vision;
  stepMovement(state, dt);
  if (state.status !== 'running') return;
  stepCombat(state, dt, vision);

  // Голод не убивает мгновенно: провиант обязан оставаться главной причиной
  // провала (§11.3), но провал должен наступать в дороге, а не внезапно.
  if (state.food <= 0) {
    state.starve += dt;
    if (state.starve >= 6) {
      state.starve = 0;
      state.hero.wounds -= 1;
      state.events.push('Голод');
    }
  }

  if (state.hero.wounds <= 0) {
    state.hero.wounds = 0;
    state.status = 'failed';
    state.path = [];
  }
}

export interface RaidResult {
  readonly status: RaidStatus;
  /** Что реально доехало до склада. */
  readonly carried: Resources;
  readonly carriedTotal: number;
  readonly lost: number;
  readonly bagTotal: number;
  readonly steps: number;
  readonly foodLeft: number;
  readonly tier: Tier;
  readonly seed: number;
  readonly maxBack: number;
  readonly locMaxBack: number;
  readonly durationSec: number;
}

/**
 * §11.2 задаёт, сколько предметов теряется, но не какие именно. Берём
 * пропорционально составу рюкзака, остаток — с самой многочисленной кучи:
 * так игрок не может подстроить состав добычи под провал.
 */
function loseProportionally(bag: Resources, total: number, lost: number): Resources {
  const kept: Resources = { ...bag };
  if (lost <= 0 || total <= 0) return kept;
  if (lost >= total) return emptyResources();

  const kinds = Object.keys(kept) as ResourceKind[];
  let removed = 0;
  for (const kind of kinds) {
    const take = Math.floor((kept[kind] / total) * lost);
    kept[kind] -= take;
    removed += take;
  }
  while (removed < lost) {
    const biggest = kinds.reduce((a, b) => (kept[a] >= kept[b] ? a : b));
    if (kept[biggest] <= 0) break;
    kept[biggest] -= 1;
    removed += 1;
  }
  return kept;
}

export function raidResult(state: RaidState): RaidResult {
  const lost = state.status === 'evacuated' ? 0 : atRisk(state);
  const carried = loseProportionally(state.bag, state.bagTotal, lost);
  return {
    status: state.status,
    carried,
    carriedTotal: Math.max(0, state.bagTotal - lost),
    lost,
    bagTotal: state.bagTotal,
    steps: state.steps,
    foodLeft: Math.max(0, Math.ceil(state.food)),
    tier: state.loc.tier,
    seed: state.loc.seed,
    maxBack: state.maxBack,
    locMaxBack: locationDepth(state.loc),
    durationSec: state.elapsed,
  };
}

export type { GameLocation, RaidState, RaidStatus };
