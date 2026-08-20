import type { Rng } from '../core/rng';
import type { Tier } from './types';

/** §13 — четыре ресурса, каждый ради своего решения. */
export type ResourceKind = 'stone' | 'wood' | 'iron' | 'crystal';

export const RESOURCE_NAME: Record<ResourceKind, string> = {
  stone: 'Камень',
  wood: 'Дерево',
  iron: 'Железо',
  crystal: 'Кристалл',
};

export type Resources = Record<ResourceKind, number>;

export const emptyResources = (): Resources => ({ stone: 0, wood: 0, iron: 0, crystal: 0 });

export const totalOf = (r: Resources): number => r.stone + r.wood + r.iron + r.crystal;

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
}

export function canAfford(have: Resources, cost: Partial<Resources>): boolean {
  return (Object.entries(cost) as [ResourceKind, number][]).every(
    ([kind, amount]) => have[kind] >= amount,
  );
}

export function spend(have: Resources, cost: Partial<Resources>): void {
  for (const [kind, amount] of Object.entries(cost) as [ResourceKind, number][]) {
    have[kind] -= amount;
  }
}
