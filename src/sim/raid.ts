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
import type { GearState, Offhand } from './gear';
import {
  CONSUMABLES,
  RATION_FOOD,
  SMOKE_THRESHOLD,
} from './consumables';
import type { ConsumableId } from './consumables';
import { generateLocation } from './generate';
import { RESOURCE_NAME, emptyResources } from './resources';
import type { ResourceKind, Resources } from './resources';
import { idx } from './grid';
import { findPath, nearestWalkable } from './pathfinding';
import type { Cell, EnemyKind, GameLocation, RaidState, RaidStatus, Tier } from './types';

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
   * §14 — снаряжение из Мастерской. Тоже необязательное и по той же причине,
   * что и класс: без него вылазка обязана считаться ровно так, как её
   * измеряли при калибровке §20.3, иначе все прежние замеры несравнимы.
   */
  readonly gear?: GearState;
  /**
   * §14.2 — что в левой руке. Необязательно и по той же причине, что класс
   * и снаряжение: без него вылазка обязана считаться ровно так, как её
   * измеряли при калибровке §20.3, иначе все прежние замеры несравнимы.
   */
  readonly offhand?: Offhand;
  /** Что игрок купил перед входом (§21). По умолчанию — ничего. */
  readonly consumables?: readonly ConsumableId[];
  /**
   * Открыт ли выход на входе. По умолчанию да: замеры, бот и золотой мастер
   * обязаны считать вылазку ровно так, как её считали при калибровке §20.3.
   * Закрывает его только онбординг — см. RaidState.evacOpen.
   */
  readonly evacOpen?: boolean;
  /**
   * Готовая локация вместо сгенерированной по сиду. Нужна прологу
   * (`prologue.ts`): поляна строится другим алгоритмом, а ходьба, шаг
   * и расход провианта обязаны считаться ровно теми же правилами.
   */
  readonly loc?: GameLocation;
  /** Провиант вместо кухонного. Тоже для пролога: Кухни в нём ещё нет. */
  readonly food?: number;
  /** Вместимость вместо складской. Для пролога: Склада в нём тоже ещё нет,
   *  и сумка там — то, с чем герой вышел, а не уровень здания. */
  readonly capacity?: number;
  /**
   * Цена вскрытия контейнера вместо `FOOD_COST.container`. Ноль — пролог:
   * там провиант это шаги, и только шаги (`prologue.ts`). В вылазке подбор
   * остаётся сделкой, и ни бот, ни калибровка §20.3 эту опцию не задают.
   */
  readonly containerFood?: number;
  /**
   * Грызёт ли голод раны на нуле провианта. Выключается прологом: терять там
   * нечего, драться не с кем, а нуль провианта перестал быть концом кадра —
   * с него уходят отдыхать к лагерю, а не проигрывают.
   */
  readonly hunger?: boolean;
  /**
   * Рубится ли лес (§13.3). Включается там, где занятые клетки — деревья:
   * поляна пролога стоит на поверхности, а стена вылазки — камень, и рубить
   * её нечем. По умолчанию выключено: замеры, бот и золотой мастер обязаны
   * считать вылазку ровно так, как её считали при калибровке §20.3.
   */
  readonly logging?: boolean;
  /**
   * Называет ли событие подбора ставку («под угрозой N»). Выключается
   * прологом: ставка вводится кадром `bait` первой вылазки и нулём — а на
   * поляне полоса риска намеренно скрыта, и всплывающая строка проговаривала
   * механику словом раньше, чем игра показывала её делом. Терять на поляне
   * к тому же нечего: возвращаться некуда, и ставки не существует.
   */
  readonly risk?: boolean;
  /**
   * Множитель добычи от богатства локации на карте мира (§4). По умолчанию 1:
   * замеры, бот и золотой мастер считают вылазку без карты.
   */
  readonly lootMul?: number;
}

