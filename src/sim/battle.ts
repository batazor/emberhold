/**
 * Пошаговый бой (§11.3). Мир исследуется в реальном времени; как только
 * контакт завязался, время останавливается и на местности проступает
 * гекс-решётка (`hex.ts`).
 *
 * **Что это меняет в конструкции игры и чего не меняет.**
 *
 * Меняет: бой перестаёт быть арифметикой, за которой игрок наблюдает.
 * Атака, Защита, Скорость и позиция становятся тем, чем распоряжаются,
 * а не тем, что подставляется в формулу за кадром.
 *
 * Не меняет: решение «глубже или назад» (§22.5) остаётся главным. Поэтому
 * бой **стоит провианта за раунд**, а не только за завязку. Останови время
 * бесплатно — и стоять в бою станет выгоднее, чем идти, а весь §11
 * держится ровно на обратном.
 *
 * Случайность здесь одна — уворот (§11.3), и бросок его детерминирован:
 * считается от сида боя и счётчика ударов (`rollPercent`), а не от
 * `Math.random`. Шаг вылазки остаётся воспроизводимым (`scripts/arch.ts`) —
 * тот же сид даёт тот же бой, и на этом по-прежнему стоят замеры, золотой
 * мастер и разбор бага по сейву. Инициатива считается Скоростью, а не броском.
 */
import { HERO_RANGED_REACH } from './config';
import { ENEMY_STATS, enemyStats } from './enemies';
import {
  hexDistance,
  hexKey,
  hexNeighbors,
  hexOpen,
  hexReach,
  hexSight,
  worldToHex,
} from './hex';
import type { Hex } from './hex';
import { finishProtection, protectionOf } from './protection';
import type { ProtectionResult } from './protection';
import type { EnemyKind } from './types';

/**
 * Сколько секунд мира «стоит» раунд боя. Не настройка темпа, а курс обмена:
 * из него выводится, сколько гексов проходит боец за ход, и он же держит
 * скорости из §17.4 сравнимыми с прежними.
 */
export const ROUND_SECONDS = 2;

/**
 * Провиант за раунд боя сверх платы за завязку (§11.1). Единица — та же,
 * что за шаг: раунд стоит примерно как шаг, и затянувшийся бой съедает
 * дорогу домой. Без этого остановленное время становится бесплатным
 * убежищем, а §22.5 перестаёт работать.
 */
export const FOOD_PER_ROUND = 1;

/** Уникальные приёмы обитателей замка; числа принадлежат правилам, не анимации. */
export const MINOTAUR_CHARGE_BONUS = 3;
export const STONE_ARMOR = 2;

/**
 * §11.3 — уворот. Модель взята из Wasteland Punk: уворот — не вечная лотерея,
 * а **плавающий ресурс**. База считается из Ловкости; каждый промах сжигает
 * часть уворота — защитник выложился, уклоняясь, и по нему становится проще
 * попасть; в свой ход боец переводит дух и часть базы возвращает. Затанковать
 * увёртливостью бесконечно нельзя по построению, а не по настройке.
 */
/** Процентов уворота за очко Ловкости. Черновое до перемера (`scripts/combat.ts`). */
export const DODGE_PER_AGILITY = 4;
/** Потолок базы уворота: рост с уровнем не должен доводить до неуязвимости. */
export const DODGE_MAX = 60;
/** Ниже этой доли базы уворот не падает — увёртливый остаётся увёртливым. */
export const DODGE_FLOOR_SHARE = 0.3;
/** Сколько базы возвращается в начале собственного хода. */
export const DODGE_REGEN_SHARE = 0.15;
/** Какую долю точности атаки промах сжигает у уворота цели. */
export const DODGE_SPENT_SHARE = 0.25;
/** Точность атаки. Пока константа и одна на всех: шанс попадания —
 *  точность минус текущий уворот цели, как в первоисточнике. */
export const ATTACK_ACCURACY = 100;

/** База уворота из Ловкости, в процентах. */
export const dodgeOf = (agility: number): number =>
  Math.min(DODGE_MAX, Math.max(0, agility) * DODGE_PER_AGILITY);

/**
 * Детерминированный «бросок» 0–99: перемешивание сида и номера удара,
 * а не `Math.random`. Один и тот же бой из сейва проигрывается посимвольно —
 * случайность видит игрок, но не замер.
 */
