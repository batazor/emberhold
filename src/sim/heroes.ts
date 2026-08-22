import { HERO_HP } from './balance';

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
export type SkillId = 'trail' | 'haul' | 'cache';
export type HeroStatus = 'ready' | 'raid' | 'healing' | 'training';

export interface Stats {
  readonly attack: number;
  readonly defense: number;
  readonly knowledge: number;
  /**
   * §11.7 — характеристика без потребителя, и это записано, а не забыто.
   *
   * `might` не читает ничто: ни бой (`attack`, `defense`), ни обзор
   * (`knowledge`), ни генератор, ни сохранение. Она стояла в панели отряда
   * четвёртой строкой рядом с тремя работающими и различала классы —
   * то есть влияла на выбор героя, не влияя на игру. Из панели убрана;
   * из таблицы классов — нет, потому что убрать её оттуда значит решить,
   * чем классы различаются дальше, а это решение раздела, а не правки UI.
   */
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
/** Насколько «Тропа» сокращает путь домой. */
export const TRAIL_BACK_DISCOUNT = 0.25;
/** Сколько вместимости разово добавляет «Заплечье». */
export const HAUL_CAPACITY = 4;
/** Во сколько раз «Схрон» увеличивает находку, пока действует. */
export const CACHE_LOOT = 2;

/**
 * §11.7 — умение раз за вылазку. **Все три платят добычей или дорогой**, и это
 * не выбор темы, а следствие замера: прежние эффекты платили провиантом
 * (Тропа удешевляла шаг, Схрон досыпал 20 еды) и боем (Заслон снимал урон),
 * а провиант перестал быть осью сложности (§11.3, снято). Прибор это и
 * показывал: срабатывало умение в 13–40% вылазок, а двигало добычу на +0.00
 * и успех на ±0.0 п.п. — на трёх классах и трёх политиках сразу.
 *
 * Новые эффекты выбраны по тому, что в вылазке вправду связывает. Уходят из
 * локации, когда полон рюкзак, поэтому платят все трое через него: Заплечье
 * поднимает потолок, Схрон — величину находки, Тропа — цену пути до дальней.
 * Разные способы купить одно и то же, и в этом смысл: класс отвечает на
 * вопрос «чем добираешь», а не «на сколько ты сильнее».
 */
export const SKILLS: Record<SkillId, SkillDef> = {
  trail: { id: 'trail', name: 'Тропа', effect: 'путь назад −25% на 30 с', seconds: 30 },
  haul: { id: 'haul', name: 'Заплечье', effect: `+${HAUL_CAPACITY} вместимости до конца вылазки`, seconds: 0 },
  cache: { id: 'cache', name: 'Схрон', effect: 'находки вдвое больше 20 с', seconds: 20 },
};



export interface HeroClassDef {
  readonly id: HeroClassId;
  readonly name: string;
  readonly strong: string;
  readonly weak: string;
  readonly skill: SkillId;
  /**
   * §11.3 — **прибавка** к базовому здоровью, а не здоровье целиком.
   * Названо `hp`, а не `wounds`: пока поле называлось ранами, а хранило
   * очки, `raid.ts` прибавлял к нему базу второй раз, и герой выходил
   * в вылазку с сорока одним очком вместо двадцати одного. Опечатки такого
   * рода не ловятся тестом на равенство — они ловятся именем.
   */
  readonly hp: number;
  /** Доля вместимости Склада: Лучник −25%, Бандит +30% (§11.7). */
  readonly bagMul: number;
  /** Доля скорости шага. Скорость — сильная сторона Лучника. */
  readonly speedMul: number;
  /** Базовые характеристики на первом уровне (§3 — четыре штуки, как в ГМиМ). */
  readonly base: Stats;
  /** Что растёт с уровнем: по единице за уровень в эти характеристики. */
  readonly growth: Stats;
  /** §14.3 — бьёт с дистанции и тратит стрелы. */
  readonly ranged: boolean;
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
    hp: 0,
    bagMul: 0.75,
    speedMul: 1.1,
    base: { attack: 4, defense: 3, knowledge: 10, might: 3 },
    growth: { attack: 1, defense: 0, knowledge: 1, might: 0 },
    ranged: true,
  },
  knight: {
    id: 'knight',
    name: 'Рыцарь',
    strong: 'защита, здоровье',
    weak: 'обзор −1',
    skill: 'haul',
    // Единственный класс с прибавкой. Треть базы — та же доля, какой
    // прежде были четыре раны против трёх (§11.7).
    hp: 7,
    bagMul: 1,
    speedMul: 1,
    base: { attack: 5, defense: 6, knowledge: 0, might: 4 },
    growth: { attack: 1, defense: 1, knowledge: 0, might: 0 },
    ranged: false,
  },
  rogue: {
    id: 'rogue',
    name: 'Бандит',
    strong: 'рюкзак +30%, добыча',
    weak: 'защита',
    skill: 'cache',
    hp: 0,
    bagMul: 1.3,
    speedMul: 1,
    base: { attack: 3, defense: 2, knowledge: 5, might: 5 },
    growth: { attack: 0, defense: 0, knowledge: 1, might: 1 },
    ranged: false,
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

/**
 * §11.8 переписан: Жильё больше никого не открывает. Люди приходят в игру
 * людьми — встречей у лагеря (§16.1), а не порогом уровня: лучник, молча
 * вставший в веер на втором уровне палатки, читался пришельцем из ниоткуда.
 * Механика догона (`syncRoster`) остаётся: ей будут пользоваться встречи.
 */
export const HERO_HQ_GATE: readonly number[] = [1];

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

/**
 * §11.8 — во сколько ран лагерь оценивает вернувшегося. Величина про
 * расписание, а не про бой: в вылазке здоровье считается очками (§11.3),
 * а лазарет переводит долю потерянного в три ступени. Три, потому что
 * `HEAL_MAX` — ровно три шага по `HEAL_PER_WOUND`.
 */
export const MAX_WOUNDS = 3;

/** §11.8 — 6 минут за рану без Лазарета. Потолок — три раны. */
export const HEAL_PER_WOUND = 6 * 60;
export const HEAL_WOUND_CAP = 3;
export const HEAL_MAX = HEAL_WOUND_CAP * HEAL_PER_WOUND;

/**
 * Сколько стоит рана при Лазарете уровня `level`. Ноль — здания нет.
 *
 * **Лазарет ускоряет лечение, но не включает его**, и это не симметрия
 * с Плацем, а необходимость: раненый герой обязан вылечиться при любом
 * лагере. Запереть лечение зданием значило бы завести состояние, из
 * которого игрок не выходит, — а §3 обещает обратное, «провал стоит одной
 * вылазки, а не прогресса».
 */
export const healPerWound = (level: number): number =>
  Math.max(60, HEAL_PER_WOUND - 50 * Math.max(0, level));

export function healSeconds(wounds: number, infirmaryLevel = 0): number {
  const per = healPerWound(infirmaryLevel);
  return Math.min(HEAL_WOUND_CAP * per, Math.max(0, wounds) * per);
}

/**
 * Вернувшийся герой ранен и занят лечением (§3). Раны не лечатся внутри
 * вылазки — только здесь, в лагере.
 */
export function startHealing(hero: HeroState, now: number, infirmaryLevel = 0): boolean {
  if (hero.wounds <= 0) {
    hero.status = 'ready';
    hero.busyUntil = null;
    return false;
  }
  hero.status = 'healing';
  hero.busyUntil = now + healSeconds(hero.wounds, infirmaryLevel);
  return true;
}

/* ---------- тренировка ---------- */

/** §11.8 — 1 уровень за 2 часа на Плацу ур. 1. */
export const TRAIN_PER_LEVEL = 2 * 3600;
/** §11.8 — потолок: на два уровня ниже лучшего героя. */
export const TRAIN_GAP = 2;

/**
 * Сколько стоит уровень на Плацу уровня `level`.
 *
 * **Плац тренировку включает, а не ускоряет** — в отличие от Лазарета.
 * §11.8 так его и называет: «Плац поднимает уровень без вылазок». Здание,
 * которое только ускоряет уже работающее, не проходит фильтр §2 — там
 * требуется ответ на «что я смогу»; здесь ответ есть, и он новый.
 */
export const trainPerLevel = (level: number): number =>
  Math.max(1800, TRAIN_PER_LEVEL - 900 * Math.max(0, level - 1));

/** Потолок тренировки: догоняющая механика для запасных, а не альтернатива
 *  игре. Лучший герой в расчёт входит, поэтому обогнать его нельзя. */
export function trainCap(roster: Roster): number {
  const best = roster.heroes.reduce((max, h) => Math.max(max, h.level), 1);
  return Math.max(1, best - TRAIN_GAP);
}

export type TrainBlock = 'ok' | 'busy' | 'cap' | 'slot-busy' | 'max' | 'no-yard';

/** Причина, а не булево: игрок должен видеть, чем именно закрыто (как §20.4). */
export function trainBlock(roster: Roster, hero: HeroState, yardLevel = 0): TrainBlock {
  if (yardLevel <= 0) return 'no-yard';
  if (hero.level >= MAX_HERO_LEVEL) return 'max';
  if (hero.status !== 'ready') return 'busy';
  if (hero.level >= trainCap(roster)) return 'cap';
  // Слот один, как у стройки (§20.1): иначе отряд качается сам, пока игрок спит.
  if (roster.heroes.some((h) => h.status === 'training')) return 'slot-busy';
  return 'ok';
}

/**
 * Слова причины — рядом с причиной (§23.3). Панель отряда и полоса лагеря
 * берут одну и ту же строку; раньше у них были две, и «потолок — на два
 * уровня ниже лучшего» разошёлся с «потолок — на два ниже лучшего».
 */
export const TRAIN_REASON: Record<Exclude<TrainBlock, 'ok'>, string> = {
  busy: 'Занят',
  cap: 'Потолок — на два уровня ниже лучшего',
  'slot-busy': 'Тренировочный слот занят',
  max: 'Максимальный уровень',
  'no-yard': 'Нужен Плац',
};

export function startTraining(
  roster: Roster,
  hero: HeroState,
  now: number,
  yardLevel = 0,
): boolean {
  if (trainBlock(roster, hero, yardLevel) !== 'ok') return false;
  hero.status = 'training';
  hero.busyUntil = now + trainPerLevel(yardLevel);
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
 * `hpLeft` — сколько здоровья у бойца осталось в конце вылазки.
 *
 * §11.8 меряет лечение ранами, и на шкале «рана» стала долей: сколько
 * четвертей здоровья потеряно, столько ран и лечится. Так потолок в 18 минут
 * сохраняется без пересчёта, а мелкая царапина не отправляет героя лечиться
 * на шесть минут — раньше отправляла, потому что мельче раны ничего не было.
 */
/** Полное здоровье бойца: класс задаёт прибавку к общему запасу. */
export const heroFullHp = (cls: HeroClassId): number => HERO_HP + HERO_CLASSES[cls].hp;

/**
 * Сколько ран увезёт в лагерь боец, у которого осталось `hpLeft`.
 *
 * Раны лечения — своя шкала лагеря, а не класса. Класс задаёт, сколько
 * здоровья у бойца; сколько времени он потом чинится — вопрос §11.8,
 * и три раны там значат «полностью разбит» для любого класса. Считать
 * потолок ран от прибавки класса нельзя: у Лучника она нулевая,
 * и он не лечился бы никогда.
 *
 * Функция отдельная, потому что считать раны нужно дважды: лагерю —
 * чтобы положить героя в Лазарет, и отчёту отправки (§26) — чтобы сказать,
 * с чем отряд вернулся. Две шкалы ран разошлись бы на первом же округлении.
 */
export function woundsFrom(cls: HeroClassId, hpLeft: number): number {
  const full = heroFullHp(cls);
  const lost = Math.max(0, full - Math.max(0, hpLeft));
  return Math.min(MAX_WOUNDS, Math.round((lost / full) * MAX_WOUNDS));
}

export function applyRaidOutcome(
  hero: HeroState,
  hpLeft: number,
  carried: number,
  tier: number,
  evacuated: boolean,
  now: number,
  infirmaryLevel = 0,
): RaidOutcome {
  hero.wounds = woundsFrom(hero.cls, hpLeft);
  hero.status = 'ready';
  hero.busyUntil = null;
  const levels = addXp(hero, raidXp(carried, tier, evacuated));
  const healing = startHealing(hero, now, infirmaryLevel);
  return {
    wounds: hero.wounds,
    levels,
    healSec: healing ? healSeconds(hero.wounds, infirmaryLevel) : 0,
  };
}

/* ---------- выход в вылазку ---------- */

export type RaidBlock = 'ok' | 'healing' | 'training' | 'raid';

export function raidBlock(hero: HeroState): RaidBlock {
  if (hero.status === 'ready') return 'ok';
  return hero.status;
}

/**
 * Слова причины — рядом с причиной (§23.3). Полоса говорила «Рыцарь занят»
 * на все три случая разом, а они разные: из лечения герой выйдет сам,
 * из тренировки — тоже, а из вылазки он не выйдет, пока игрок его не вернёт.
 */
export const RAID_REASON: Record<Exclude<RaidBlock, 'ok'>, string> = {
  healing: 'Лечится',
  training: 'Тренируется',
  raid: 'В вылазке',
};

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
  /** §11.3 — прибавка к базовому здоровью от класса. */
  readonly hp: number;
  readonly knowledge: number;
  readonly bagMul: number;
  readonly speedMul: number;
  readonly skill: SkillId;
  /** §11.3 — сколько очков стойкости снимает удар. Растёт с уровнем. */
  readonly attack: number;
  /** §11.3 — делит пробой: сколько ран стоит удар по герою. */
  readonly defense: number;
  /**
   * §14.3 — стреляет ли этот класс. Отдельно от числа стрел: пустой колчан
   * у Лучника и отсутствие колчана у Рыцаря — разные состояния, и путать
   * их нельзя ни в бою, ни на экране.
   */
  readonly ranged: boolean;
  /**
   * §11.8 — сид лица. Лицо привязано к человеку, а не к панели: в бою тот же
   * герой обязан стоять с тем же лицом, что в веере, а веер берёт сид
   * из `hero.id`. Снаряжение — единственное, что от героя доходит до боя,
   * поэтому сид едет здесь.
   */
  readonly seed: number;
}

export function loadout(hero: HeroState): HeroLoadout {
  const def = HERO_CLASSES[hero.cls];
  return {
    cls: hero.cls,
    seed: hero.id,
    level: hero.level,
    hp: def.hp,
    knowledge: stats(hero).knowledge,
    bagMul: def.bagMul,
    speedMul: def.speedMul,
    skill: def.skill,
    // §11.3 — обе характеристики теперь входят в бой, а не только
    // показываются. Берутся с уровнем: рост героя обязан быть виден в бою,
    // иначе тренировка не чувствуется (§11.8).
    attack: stats(hero).attack,
    defense: stats(hero).defense,
    ranged: def.ranged,
  };
}

/** Плейсхолдерный герой для замеров и тестов: ровно те числа, что были
 *  у безымянного героя этапов 1–4, чтобы старые прогоны остались сравнимы. */
export const DEFAULT_LOADOUT: HeroLoadout = {
  cls: 'rogue',
  seed: 0,
  level: 1,
  hp: 0,
  knowledge: 5,
  bagMul: 1,
  speedMul: 1,
  skill: 'cache',
  // Эталонные значения, а не значения класса: этим героем ходят золотой
  // мастер и вся калибровка §20.3, и от него же считается весь бестиарий
  // (§22.6): рядовой стоит четверти его здоровья, воин — половины.
  // Мерить бестиарий Рыцарем нельзя — он крепче всех, и ярус, посильный
  // ему, оказался бы стеной двум остальным.
  //
  // Защита — середина между классами (2, 3 и 6), а не ноль. Нулевая
  // означала бы героя, которого в игре не существует, и все замеры считали
  // бы худший случай как средний: §22.6 мерил цену встречи с воином
  // на бойце вовсе без Защиты и получал два провала из трёх на двух воинах.
  attack: 4,
  defense: 3,
  // Ближний: этим героем мерилась вся калибровка §20.3, и дальний бой
  // сделал бы её результаты несравнимыми с прежними.
  ranged: false,
};
