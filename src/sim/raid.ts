import { kitchenFood, storageCapacity } from './camp';
import {
  ENEMY_WAKE_SHARE,
  FOOD_COST,
  HERO_REACH,
  ARROWS_PER_CONTAINER,
  MIN_PIERCE_SHARE,
  PIERCE_STEP,
  PROJECTILE_HIT,
  RANGED_MELEE_PENALTY,
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
import { effectOf } from './events';
import type { EventId } from './events';
import { RESOURCE_NAME, emptyResources } from './resources';
import type { ResourceKind, Resources } from './resources';
import {
  FOOD_PER_ROUND,
  advance,
  apply,
  battleOver,
  contactBroken,
  createBattle,
  current,
  enemyPlan,
} from './battle';
import type { BattleAction, BattleUnit } from './battle';
import { hasLineOfSight, idx } from './grid';
import { hexToWorld } from './hex';
import { findPath, nearestWalkable } from './pathfinding';
import type {
  Cell,
  EnemyKind,
  GameLocation,
  Fighter,
  Projectile,
  RaidState,
  RaidStatus,
  Tier,
} from './types';

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
  /**
   * §14.3 — сколько стрел лежит в лагере. Берётся не больше колчана;
   * необязательно, потому что до §14.3 стрел не было вовсе, и прежние
   * прогоны обязаны считаться ровно как считались.
   */
  readonly arrows?: number;
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
  /**
   * Событие локации (§11.6), объявленное картой до входа. По умолчанию нет —
   * и это то же требование, что у `lootMul`: замеры, бот и золотой мастер
   * считают вылазку без событий, иначе прежние числа несравнимы.
   */
  readonly event?: EventId | null;
}

