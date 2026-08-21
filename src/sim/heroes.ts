import { HERO_WOUNDS } from './balance';

/**
 * Этап 5 (§8): герои. Реализует §3, §11.7 и §11.8 и раскадровку `heroes.html`.
 *
 * §0.1 — `name` здесь рабочее: подпись для интерфейса, а не решение и не лор.
 * Меняется правкой строки, без обсуждения; читает его только интерфейс.
 *
 * Главное, что здесь моделируется, — не характеристики, а **расписание**.
 * Ротация возникает не из желания собирать персонажей, а из того, что
 * состояние «лечится» занимает реальное время, а вылазка хочется сейчас.
 * Поэтому герой — это класс, уровень и таймер, и ничего больше.
 *
 * Чего здесь намеренно нет: смерти (§3 — герой выбывает на таймер, не
 * исчезает), найма и редкости (герои открываются уровнем Жилья, это гейт
 * темпа, а не источник дохода).
 */

/**
 * §11.7 — три класса, и различает их то, как они дерутся. Идентификаторы
 * совпадают с моделями набора KayKit (`Knight`, `Ranger`, `Rogue`) ровно
 * по той же причине, по какой `EnemyKind` совпадает со `Skeleton_*`:
 * называть тип тем, что игрок видит, честнее, чем придумывать породу.
 *
 * Прежняя тройка — `ranger` / `warrior` / `porter` — снята по выводу
 * `scripts/classes.ts`, который назвал Следопыта вырожденным вниз:
 * класс, не первый ни на одном ярусе ни при одной манере игры, — это
 * не выбор, а подсказка. Старые значения переезжают через LEGACY_CLASS.
 *
 * Попутно ушла двусмысленность: строка 'warrior' означала и героя, и врага.
 */
export type HeroClassId = 'knight' | 'archer' | 'rogue';
export type SkillId = 'trail' | 'guard' | 'forage';
export type HeroStatus = 'ready' | 'raid' | 'healing' | 'training';

export interface Stats {
  readonly attack: number;
  readonly defense: number;
  readonly knowledge: number;
  readonly might: number;
}

export interface SkillDef {
  readonly id: SkillId;
  readonly name: string;
  readonly effect: string;
  /** Сколько секунд действует. 0 — мгновенное. */
  readonly seconds: number;
}

/**
 * §11.7 — все три умения влияют на одно и то же решение: насколько глубоко
 * можно зайти и вернуться. Умение, не связанное с ним, добавляет кнопку
 * и не добавляет выбора, поэтому в игру не берётся.
 */
export const SKILLS: Record<SkillId, SkillDef> = {
  trail: { id: 'trail', name: 'Тропа', effect: 'путь назад −25% на 30 с', seconds: 30 },
  guard: { id: 'guard', name: 'Заслон', effect: 'не получает урон 5 с', seconds: 5 },
  forage: { id: 'forage', name: 'Схрон', effect: 'разово +20 провианта', seconds: 0 },
};

/** Насколько «Тропа» удешевляет шаг. См. комментарий к TRAIL_STEP_DISCOUNT ниже. */
export const TRAIL_STEP_DISCOUNT = 0.25;
/** «Прикорм» — разово +20 провианта (§11.7). */
export const FORAGE_FOOD = 20;

export interface HeroClassDef {
  readonly id: HeroClassId;
  readonly name: string;
  readonly strong: string;
  readonly weak: string;
  readonly skill: SkillId;
  /** §11.3 — здоровье это раны. У Рыцаря их четыре (§11.7). */
  readonly wounds: number;
  /** Доля вместимости Склада: Лучник −25%, Бандит +30% (§11.7). */
  readonly bagMul: number;
  /** Доля скорости шага. Скорость — сильная сторона Лучника. */
  readonly speedMul: number;
  /** Базовые характеристики на первом уровне (§3 — четыре штуки, как в ГМиМ). */
  readonly base: Stats;
  /** Что растёт с уровнем: по единице за уровень в эти характеристики. */
  readonly growth: Stats;
}

/**
 * Обзор считается по формуле §11.4: `3 + Знание/5`. Отсюда и назначено
 * Знание: Лучник 10 даёт 5 тайлов, Бандит 5 — четыре (базовая величина
 * прежнего безымянного героя), Рыцарь 0 — три, то есть ровно «−1» из §11.7.
 *
 * Атака, Защита и Сила пока хранятся и показываются, но в бой не входят:
 * бой ведётся ранами (одна за удар). §11.3 переписан под две шкалы — Атака
 * снимает очки стойкости врага, Защита делит пробой по герою, — и код идёт
 * к нему шагами. Связывать их наполовину — значит получить два источника
 * правды о том, кто кого бьёт.
 */