export function rollPercent(seed: number, n: number): number {
  let x = (seed + Math.imul(n + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) % 100;
}

export type Side = 'hero' | 'enemy';

export interface BattleUnit {
  readonly id: number;
  readonly side: Side;
  /** У противника — его вид; у героя null. */
  readonly kind: EnemyKind | null;
  /** §22.6 — уровень противника: HUD подписывает, статы уже посчитаны
   *  при создании. У героя единица — его уровень живёт в лагере. */
  readonly level: number;
  hex: Hex;
  /** Очки здоровья; одна шкала и одна формула для обеих сторон (§11.3). */
  hp: number;
  /** Гексов за ход. Выводится из скорости мира, а не назначается. */
  readonly move: number;
  /**
   * §11.3 — Атака и Защита **этого бойца**, а не стороны.
   *
   * Заведены здесь, а не берутся у героя, потому что отряд уже близко:
   * пока своих ровно один, спросить его характеристики у `state.loadout`
   * было бы одно и то же, — но ровно с этого места единственность и начала
   * бы врастать. Трое бойцов с числами одного читались бы как поломка,
   * которую нашли бы не сразу.
   */
  readonly attack: number;
  readonly defense: number;
  /** Дальность удара в гексах. Ближний бой — единица, то есть соседство. */
  readonly reach: number;
  readonly ranged: boolean;
  /** База уворота из Ловкости (§11.3). К ней уворот тянется, отдыхая. */
  readonly dodgeBase: number;
  /** Текущий уворот — плавает: промахи сжигают, свой ход возвращает. */
  dodge: number;
  /**
   * Ход состоит из перемещения и действия, и каждого — по одному.
   * Без `moved` боец ходит бесконечно: план «дойти» остаётся выполнимым
   * после каждого шага, очередь не двигается, и бой не кончается никогда.
   * Золотой мастер показал это как 95% провалов при нуле полученных ран.
   */
  moved: boolean;
  /** Потрачено ли действие. Действие ход и заканчивает. */
  acted: boolean;
  /** Держит ли блок до своего следующего хода (§14.2). */
  guarding: boolean;
  /** Щит делает из обычного Блока Заслон. */
  readonly hasShield: boolean;
  /** Первый ближний удар по Заслону пытается оттолкнуть врага. */
  braceReady: boolean;
  /** Первый удар по соседнему союзнику можно перехватить. */
  interceptReady: boolean;
}

export interface BattleState {
  readonly units: BattleUnit[];
  /** Порядок хода: индексы в `units`, отсортированные Скоростью. */
  readonly order: number[];
  /** Чей ход сейчас — позиция в `order`. */
  at: number;
  round: number;
  /** Что случилось за последний ход — для реплик HUD и звука. */
  events: string[];
  /** Сид боя — из него считаются броски уворота (`rollPercent`). */
  readonly seed: number;
  /** Счётчик ударов: номер броска. Растёт с каждым замахом любой стороны. */
  rolls: number;
}

export type BattleAction =
  | { readonly kind: 'move'; readonly to: Hex }
  | { readonly kind: 'attack'; readonly target: number }
  | { readonly kind: 'guard' }
  | { readonly kind: 'wait' };

/**
 * Протокол показа (§17.1). Симуляция решает бой мгновенно — вся очередь
 * противников доигрывается за один тик, и это правильно: пошаговость не должна
 * заставлять ждать. Но мгновенный бой нечего смотреть: строки `events` знают
 * «кто кого», а рендеру нужно «откуда, куда и чем кончилось».
 *
 * Записи складываются тем же `apply`, что меняет состояние, — протокол
 * не может разойтись с боем, потому что пишется тем же ходом. Проигрывает
 * его рендер в своём темпе; симуляция про темп не знает ничего, и замеры
 * с ботом остаются воспроизводимыми.
 */
export type BattlePlay =
  | {
      readonly kind: 'move';
      readonly unit: number;
      /** Гексы от стойки до места, включая оба конца, — по ним идёт тело. */
      readonly path: readonly Hex[];
    }
  | {
      readonly kind: 'strike';
      readonly unit: number;
      readonly target: number;
      readonly from: Hex;
      readonly at: Hex;
      readonly ranged: boolean;
      /** Цель увернулась: удар прошёл мимо, ран нет — показ без вспышки. */
      readonly dodged: boolean;
      /** Удар пришёлся в блок — цель держит, а не вздрагивает. */
      readonly blocked: boolean;
      /** Цель пала: клип падения играется в момент попадания, а не в конце боя. */
      readonly killed: boolean;
      /** Стойкость цели после удара — полоска тикает по протоколу. */
      readonly hpAfter: number;
      readonly dealt: number;
      readonly preventedByDefense: number;
      readonly preventedByGuard: number;
      /** Куда Заслон оттолкнул атакующего. */
      readonly pushedTo?: Hex | undefined;
      /** Кого щитоносец прикрыл этим ударом. */
      readonly interceptedFor?: number | undefined;
      /** Визуальный слой читает приём, но его эффект уже полностью решён здесь. */
      readonly technique?: 'minotaur-charge' | 'stone-armor' | undefined;
    }
  | { readonly kind: 'guard'; readonly unit: number };

/** Гексов за ход из скорости мира. Не меньше одного: боец, который не может
 *  сдвинуться, превращает бой в перестрелку двух столбов. */
export const movePerTurn = (speed: number): number =>
  Math.max(1, Math.round(speed * ROUND_SECONDS));

/**
 * Ближний бой — это соседство, и точка. В мире досягаемость меряется долями
 * клетки (топор воина 1,5 против геройской 1,0), и это имело смысл, пока
 * противник останавливался на длине своего оружия. На решётке остановиться
 * «в полутора гексах» нельзя, и полтора превращаются в один — то есть
 * в то же самое соседство. Разница уходит туда, где ей место: в Атаку.
 */
export const reachInHexes = (reach: number, ranged: boolean): number =>
  ranged ? Math.max(1, Math.round(reach)) : 1;

export const unitAt = (state: BattleState, hex: Hex): BattleUnit | undefined =>
  state.units.find((u) => u.hp > 0 && hexKey(u.hex) === hexKey(hex));

export const current = (state: BattleState): BattleUnit | undefined =>
  state.units[state.order[state.at] ?? -1];

export const alive = (state: BattleState, side: Side): BattleUnit[] =>
  state.units.filter((u) => u.side === side && u.hp > 0);

/** Занятые гексы — тела не проходятся насквозь. */
export const occupied = (state: BattleState, except?: number): ReadonlySet<string> =>
  new Set(state.units.filter((u) => u.hp > 0 && u.id !== except).map((u) => hexKey(u.hex)));

/**
 * Порядок хода. **Герой открывает раунд, противники ходят между собой
 * по Скорости.**
 *
 * Правило «быстрый ходит раньше» для всех выглядело честнее, но замер его
 * отменил: скелет быстрее героя, и на нулевом ярусе двое скелетов убивали
 * его за два раунда — 0% успеха там, где §15 обещает «учит, что бой дёшев».
 * Причина не в силе противника: в реальном времени герой бил, пока тот
 * подходил, а пошаговый раунд отдаёт каждому по удару, и первый ход решает
 * больше, чем любая характеристика.
 *
 * Довод тот же, что §17.3 приводит про замах: противник, бьющий раньше,
 * чем игрок вообще сходил, читается как несправедливость независимо
 * от урона.
 *
 * Скорость при этом не обесценена — она по-прежнему задаёт, сколько гексов
 * боец проходит за ход, и очередь среди противников. Ничьи разрешаются
 * номером, а не броском: шаг обязан быть детерминированным.
 */
export function initiative(units: readonly BattleUnit[], speeds: readonly number[]): number[] {
  return units
    .map((u, i) => ({ i, speed: speeds[i] ?? 0, side: u.side }))
    .sort((a, b) =>
      (a.side === b.side ? 0 : a.side === 'hero' ? -1 : 1)
      || b.speed - a.speed
      || a.i - b.i)
    .map((x) => x.i);
}

/**
 * Гекс, на который можно встать: сам или ближайший свободный сосед.
 *
 * Проверять обязательно. Центр гекса лежит в мировых координатах, и округление
 * может увести его в занятую клетку — а боец, поставленный в стену, после боя
 * возвращается в мир внутрь камня. Пути оттуда нет, и вылазка обрывается
 * молча, со статусом «идёт»: замер показывал 0% успеха на нулевом ярусе,
 * и это была не сложность, а обрыв.
 */
function placeOn(size: number, blocked: Uint8Array, want: Hex, taken: ReadonlySet<string>): Hex {
  const free = (h: Hex): boolean => hexOpen(size, blocked, h) && !taken.has(hexKey(h));
  if (free(want)) return want;
  const near = hexNeighbors(want).find(free);
  if (near !== undefined) return near;
  // Второе кольцо — на случай тесноты у стены.
  for (const n of hexNeighbors(want)) {
    const far = hexNeighbors(n).find(free);
    if (far !== undefined) return far;
  }
  return want;
}

/** Начало боя: бойцы встают на решётку там, где застал контакт. */
export function createBattle(
  size: number,
  blocked: Uint8Array,
  /**
   * Свои бойцы. Список, а не один: поле боя оперирует сторонами с самого
   * начала, и отряд ложится сюда без правок — меняется только то, кого
   * в него передали.
   */
  party: readonly {
    id: number;
    x: number;
    z: number;
    hp: number;
    speed: number;
    reach: number;
    ranged: boolean;
    attack: number;
    defense: number;
    agility: number;
    hasShield?: boolean;
  }[],
  enemies: readonly { id: number; kind: EnemyKind; level: number; x: number; z: number; hp: number }[],
  /** Сид боя для бросков уворота. Приходит из сида локации и номера стычки —
   *  тот же сейв даёт тот же бой. */
  seed = 0,
): BattleState {
  const units: BattleUnit[] = [];
  const taken = new Set<string>();
  for (const p of party) {
    const hex = placeOn(size, blocked, worldToHex(p.x, p.z), taken);
    taken.add(hexKey(hex));
    units.push({
      id: p.id,
      side: 'hero',
      kind: null,
      level: 1,
      hex,
      hp: p.hp,
      move: movePerTurn(p.speed),
      reach: reachInHexes(p.ranged ? HERO_RANGED_REACH : p.reach, p.ranged),
      ranged: p.ranged,
      attack: p.attack,
      defense: p.defense,
      dodgeBase: dodgeOf(p.agility),
      dodge: dodgeOf(p.agility),
      moved: false,
      acted: false,
      guarding: false,
      hasShield: p.hasShield ?? false,
      braceReady: false,
      interceptReady: false,
    });
  }
  for (const e of enemies) {
    // §22.6 — числа берутся у уровня, а не у типа: воин Дна бьёт больнее
    // воина Подступов, оставаясь тем же воином по рисунку боя.
    const stats = enemyStats(e.kind, e.level);
    // Двое в одном гексе — следствие округления, а не расстановки: в мире
    // они стояли врозь. Раздвигаем по соседям, а не роняем бой.
    const hex = placeOn(size, blocked, worldToHex(e.x, e.z), taken);
    taken.add(hexKey(hex));
    units.push({
      id: e.id,
      side: 'enemy',
      kind: e.kind,
      level: e.level,
      hex,
      hp: e.hp,
      move: movePerTurn(stats.speed),
      reach: reachInHexes(stats.ranged ? stats.reach : 1, stats.ranged),
      ranged: stats.ranged,
      attack: stats.attack,
      defense: 0,
      dodgeBase: dodgeOf(stats.agility),
      dodge: dodgeOf(stats.agility),
      moved: false,
      acted: false,
      guarding: false,
      hasShield: false,
      braceReady: false,
      interceptReady: false,
    });
  }

  const speeds = units.map((u) => {
    if (u.side !== 'hero') return ENEMY_STATS[u.kind!].speed;
    return party.find((p) => p.id === u.id)?.speed ?? 0;
  });
  return { units, order: initiative(units, speeds), at: 0, round: 1, events: [], seed, rolls: 0 };
}

/**
 * Оторвался ли герой. Бой кончается не только смертью: §15 строит роли
 * врагов на выборе «обойти или пробиться», и без возможности выйти
 * второй вариант исчезает — любая встреча становится боем насмерть.
 * Замер показал это прямо: 2,86 раны из трёх за вылазку.
 *
 * Условие проверяется в начале раунда, а не после каждого хода: за раунд
 * противники успевают догнать, и оторваться значит пережить их ходы,
 * а не просто отойти на шаг. Это делает отрыв решением со стоимостью.
 */
export function contactBroken(
  state: BattleState,
  size: number,
  blocked: Uint8Array,
): boolean {
  const heroes = alive(state, 'hero');
  if (heroes.length === 0) return false;
  return alive(state, 'enemy').every(
    (e) => targets(state, size, blocked, e).length === 0,
  );
}

/** Кончился ли бой и чем. */
export function battleOver(state: BattleState): 'hero' | 'enemy' | null {
  if (alive(state, 'hero').length === 0) return 'enemy';
  if (alive(state, 'enemy').length === 0) return 'hero';
  return null;
}

/** Куда этот боец может дойти за свой ход. */
export function moves(
  state: BattleState,
  size: number,
  blocked: Uint8Array,
  unit: BattleUnit,
): Map<string, { hex: Hex; steps: number }> {
  // Уже ходил — идти некуда: перемещение в ходу одно.
  if (unit.moved) return new Map();
  const reach = hexReach(size, blocked, unit.hex, unit.move, occupied(state, unit.id));
  // Свой гекс — не ход. Волновой обход возвращает его нулём шагов, и без
  // этой строки «шаг на месте» проходит как ход: очередь не двигается,
  // и бой крутится вечно.
  reach.delete(hexKey(unit.hex));
  return reach;
}

/** Кого этот боец достаёт с места, где стоит. */
export function targets(
  state: BattleState,
  size: number,
  blocked: Uint8Array,
  unit: BattleUnit,
): BattleUnit[] {
  return state.units.filter(
    (u) =>
      u.hp > 0
      && u.side !== unit.side
      && hexDistance(unit.hex, u.hex) <= unit.reach
      // Ближний достаёт соседа и без линии: он и так вплотную.
      && (!unit.ranged || hexSight(size, blocked, unit.hex, u.hex)),
  );
}

/** Кто встанет между ударом и выбранной целью. Одно правило для боя и прогноза. */
function interceptorFor(state: BattleState, aimed: BattleUnit): BattleUnit | undefined {
  return state.units
    .filter((u) =>
      u.hp > 0
      && u.side === aimed.side
      && u.id !== aimed.id
      && u.guarding
      && u.hasShield
      && u.interceptReady
      && hexDistance(u.hex, aimed.hex) <= 1)
    .sort((a, b) => a.id - b.id)[0];
}

/** Куда отлетит атакующий. `from` нужен ИИ, который оценивает будущую стойку. */
function bracePushTo(
  state: BattleState,
  size: number,
  blocked: Uint8Array,
  attacker: BattleUnit,
  target: BattleUnit,
  from: Hex = attacker.hex,
): Hex | undefined {
  if (attacker.kind === 'minotaur' || attacker.kind === 'stone-golem') return undefined;
  const want = { q: from.q + (from.q - target.hex.q), r: from.r + (from.r - target.hex.r) };
  return hexOpen(size, blocked, want) && !occupied(state, attacker.id).has(hexKey(want))
    ? want
    : undefined;
}

/** Передать ход следующему живому. Новый раунд снимает блоки и отметки. */
export function advance(state: BattleState): void {
  for (let step = 0; step < state.order.length + 1; step++) {
    state.at += 1;
    if (state.at >= state.order.length) {
      state.at = 0;
      state.round += 1;
      for (const u of state.units) u.acted = false;
    }
    const next = current(state);
    if (next !== undefined && next.hp > 0) {
      // Блок держится до собственного следующего хода: он и есть цена хода,
      // потраченного на защиту, а не бесплатная поза.
      next.guarding = false;
      next.braceReady = false;
      next.interceptReady = false;
      next.moved = false;
      next.acted = false;
      // Свой ход — передышка: часть базы уворота возвращается (§11.3).
      // Не вся: сожжённое промахами противника отыгрывается за несколько
      // ходов, и серия атак по одному бойцу остаётся способом его пробить.
      next.dodge = Math.min(next.dodgeBase, next.dodge + next.dodgeBase * DODGE_REGEN_SHARE);
      return;
    }
  }
}

/**
 * Сколько HP снимает удар этого бойца по этому. Урон считается теми же
 * правилами для обеих сторон (§11.3). Пошаговость меняет, **когда** бьют,
 * а не **как** считается удар, — иначе получилось бы две модели боя,
 * и настраивать пришлось бы обе.
 */
export interface Damage {
  /** Сколько HP снять с цели. */
  readonly amount: number;
  /** Отражён ли удар блоком. */
  readonly blocked: boolean;
}

/**
 * Блок делит удар пополам, а не отменяет его. Отмена превратила бы блок
 * в единственный разумный ход против сильного противника; половина оставляет
 * его решением — потраченным ходом, который окупается не всегда.
 */
export const GUARD_SHARE = 0.5;
const amount = (n: number): string => Number.isInteger(n) ? String(n) : n.toFixed(1);

export type DamageSource = number | ProtectionResult;

/** Тот же итог удара для прогноза и для применения. */
export function strikeProtection(
  from: BattleUnit,
  to: BattleUnit,
  source: DamageSource,
  guarding = to.guarding,
): ProtectionResult {
  const base = typeof source === 'number' ? protectionOf(source, 0) : source;
  return finishProtection(base, {
    guarding,
    guardShare: GUARD_SHARE,
    add: from.kind === 'minotaur' && from.moved ? MINOTAUR_CHARGE_BONUS : 0,
    absorb: to.kind === 'stone-golem' ? STONE_ARMOR : 0,
  });
}

/**
 * Путь шага для протокола показа: гексы от стойки до места. Восстанавливается
 * спуском по волновому полю — от места к стойке, каждый раз на соседа с числом
 * шагов на единицу меньше. Сосед такой есть по построению обхода, а порядок
 * соседей закреплён (`HEX_DIRS`), поэтому путь детерминирован.
 */
function pathTo(
  size: number,
  blocked: Uint8Array,
  state: BattleState,
  unit: BattleUnit,
  to: { hex: Hex; steps: number },
): Hex[] {
  const field = hexReach(size, blocked, unit.hex, unit.move, occupied(state, unit.id));
  const path: Hex[] = [to.hex];
  let cur = to;
  while (cur.steps > 0) {
    const prev = hexNeighbors(cur.hex)
      .map((h) => field.get(hexKey(h)))
      .find((s) => s !== undefined && s.steps === cur.steps - 1);
    if (prev === undefined) break;
    path.push(prev.hex);
    cur = prev;
  }
  return path.reverse();
}

/** Применить действие текущего бойца. Возвращает, потрачен ли ход.
 *  `plays` — протокол показа: если передан, действие записывает себя в него. */
export function apply(
  state: BattleState,
  size: number,
  blocked: Uint8Array,
  action: BattleAction,
  damageOf: (from: BattleUnit, to: BattleUnit) => DamageSource,
  name: (u: BattleUnit) => string,
  plays?: BattlePlay[],
): boolean {
  const unit = current(state);
  if (unit === undefined || unit.hp <= 0) return false;
  state.events.length = 0;

  switch (action.kind) {
    case 'move': {
      const reach = moves(state, size, blocked, unit);
      const spot = reach.get(hexKey(action.to));
      if (spot === undefined) return false;
      plays?.push({ kind: 'move', unit: unit.id, path: pathTo(size, blocked, state, unit, spot) });
      unit.hex = spot.hex;
      unit.moved = true;
      // Шаг хода не кончает: подойти и ударить — один ход, иначе ближний бой
      // становится вдвое медленнее дальнего без всякой на то причины.
      return true;
    }
    case 'attack': {
      const aimed = state.units.find((u) => u.id === action.target && u.hp > 0);
      if (aimed === undefined) return false;
      if (!targets(state, size, blocked, unit).includes(aimed)) return false;
      // §11.7 — щитоносец в Заслоне прикрывает соседа один раз.
      const interceptor = interceptorFor(state, aimed);
      const target = interceptor ?? aimed;
      if (interceptor !== undefined) interceptor.interceptReady = false;
      const attackFrom = unit.hex;
      const technique = unit.kind === 'minotaur' && unit.moved
        ? 'minotaur-charge'
        : target.kind === 'stone-golem'
          ? 'stone-armor'
          : undefined;
      // Уворот (§11.3). Бросок детерминирован сидом и номером удара; блок
      // уворота не даёт — держащий стоит, а не уходит с линии. Промах
      // сжигает часть уворота цели, но не ниже трети базы: увёртливого
      // пробивают серией, а не отменяют одним попаданием.
      const roll = rollPercent(state.seed, state.rolls++);
      if (!target.guarding && roll < target.dodge) {
        target.dodge = Math.max(
          target.dodgeBase * DODGE_FLOOR_SHARE,
          target.dodge - ATTACK_ACCURACY * DODGE_SPENT_SHARE,
        );
        plays?.push({
          kind: 'strike',
          unit: unit.id,
          target: target.id,
          from: unit.hex,
          at: target.hex,
          ranged: unit.ranged,
          dodged: true,
          blocked: false,
          killed: false,
          hpAfter: target.hp,
          dealt: 0,
          preventedByDefense: 0,
          preventedByGuard: 0,
          interceptedFor: interceptor === undefined ? undefined : aimed.id,
          technique,
        });
        state.events.push(`${name(unit)} бьёт — ${name(target)} уходит от удара`);
        unit.acted = true;
        return true;
      }
      const protection = strikeProtection(unit, target, damageOf(unit, target));
      const dealt = protection.dealt;
      target.hp -= dealt;

      // Заслон покупает пространство, а не только HP. Тяжёлые тела
      // не двигаются, но попытку всё равно сжигают: Заслон один.
      let pushedTo: Hex | undefined;
      if (
        target.guarding
        && target.hasShield
        && target.braceReady
        && !unit.ranged
        && hexDistance(unit.hex, target.hex) === 1
      ) {
        target.braceReady = false;
        const want = bracePushTo(state, size, blocked, unit, target);
        if (want !== undefined) {
          unit.hex = want;
          pushedTo = want;
        }
      }
      plays?.push({
        kind: 'strike',
        unit: unit.id,
        target: target.id,
        from: attackFrom,
        at: target.hex,
        ranged: unit.ranged,
        dodged: false,
        blocked: target.guarding,
        killed: target.hp <= 0,
        hpAfter: Math.max(0, target.hp),
        dealt,
        preventedByDefense: protection.preventedByDefense,
        preventedByGuard: protection.preventedByGuard,
        pushedTo,
        interceptedFor: interceptor === undefined ? undefined : aimed.id,
        technique,
      });
      if (interceptor !== undefined) state.events.push(`${name(interceptor)} прикрывает ${name(aimed)}`);
      if (pushedTo !== undefined) state.events.push(`${name(target)} отбрасывает ${name(unit)}`);
      if (technique === 'minotaur-charge') state.events.push('Минотавр идёт на таран');
      if (technique === 'stone-armor') state.events.push('Каменная броня смягчает удар');
      state.events.push(
        target.guarding
          ? `${name(unit)} бьёт — ${name(target)} держит · спасено ${amount(protection.preventedByGuard)}`
          : protection.preventedByDefense > 0
            ? `${name(unit)} бьёт · Защита сняла ${amount(protection.preventedByDefense)}`
            : `${name(unit)} бьёт`,
      );
      if (target.hp <= 0) state.events.push(`${name(target)} падёт`);
      unit.acted = true;
      return true;
    }
    case 'guard': {
      unit.guarding = true;
      unit.braceReady = unit.hasShield;
      unit.interceptReady = unit.hasShield;
      unit.acted = true;
      plays?.push({ kind: 'guard', unit: unit.id });
      state.events.push(`${name(unit)} закрывается`);
      return true;
    }
    case 'wait': {
      unit.acted = true;
      return true;
    }
  }
}

/**
 * Ход противника. Решается правилом, а не броском: шаг вылазки
 * детерминирован (`scripts/arch.ts`), и «умный» ИИ с рандомом сделал бы
 * замеры невоспроизводимыми.
 *
 * Правило простое и читаемое игроком с экрана — это важнее хитрости:
 * достаю — бью, не достаю — подхожу настолько, насколько хватает хода.
 * Непреследующий (маг, §15) с места не сходит: его роль в том, чтобы
 * держать зону, и подбегающий маг перестал бы быть магом.
 */
export function enemyPlan(
  state: BattleState,
  size: number,
  blocked: Uint8Array,
  unit: BattleUnit,
  chases: boolean,
): BattleAction {
  const reachable = targets(state, size, blocked, unit);
  if (reachable.length > 0) {
    const best = preferredEnemyTarget(state, unit, reachable);
    return { kind: 'attack', target: best.id };
  }
  // Уже ходил и не достал — ход кончен. Без этого план «дойти» остаётся
  // выполнимым бесконечно.
  if (!chases || unit.moved) return { kind: 'wait' };

  const foes = alive(state, unit.side === 'hero' ? 'enemy' : 'hero');
  if (foes.length === 0) return { kind: 'wait' };
  const focus = preferredEnemyTarget(state, unit, foes);

  const reach = moves(state, size, blocked, unit);
  let best: { hex: Hex; score: number } | null = null;
  for (const [, spot] of reach) {
    // Каждый тип идёт к той же цели, которую выберет для удара. Воин возле
    // Заслона дополнительно ищет стойку, из которой отбрасыванию некуда идти:
    // стена или другое тело сжигают первое срабатывание без бесплатного отрыва.
    const near = hexDistance(spot.hex, focus.hex);
    const trapsBrace = unit.kind === 'warrior'
      && focus.hasShield
      && focus.guarding
      && near <= unit.reach
      && bracePushTo(state, size, blocked, unit, focus, spot.hex) === undefined;
    const score = near * 100 + spot.steps - (trapsBrace ? 40 : 0);
    if (best === null || score < best.score) best = { hex: spot.hex, score };
  }
  return best === null ? { kind: 'wait' } : { kind: 'move', to: best.hex };
}

/**
 * Цель — часть силуэта врага, а не скрытая случайность.
 *
 * - воин и тяжёлые бьют поднятый щит, чтобы снять первое срабатывание;
 * - маг целит прикрытого соседа и тем самым заставляет тратить перехват;
 * - остальные добивают самого раненого, поэтому стая складывает удары.
 */
function preferredEnemyTarget(
  state: BattleState,
  unit: BattleUnit,
  choices: readonly BattleUnit[],
): BattleUnit {
  const score = (target: BattleUnit): number => {
    const shieldUp = target.hasShield && target.guarding && target.braceReady;
    const covered = !target.hasShield && interceptorFor(state, target) !== undefined;
    const role = unit.kind === 'mage' && covered
      ? -20_000
      : (unit.kind === 'warrior' || unit.kind === 'minotaur' || unit.kind === 'stone-golem') && shieldUp
        ? -10_000
        : 0;
    return role + target.hp * 100 + target.id;
  };
  return choices.reduce((a, b) => (score(a) <= score(b) ? a : b));
}

export type ThreatIntent =
  | 'brace-burn'
  | 'draw-intercept'
  | 'charge'
  | 'immovable'
  | 'swarm';

export interface BattleThreat {
  readonly attacker: number;
  /** Кого противник выбрал до возможного перехвата. */
  readonly aimed: number;
  /** Кто действительно примет удар в этом сценарии. */
  readonly target: number;
  readonly path: readonly Hex[];
  /** Урон при попадании в этом сценарии. */
  readonly damage: number;
  readonly hitChance: number;
  readonly ranged: boolean;
  /** Почему этот удар является контрприёмом против Заслона. */
  readonly intent?: ThreatIntent | undefined;
}

export interface BattleForecast {
  readonly unit: number;
  /** Что случится без защитного действия. */
  readonly threats: readonly BattleThreat[];
  /** Что случится, если текущий боец выберет Блок/Заслон. */
  readonly guardedThreats: readonly BattleThreat[];
  /** Сумма только по тому бойцу, который сейчас ходит. */
  readonly damage: number;
  readonly guardedDamage: number;
  readonly canBreakContact: boolean;
}

const copyBattle = (state: BattleState): BattleState => ({
  ...state,
  units: state.units.map((u) => ({ ...u, hex: { ...u.hex } })),
  order: [...state.order],
  events: [],
});

interface ForecastScenario {
  readonly threats: readonly BattleThreat[];
  readonly broken: boolean;
}

function threatIntent(
  unit: BattleUnit,
  target: BattleUnit,
  interceptor: BattleUnit | undefined,
): ThreatIntent | undefined {
  if (unit.kind === 'mage' && interceptor !== undefined) return 'draw-intercept';
  if (!target.guarding || !target.hasShield) return undefined;
  if (!target.braceReady) return undefined;
  if (unit.kind === 'warrior') return 'brace-burn';
  if (unit.kind === 'minotaur') return unit.moved ? 'charge' : 'immovable';
  if (unit.kind === 'stone-golem') return 'immovable';
  return undefined;
}

/** Проиграть один вариант круга, не вскрывая броски и не снимая HP. */
function forecastScenario(
  state: BattleState,
  size: number,
  blocked: Uint8Array,
  damageOf: (from: BattleUnit, to: BattleUnit) => DamageSource,
  originalId: number,
  guarding: boolean,
  stand?: Hex,
): ForecastScenario | null {
  const copy = copyBattle(state);
  const hero = copy.units.find((u) => u.id === originalId);
  if (hero === undefined) return null;
  if (stand !== undefined) {
    const legal = moves(copy, size, blocked, hero).get(hexKey(stand));
    if (legal === undefined) return null;
    hero.hex = { ...legal.hex };
  }
  hero.moved = stand !== undefined;
  hero.guarding = guarding;
  hero.braceReady = guarding && hero.hasShield;
  hero.interceptReady = guarding && hero.hasShield;
  hero.acted = true;
  advance(copy);

  const paths = new Map<number, readonly Hex[]>();
  const threats: BattleThreat[] = [];
  let guard = 0;
  while (guard++ < copy.units.length * 3) {
    const unit = current(copy);
    if (unit === undefined || unit.side === 'hero') break;
    const stats = ENEMY_STATS[unit.kind!];
    const plan = enemyPlan(copy, size, blocked, unit, stats.chases);
    if (plan.kind === 'move') {
      const plays: BattlePlay[] = [];
      if (!apply(copy, size, blocked, plan, damageOf, () => '', plays)) break;
      const moved = plays.find((p): p is Extract<BattlePlay, { kind: 'move' }> => p.kind === 'move');
      if (moved !== undefined) paths.set(unit.id, moved.path);
      continue;
    }
    if (plan.kind === 'attack') {
      const aimed = copy.units.find((u) => u.id === plan.target && u.hp > 0);
      if (aimed !== undefined) {
        const interceptor = interceptorFor(copy, aimed);
        const target = interceptor ?? aimed;
        if (interceptor !== undefined) interceptor.interceptReady = false;
        threats.push({
          attacker: unit.id,
          aimed: aimed.id,
          target: target.id,
          path: paths.get(unit.id) ?? [],
          damage: strikeProtection(unit, target, damageOf(unit, target)).dealt,
          hitChance: target.guarding
            ? ATTACK_ACCURACY
            : Math.max(0, Math.min(100, ATTACK_ACCURACY - target.dodge)),
          ranged: unit.ranged,
          intent: threatIntent(unit, target, interceptor),
        });

        // Первое столкновение со щитом меняет последующие пути даже в
        // прогнозе. HP не снимается, но срабатывание и позиция — настоящие.
        if (
          target.guarding
          && target.hasShield
          && target.braceReady
          && !unit.ranged
          && hexDistance(unit.hex, target.hex) === 1
        ) {
          target.braceReady = false;
          const pushed = bracePushTo(copy, size, blocked, unit, target);
          if (pushed !== undefined) unit.hex = pushed;
        }
      }
    }
    unit.acted = true;
    advance(copy);
  }

  const minions = guarding && hero.hasShield
    ? threats.filter((t) => copy.units.find((u) => u.id === t.attacker)?.kind === 'minion')
    : [];
  const marked = minions.length < 2
    ? threats
    : threats.map((t) =>
      copy.units.find((u) => u.id === t.attacker)?.kind === 'minion'
        ? { ...t, intent: 'swarm' as const }
        : t);
  return { threats: marked, broken: contactBroken(copy, size, blocked) };
}

/**
 * Что сделают противники, если герой кончит ход здесь.
 *
 * Атаки не применяются: прогноз обещает намерение и цену при
 * попадании, а не вскрывает будущий бросок уворота. Подходы при этом
 * проигрываются тем же `enemyPlan`, потому путь на экране не расходится с боем.
 */
export function forecastRound(
  state: BattleState,
  size: number,
  blocked: Uint8Array,
  damageOf: (from: BattleUnit, to: BattleUnit) => DamageSource,
  stand?: Hex,
): BattleForecast | null {
  const original = current(state);
  if (original === undefined || original.side !== 'hero') return null;
  const plain = forecastScenario(state, size, blocked, damageOf, original.id, false, stand);
  const guarded = forecastScenario(state, size, blocked, damageOf, original.id, true, stand);
  if (plain === null || guarded === null) return null;
  const mine = plain.threats.filter((t) => t.target === original.id);
  const guardedMine = guarded.threats.filter((t) => t.target === original.id);
  return {
    unit: original.id,
    threats: plain.threats,
    guardedThreats: guarded.threats,
    damage: mine.reduce((sum, t) => sum + t.damage, 0),
    guardedDamage: guardedMine.reduce((sum, t) => sum + t.damage, 0),
    canBreakContact: plain.broken,
  };
}