export function createRaid(opts: RaidOptions): RaidState {
  // Событие сворачивается в числа на входе — ровно как снаряжение: вылазке
  // нужны множители, а не имя того, что происходит снаружи.
  const event = effectOf(opts.event ?? null);
  const loc =
    opts.loc ?? generateLocation(opts.seed, opts.tier, (opts.lootMul ?? 1) * event.loot, event.enemies);
  const loadout = opts.loadout ?? DEFAULT_LOADOUT;
  // Снаряжение сворачивается в числа один раз на входе: вылазке незачем
  // знать про слоты, ей нужны вместимость, раны и множители.
  const mods = opts.gear === undefined ? NO_MODS : gearMods(opts.gear, opts.offhand ?? 'torch');
  const quiver = loadout.ranged ? Math.min(mods.arrows, Math.max(0, opts.arrows ?? mods.arrows)) : 0;
  const supply = opts.food ?? kitchenFood(opts.kitchenLevel);

  /**
   * §11.7 — отряд. Пока в нём один боец: состав приходит снаружи, и вылазка
   * не знает, сколько их. Разница видна только тогда, когда их станет
   * больше, — и это правильная проверка замены представления.
   *
   * §11.9а — запас хода личный. У одного бойца сумма равна его запасу,
   * то есть ровно прежнему числу, и золотой мастер обязан это подтвердить.
   */
  const party: Fighter[] = [{
    id: 0,
    loadout,
    mods,
    x: loc.evac.x,
    z: loc.evac.z,
    prevX: loc.evac.x,
    prevZ: loc.evac.z,
    facing: 0,
    // Раны — от класса (§11.7) плюс броня (§14).
    wounds: loadout.wounds + mods.wounds,
    cooldown: 0,
    arrows: quiver,
    arrowsMax: quiver,
    food: supply,
    foodMax: supply,
  }];

  return {
    loc,
    loadout,
    mods,
    skillUsed: false,
    skillLeft: 0,
    party,
    active: 0,
    // Ведущий — тот же объект, а не копия: правка через любое из двух имён
    // меняет одно и то же.
    hero: party[0]!,
    food: supply,
    foodMax: supply,
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
    riskAdd: event.risk,
    visionAdd: event.vision,
    stepMul: event.step,
    consumables: [...(opts.consumables ?? [])],
    fired: [],
    smokeUntil: 0,
    lastHitBy: null,
    lastWoundFrom: null,
    woundsTaken: 0,
    fights: 0,
    kills: 0,
    evacOpen: opts.evacOpen ?? true,
    // §14.3 — колчан наполняется на выходе, из лагерного запаса и не выше
    // вместимости. У ближника вместимость нулевая, и «ноль стрел у Лучника»
    // с «нет колчана у Рыцаря» не смешиваются: различает их loadout.ranged.
    arrows: quiver,
    arrowsMax: quiver,
    arrowsSpent: 0,
    dryFights: 0,
    battle: null,
    paidRound: 0,
    projectiles: [],
    nextProjectileId: 0,
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
  // §11.2: доля = база[ярус] + сумма модификаторов события, и только потом
  // снаряжение (`mods.risk`) её множит. Порядок важен: слагаемое события
  // работает и на нулевом ярусе, где база — ноль, а множитель дал бы ноль.
  //
  // Доля зажата единицей, и это не перестраховка: на Дне база уже 100%,
  // и любое событие поверх обещало бы отнять больше, чем игрок несёт.
  // Отнять больше нельзя (`raidResult` делит по составу рюкзака), а вот
  // сказать «ставка 125%» карточка могла — и врала бы дважды: и числом,
  // и тем, что буря на Дне якобы дороже бури на втором ярусе.
  const share = Math.min(1, TIER_RISK[state.loc.tier] + state.riskAdd);
  return Math.ceil(state.bagTotal * share * state.mods.risk);
}

export function commandMove(state: RaidState, target: Cell): boolean {
  if (state.status !== 'running') return false;
  const { loc, hero } = state;
  const goal = nearestWalkable(loc.size, loc.blocked, {
    x: Math.round(target.x),
    z: Math.round(target.z),
  });
  if (goal === null) return false;
  const here = { x: Math.round(hero.x), z: Math.round(hero.z) };
  const path = findPath(loc.size, loc.blocked, here, goal);
  if (path.length === 0) {
    // Цель под ногами. Поиск пути возвращает пустоту — идти некуда, — и до
    // пошагового боя это не случалось: герой приходил на клетку шагом,
    // и приход разбирался сам. Бой сдвигает героя телепортом, и он может
    // очнуться прямо на находке. «Дойти туда, где стою» значит «сделать
    // то, что здесь есть», а не «ничего не делать»: иначе вылазка
    // застревает молча.
    if (goal.x !== here.x || goal.z !== here.z) return false;
    state.path = [goal];
    return true;
  }
  state.path = path;
  return true;
}

function heroSpeed(state: RaidState): number {
  // Вес добычи замедляет героя (§1) — цена жадности платится дорогой назад.
  const load = state.bagTotal / state.capacity;
  const starving = anyStarving(state) ? 0.6 : 1;
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
 * обесценил бы возвращение. Проверяется телеметрией: если умение не меняет
 * глубину возвращения, читается оно неправильно.
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
    state.mods.foodStep *
    state.stepMul
  );
}

/** Умение применяется один раз за вылазку, отката нет (§11.7). */
export function useSkill(state: RaidState): boolean {
  if (state.status !== 'running' || state.skillUsed) return false;
  const def = SKILLS[state.loadout.skill];
  state.skillUsed = true;
  state.skillLeft = def.seconds;
  if (state.loadout.skill === 'forage') feed(state, FORAGE_FOOD);
  state.events.push(`${def.name}: ${def.effect}`);
  return true;
}

