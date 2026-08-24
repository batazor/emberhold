import { HERO_HP, TIER_ENEMY_LEVEL } from './balance';
import { kitchenFood, storageCapacity } from './camp';
import {
  ENEMY_WAKE_SHARE,
  FOOD_COST,
  HERO_REACH,
  ARROWS_PER_CONTAINER,
  BANDAGE_HEAL,
  HUNGER_BITE,
  RANGED_MELEE_PENALTY,
  HERO_SPEED,
  TIER_RISK,
  WEIGHT_SLOWDOWN,
  visionRadius,
} from './config';
import { ENEMY_STATS, enemyStats } from './enemies';
import {
  DEFAULT_LOADOUT,
  SKILLS,
  cacheLoot,
  enemyXp,
  haulCapacity,
  skillEffect,
  skillSeconds,
  trailDiscount,
} from './heroes';
import type { HeroLoadout } from './heroes';
import { NO_MODS, gearMods } from './gear';
import type { GearState, Offhand } from './gear';
import { protectionOf } from './protection';
import type { ProtectionResult } from './protection';
import {
  CONSUMABLES,
  RATION_FOOD,
  SMOKE_THRESHOLD,
} from './consumables';
import type { ConsumableId } from './consumables';
import { generateLocation } from './generate';
import { firstDungeonNpcLineAt, stepDungeonNpcs } from './dungeonNpc';
import { effectOf } from './events';
import { effectOfCard } from './draft';
import type { DraftCardId } from './draft';
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
  forecastRound,
} from './battle';
import type { BattleAction, BattleForecast, BattleUnit } from './battle';
import { keepApart } from './crowd';
import { hasLineOfSight, idx } from './grid';
import { hexToWorld } from './hex';
import type { Hex } from './hex';
import { findPath, nearestWalkable } from './pathfinding';
import type {
  Cell,
  Container,
  Enemy,
  EnemyKind,
  GameLocation,
  Fighter,
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
   * §22.6б — номер захода на ярус (0 — первый): первые заходы встречают
   * тела уровнем ниже. Необязателен: без него локация считается зрелой,
   * как её меряли, — замеры и старые прогоны остаются сравнимы.
   */
  readonly visit?: number;
  /**
   * §11.7 — кто ещё идёт. Ведущий задаётся `loadout`, эти встают следом.
   * Необязательно и по той же причине, что класс и снаряжение: без него
   * вылазка обязана считаться ровно так, как её измеряли при калибровке
   * §20.3, — иначе замеры на отряде и на одиночке стали бы несравнимы.
   */
  readonly followers?: readonly HeroLoadout[];
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
  /**
   * §19 — карта сборов, выбранная перед входом. По умолчанию нет, и это то же
   * требование, что у события: бот, калибровка §20.3 и золотой мастер считают
   * вылазку без карт, иначе прежние числа несравнимы.
   */
  readonly draft?: DraftCardId | null;
}

