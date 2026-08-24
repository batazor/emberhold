import { stash } from './camp';
import type { CampState } from './camp';
import { CONSUMABLE_SLOTS } from './consumables';
import { rollSupplyBox } from './lootbox';
import type { SupplyBoxOpen } from './lootbox';
import type { Resources } from './resources';

export interface SupplyClaim extends SupplyBoxOpen {
  readonly overflow: number;
  readonly arrowsAdded: number;
  readonly consumableAdded: boolean;
}

/** Сид открытия отделён от генерации рейда и стабилен для номера вылазки. */
export const supplyClaimSeed = (raidSeed: number, raidNumber: number): number =>
  (raidSeed ^ Math.imul(raidNumber, 0x9e3779b1) ^ 0x7f4a7c15) >>> 0;

/**
 * Единственный вход из выигранного ларца в лагерь. Ролл и pity меняются
 * вместе, чтобы перезагрузка экрана не могла перебрасывать награду.
 */
export function claimSupplyBox(camp: CampState, seed: number): SupplyClaim {
  const open = rollSupplyBox(seed, camp.supplyPity ?? 0);
  camp.supplyPity = open.pityAfter;

  const resources: Partial<Resources> = {};
  let arrowsAdded = 0;
  let consumableAdded = false;
  for (const reward of open.rewards) {
    for (const [kind, amount] of Object.entries(reward.resources ?? {}) as [keyof Resources, number][]) {
      resources[kind] = (resources[kind] ?? 0) + amount;
    }
    if (reward.arrows !== undefined) {
      camp.arrows += reward.arrows;
      arrowsAdded += reward.arrows;
    }
    if (reward.consumable !== undefined && camp.loadout.length < CONSUMABLE_SLOTS) {
      camp.loadout.push(reward.consumable);
      consumableAdded = true;
    }
  }

  return { ...open, overflow: stash(camp, resources), arrowsAdded, consumableAdded };
}
