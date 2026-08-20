import type { Resources } from './resources';

/**
 * §14 — снаряжение и Кузница.
 *
 * Главное правило раздела: **снаряжение расширяет выбор, а не множит урон.**
 * Поэтому у каждого слота есть и то, что он даёт, и то, чем платит, — иначе
 * «надеть всё» становится единственной стратегией и решения не существует.
 *
 * Второе правило: **Кузница улучшает, а не рандомит.** Здесь нет ни одного
 * обращения к rng: предмет в слоте один, он растёт по уровням, перебросов нет.
 * Отсюда же следует, что инвентаря не существует как сущности — слот и есть
 * инвентарь, а уровень предмета и есть его качество.
 *
 * Чего в этом файле сознательно нет: выпадения предметов из сундуков (§14
 * называет их первым источником). Крафт — это второй сток без таймера, ради
 * которого Кузница и появилась в §20.1; выпадение из сундуков ничего
 * не решает в петле возврата и подождёт до этапа с ярусными наградами.
 */
export type GearSlot = 'weapon' | 'armor' | 'torch' | 'bag' | 'ring';

export const GEAR_ORDER: readonly GearSlot[] = ['weapon', 'armor', 'torch', 'bag', 'ring'];

/** §14 — уровень предмета 1–5. Потолок ниже потолка зданий намеренно:
 *  Кузница ур. 6 не даёт шестого уровня предметам, она даёт запас. */
export const MAX_ITEM_LEVEL = 5;

export interface GearDef {
  readonly slot: GearSlot;
  readonly name: string;
  /** Что меняет в следующей вылазке. */
  readonly effect: (level: number) => string;
  /** Чем платит. Пустой компромисс запрещён: слот без цены — не решение. */
  readonly tradeoff: string;
}

export const GEAR: Record<GearSlot, GearDef> = {
  weapon: {
    slot: 'weapon',
    name: 'Кайло',
    effect: (l) => `Удар быстрее на ${Math.round((1 - weaponInterval(l)) * 100)}%`,
    tradeoff: 'Тяжёлое: рюкзак −1',
  },
  armor: {
    slot: 'armor',
    name: 'Соляная куртка',
    effect: (l) => `Ран ${armorWounds(l) > 0 ? `+${armorWounds(l)}` : '+0'}`,
    tradeoff: 'С ур. 3 тяжёлая: шаг дороже на 15%',
  },
  torch: {
    slot: 'torch',
    name: 'Рудничный фонарь',
    effect: (l) => `Обзор +${torchVision(l)}`,
    tradeoff: 'Занимает слот, который мог бы дать вместимость',
  },
  bag: {
    slot: 'bag',
    name: 'Заплечный короб',
    effect: (l) => `Рюкзак +${bagCapacity(l)}`,
    tradeoff: 'В бою не даёт ничего',
  },
  ring: {
    slot: 'ring',
    name: 'Спокойная рука',
    effect: (l) => `Под угрозой меньше на ${Math.round(ringRisk(l) * 100)}%`,
    tradeoff: 'Один аффикс, задан при ковке и не меняется',
  },
};

/* ---------- эффекты слотов ---------- */

/** Множитель интервала удара: ур. 5 бьёт на 35% быстрее. */
export const weaponInterval = (level: number): number => (level <= 0 ? 1 : 1 - 0.07 * level);

/** §11.3 — раны, а не полоска, поэтому броня даёт целые раны и редко. */
export const armorWounds = (level: number): number => (level >= 4 ? 2 : level >= 2 ? 1 : 0);

/** §14 — тяжёлая броня дороже в дороге. Порог, а не плавный рост:
 *  игрок должен уметь назвать уровень, на котором сделка меняется. */
export const armorFoodStep = (level: number): number => (level >= 3 ? 1.15 : 1);

/**
 * Прибавка к обзору сверх базовой. Базовый фонарь героя из §11.4 остаётся
 * у всех и всегда — на нём измерена вся модель ярусов, и отнимать его
 * предметом означало бы задним числом ужесточить каждый ярус.
 */
export const torchVision = (level: number): number => (level >= 4 ? 2 : level >= 2 ? 1 : 0);

/** Прибавка к рюкзаку. Уровень Склада даёт больше — сумка догоняет, не заменяет. */
export const bagCapacity = (level: number): number => Math.max(0, level);

/** §11.2 — доля под угрозой падает на 10% за уровень. Единственный предмет,
 *  трогающий ставку: она сердце вылазки, и трогать её вправе один слот. */
export const ringRisk = (level: number): number => Math.min(0.5, 0.1 * Math.max(0, level));

export type GearState = Record<GearSlot, number>;

export const emptyGear = (): GearState => ({ weapon: 0, armor: 0, torch: 0, bag: 0, ring: 0 });

/**
 * §14 — крафт из железа и кристаллов. Соль и дерево не берём осознанно:
 * соль уходит в ускорения (§20.5), дерево держит ранние постройки (§13),
 * а железо и кристалл к середине игры копятся быстрее, чем тратятся, —
 * именно они и лежали мёртвым грузом без второго стока.
 *
 * Порядок величины: ступень снаряжения стоит примерно половину ближайшей
 * ступени постройки. Это делает Кузницу настоящей альтернативой, когда слот
 * стройки занят, и не даёт ей перебивать сами постройки.
 * Числа временные ровно в той же мере, что и BUILD_COST: их следует
 * перемерить (`npm run measure`), когда снаряжение попадёт в бота.
 */
export const GEAR_COST: Record<number, Partial<Resources>> = {
  1: { iron: 4 },
  2: { iron: 9 },
  3: { iron: 16, crystal: 2 },
  4: { iron: 26, crystal: 6 },
  5: { iron: 40, crystal: 14 },
};

/**
 * Сводка эффектов всего снаряжения. Считается один раз на выход в вылазку:
 * вылазка не должна знать про слоты, ей нужны числа.
 */
export interface GearMods {
  /** Прибавка к вместимости рюкзака, может быть отрицательной. */
  readonly capacity: number;
  readonly wounds: number;
  readonly foodStep: number;
  readonly attackInterval: number;
  readonly vision: number;
  /** Множитель доли под угрозой. */
  readonly risk: number;
}

export const NO_MODS: GearMods = {
  capacity: 0,
  wounds: 0,
  foodStep: 1,
  attackInterval: 1,
  vision: 0,
  risk: 1,
};

export function gearMods(gear: GearState): GearMods {
  return {
    // Оружие тяжёлое всегда, а не с какого-то уровня: компромисс обязан
    // существовать с первой же ковки, иначе первый предмет — бесплатный.
    capacity: bagCapacity(gear.bag) - (gear.weapon > 0 ? 1 : 0),
    wounds: armorWounds(gear.armor),
    foodStep: armorFoodStep(gear.armor),
    attackInterval: weaponInterval(gear.weapon),
    vision: torchVision(gear.torch),
    risk: 1 - ringRisk(gear.ring),
  };
}

/** Строка для панели: «ур. 3 · Рюкзак +3». Пустой слот честно говорит, что пуст. */
export function gearLine(slot: GearSlot, level: number): string {
  const def = GEAR[slot];
  return level <= 0 ? 'не выковано' : `ур. ${level} · ${def.effect(level)}`;
}