export function createRaid(opts: RaidOptions): RaidState {
  // Событие сворачивается в числа на входе — ровно как снаряжение: вылазке
  // нужны множители, а не имя того, что происходит снаружи.
  const event = effectOf(opts.event ?? null);
  // §19 — карта сворачивается в числа там же и так же, как событие: вылазке
  // незачем знать про карты, ей нужны провиант, вместимость, обзор и ставка.
  const draft = effectOfCard(opts.draft ?? null);
  const loc =
    opts.loc ?? generateLocation(opts.seed, opts.tier, (opts.lootMul ?? 1) * event.loot * draft.loot, event.enemies, opts.visit);
  const loadout = opts.loadout ?? DEFAULT_LOADOUT;
  // Снаряжение сворачивается в числа один раз на входе: вылазке незачем
  // знать про слоты, ей нужны вместимость, раны и множители.
  const mods = opts.gear === undefined ? NO_MODS : gearMods(opts.gear, opts.offhand ?? 'torch');
  /**
   * §14.3 — вместимость и запас это две разные величины, и раньше они были
   * одной. `arrowsMax` считался от того, сколько взяли, поэтому ноль в лагере
   * делал ноль вместимости, а подбор упирается в `arrows < arrowsMax` —
   * и с пустым колчаном не срабатывал никогда. Ноль был поглощающим: выйти
   * из него не давал ни один источник, кроме покупки за железо.
   */
  const quiverCap = loadout.ranged ? mods.arrows : 0;
  const quiver = Math.min(quiverCap, Math.max(0, opts.arrows ?? quiverCap));
  // §19 — карта провианта прибавляется и к запасу, и к потолку: полоса HUD
  // читает потолок, и оставленный прежним он показал бы «103 из 78».
  const supply = Math.max(1, (opts.food ?? kitchenFood(opts.kitchenLevel)) + draft.food);

  /**
   * §11.7 — отряд. Пока в нём один боец: состав приходит снаружи, и вылазка
   * не знает, сколько их. Разница видна только тогда, когда их станет
   * больше, — и это правильная проверка замены представления.
   *
   * §11.9а — запас хода личный. У одного бойца сумма равна его запасу,
   * то есть ровно прежнему числу, и золотой мастер обязан это подтвердить.
   */
  /** Боец отряда. Ведущий и следующие собираются одним кодом: разница
   *  между ними только в том, кто задаёт путь. */
  const make = (id: number, who: HeroLoadout): Fighter => {
    const capOf = who.ranged ? mods.arrows : 0;
    const quiverOf = Math.min(capOf, Math.max(0, opts.arrows ?? capOf));
    return {
      id,
      loadout: who,
      mods,
      x: loc.evac.x,
      z: loc.evac.z,
      prevX: loc.evac.x,
      prevZ: loc.evac.z,
      facing: 0,
      hp: HERO_HP + who.hp + mods.wounds + draft.hp,
      hpMax: HERO_HP + who.hp + mods.wounds + draft.hp,
      cooldown: 0,
      arrows: quiverOf,
      arrowsMax: capOf,
      food: supply,
      foodMax: supply,
    };
  };

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
    hp: HERO_HP + loadout.hp + mods.wounds + draft.hp,
    hpMax: HERO_HP + loadout.hp + mods.wounds + draft.hp,
    cooldown: 0,
    arrows: quiver,
    arrowsMax: quiverCap,
    food: supply,
    foodMax: supply,
  }];
  (opts.followers ?? []).forEach((who, i) => party.push(make(i + 1, who)));

  return {
    loc,
    loadout,
    mods,
    skillUsed: false,
    skillLeft: 0,
    party,
    active: 0,
    trail: [],
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
    capacity: Math.max(
      1,
      (opts.capacity ??
        Math.floor(storageCapacity(opts.storageLevel) * loadout.bagMul) + mods.capacity) +
        draft.bag,
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
    riskAdd: event.risk + draft.risk,
    visionAdd: event.vision + draft.vision,
    // Ночь на входе неизвестна — её знает только кадр, — поэтому здесь день.
    // Первый же шаг перепишет число целиком, а до него по локации никто
    // не ходит и никого не будит.
    vision: visionRadius(loadout.knowledge, false, true) + mods.vision + event.vision + draft.vision,
    stepMul: event.step,
    // §19 — множитель пути назад. Единица без карты; «Верёвка» ставит 0,75.
    backMul: draft.back,
    // §11.1 — цена стычки. Карта её переписывает («Точило»), а не сдвигает:
    // число в §11.1 названо целым, и половин провианта в игре нет.
    fightFood: draft.fightFood ?? FOOD_COST.fight,
    consumables: [...(opts.consumables ?? [])],
    fired: [],
    smokeUntil: 0,
    lastHitBy: null,
    lastWoundFrom: null,
    damageTaken: 0,
    guardTurns: 0,
    guardPrevented: 0,
    shieldPushes: 0,
    intercepts: 0,
    dodges: 0,
    fights: 0,
    joined: 0,
    kills: 0,
    foxesCaught: 0,
    combatXp: 0,
    evacOpen: opts.evacOpen ?? true,
    // §14.3 — колчан наполняется на выходе, из лагерного запаса и не выше
    // вместимости. У ближника вместимость нулевая, и «ноль стрел у Лучника»
    // с «нет колчана у Рыцаря» не смешиваются: различает их loadout.ranged.
    arrows: quiver,
    arrowsMax: quiverCap,
    arrowsSpent: 0,
    dryFights: 0,
    battle: null,
    plays: [],
    paidRound: 0,
    projectiles: [],
    nextProjectileId: 0,
    nextNpcLine: firstDungeonNpcLineAt(loc.seed),
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

/**
 * §11.7 «Тропа» и §19 «Верёвка» — во что дорога домой обходится **при
 * планировании**. Отдельно от `backSteps` намеренно: сырое расстояние идёт
 * в телеметрию глубины (§11.11, `maxBack`), и скидка не должна делать заход
 * мельче, чем он был. Игроку и боту нужно другое число — сколько идти отсюда.
 */
export function backCost(state: RaidState, cell: number): number {
  const d = state.loc.backSteps[cell];
  const raw = d === undefined || d < 0 ? 0 : d;
  // Карта работает всю вылазку, умение — тридцать секунд; сокращают они одну
  // и ту же дорогу и потому перемножаются.
  const skill = skillActive(state, 'trail') ? 1 - trailDiscount(state.loadout.skillLevel) : 1;
  return Math.ceil(raw * state.backMul * skill);
}

/** То же для клетки, на которой герой стоит: строка «Путь назад» в HUD. */
export function backLeft(state: RaidState): number {
  const { loc, hero } = state;
  return backCost(state, idx(loc.size, Math.round(hero.x), Math.round(hero.z)));
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
  // Тяжёлая броня дороже в дороге (§14). «Тропы» здесь больше нет: она
  // сокращает дорогу, а не цену шага, — иначе платит провиантом, который
  // перестал быть осью сложности (§11.3, снято).
  return (
    FOOD_COST.step *
    state.mods.foodStep *
    state.stepMul
  );
}

/** Умение применяется один раз за вылазку, отката нет (§11.7). */
export function useSkill(state: RaidState): boolean {
  if (state.status !== 'running' || state.skillUsed) return false;
  const def = SKILLS[state.loadout.skill];
  state.skillUsed = true;
  state.skillLeft = skillSeconds(def.id, state.loadout.skillLevel);
  // Заплечье действует не срок, а до конца вылазки: потолок рюкзака поднят
  // один раз и остаётся поднятым. Поэтому у него `seconds: 0`.
  if (state.loadout.skill === 'haul') state.capacity += haulCapacity(state.loadout.skillLevel);
  state.events.push(`${def.name}: ${skillEffect(def.id, state.loadout.skillLevel)}`);
  return true;
}

/**
 * Засада вскрытого сундука (`Container.ambush`): единственный способ
 * добавить противника после генерации.
 *
 * Встают сразу проснувшимися и с меткой `relentless`: их подняло действие
 * игрока, а не его приближение, и правила сна к ним не относятся —
 * ни «не заметил», ни «отстал — уснул». Бой начнётся обычным контактом
 * (`stepContact`), когда они добегут: погоня и есть цена сундука.
 *
 * Клетки — из `ambush.at` (стража замка идёт от ворот); без них — кольцо
 * свободных клеток вокруг сундука: скелеты поднимаются из земли рядом.
 */
function springAmbush(state: RaidState, container: Container): void {
  const ambush = container.ambush;
  if (ambush === undefined) return;
  const { loc } = state;
  const spots: Cell[] = [];
  const free = (x: number, z: number): boolean =>
    x >= 0 && z >= 0 && x < loc.size && z < loc.size && loc.blocked[idx(loc.size, x, z)] === 0;
  for (const at of ambush.at ?? []) {
    if (spots.length >= ambush.count) break;
    if (free(at.x, at.z)) spots.push(at);
  }
  // Кольцо расходится от сундука, пока не наберётся счёт: ближние клетки
  // раньше дальних, обход детерминированный — сид уже отработал в генерации,
  // и второй источник случайности здесь завёл бы два разных боя на один сейв.
  for (let r = 1; r <= 3 && spots.length < ambush.count; r++) {
    for (let dz = -r; dz <= r && spots.length < ambush.count; dz++) {
      for (let dx = -r; dx <= r && spots.length < ambush.count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = container.x + dx;
        const z = container.z + dz;
        if (!free(x, z)) continue;
        if (spots.some((s) => s.x === x && s.z === z)) continue;
        spots.push({ x, z });
      }
    }
  }
  const nextId = loc.enemies.reduce((top, e) => Math.max(top, e.id), 0) + 1;
  spots.forEach((at, i) => {
    // §22.6 — засада поднимается телами своего яруса, и уровнем локации:
    // на смягчённом входе (§22.6б) сундук не должен быть жёстче яруса.
    const level = loc.enemies[0]?.level ?? TIER_ENEMY_LEVEL[loc.tier];
    loc.enemies.push({
      id: nextId + i,
      kind: ambush.kind,
      level,
      x: at.x,
      z: at.z,
      prevX: at.x,
      prevZ: at.z,
      hp: enemyStats(ambush.kind, level).hp,
      awake: true,
      telegraph: 0,
      cooldown: 0,
      relentless: true,
    });
  });
  if (spots.length > 0) {
    state.events.push(
      ambush.kind === 'guard' ? 'Стража спешит ко двору!' : 'Из земли поднимаются скелеты!',
    );
  }
}

function arriveAt(state: RaidState, cell: Cell): void {
  state.steps += 1;
  spend(state, stepFoodCost(state));

  const container = state.loc.containers.find(
    (c) => !c.opened && c.x === cell.x && c.z === cell.z,
  );
  if (container !== undefined) {
    const locks = container.lockedBy === undefined
      ? []
      : Array.isArray(container.lockedBy) ? container.lockedBy : [container.lockedBy];
    if (locks.length > 0 && state.loc.enemies.some((e) => locks.includes(e.kind) && e.hp > 0)) {
      state.events.push('Золотой сундук остаётся заперт, пока хозяин жив');
    } else if (state.bagTotal >= state.capacity) {
      state.events.push('Рюкзак полон — контейнер не вскрыт');
    } else {
      container.opened = true;
      spend(state, state.containerFood);
      // §11.7 «Схрон» — находка щедрее, пока умение держится. Множитель
      // ложится на содержимое, а не на взятое: упереться в рюкзак он не мешает.
      const inside = skillActive(state, 'cache')
        ? container.amount * cacheLoot(state.loadout.skillLevel)
        : container.amount;
      const taken = Math.min(inside, state.capacity - state.bagTotal);
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
      // Засада вскрытого сундука: добыча уже в рюкзаке, счёт предъявлен.
      if (container.ambush !== undefined) springAmbush(state, container);
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

/**
 * §11.7 — на сколько отстаёт следующий в цепочке. Меньше клетки: отряд идёт
 * вплотную, иначе хвост тянется через пол-локации и «отряд идёт вместе»
 * перестаёт быть правдой. Больше половины: слипшиеся фигуры читаются как одна.
 */
const FOLLOW_GAP = 0.8;

/** Сколько следов ведущего помним. Хватает на всю цепочку с запасом. */
const TRAIL_MAX = 96;

/**
 * §11.7 — где встанет каждый. Отряд идёт **по следу ведущего**, а не рядом
 * с ним: так он обходит те же камни, что и он, и не застревает в стене,
 * которую ведущий обогнул. Цепочка — это и есть «идут вместе» на сетке,
 * где рядом встать бывает негде.
 *
 * Вынесено наружу, потому что этот же ответ нужен рендеру: точка, куда
 * встанет боец, обязана считаться тем же кодом, которым он туда встанет.
 */
export function followSpots(state: RaidState): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < state.party.length; i++) {
    if (i === state.active) {
      out.push({ x: state.hero.x, z: state.hero.z });
      continue;
    }
    out.push(trailAt(state, FOLLOW_GAP * out.length));
  }
  return out;
}

/** Точка на следу ведущего в `back` шагах позади него. */
function trailAt(state: RaidState, back: number): { x: number; z: number } {
  let left = back;
  let prev = { x: state.hero.x, z: state.hero.z };
  for (const p of state.trail) {
    const d = Math.hypot(p.x - prev.x, p.z - prev.z);
    if (d >= left) {
      const k = d === 0 ? 0 : left / d;
      return { x: prev.x + (p.x - prev.x) * k, z: prev.z + (p.z - prev.z) * k };
    }
    left -= d;
    prev = p;
  }
  return prev;
}

function stepMovement(state: RaidState, dt: number): void {
  const { hero } = state;
  for (const f of state.party) {
    f.prevX = f.x;
    f.prevZ = f.z;
  }
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

  // След ведущего пишется после его хода: по нему пойдут остальные.
  state.trail.unshift({ x: hero.x, z: hero.z });
  if (state.trail.length > TRAIL_MAX) state.trail.length = TRAIL_MAX;

  const spots = followSpots(state);
  for (let i = 0; i < state.party.length; i++) {
    if (i === state.active) continue;
    const f = state.party[i]!;
    const to = spots[i]!;
    const dx = to.x - f.x;
    const dz = to.z - f.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) f.facing = Math.atan2(dx, dz);
    f.x = to.x;
    f.z = to.z;
  }
}

/**
 * §11.3 — урон. Одна формула в обе стороны, как раздел её и записал.
 *
 * Работать так она стала только со шкалой: пока здоровье считалось целыми
 * ранами, «минус половина Защиты» вырождалось — при любой Защите удар стоил
 * ровно одной раны, и характеристика не делала ничего. Половину работы
 * над боем занял обход этого вырождения порогами; со шкалой порогов
 * не нужно, и Защита смягчает удар плавно.
 *
 * MIN_DAMAGE держит нижнюю границу: неуязвимости не существует
 * по построению, а не по настройке.
 */
export { damageOf } from './protection';

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
    if (enemy.peaceful === true) continue;
    if (!enemy.awake && dist <= vision * ENEMY_WAKE_SHARE && state.elapsed >= state.smokeUntil) {
      enemy.awake = true;
    }
    if (!enemy.awake) continue;
    // Засадный (`relentless`) не отпускает: стражник, поднятый сундуком,
    // обязан добежать — иначе засада обходится двумя шагами в сторону.
    if (dist > vision + 2 && enemy.relentless !== true) {
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

  /**
   * Тела не проходят сквозь тела (`sim/crowd.ts`). Погоня ведёт каждого
   * к герою по своей прямой, и втроём они сходились в одну точку: трое
   * в одном силуэте читаются одним противником, и бой перестаёт быть
   * «сколько их», превращаясь в «сколько успеешь ударить».
   *
   * Герой в списке стоит неподвижным: его двигает игрок, и толкать его
   * толпой значило бы отнимать управление. Упереться в него противники
   * и так не могут — они останавливаются на своей дистанции удара.
   */
  const alive = loc.enemies.filter((e) => e.hp > 0 && e.awake);
  if (alive.length > 1) {
    const crowd = [...alive, hero];
    keepApart(crowd, {
      fixed: (i: number) => i === crowd.length - 1,
      free: (x: number, z: number) => loc.blocked[idx(loc.size, Math.round(x), Math.round(z))] === 0,
    });
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
  // §21.2 — повязка страхует ошибку маршрута. Срабатывает на четверти
  // здоровья: «последней раны», по которой она срабатывала раньше,
  // на шкале не существует.
  // §21.2 — «страхует ошибку, а не воскрешает»: на нуле она не срабатывает.
  // С целыми ранами это выходило само (условие было «ровно одна рана»),
  // на шкале ноль попадает в «четверть и ниже», и правило надо назвать.
  if (hero.hp > 0 && hero.hp <= hero.hpMax / 4 && state.consumables.includes('bandage')) {
    fireConsumable(state, 'bandage');
    hero.hp = Math.min(hero.hpMax, hero.hp + BANDAGE_HEAL);
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

/**
 * §11.2 — **провалом считается падение всего отряда, а не любого бойца.**
 *
 * Ставка объявлена локацией до входа (§11.6), и пересчитывать её по головам
 * значило бы менять сделку задним числом. Павший выбывает из вылазки
 * и уходит на лечение (§11.8); отряд идёт дальше меньшим числом — и это
 * решение, а не приговор: с двумя бойцами глубже, но дороже.
 *
 * Ведущий при падении меняется: вести отряд некому, если тот, кем вели,
 * лежит.
 */
export function standing(state: RaidState): Fighter[] {
  return state.party.filter((f) => f.hp > 0);
}

/** Передать ведение живому. Возвращает, остался ли кто-то на ногах. */
function reelect(state: RaidState): boolean {
  if (state.hero.hp > 0) return true;
  const next = state.party.findIndex((f) => f.hp > 0);
  if (next < 0) return false;
  state.active = next;
  state.hero = state.party[next]!;
  // След ведёт прежний ведущий, и новый пойдёт по нему же: цепочка
  // не рвётся оттого, что первый упал.
  return true;
}

/**
 * Номер бойца на поле. Отрицательный: у противников номера выданы
 * генератором с нуля, и два счётчика не должны столкнуться.
 */
const unitOf = (f: Fighter): number => -1 - f.id;

/** Кто на поле стоит за этим бойцом. С отрядом «свой» перестал означать
 *  «ведущий», и спрашивать колчан у ведущего стало ошибкой. */
const fighterOf = (state: RaidState, unit: BattleUnit): Fighter | undefined =>
  state.party.find((f) => unitOf(f) === unit.id);

/**
 * Кто стоит за каждым своим бойцом на поле — для панели боя (§11.3).
 * Панель рисует очередь лицами, а лицо выводится из класса и сида (§11.8);
 * пересчитывать `unitOf` у себя панель не должна: формула отрицательных
 * идентификаторов — деталь этого файла, и копия её разошлась бы молча.
 */
export const partyByUnit = (state: RaidState): ReadonlyMap<number, HeroLoadout> =>
  new Map(state.party.map((f) => [unitOf(f), f.loadout]));
const HERO_UNIT = -1;

/**
 * §11.7 — на каком расстоянии боец втягивается в завязавшийся бой.
 * Столько же, сколько длина цепочки на троих: кто идёт следом, тот и в бою,
 * а отставший подходит и вступает позже.
 */
const JOIN_RANGE = 2.5;

/**
 * Завязать бой. Мир останавливается, бойцы встают на решётку там, где их
 * застал контакт (§11.3). В бой идут только проснувшиеся: спящий за стеной
 * к этой стычке отношения не имеет, и втягивать его значило бы наказывать
 * игрока за то, чего он не делал.
 */
function openBattle(state: RaidState): void {
  const engaged = state.loc.enemies.filter((e) => e.hp > 0 && e.awake);
  if (engaged.length === 0) return;

  /**
   * §11.7 — **в бой втягиваются только те, кто рядом.**
   *
   * Так это устроено в играх, откуда взята форма: половина отряда дерётся,
   * половина ещё подходит и вступает следующим ходом. Втягивать всех
   * независимо от расстояния значило бы телепортировать хвост цепочки
   * к завязке — и цепочка, ради которой отряд идёт следом, перестала бы
   * что-либо значить.
   *
   * Порог тот же, что у пробуждения противника (§15): кого видно, тот и в бою.
   */
  const near = state.party.filter(
    (f) => f.hp > 0
      && engaged.some((e) => Math.hypot(e.x - f.x, e.z - f.z) <= JOIN_RANGE),
  );
  // Ведущий в бою всегда: контакт завязался на нём, и оставить его снаружи
  // означало бы бой, в котором игроку нечем ходить.
  const joining = near.includes(state.hero) ? near : [state.hero, ...near];

  // Идентификаторы своих отрицательные: у противников они выданы генератором
  // и начинаются с нуля, и столкнуться эти два счётчика не должны.
  state.battle = createBattle(
    state.loc.size,
    state.loc.blocked,
    joining.map((f) => ({
      id: unitOf(f),
      x: f.x,
      z: f.z,
      hp: f.hp,
      speed: HERO_SPEED * f.loadout.speedMul,
      reach: HERO_REACH,
      ranged: f.loadout.ranged && f.arrows > 0,
      attack: f.loadout.attack + f.mods.attack,
      defense: f.loadout.defense + f.mods.defense,
      agility: f.loadout.agility,
      hasShield: f.mods.hasShield,
    })),
    engaged.map((e) => ({ id: e.id, kind: e.kind, level: e.level, x: e.x, z: e.z, hp: e.hp })),
    // Сид боя — сид локации плюс номер стычки: броски уворота (§11.3)
    // детерминированы, и тот же сейв даёт тот же бой посимвольно.
    state.loc.seed + state.fights,
  );
  // Завязка стоит провианта ровно как прежде (§11.1) — цена решения
  // ввязаться не изменилась оттого, что бой стал пошаговым.
  spend(state, state.fightFood);
  state.fights += 1;
  state.paidRound = 1;
  // §11.7 — сколько бойцов успело втянуться. Прибор спрашивает этим: если
  // всегда трое, правило «только ближние» — украшение; если всегда один,
  // цепочка слишком длинная.
  state.joined += joining.length;
  state.path = [];
  state.events.push('Бой');
}

/**
 * Закончить бой и вернуть его итог в мир: раны героя, стойкость противников
 * и то, где все оказались. Мир — источник правды о положении, поле боя —
 * о том, что случилось.
 */
/** Снять добычу с лисы один раз. Шкура кладётся первой: она редкая и дороже,
 * а при одном свободном месте терять её ради куска мяса было бы ловушкой. */
export function harvestFox(state: RaidState, enemy: Enemy): void {
  if (enemy.kind !== 'fox' || enemy.harvested === true) return;
  enemy.harvested = true;
  state.foxesCaught += 1;
  let free = Math.max(0, state.capacity - state.bagTotal);
  const pelt = Math.min(1, free);
  state.bag.pelt = (state.bag.pelt ?? 0) + pelt;
  state.bagTotal += pelt;
  free -= pelt;
  const meat = Math.min(2, free);
  state.bag.meat = (state.bag.meat ?? 0) + meat;
  state.bagTotal += meat;
  const got = [pelt > 0 ? `лисья шкура ${pelt}` : '', meat > 0 ? `мясо ${meat}` : '']
    .filter(Boolean).join(' · ');
  state.events.push(got === '' ? 'Рюкзак полон — добыча с лисы потеряна' : `Добыто: ${got}`);
}

function closeBattle(state: RaidState): void {
  const battle = state.battle;
  if (battle === null) return;

  for (const u of battle.units) {
    const world = hexToWorld(u.hex);
    if (u.side === 'hero') {
      const f = state.party.find((p) => unitOf(p) === u.id);
      if (f === undefined) continue;
      f.hp = u.hp;
      f.prevX = f.x;
      f.prevZ = f.z;
      f.x = world.x;
      f.z = world.z;
      continue;
    }
    const enemy = state.loc.enemies.find((e) => e.id === u.id);
    if (enemy === undefined) continue;
    enemy.prevX = enemy.x;
    enemy.prevZ = enemy.z;
    enemy.x = world.x;
    enemy.z = world.z;
    if (u.hp <= 0 && enemy.hp > 0) {
      state.kills += 1;
      state.combatXp += enemyXp(enemy.kind, enemy.level);
    }
    enemy.hp = u.hp;
    if (u.hp <= 0) {
      enemy.awake = false;
      harvestFox(state, enemy);
    }
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

  const playAt = state.plays.length;
  const ok = apply(
    battle, state.loc.size, state.loc.blocked, action,
    (from, to) => damageBetween(state, from, to),
    (u) => (u.side === 'hero' ? 'Герой' : ENEMY_STATS[u.kind!].name),
    state.plays,
  );
  if (!ok) return false;

  if (unit.side === 'hero' && action.kind === 'guard') state.guardTurns += 1;
  for (const play of state.plays.slice(playAt)) {
    if (play.kind !== 'strike' || play.target >= 0) continue;
    state.guardPrevented += play.preventedByGuard;
    if (play.pushedTo !== undefined) state.shieldPushes += 1;
    if (play.interceptedFor !== undefined) state.intercepts += 1;
    if (play.dodged) state.dodges += 1;
  }

  if (heroUnit !== undefined && heroUnit.hp < woundsBefore) {
    state.damageTaken += woundsBefore - heroUnit.hp;
    state.lastWoundFrom = 'enemy';
    if (unit.side === 'enemy') state.lastHitBy = unit.kind;
    state.hero.hp = heroUnit.hp;
  }

  for (const e of battle.events) state.events.push(e);

  // Стрелок тратит стрелу за выстрел — там же, где раньше (§14.3).
  const shot = fighterOf(state, unit) ?? state.hero;
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
 * одна шкала HP и одна формула для обеих сторон. Пошаговость меняет,
 * когда бьют, а не как считается удар.
 */
function damageBetween(state: RaidState, from: BattleUnit, to: BattleUnit): ProtectionResult {
  if (from.side === 'hero') {
    // Пустой колчан бьёт слабее (§14.3) — и колчан того, кто бьёт, а не
    // ведущего: с отрядом «свой» перестал означать «единственный».
    const f = fighterOf(state, from);
    const dry = f !== undefined && f.loadout.ranged && f.arrows <= 0;
    return protectionOf(from.attack * (dry ? RANGED_MELEE_PENALTY : 1), to.defense);
  }
  // Защита берётся у того, кого бьют, а не у стороны: трое бойцов держат
  // удар по-разному, и это и есть смысл характеристики.
  return protectionOf(from.attack, to.defense);
}

/** Прогноз до конца круга — та же математика, что у настоящего удара. */
export function battleForecast(state: RaidState, stand?: Hex): BattleForecast | null {
  if (state.battle === null) return null;
  return forecastRound(
    state.battle,
    state.loc.size,
    state.loc.blocked,
    (from, to) => damageBetween(state, from, to),
    stand,
  );
}

/**
 * Шаг вылазки. **Порядок стадий — часть контракта, а не деталь реализации,**
 * и каждая следующая читает то, что записала предыдущая:
 *
 * 1. **Бой.** Если стычка открыта, мир стоит целиком и шаг на этом кончается.
 * 2. **Часы** — `elapsed`, откат умения, глубина возвращения (`maxBack`).
 * 3. **Обзор** — `state.vision`, единственное место, где складываются
 *    слагаемые (§11.4). Всё ниже и весь рендер читают уже готовое число.
 * 4. **Движение** — герой едет по пути и платит провиантом за шаг.
 * 5. **Контакт** — кто проснулся и кто дотянулся; считается от `vision`
 *    и от позиции после шага, иначе враг реагировал бы на прошлый кадр.
 * 6. **Голод** — грызёт раны, только если провиант кончился на этом шаге.
 * 7. **Расходники** — срабатывают после урона, чтобы зелье спасало от раны,
 *    которая уже нанесена, а не от будущей.
 * 8. **Перевыбор ведущего** — последним: до него отряд ещё мог потерять
 *    бойца в любой из стадий выше, и раньше выбирать не из чего.
 *
 * Перестановка любых двух — смена правил игры, а не рефактор.
 */
export function stepRaid(state: RaidState, dt: number, night: boolean, knowledge: number): void {
  if (state.status !== 'running') return;
  state.events.length = 0;

  // Пока идёт бой, мир стоит целиком: ни шага, ни провианта за шаг,
  // ни полёта снарядов. Останавливается именно время, а не темп.
  if (state.battle !== null) {
    let guard = 0;
    while (stepBattle(state) && guard++ < 64) { /* доигрываем чужие ходы */ }
    if (!reelect(state)) {
      for (const f of state.party) f.hp = 0;
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
  state.vision = visionRadius(knowledge, night, true) + state.mods.vision + state.visionAdd;
  stepMovement(state, dt);
  if (state.status !== 'running') return;
  // Вне боя остаётся только завязка: разбудить и подойти. Сам бой считает
  // поле (§11.3), и считать его дважды нельзя.
  stepContact(state, dt, state.vision);
  if (state.inFight && state.battle === null) openBattle(state);
  if (state.battle === null) stepDungeonNpcs(state);

  // Голод не убивает мгновенно: провиант обязан оставаться главной причиной
  // провала (§11.3), но провал должен наступать в дороге, а не внезапно.
  if (anyStarving(state) && state.hunger) {
    state.starve += dt;
    if (state.starve >= 6) {
      state.starve = 0;
      state.hero.hp -= HUNGER_BITE;
      state.damageTaken += HUNGER_BITE;
      state.lastWoundFrom = 'hunger';
      state.events.push('Голод');
    }
  }

  stepConsumables(state);

  if (!reelect(state)) {
    for (const f of state.party) f.hp = 0;
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
  readonly damageTaken: number;
  readonly guardTurns: number;
  readonly guardPrevented: number;
  readonly shieldPushes: number;
  readonly intercepts: number;
  readonly dodges: number;
  readonly fights: number;
  readonly kills: number;
  /** Опыт, заработанный именно победами в боях. */
  readonly combatXp: number;
  /** Кто нанёс последний удар. null — вылазка кончилась не боем. */
  readonly lastHitBy: EnemyKind | null;
  /** §11.7 — сколько бойцов вернулось на ногах. Провал — это ноль, а не
   *  «ведущий пал»: остальные идут дальше меньшим числом. */
  readonly standing: number;
  /** §11.7 — бойцов, втянутых в бои. Делённое на стычки даёт средний
   *  размер боя: правило «только ближние» этим и проверяется. */
  readonly joined: number;
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
    const take = Math.floor(((kept[kind] ?? 0) / total) * lost);
    kept[kind] = (kept[kind] ?? 0) - take;
    removed += take;
  }
  while (removed < lost) {
    const biggest = kinds.reduce((a, b) => ((kept[a] ?? 0) >= (kept[b] ?? 0) ? a : b));
    if ((kept[biggest] ?? 0) <= 0) break;
    kept[biggest] = (kept[biggest] ?? 0) - 1;
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
    damageTaken: state.damageTaken,
    guardTurns: state.guardTurns,
    guardPrevented: state.guardPrevented,
    shieldPushes: state.shieldPushes,
    intercepts: state.intercepts,
    dodges: state.dodges,
    fights: state.fights,
    kills: state.kills,
    combatXp: state.combatXp,
    lastHitBy: raidCause(state) === 'combat' ? state.lastHitBy : null,
    standing: standing(state).length,
    joined: state.joined,
    arrowsSpent: state.arrowsSpent,
    arrowsLeft: state.arrows,
    dryFights: state.dryFights,
  };
}

export type { GameLocation, RaidState, RaidStatus };
