import { mulberry32 } from '../core/rng';
import type { Rng } from '../core/rng';
import type { ConsumableId } from './consumables';
import type { Resources } from './resources';
import type { Tier } from './types';

/**
 * Ларец снабжения — заработанный в вылазке контейнер с тремя
 * структурированными слотами. Это не три одинаковых броска:
 *
 *  1. материал гарантирует полезную базу;
 *  2. походный предмет страхует следующую вылазку;
 *  3. бонус несёт редкость и hard pity.
 *
 * Ценность сведена к линейке торговца (§13.5): камень 3, дерево 8,
 * железо 24. Кристалл выведен из глубокой росписи (§30.2): 1,8 железа.
 * Структура повторяет метод из статьи GDCuffs, но добавляет то, чего одной
 * таблице ожидания не хватает: хвост неудач, квантили и состояние pity.
 */

export type SupplySlotId = 'material' | 'expedition' | 'bonus';
export type SupplyCategory = 'material' | 'expedition' | 'bonus-common' | 'bonus-rare';

export type SupplyRewardId =
  | 'stone-4'
  | 'wood-2'
  | 'iron-1'
  | 'ration'
  | 'bandage'
  | 'arrows-4'
  | 'smoke'
  | 'stone-6'
  | 'wood-3'
  | 'bonus-iron-1'
  | 'crystal-1'
  | 'iron-2';

export interface SupplyRewardDef {
  readonly id: SupplyRewardId;
  readonly slot: SupplySlotId;
  readonly category: SupplyCategory;
  /** Рабочее имя: UI переводит идентификатор у себя. */
  readonly name: string;
  readonly resources?: Partial<Resources>;
  readonly arrows?: number;
  readonly consumable?: ConsumableId;
  /** Ценность в общей линейке 3 / 8 / 24 / 43,2. */
  readonly value: number;
}

/** Общая единица калькулятора. Не является валютой игрока. */
export const LOOTBOX_VALUE = {
  stone: 3,
  wood: 8,
  iron: 24,
  crystal: 43.2,
} as const;

export const SUPPLY_REWARDS: Record<SupplyRewardId, SupplyRewardDef> = {
  'stone-4': {
    id: 'stone-4', slot: 'material', category: 'material', name: 'Камень ×4',
    resources: { stone: 4 }, value: 4 * LOOTBOX_VALUE.stone,
  },
  'wood-2': {
    id: 'wood-2', slot: 'material', category: 'material', name: 'Дерево ×2',
    resources: { wood: 2 }, value: 2 * LOOTBOX_VALUE.wood,
  },
  'iron-1': {
    id: 'iron-1', slot: 'material', category: 'material', name: 'Железо ×1',
    resources: { iron: 1 }, value: LOOTBOX_VALUE.iron,
  },
  ration: {
    id: 'ration', slot: 'expedition', category: 'expedition', name: 'Дорожный паёк',
    consumable: 'ration', value: 8 * LOOTBOX_VALUE.stone,
  },
  bandage: {
    id: 'bandage', slot: 'expedition', category: 'expedition', name: 'Повязка',
    consumable: 'bandage', value: 10 * LOOTBOX_VALUE.stone,
  },
  'arrows-4': {
    id: 'arrows-4', slot: 'expedition', category: 'expedition', name: 'Стрелы ×4',
    arrows: 4, value: LOOTBOX_VALUE.iron,
  },
  smoke: {
    id: 'smoke', slot: 'expedition', category: 'expedition', name: 'Дымовая шашка',
    consumable: 'smoke', value: 9 * LOOTBOX_VALUE.stone + LOOTBOX_VALUE.iron,
  },
  'stone-6': {
    id: 'stone-6', slot: 'bonus', category: 'bonus-common', name: 'Камень ×6',
    resources: { stone: 6 }, value: 6 * LOOTBOX_VALUE.stone,
  },
  'wood-3': {
    id: 'wood-3', slot: 'bonus', category: 'bonus-common', name: 'Дерево ×3',
    resources: { wood: 3 }, value: 3 * LOOTBOX_VALUE.wood,
  },
  'bonus-iron-1': {
    id: 'bonus-iron-1', slot: 'bonus', category: 'bonus-common', name: 'Железо ×1',
    resources: { iron: 1 }, value: LOOTBOX_VALUE.iron,
  },
  'crystal-1': {
    id: 'crystal-1', slot: 'bonus', category: 'bonus-rare', name: 'Кристалл ×1',
    resources: { crystal: 1 }, value: LOOTBOX_VALUE.crystal,
  },
  'iron-2': {
    id: 'iron-2', slot: 'bonus', category: 'bonus-rare', name: 'Железо ×2',
    resources: { iron: 2 }, value: 2 * LOOTBOX_VALUE.iron,
  },
};

interface WeightedReward {
  readonly id: SupplyRewardId;
  readonly weight: number;
}

const MATERIAL: readonly WeightedReward[] = [
  { id: 'stone-4', weight: 1 },
  { id: 'wood-2', weight: 1 },
  { id: 'iron-1', weight: 1 },
];