function arriveAt(state: RaidState, cell: Cell): void {
  state.steps += 1;
  spend(state, stepFoodCost(state));

  const container = state.loc.containers.find(
    (c) => !c.opened && c.x === cell.x && c.z === cell.z,
  );
  if (container !== undefined) {
    if (state.bagTotal >= state.capacity) {
      state.events.push('Рюкзак полон — контейнер не вскрыт');
    } else {
      container.opened = true;
      spend(state, state.containerFood);
      const taken = Math.min(container.amount, state.capacity - state.bagTotal);
      state.bag[container.kind] += taken;
      state.bagTotal += taken;
      // §14.3 — стрелы подбираются, и это отменяет §21.4 осознанно:
      // приберечь их нельзя, потому что тратит их бой, а не игрок.
      // §14.3 — стрелы достаются тем, кто ими стреляет, и по колчану
      // каждого: у ближника вместимость нулевая, и делить с ним нечего.
      const shooter = state.party.find((f) => f.loadout.ranged && f.arrows < f.arrowsMax);
      if (shooter !== undefined) {
        const picked = Math.min(ARROWS_PER_CONTAINER, shooter.arrowsMax - shooter.arrows);
        shooter.arrows += picked;
        state.arrows = shooter.arrows;
        if (picked > 0) state.events.push(`+${picked} · стрелы`);
      }
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

/**
 * §11.3 — сколько ран стоит удар этого противника по этому герою.
 *
 * Защита не отменяет удар, а делит пробой: часть проходит всегда
 * (MIN_PIERCE_SHARE), поэтому неуязвимости не существует по построению.
 * Раны при этом остаются целыми — меняется не их дробность, а их число.
 */
export function woundsPerHit(attack: number, defense: number): number {
  const pierce = Math.max(attack * MIN_PIERCE_SHARE, attack - defense / 2);
  return 1 + Math.floor(Math.max(0, pierce - 1) / PIERCE_STEP);
}

/**
 * §11.3 — полёт снарядов. Идёт **до** боя, чтобы выстрел, сделанный в этом
 * тике, не долетал в этом же: иначе дальний бой отличался бы от ближнего
 * только словом, а фора, за которую игрок уходит с линии, не существовала бы.
 *
 * Снаряд кончается ровно тремя способами, и все три обязаны быть достижимы:
 * попал, врезался в камень, дошёл до точки прицеливания и никого там не нашёл.
 * Третий — и есть промах: цель ушла, пока он летел.
 */
function stepProjectiles(state: RaidState, dt: number): void {
  const { loc, hero } = state;
  if (state.projectiles.length === 0) return;

  const alive: Projectile[] = [];
  for (const p of state.projectiles) {
    p.prevX = p.x;
    p.prevZ = p.z;

    const toAimX = p.aimX - p.x;
    const toAimZ = p.aimZ - p.z;
    const left = Math.hypot(toAimX, toAimZ);
    const move = p.speed * dt;

    // Дошёл до точки прицеливания и никого не задел — промах.
    if (left <= move) {
      continue;
    }
    p.x += (toAimX / left) * move;
    p.z += (toAimZ / left) * move;

    // Камень останавливает снаряд там же, где перекрывает видимость:
    // одна и та же сетка, иначе выстрел «сквозь стену» вернулся бы
    // с другой стороны.
    const cell = idx(loc.size, Math.round(p.x), Math.round(p.z));
    if (loc.blocked[cell]) continue;

    if (p.from === 'enemy') {
      if (Math.hypot(hero.x - p.x, hero.z - p.z) <= PROJECTILE_HIT) {
        // §11.7 «Заслон» — удар отражается целиком, но снаряд всё равно
        // прилетает: игрок должен видеть, что его отбили, а не что мимо.
        if (skillActive(state, 'guard')) {
          state.events.push('Заслон держит');
        } else {
          const took = woundsPerHit(p.power, state.loadout.defense + state.mods.defense);
          hero.wounds -= took;
          state.woundsTaken += took;
          state.lastHitBy = p.kind;
          state.lastWoundFrom = 'enemy';
          state.events.push(`${p.kind === null ? 'Выстрел' : ENEMY_STATS[p.kind].name} бьёт`);
        }
        continue;
      }
    } else {
      const target = loc.enemies.find((e) => e.id === p.targetId);
      if (target !== undefined && target.hp > 0
        && Math.hypot(target.x - p.x, target.z - p.z) <= PROJECTILE_HIT) {
        target.hp -= p.power;
        if (target.hp <= 0) {
          target.awake = false;
          state.kills += 1;
          state.events.push(`${ENEMY_STATS[target.kind].name} падёт`);
        }
        continue;
      }
    }

    alive.push(p);
  }
  state.projectiles = alive;
}

function stepContact(state: RaidState, dt: number, vision: number): void {
  const { hero, loc } = state;
  let touching = false;

  for (const enemy of loc.enemies) {
    if (enemy.hp <= 0) continue;
    const stats = ENEMY_STATS[enemy.kind];
    enemy.prevX = enemy.x;
    enemy.prevZ = enemy.z;

    const dx = hero.x - enemy.x;
    const dz = hero.z - enemy.z;
    const dist = Math.hypot(dx, dz);

    // Игрок видит дальше, чем его видят: только так «проход через комнату»
    // остаётся платным решением, а не внезапной свалкой (§15).
    if (!enemy.awake && dist <= vision * ENEMY_WAKE_SHARE && state.elapsed >= state.smokeUntil) {
      enemy.awake = true;
    }
    if (!enemy.awake) continue;
    if (dist > vision + 2) {
      enemy.awake = false;
      continue;
    }

    // Контакт. У ближнего это касание, у стрелка — дистанция и линия:
    // маг завязывает бой оттуда, откуда достаёт, и подходить не обязан.
    const inReach = stats.ranged
      ? dist <= stats.reach
        && hasLineOfSight(loc.size, loc.blocked, enemy.x, enemy.z, hero.x, hero.z)
      : dist <= stats.reach;

    if (inReach) {
      touching = true;
      continue;
    }

    // Не достаёт — подходит. Непреследующий стоит: держать зону — вся его
    // роль, и подбегающий маг перестал бы быть магом (§15).
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

  state.inFight = touching;
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

  if (anyStarving(state) && state.consumables.includes('ration')) {
    fireConsumable(state, 'ration');
    feed(state, RATION_FOOD);
    state.starve = 0;
  }

  if (state.consumables.includes('smoke')) {
    let awake = 0;
    for (const e of loc.enemies) if (e.hp > 0 && e.awake) awake++;
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

/**
 * §11.3 — идёт ли бой. Пока идёт, мир стоит: шага нет, провианта за шаг нет,
 * снаряды не летят. Наружу вынесено затем, что этот же вопрос задают рендер,
 * интерфейс и бот, и каждый из них не должен знать, как устроено поле.
 */
export const inBattle = (state: RaidState): boolean => state.battle !== null;

/**
 * §11.9а — каждый платит из своего запаса.
 *
 * Не из общего котла и не поровну от суммы: запас личный, и «докуда дойдём»
 * определяется тем, у кого он кончится первым. Отсюда и решение «кого вести» —
 * тяжёлый Рыцарь и лёгкий Лучник расходятся по дальности.
 *
 * Отряд идёт вместе, поэтому шаг стоит одинаково всем: платят все, а не
 * ведущий за всех.
 */
function spend(state: RaidState, each: number): void {
  for (const f of state.party) f.food -= each;
  syncSupply(state);
}

/**
 * Найденное достаётся тому, кто нашёл, — ведущему. Делить паёк на троих
 * значило бы, что запас не личный, а общий, только записанный иначе.
 */
function feed(state: RaidState, amount: number): void {
  state.hero.food += amount;
  syncSupply(state);
}

/** Полоса HUD показывает отряд, а не ведущего: провиант вылазки — сумма. */
function syncSupply(state: RaidState): void {
  let sum = 0;
  for (const f of state.party) sum += f.food;
  state.food = sum;
}

/** §11.9а — выдать отряду провиант. Запас личный, поэтому пишется бойцам,
 *  а `state.food` пересчитывается из них. */
export function setSupply(state: RaidState, each: number): void {
  for (const f of state.party) f.food = each;
  let sum = 0;
  for (const f of state.party) sum += f.food;
  state.food = sum;
}

/** Кончился ли провиант хоть у кого-то: дальше идёт тот, кто голоден,
 *  а не отряд в среднем. */
const anyStarving = (state: RaidState): boolean => state.party.some((f) => f.food <= 0);

/** Идентификатор героя на поле. Отрицательный: у противников номера
 *  выданы генератором с нуля, и два счётчика не должны столкнуться. */
const HERO_UNIT = -1;

/**
 * Завязать бой. Мир останавливается, бойцы встают на решётку там, где их
 * застал контакт (§11.3). В бой идут только проснувшиеся: спящий за стеной
 * к этой стычке отношения не имеет, и втягивать его значило бы наказывать
 * игрока за то, чего он не делал.
 */
function openBattle(state: RaidState): void {
  const engaged = state.loc.enemies.filter((e) => e.hp > 0 && e.awake);
  if (engaged.length === 0) return;

  // Отряд из одного — но уже отряд (§11.7). Список здесь заведён затем,
  // что поле боя оперирует сторонами с самого начала: когда бойцов станет
  // трое, изменится то, кого сюда положили, а не как считается бой.
  //
  // Идентификаторы своих отрицательные: у противников они выданы генератором
  // и начинаются с нуля, и столкнуться эти два счётчика не должны.
  state.battle = createBattle(
    state.loc.size,
    state.loc.blocked,
    [{
      id: HERO_UNIT,
      x: state.hero.x,
      z: state.hero.z,
      wounds: state.hero.wounds,
      speed: HERO_SPEED * state.loadout.speedMul,
      reach: HERO_REACH,
      ranged: state.hero.loadout.ranged && state.hero.arrows > 0,
      attack: state.loadout.attack,
      defense: state.loadout.defense + state.mods.defense,
    }],
    engaged.map((e) => ({ id: e.id, kind: e.kind, x: e.x, z: e.z, hp: e.hp })),
  );
  // Завязка стоит провианта ровно как прежде (§11.1) — цена решения
  // ввязаться не изменилась оттого, что бой стал пошаговым.
  spend(state, FOOD_COST.fight);
  state.fights += 1;
  state.paidRound = 1;
  state.path = [];
  state.events.push('Бой');
}

/**
 * Закончить бой и вернуть его итог в мир: раны героя, стойкость противников
 * и то, где все оказались. Мир — источник правды о положении, поле боя —
 * о том, что случилось.
 */
function closeBattle(state: RaidState): void {
  const battle = state.battle;
  if (battle === null) return;

  for (const u of battle.units) {
    const world = hexToWorld(u.hex);
    if (u.side === 'hero') {
      // Пока боец один, мир хранит его отдельным полем. С отрядом здесь
      // будет поиск по id — и это единственное, что придётся дописать.
      if (u.id !== HERO_UNIT) continue;
      state.hero.wounds = u.hp;
      state.hero.prevX = state.hero.x;
      state.hero.prevZ = state.hero.z;
      state.hero.x = world.x;
      state.hero.z = world.z;
      continue;
    }
    const enemy = state.loc.enemies.find((e) => e.id === u.id);
    if (enemy === undefined) continue;
    enemy.prevX = enemy.x;
    enemy.prevZ = enemy.z;
    enemy.x = world.x;
    enemy.z = world.z;
    if (u.hp <= 0 && enemy.hp > 0) state.kills += 1;
    enemy.hp = u.hp;
    if (u.hp <= 0) enemy.awake = false;
  }

  state.battle = null;
  state.inFight = false;

  // Бой сдвигает героя, а выход срабатывал только на шаге — и герой,
  // оказавшийся на выходе после боя, застревал: идти некуда,
  // выйти нечем. Замер видел это как вылазку, которая не кончается.
  if (
    state.evacOpen
    && Math.round(state.hero.x) === state.loc.evac.x
    && Math.round(state.hero.z) === state.loc.evac.z
  ) {
    state.status = 'evacuated';
    state.path = [];
  }
}

/**
 * Один ход боя. Ходы противников считаются сами и сразу; на ходу героя шаг
 * останавливается и ждёт решения — его принимает игрок или бот.
 *
 * Возвращает, стоит ли звать себя снова: так вся очередь противников
 * доигрывается за один тик, а игрок не смотрит, как они ходят по одному
 * за кадр.
 */
function stepBattle(state: RaidState): boolean {
  const battle = state.battle;
  if (battle === null) return false;

  if (battleOver(battle) !== null) {
    closeBattle(state);
    return false;
  }

  // Раунд стоит провианта (§11.3): остановленное время не должно быть
  // бесплатным убежищем, иначе стоять в бою выгоднее, чем идти.
  if (battle.round > state.paidRound) {
    state.paidRound = battle.round;
    spend(state, FOOD_PER_ROUND);

    // Начало раунда — момент, когда проверяется отрыв. Ушёл и пережил
    // чужие ходы — бой кончился, мир пошёл дальше, противники остались
    // разбужены и погонятся уже в реальном времени. Так §15 возвращает
    // себе «обойти», которого пошаговый режим её лишил.
    if (contactBroken(battle, state.loc.size, state.loc.blocked)) {
      state.events.push('Оторвался');
      closeBattle(state);
      return false;
    }
  }

  const unit = current(battle);
  if (unit === undefined) return false;
  if (unit.side === 'hero') return false; // ждём решения

  const stats = ENEMY_STATS[unit.kind!];
  const plan = enemyPlan(battle, state.loc.size, state.loc.blocked, unit, stats.chases);
  applyBattle(state, plan);
  return true;
}

/**
 * Решение стороны героя. Зовётся игроком и ботом одинаково: у боя один вход,
 * и «как ходит человек» с «как ходит бот» не расходятся по коду.
 */
export function commandBattle(state: RaidState, action: BattleAction): boolean {
  const battle = state.battle;
  if (battle === null || state.status !== 'running') return false;
  const unit = current(battle);
  if (unit === undefined || unit.side !== 'hero') return false;
  return applyBattle(state, action);
}

/** Применить действие и передать ход, если он потрачен. */
function applyBattle(state: RaidState, action: BattleAction): boolean {
  const battle = state.battle!;
  const unit = current(battle)!;
  const before = unit.hex;

  // §9 — раны обязаны считаться там же, где наносятся. Бой снимает их
  // напрямую с бойца, и без этого замера счётчики молчат: золотой мастер
  // показал «ран за вылазку 0» при живом бое, то есть прибор атрибуции
  // остался цел, но перестал быть подключён.
  const heroUnit = battle.units.find((u) => u.id === HERO_UNIT);
  const woundsBefore = heroUnit?.hp ?? 0;

  const ok = apply(
    battle, state.loc.size, state.loc.blocked, action,
    (from, to) => damageBetween(state, from, to),
    (u) => (u.side === 'hero' ? 'Герой' : ENEMY_STATS[u.kind!].name),
  );
  if (!ok) return false;

  if (heroUnit !== undefined && heroUnit.hp < woundsBefore) {
    state.woundsTaken += woundsBefore - heroUnit.hp;
    state.lastWoundFrom = 'enemy';
    if (unit.side === 'enemy') state.lastHitBy = unit.kind;
    state.hero.wounds = heroUnit.hp;
  }

  for (const e of battle.events) state.events.push(e);

  // Стрелок тратит стрелу за выстрел — там же, где раньше (§14.3).
  const shot = state.party.find((f) => f.id === -unit.id - 1) ?? state.hero;
  if (action.kind === 'attack' && unit.side === 'hero' && unit.ranged && shot.arrows > 0) {
    shot.arrows -= 1;
    state.arrows = shot.arrows;
    state.arrowsSpent += 1;
    if (shot.arrows === 0) state.events.push('Колчан пуст');
  }

  // Шаг ходом не кончается: подойти и ударить — один ход. Кончают его удар,
  // блок и ожидание, то есть всё, кроме перемещения.
  if (action.kind === 'move' && !unit.acted) {
    void before;
    return true;
  }
  advance(battle);
  return true;
}

/**
 * §11.3 — урон считается теми же правилами, что и вне боя: у противника
 * очки стойкости, у героя целые раны через пробой. Пошаговость меняет,
 * когда бьют, а не как считается удар.
 */
function damageBetween(state: RaidState, from: BattleUnit, to: BattleUnit): number {
  if (from.side === 'hero') {
    // Пустой колчан бьёт слабее (§14.3). Проверка по стрелам остаётся общей,
    // пока боец один; с отрядом колчан переедет к бойцу вместе с остальным.
    const dry = state.hero.loadout.ranged && state.hero.arrows <= 0;
    return from.attack * (dry ? RANGED_MELEE_PENALTY : 1);
  }
  // Защита берётся у того, кого бьют, а не у стороны: трое бойцов держат
  // удар по-разному, и это и есть смысл характеристики.
  return woundsPerHit(from.attack, to.defense);
}

export function stepRaid(state: RaidState, dt: number, night: boolean, knowledge: number): void {
  if (state.status !== 'running') return;
  state.events.length = 0;

  // Пока идёт бой, мир стоит целиком: ни шага, ни провианта за шаг,
  // ни полёта снарядов. Останавливается именно время, а не темп.
  if (state.battle !== null) {
    let guard = 0;
    while (stepBattle(state) && guard++ < 64) { /* доигрываем чужие ходы */ }
    if (state.hero.wounds <= 0) {
      state.hero.wounds = 0;
      state.status = 'failed';
      state.path = [];
    }
    return;
  }

  state.elapsed += dt;
  if (state.skillLeft > 0) state.skillLeft = Math.max(0, state.skillLeft - dt);
  const back = backSteps(state);
  if (back > state.maxBack) state.maxBack = back;

  // Базовый фонарь героя (§11.4) остаётся у всех; выкованный фонарь
  // прибавляется сверху и потому не ужесточает ярусы задним числом.
  const vision = visionRadius(knowledge, night, true) + state.mods.vision + state.visionAdd;
  stepMovement(state, dt);
  if (state.status !== 'running') return;
  // Снаряды двигаются до боя: выстрел, сделанный в этом тике, не долетает
  // в этом же. Иначе дальний бой отличался бы от ближнего только словом.
  stepProjectiles(state, dt);
  // Вне боя остаётся только завязка: разбудить и подойти. Сам бой считает
  // поле (§11.3), и считать его дважды нельзя.
  stepContact(state, dt, vision);
  if (state.inFight && state.battle === null) openBattle(state);

  // Голод не убивает мгновенно: провиант обязан оставаться главной причиной
  // провала (§11.3), но провал должен наступать в дороге, а не внезапно.
  if (anyStarving(state) && state.hunger) {
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
  /** §14.3 — колчан обязан пустеть не всегда и не никогда; это меряется. */
  readonly arrowsSpent: number;
  readonly arrowsLeft: number;
  readonly dryFights: number;
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
    arrowsSpent: state.arrowsSpent,
    arrowsLeft: state.arrows,
    dryFights: state.dryFights,
  };
}

export type { GameLocation, RaidState, RaidStatus };