/**
 * ВНИМАНИЕ: числа здесь пока прежние — те, что были у Следопыта, Ратника
 * и Носильщика. Переименование сделано отдельным шагом намеренно: так
 * золотой мастер не двигается, и переход на новые имена можно проверить
 * независимо от того, как классы разойдутся в бою.
 *
 * Поэтому `strong` и `weak` описывают ещё старые роли, а не те, что
 * обещает §11.7. Разведёт их `scripts/classes.ts` вместе с Атакой,
 * Защитой и колчаном — до тех пор числа считаются черновыми (§11.7).
 */
export const HERO_CLASSES: Record<HeroClassId, HeroClassDef> = {
  archer: {
    id: 'archer',
    name: 'Лучник',
    strong: 'обзор, скорость',
    weak: 'рюкзак −25%',
    skill: 'trail',
    wounds: HERO_WOUNDS,
    bagMul: 0.75,
    speedMul: 1.1,
    base: { attack: 4, defense: 3, knowledge: 10, might: 3 },
    growth: { attack: 1, defense: 0, knowledge: 1, might: 0 },
  },
  knight: {
    id: 'knight',
    name: 'Рыцарь',
    strong: 'защита, 4 раны',
    weak: 'обзор −1',
    skill: 'guard',
    wounds: HERO_WOUNDS + 1,
    bagMul: 1,
    speedMul: 1,
    base: { attack: 5, defense: 6, knowledge: 0, might: 4 },
    growth: { attack: 1, defense: 1, knowledge: 0, might: 0 },
  },
  rogue: {
    id: 'rogue',
    name: 'Бандит',
    strong: 'рюкзак +30%, добыча',
    weak: 'защита',
    skill: 'forage',
    wounds: HERO_WOUNDS,
    bagMul: 1.3,
    speedMul: 1,
    base: { attack: 3, defense: 2, knowledge: 5, might: 5 },
    growth: { attack: 0, defense: 0, knowledge: 1, might: 1 },
  },
};

/**
 * Порядок открытия. **Первый герой — Рыцарь** (§11.7): четыре раны прощают
 * больше, а решение «держать дистанцию» первой вылазке не по силам. Довод
 * второй и более жёсткий: §19.4 держит потолок в шесть механик на первую
 * сессию, а лук, стрелы и выбор руки добавляют три — стрелковый класс
 * первым этот потолок пробивает.
 */
export const CLASS_ORDER: readonly HeroClassId[] = ['knight', 'archer', 'rogue'];

/**
 * §11.7 — классы, записанные прежними правилами. Сопоставление по роли,
 * а не по имени: Следопыт был обзором и скоростью — это Лучник; Ратник был
 * ранами и защитой — это Рыцарь; Носильщик был рюкзаком — это Бандит.
 * Солевар — прежнее имя Носильщика, и он проходит оба шага разом.
 *
 * Отображение обязано быть биекцией: `readRoster` не схлопывает дубликаты,
 * и два старых класса, ведущих в один новый, дали бы отряд из двух Рыцарей.
 */
export const LEGACY_CLASS: Readonly<Record<string, HeroClassId>> = {
  ranger: 'archer',
  warrior: 'knight',
  porter: 'rogue',
  salter: 'rogue',
};

export interface HeroState {
  readonly id: number;
  readonly cls: HeroClassId;
  level: number;
  xp: number;
  /** Сколько ран получено и ещё не залечено. */
  wounds: number;
  status: HeroStatus;
  /** Когда закончится лечение или тренировка. null — таймера нет. */
  busyUntil: number | null;
}

export interface Roster {
  heroes: HeroState[];
  /** Кем выходим в вылазку. Индекс в heroes. */
  active: number;
}

/* ---------- открытие героев ---------- */

/** §11.8 — второй герой на Жилье ур. 2, третий — ур. 4. */
export const HERO_HQ_GATE: readonly number[] = [1, 2, 4];

export function unlockedHeroes(hqLevel: number): number {
  let n = 0;
  for (const gate of HERO_HQ_GATE) if (hqLevel >= gate) n++;
  return n;
}

export function createHero(cls: HeroClassId, id: number): HeroState {
  return { id, cls, level: 1, xp: 0, wounds: 0, status: 'ready', busyUntil: null };
}

export function createRoster(): Roster {
  return { heroes: [createHero(CLASS_ORDER[0]!, 0)], active: 0 };
}