const EXPEDITION: readonly WeightedReward[] = [
  { id: 'ration', weight: 0.3 },
  { id: 'bandage', weight: 0.3 },
  { id: 'arrows-4', weight: 0.3 },
  { id: 'smoke', weight: 0.1 },
];

const BONUS_COMMON: readonly WeightedReward[] = [
  { id: 'stone-6', weight: 1 },
  { id: 'wood-3', weight: 1 },
  { id: 'bonus-iron-1', weight: 1 },
];

const BONUS_RARE: readonly WeightedReward[] = [
  { id: 'crystal-1', weight: 1 },
  { id: 'iron-2', weight: 1 },
];

/** Цена-бюджет ларца, а не цена покупки: ларец зарабатывается риском. */
export const SUPPLY_TARGET_VALUE = 72;
/** Базовый шанс редкого бонуса до гарантий. */
export const SUPPLY_RARE_CHANCE = 0.1;
/** Десятый ларец без редкого бонуса гарантирует его. */
export const SUPPLY_HARD_PITY = 10;
/** Ларец заменяет глубокую находку в части заходов ярусов 2–3. */
export const SUPPLY_BOX_CHANCE = 0.15;

export interface PityConfig {
  readonly baseChance: number;
  readonly hardPity: number;
}

export const SUPPLY_PITY: PityConfig = {
  baseChance: SUPPLY_RARE_CHANCE,
  hardPity: SUPPLY_HARD_PITY,
};

export interface SupplyBoxOpen {
  readonly rewards: readonly SupplyRewardDef[];
  readonly rare: boolean;
  readonly forced: boolean;
  /** Сколько ларцов подряд до этого были без редкой награды. */
  readonly pityBefore: number;
  readonly pityAfter: number;
  readonly value: number;
}

export interface PitySummary {
  readonly expectedBoxes: number;
  /** Фактическая доля редких наград в длинной серии с учётом гарантии. */
  readonly longRunRareRate: number;
  /** Доля циклов, доходящих именно до гарантированного открытия. */
  readonly hardPityShare: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
}

export interface SupplyValueSummary {
  readonly target: number;
  readonly baseExpected: number;
  readonly longRunExpected: number;
  readonly overTarget: number;
  readonly min: number;
  readonly max: number;
  readonly standardDeviation: number;
  readonly pity: PitySummary;
}

const clampChance = (chance: number): number => Math.min(1, Math.max(0, chance));
const positivePity = (hardPity: number): number => Math.max(1, Math.floor(hardPity));

function pick(rng: Rng, pool: readonly WeightedReward[]): SupplyRewardDef {
  const total = pool.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;
  for (const item of pool) {
    roll -= item.weight;
    if (roll <= 0) return SUPPLY_REWARDS[item.id];
  }
  return SUPPLY_REWARDS[pool[pool.length - 1]!.id];
}

function weightedMean(pool: readonly WeightedReward[]): number {
  const total = pool.reduce((sum, item) => sum + item.weight, 0);
  return pool.reduce((sum, item) => sum + SUPPLY_REWARDS[item.id].value * item.weight, 0) / total;
}

function weightedVariance(pool: readonly WeightedReward[], mean = weightedMean(pool)): number {
  const total = pool.reduce((sum, item) => sum + item.weight, 0);
  return pool.reduce((sum, item) => {
    const d = SUPPLY_REWARDS[item.id].value - mean;
    return sum + d * d * item.weight;
  }, 0) / total;
}

/**
 * Есть ли ларец в этом заходе. Поток отдельный от генератора карты: появление
 * новой награды не переставляет комнаты, противников и обычную добычу.
 */
export function supplyBoxAt(seed: number, tier: Tier, visit: number): boolean {
  // Infinity означает внесюжетный замер/золотой мастер: новые награды не
  // должны задним числом менять эталонные рейды без живого счётчика заходов.
  if (tier < 2 || !Number.isFinite(visit)) return false;
  const turn = Math.max(0, Math.floor(visit));
  return mulberry32((seed ^ 0x51a7b0c5 ^ Math.imul(turn + 1, 0x45d9f3b)) >>> 0)()
    < SUPPLY_BOX_CHANCE;
}

/** Открыть ларец детерминированно от сида открытия и текущего pity. */
export function rollSupplyBox(
  seed: number,
  pityBefore: number,
  config: PityConfig = SUPPLY_PITY,
): SupplyBoxOpen {
  const rng = mulberry32((seed ^ 0x1b873593) >>> 0);
  const hardPity = positivePity(config.hardPity);
  const pity = Math.max(0, Math.min(hardPity - 1, Math.floor(pityBefore)));
  const forced = pity >= hardPity - 1;
  const rare = forced || rng() < clampChance(config.baseChance);
  const rewards = [
    pick(rng, MATERIAL),
    pick(rng, EXPEDITION),
    pick(rng, rare ? BONUS_RARE : BONUS_COMMON),
  ] as const;
  return {
    rewards,
    rare,
    forced,
    pityBefore: pity,
    pityAfter: rare ? 0 : pity + 1,
    value: rewards.reduce((sum, reward) => sum + reward.value, 0),
  };
}