export function createRaid(opts: RaidOptions): RaidState {
  const loc = opts.loc ?? generateLocation(opts.seed, opts.tier, opts.lootMul ?? 1);
  const loadout = opts.loadout ?? DEFAULT_LOADOUT;
  // Снаряжение сворачивается в числа один раз на входе: вылазке незачем
  // знать про слоты, ей нужны вместимость, раны и множители.
  const mods = opts.gear === undefined ? NO_MODS : gearMods(opts.gear, opts.offhand ?? 'torch');
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
    food: opts.food ?? kitchenFood(opts.kitchenLevel),
    foodMax: opts.food ?? kitchenFood(opts.kitchenLevel),
    bag: emptyResources(),
    bagTotal: 0,
    // Рюкзак класса: Лучник −25%, Бандит +30% (§11.7). Не меньше единицы,
    // иначе на Складе ур. 1 Лучник не смог бы унести ничего.
    // Склад × класс, потом снаряжение: сумка прибавляет, оружие отнимает (§14).
    // Прибавка идёт после доли класса, иначе рюкзак Лучника съедал бы
    // четверть выкованного короба, о чём игроку никто не говорил.
    capacity: opts.capacity ?? Math.max(
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
    containerFood: opts.containerFood ?? FOOD_COST.container,
    hunger: opts.hunger ?? true,
    logging: opts.logging ?? false,
    risk: opts.risk ?? true,
    consumables: [...(opts.consumables ?? [])],
    fired: [],
    smokeUntil: 0,
    lastHitBy: null,
    lastWoundFrom: null,
    woundsTaken: 0,
    fights: 0,
    kills: 0,
    evacOpen: opts.evacOpen ?? true,
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
 *
 * Функция открыта наружу затем, что планировать дорогу назад обязан тот же
 * ценник, по которому она списывается: бот, считающий шаг по полной цене
 * при действующей Тропе, показывает нулевой эффект умения — не потому,
 * что его нет, а потому, что он в его план не попал.
 */
export function stepFoodCost(state: RaidState): number {
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
      state.food -= state.containerFood;
      const taken = Math.min(container.amount, state.capacity - state.bagTotal);
      state.bag[container.kind] += taken;
      state.bagTotal += taken;
      const found = `+${taken} · ${RESOURCE_NAME[container.kind]}`;
      state.events.push(state.risk ? `${found} · под угрозой ${atRisk(state)}` : found);
    }
  }

  if (
    state.evacOpen &&
    cell.x === state.loc.evac.x &&
    cell.z === state.loc.evac.z &&
    state.steps > 0
  ) {
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
    if (!enemy.awake && dist <= vision * ENEMY_WAKE_SHARE && state.elapsed >= state.smokeUntil) {
      enemy.awake = true;
    }
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
            state.woundsTaken += 1;
            state.lastHitBy = enemy.kind;
            state.lastWoundFrom = 'enemy';
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
    // обязан доставать до неё. Иначе воин и маг не «бьют первым»
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
        state.kills += 1;
        state.events.push(`${stats.name} падёт`);
      }
    }
  }

  // Провиант за стычку списывается один раз, а не каждый тик (§11.1).
  if (engaged && !state.inFight) {
    state.food -= FOOD_COST.fight;
    state.fights += 1;
    state.inFight = true;
  } else if (!engaged) {
    state.inFight = false;
  }
}


/**
 * §21.1 — расходник срабатывает сам. Функции «использовать» нет: момент
 * выбран правилом, поэтому приберечь его на потом физически невозможно,
 * и возражение §19.1 («берегут для лучшего момента, который не наступает»)
 * снимается конструкцией, а не обещанием.
 */
function fireConsumable(state: RaidState, id: ConsumableId): void {
  const at = state.consumables.indexOf(id);
  if (at === -1) return;
  state.consumables.splice(at, 1);
  state.fired.push(id);
  state.events.push(`${CONSUMABLES[id].name}: ${CONSUMABLES[id].effect}`);
}

/** Проверяется после боя и голода, до проверки смерти: страхует, а не воскрешает. */
function stepConsumables(state: RaidState): void {
  const { hero, loc } = state;

  // Повязка — на последней ране, до того как её снимут. Иначе она лечила бы
  // труп, а §21 обещает страховку от ошибки, а не воскрешение.
  if (hero.wounds === 1 && state.consumables.includes('bandage')) {
    fireConsumable(state, 'bandage');
    hero.wounds += 1;
  }

  if (state.food <= 0 && state.consumables.includes('ration')) {
    fireConsumable(state, 'ration');
    state.food += RATION_FOOD;
    state.starve = 0;
  }

  if (state.consumables.includes('smoke')) {
    let awake = 0;
    for (const e of loc.enemies) if (e.wounds > 0 && e.awake) awake++;
    if (awake >= SMOKE_THRESHOLD) {
      fireConsumable(state, 'smoke');
      for (const e of loc.enemies) {
        e.awake = false;
        e.telegraph = 0;
      }
      state.smokeUntil = state.elapsed + 3;
    }
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
  if (state.food <= 0 && state.hunger) {
    state.starve += dt;
    if (state.starve >= 6) {
      state.starve = 0;
      state.hero.wounds -= 1;
      state.woundsTaken += 1;
      state.lastWoundFrom = 'hunger';
      state.events.push('Голод');
    }
  }

  stepConsumables(state);

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
  /** Что сработало за вылазку — §21.5 меряет разброс по видам. */
  readonly fired: readonly ConsumableId[];
  /**
   * §9 — почему вылазка кончилась. Прежде причину выводил замерный скрипт
   * по правилу «раны кончились раньше провианта», то есть знал её только бот.
   * Здесь она берётся из того, откуда пришла последняя рана, и потому верна
   * и для голодного героя, добитого скелетом, и для раненного в бою,
   * доевшего провиант.
   */
  readonly cause: RaidCause;
  readonly woundsTaken: number;
  readonly fights: number;
  readonly kills: number;
  /** Кто нанёс последний удар. null — вылазка кончилась не боем. */
  readonly lastHitBy: EnemyKind | null;
}

/** §9 — три исхода вылазки, различимые в телеметрии. */
export type RaidCause = 'evacuated' | 'food' | 'combat';

/**
 * Провал читается по последней ране, а не по остатку провианта: голод и удар
 * отнимают её одинаково, и различить их постфактум нельзя.
 */
export function raidCause(state: RaidState): RaidCause {
  if (state.status === 'evacuated') return 'evacuated';
  return state.lastWoundFrom === 'enemy' ? 'combat' : 'food';
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
    fired: [...state.fired],
    cause: raidCause(state),
    woundsTaken: state.woundsTaken,
    fights: state.fights,
    kills: state.kills,
    lastHitBy: raidCause(state) === 'combat' ? state.lastHitBy : null,
  };
}

export type { GameLocation, RaidState, RaidStatus };