/**
 * Догоняет состав отряда до уровня Жилья. Вызывается после каждой стройки
 * и при загрузке: сохранение могло быть записано правилами, где гейты стояли
 * иначе, и отряд не должен от этого рассыпаться.
 */
export function syncRoster(roster: Roster, hqLevel: number): HeroClassId | null {
  const target = unlockedHeroes(hqLevel);
  if (roster.heroes.length >= target) return null;
  const cls = CLASS_ORDER[roster.heroes.length];
  if (cls === undefined) return null;
  roster.heroes.push(createHero(cls, roster.heroes.length));
  return cls;
}

/* ---------- уровни ---------- */

/**
 * Порог уровня. Кривая — placeholder: §11 не назначает опыт, а замерить его
 * можно только по числу вылазок на уровень, то есть после телеметрии.
 * Держится в одном месте намеренно.
 */
export const xpToNext = (level: number): number => 100 * (level + 1);

export const MAX_HERO_LEVEL = 20;

/** Опыт за вылазку. Тоже placeholder: привязан к вынесенному, чтобы уровень
 *  рос от удачных заходов, а не от времени в локации. */
export function raidXp(carried: number, tier: number, evacuated: boolean): number {
  return Math.round(carried * 8 + tier * 10 + (evacuated ? 20 : 0));
}

export function addXp(hero: HeroState, xp: number): number {
  let gained = 0;
  hero.xp += Math.max(0, Math.round(xp));
  while (hero.level < MAX_HERO_LEVEL && hero.xp >= xpToNext(hero.level)) {
    hero.xp -= xpToNext(hero.level);
    hero.level += 1;
    gained += 1;
  }
  if (hero.level >= MAX_HERO_LEVEL) hero.xp = 0;
  return gained;
}

export function stats(hero: HeroState): Stats {
  const def = HERO_CLASSES[hero.cls];
  const n = hero.level - 1;
  return {
    attack: def.base.attack + def.growth.attack * n,
    defense: def.base.defense + def.growth.defense * n,
    knowledge: def.base.knowledge + def.growth.knowledge * n,
    might: def.base.might + def.growth.might * n,
  };
}

/* ---------- лечение ---------- */

/** §11.8 — 6 минут за рану, максимум 18. */
export const HEAL_PER_WOUND = 6 * 60;
export const HEAL_MAX = 18 * 60;

export function healSeconds(wounds: number): number {
  return Math.min(HEAL_MAX, Math.max(0, wounds) * HEAL_PER_WOUND);
}

/**
 * Вернувшийся герой ранен и занят лечением (§3). Раны не лечатся внутри
 * вылазки — только здесь, в лагере.
 */
export function startHealing(hero: HeroState, now: number): boolean {
  if (hero.wounds <= 0) {
    hero.status = 'ready';
    hero.busyUntil = null;
    return false;
  }
  hero.status = 'healing';
  hero.busyUntil = now + healSeconds(hero.wounds);
  return true;
}

/* ---------- тренировка ---------- */

/** §11.8 — 1 уровень за 2 часа. */
export const TRAIN_PER_LEVEL = 2 * 3600;
/** §11.8 — потолок: на два уровня ниже лучшего героя. */
export const TRAIN_GAP = 2;

/** Потолок тренировки: догоняющая механика для запасных, а не альтернатива
 *  игре. Лучший герой в расчёт входит, поэтому обогнать его нельзя. */
export function trainCap(roster: Roster): number {
  const best = roster.heroes.reduce((max, h) => Math.max(max, h.level), 1);
  return Math.max(1, best - TRAIN_GAP);
}

export type TrainBlock = 'ok' | 'busy' | 'cap' | 'slot-busy' | 'max';

/** Причина, а не булево: игрок должен видеть, чем именно закрыто (как §20.4). */
export function trainBlock(roster: Roster, hero: HeroState): TrainBlock {
  if (hero.level >= MAX_HERO_LEVEL) return 'max';
  if (hero.status !== 'ready') return 'busy';
  if (hero.level >= trainCap(roster)) return 'cap';
  // Слот один, как у стройки (§20.1): иначе отряд качается сам, пока игрок спит.
  if (roster.heroes.some((h) => h.status === 'training')) return 'slot-busy';
  return 'ok';
}

export function startTraining(roster: Roster, hero: HeroState, now: number): boolean {
  if (trainBlock(roster, hero) !== 'ok') return false;
  hero.status = 'training';
  hero.busyUntil = now + TRAIN_PER_LEVEL;
  return true;
}

/* ---------- ход времени ---------- */

