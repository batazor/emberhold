import type { GearMods } from './gear';
import type { HeroLoadout } from './heroes';
import type { ConsumableId } from './consumables';
import type { ResourceKind, Resources } from './resources';

export type Tier = 0 | 1 | 2 | 3;

export interface Cell {
  readonly x: number;
  readonly z: number;
}

/**
 * Три типа противника (§15). Идентификаторы — имена моделей набора KayKit
 * (`Skeleton_Minion`, `Skeleton_Warrior`, `Skeleton_Mage`), и это не описка:
 * называть тип тем, что игрок видит, честнее, чем придумывать породу.
 *
 * **Слова временные, см. §0.1 и §15.** Ни одно решение на них не опирается.
 */
/**
 * Кто участвует в бюджете ран яруса (§22). Трое, и все трое — скелеты (§15):
 * это отдельное имя, а не синоним `EnemyKind`, потому что цена присутствия
 * меряется ботом только у них. Привидение в ярусах не спавнится вовсе,
 * и приписывать ему измеренное число было бы враньём про замер.
 */
export type RaidEnemyKind = 'minion' | 'warrior' | 'mage';

/** Все, кого умеет вести бой: трое ярусных и обитатель кладбища (§6.1.7). */
export type EnemyKind = RaidEnemyKind | 'ghost';

/** §15 — три типа, по одному на диапазон ярусов, различимы силуэтом. */
export interface EnemyStats {
  readonly kind: EnemyKind;
  readonly name: string;
  readonly wounds: number;
  readonly speed: number;
  /** §17.3 — длительность замаха. Нижняя граница осознанной реакции. */
  readonly telegraph: number;
  readonly attackInterval: number;
  readonly reach: number;
  readonly chases: boolean;
}

export interface Enemy {
  readonly id: number;
  readonly kind: EnemyKind;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  wounds: number;
  awake: boolean;
  /** Секунды до конца замаха; 0 — замаха нет. */
  telegraph: number;
  cooldown: number;
}

export interface Container {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly amount: number;
  /** §13 — что именно лежит: вид выпадает по ярусу, а не по контейнеру. */
  readonly kind: ResourceKind;
  opened: boolean;
}

export interface GameLocation {
  readonly seed: number;
  readonly tier: Tier;
  readonly size: number;
  readonly blocked: Uint8Array;
  readonly evac: Cell;
  readonly containers: Container[];
  readonly enemies: Enemy[];
  /** §11.1 «путь назад»: длина кратчайшего пути до эвакуации, в шагах. */
  readonly backSteps: Int32Array;
}

export interface Hero {
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  facing: number;
  wounds: number;
  cooldown: number;
}

export type RaidStatus = 'running' | 'evacuated' | 'failed';

export interface RaidState {
  readonly loc: GameLocation;
  readonly hero: Hero;
  /** Кем идём (§11.7). Вылазка знает о герое ровно это и ничего про лечение. */
  readonly loadout: HeroLoadout;
  /** §14 — снаряжение, свёрнутое в числа на входе. Внутри вылазки не меняется:
   *  перековаться посреди тракта нельзя, и это не упущение, а правило. */
  readonly mods: GearMods;
  /** §11.7 — умение применяется один раз за вылазку, отката нет. */
  skillUsed: boolean;
  /** Сколько секунд умение ещё действует. 0 — не действует. */
  skillLeft: number;
  food: number;
  /** Потолок провианта от Кухни — нужен полосе в HUD (§2). */
  readonly foodMax: number;
  /** Рюкзак по видам: на экране возврата ресурсы зачисляются как есть. */
  bag: Resources;
  bagTotal: number;
  /** Вместимость Склада на момент выхода (§2). */
  readonly capacity: number;
  path: Cell[];
  status: RaidStatus;
  steps: number;
  /** Дальше всего от выхода, куда игрок заходил (§9: глубина эвакуации). */
  maxBack: number;
  /** Секунды в локации — для §17.4 и для телеметрии. */
  elapsed: number;
  /** Секунды без провианта — голод отнимает раны не сразу. */
  starve: number;
  /** Цена вскрытия контейнера. Обычно `FOOD_COST.container`, в прологе ноль. */
  readonly containerFood: number;
  /** Грызёт ли голод раны на нуле провианта. В прологе — нет. */
  readonly hunger: boolean;
  /**
   * Рубится ли здесь лес (§13.3). Свойство локации, а не рендера: занятая
   * клетка поляны — дерево, занятая клетка вылазки — камень, и топор
   * ко второму не относится.
   */
  readonly logging: boolean;
  /** Называет ли событие подбора ставку. В прологе — нет: терять там нечего,
   *  а ставку вводит кадр `bait` первой вылазки. */
  readonly risk: boolean;
  /** Копится, пока идёт бой: провиант списывается один раз за стычку (§11.1). */
  inFight: boolean;
  /** Взятые в вылазку расходники, ещё не сработавшие (§21).
   *  Имя не loadout: так называется снаряжение героя из §14. */
  consumables: ConsumableId[];
  /** Что сработало — для телеметрии и для гашения слота в HUD. */
  fired: ConsumableId[];
  /** До этой секунды после дыма противники не просыпаются: без передышки
   *  контакт восстановился бы на следующем же тике. */
  smokeUntil: number;
  /** Кто нанёс последний удар — нужен телеметрии и замеру: без атрибуции
   *  «провалы в бою» ничего не говорят о том, что чинить. */
  lastHitBy: EnemyKind | null;
  /**
   * Открыт ли выход. Обычно да с первой секунды — «выход всегда доступен
   * одним касанием» (`onboarding.html`, кадр 7). Закрывается он ровно в одном
   * месте: в первой вылазке, пока игрок не взял добычу. Герой стартует на
   * точке эвакуации, и без этого первый же тап рядом со стартом заканчивал
   * вылазку с пустым рюкзаком — игрок уходил домой, не увидев игры.
   */
  evacOpen: boolean;
  /** Реплики для HUD — то, что игрок должен заметить в этот тик. */
  events: string[];
}