/** Вероятность хотя бы одной редкой награды за N будущих ларцов. */
export function rareChanceWithin(attempts: number, config: PityConfig = SUPPLY_PITY): number {
  const n = Math.max(0, Math.floor(attempts));
  if (n <= 0) return 0;
  const hardPity = positivePity(config.hardPity);
  if (n >= hardPity) return 1;
  return 1 - Math.pow(1 - clampChance(config.baseChance), n);
}

/** Показатели хвоста неудач. Гарантия делает процесс состоянием, не броском. */
export function pitySummary(config: PityConfig = SUPPLY_PITY): PitySummary {
  const chance = clampChance(config.baseChance);
  const hardPity = positivePity(config.hardPity);
  let expectedBoxes = 0;
  for (let before = 0; before < hardPity; before++) {
    expectedBoxes += Math.pow(1 - chance, before);
  }
  const quantile = (target: number): number => {
    for (let n = 1; n <= hardPity; n++) if (rareChanceWithin(n, config) >= target) return n;
    return hardPity;
  };
  return {
    expectedBoxes,
    longRunRareRate: 1 / expectedBoxes,
    hardPityShare: Math.pow(1 - chance, hardPity - 1),
    p50: quantile(0.5),
    p90: quantile(0.9),
    p95: quantile(0.95),
  };
}

/** EV, разброс и границы одного ларца в длинной серии. */
export function supplyValueSummary(config: PityConfig = SUPPLY_PITY): SupplyValueSummary {
  const pity = pitySummary(config);
  const baseRare = clampChance(config.baseChance);
  const material = weightedMean(MATERIAL);
  const expedition = weightedMean(EXPEDITION);
  const common = weightedMean(BONUS_COMMON);
  const rare = weightedMean(BONUS_RARE);
  const baseExpected = material + expedition + common * (1 - baseRare) + rare * baseRare;
  const longRunExpected =
    material + expedition + common * (1 - pity.longRunRareRate) + rare * pity.longRunRareRate;

  const materialVariance = weightedVariance(MATERIAL, material);
  const expeditionVariance = weightedVariance(EXPEDITION, expedition);
  const commonVariance = weightedVariance(BONUS_COMMON, common);
  const rareVariance = weightedVariance(BONUS_RARE, rare);
  const bonusVariance =
    (1 - pity.longRunRareRate) * (commonVariance + Math.pow(common - (longRunExpected - material - expedition), 2)) +
    pity.longRunRareRate * (rareVariance + Math.pow(rare - (longRunExpected - material - expedition), 2));

  const min = Math.min(...MATERIAL.map((i) => SUPPLY_REWARDS[i.id].value)) +
    Math.min(...EXPEDITION.map((i) => SUPPLY_REWARDS[i.id].value)) +
    Math.min(...BONUS_COMMON.map((i) => SUPPLY_REWARDS[i.id].value));
  const max = Math.max(...MATERIAL.map((i) => SUPPLY_REWARDS[i.id].value)) +
    Math.max(...EXPEDITION.map((i) => SUPPLY_REWARDS[i.id].value)) +
    Math.max(...BONUS_RARE.map((i) => SUPPLY_REWARDS[i.id].value));
  return {
    target: SUPPLY_TARGET_VALUE,
    baseExpected,
    longRunExpected,
    overTarget: longRunExpected / SUPPLY_TARGET_VALUE - 1,
    min,
    max,
    standardDeviation: Math.sqrt(materialVariance + expeditionVariance + bonusVariance),
    pity,
  };
}

export interface SupplySimulation {
  readonly count: number;
  readonly averageValue: number;
  readonly rareRate: number;
  readonly forcedRate: number;
  readonly min: number;
  readonly max: number;
  readonly rewardCounts: Readonly<Record<SupplyRewardId, number>>;
}

/** Монте-Карло — проверка формулы тем же роллом, который пойдёт в игру. */
export function simulateSupplyBoxes(
  count: number,
  seed = 0x51a7,
  config: PityConfig = SUPPLY_PITY,
): SupplySimulation {
  const n = Math.max(1, Math.floor(count));
  const rewardCounts = Object.fromEntries(
    (Object.keys(SUPPLY_REWARDS) as SupplyRewardId[]).map((id) => [id, 0]),
  ) as Record<SupplyRewardId, number>;
  let pity = 0;
  let total = 0;
  let rares = 0;
  let forced = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const open = rollSupplyBox((seed + Math.imul(i + 1, 0x9e3779b1)) >>> 0, pity, config);
    pity = open.pityAfter;
    total += open.value;
    if (open.rare) rares++;
    if (open.forced) forced++;
    min = Math.min(min, open.value);
    max = Math.max(max, open.value);
    for (const reward of open.rewards) rewardCounts[reward.id]++;
  }
  return {
    count: n,
    averageValue: total / n,
    rareRate: rares / n,
    forcedRate: forced / n,
    min,
    max,
    rewardCounts,
  };
}