export interface HeroTick {
  readonly hero: HeroState;
  readonly what: 'healed' | 'trained';
}

/**
 * Завершает таймеры, которые уже вышли. Считается по монотонному времени
 * (§6), поэтому лечение и тренировка идут, пока игра закрыта, — это и есть
 * оффлайн-прогресс из §2.
 */
export function refreshHeroes(roster: Roster, now: number): HeroTick[] {
  const done: HeroTick[] = [];
  for (const hero of roster.heroes) {
    if (hero.busyUntil === null || now < hero.busyUntil) continue;
    if (hero.status === 'healing') {
      hero.wounds = 0;
      hero.status = 'ready';
      hero.busyUntil = null;
      done.push({ hero, what: 'healed' });
    } else if (hero.status === 'training') {
      hero.level += 1;
      hero.xp = 0;
      hero.status = 'ready';
      hero.busyUntil = null;
      done.push({ hero, what: 'trained' });
    }
  }
  return done;
}

/* ---------- итог вылазки ---------- */

export interface RaidOutcome {
  /** Сколько ран получено в этой вылазке. */
  readonly wounds: number;
  /** Сколько уровней взято прямо сейчас. */
  readonly levels: number;
  /** Сколько секунд герой будет лечиться. 0 — вернулся целым. */
  readonly healSec: number;
}

/**
 * Вернувшийся герой ранен и занят лечением (§3) — на этом держится ротация.
 * Функция живёт здесь, а не в связке экранов: правило «раны переносятся из
 * вылазки в расписание» — это правило отряда, и проверяться оно должно
 * без браузера.
 *
 * `woundsLeft` — сколько ран у героя осталось в конце вылазки (в локации они
 * считаются вниз от максимума класса).
 */
export function applyRaidOutcome(
  hero: HeroState,
  woundsLeft: number,
  carried: number,
  tier: number,
  evacuated: boolean,
  now: number,
): RaidOutcome {
  const max = HERO_CLASSES[hero.cls].wounds;
  hero.wounds = Math.min(max, Math.max(0, max - Math.max(0, woundsLeft)));
  hero.status = 'ready';
  hero.busyUntil = null;
  const levels = addXp(hero, raidXp(carried, tier, evacuated));
  const healing = startHealing(hero, now);
  return {
    wounds: hero.wounds,
    levels,
    healSec: healing ? healSeconds(hero.wounds) : 0,
  };
}

/* ---------- выход в вылазку ---------- */

export type RaidBlock = 'ok' | 'healing' | 'training' | 'raid';

export function raidBlock(hero: HeroState): RaidBlock {
  if (hero.status === 'ready') return 'ok';
  return hero.status;
}

/** Первый, кем можно пойти прямо сейчас. Ростер сортируется по готовности,
 *  а не по силе: экран отряда отвечает на вопрос «кем я иду». */
export function firstReady(roster: Roster): HeroState | null {
  return roster.heroes.find((h) => h.status === 'ready') ?? null;
}

export function activeHero(roster: Roster): HeroState {
  return roster.heroes[roster.active] ?? roster.heroes[0]!;
}

export function selectHero(roster: Roster, index: number): boolean {
  if (index < 0 || index >= roster.heroes.length) return false;
  roster.active = index;
  return true;
}

/**
 * Всё, что вылазка знает о герое. Раздельный тип нужен затем, что `sim/raid`
 * не должен зависеть от расписания лагеря: вылазке важны обзор, раны, рюкзак,
 * скорость и одно умение — и ничего про лечение.
 */
export interface HeroLoadout {
  readonly cls: HeroClassId;
  readonly level: number;
  readonly wounds: number;
  readonly knowledge: number;
  readonly bagMul: number;
  readonly speedMul: number;
  readonly skill: SkillId;
}

export function loadout(hero: HeroState): HeroLoadout {
  const def = HERO_CLASSES[hero.cls];
  return {
    cls: hero.cls,
    level: hero.level,
    wounds: def.wounds,
    knowledge: stats(hero).knowledge,
    bagMul: def.bagMul,
    speedMul: def.speedMul,
    skill: def.skill,
  };
}

/** Плейсхолдерный герой для замеров и тестов: ровно те числа, что были
 *  у безымянного героя этапов 1–4, чтобы старые прогоны остались сравнимы. */
export const DEFAULT_LOADOUT: HeroLoadout = {
  cls: 'rogue',
  level: 1,
  wounds: HERO_WOUNDS,
  knowledge: 5,
  bagMul: 1,
  speedMul: 1,
  skill: 'forage',
};
