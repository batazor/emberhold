import type { Rng } from '../core/rng';
import type { Tier } from './types';

/**
 * §13 — пять ресурсов, каждый ради своего решения.
 *
 * **Пища (§13.7) добавлена последней и по другому правилу, чем четыре
 * первых.** Те приходят из вылазки и тратятся на постройки; пища не выпадает
 * в находках вовсе — её добывает жилец, и тратится она сама, по времени.
 * Это единственный ресурс, у которого сток идёт без участия игрока, и потому
 * единственный, который связывает лагерь с часами, а не с решениями.
 */
export type BaseResourceKind = 'stone' | 'wood' | 'iron' | 'crystal' | 'food';
export type CommodityKind = 'meat' | 'pelt';
export type ResourceKind = BaseResourceKind | CommodityKind;

export const RESOURCE_NAME: Record<ResourceKind, string> = {
  stone: 'Камень',
  wood: 'Дерево',
  iron: 'Железо',
  crystal: 'Кристалл',
  food: 'Пища',
  meat: 'Мясо',
  pelt: 'Лисья шкура',
};

export const RESOURCE_KINDS: readonly ResourceKind[] = [
  'stone', 'wood', 'iron', 'crystal', 'food', 'meat', 'pelt',
];

/** Охотничьи товары необязательны в старых сейвах и тестовых заготовках. */
export type Resources = Record<BaseResourceKind, number> & Partial<Record<CommodityKind, number>>;

export const emptyResources = (): Resources => ({
  stone: 0, wood: 0, iron: 0, crystal: 0, food: 0,
});

export const totalOf = (r: Resources): number =>
  r.stone + r.wood + r.iron + r.crystal + r.food + (r.meat ?? 0) + (r.pelt ?? 0);

/**
 * §13: камень — со всех ярусов, дерево — 0–2, железо — 1–3,
 * кристалл — только 2–3 и редко. Кристалл и есть вся конструкция глубины:
 * если он однажды закапает на мелких ярусах, спускаться станет незачем.
 */
const LOOT_TABLE: Record<Tier, readonly (readonly [ResourceKind, number])[]> = {
  0: [['stone', 0.7], ['wood', 0.3]],
  1: [['stone', 0.5], ['wood', 0.3], ['iron', 0.2]],
  2: [['stone', 0.4], ['wood', 0.15], ['iron', 0.35], ['crystal', 0.1]],
  3: [['stone', 0.3], ['iron', 0.45], ['crystal', 0.25]],
};

/**
 * Та же таблица долей, но читаемая по виду. Нужна замеру (`npm run fence`):
 * чтобы взять одну единицу камня, надо вскрыть 1/долю находок — остальные
 * выпадут не камнем, и цена ресурса в секундах считается отсюда.
 */
export const LOOT_SHARE: Record<Tier, Partial<Record<ResourceKind, number>>> = {
  0: Object.fromEntries(LOOT_TABLE[0]),
  1: Object.fromEntries(LOOT_TABLE[1]),
  2: Object.fromEntries(LOOT_TABLE[2]),
  3: Object.fromEntries(LOOT_TABLE[3]),
};

export function rollLoot(rng: Rng, tier: Tier): ResourceKind {
  const roll = rng();
  let acc = 0;
  for (const [kind, weight] of LOOT_TABLE[tier]) {
    acc += weight;
    if (roll <= acc) return kind;
  }
  return 'stone';
}

export function addResources(into: Resources, from: Resources): void {
  into.stone += from.stone;
  into.wood += from.wood;
  into.iron += from.iron;
  into.crystal += from.crystal;
  into.food += from.food;
  if ((from.meat ?? 0) > 0) into.meat = (into.meat ?? 0) + (from.meat ?? 0);
  if ((from.pelt ?? 0) > 0) into.pelt = (into.pelt ?? 0) + (from.pelt ?? 0);
}

export function canAfford(have: Resources, cost: Partial<Resources>): boolean {
  return (Object.entries(cost) as [ResourceKind, number][]).every(
    ([kind, amount]) => (have[kind] ?? 0) >= amount,
  );
}

export function spend(have: Resources, cost: Partial<Resources>): void {
  for (const [kind, amount] of Object.entries(cost) as [ResourceKind, number][]) {
    have[kind] = (have[kind] ?? 0) - amount;
  }
}
