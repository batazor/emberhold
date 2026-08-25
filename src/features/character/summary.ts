import { HERO_HP } from '../../sim/balance';
import { storageCapacity } from '../../sim/camp';
import { FOOD_COST, visionRadius } from '../../sim/config';
import { OFFHAND, gearMods } from '../../sim/gear';
import type { GearState, Offhand } from '../../sim/gear';
import type { HeroLoadout } from '../../sim/heroes';

/** Всё постоянное, что войдёт в следующую вылазку до выбора места и карт. */
export interface RaidContext {
  readonly loadout: HeroLoadout;
  readonly storageLevel: number;
  readonly capacityBonus: number;
  readonly visionBonus: number;
  readonly quiverBonus: number;
}

export type RaidMetric =
  | 'attack'
  | 'health'
  | 'vision'
  | 'defense'
  | 'capacity'
  | 'provisions'
  | 'risk'
  | 'quiver';

export interface RaidRow {
  readonly metric: RaidMetric;
  readonly group: 'combat' | 'journey';
  readonly name: string;
  /** Итог, а не прибавка снаряжения. */
  readonly now: string;
  /** Итог после смены предмета в левой руке. */
  readonly other: string | null;
}

export interface RaidSummary {
  readonly rows: readonly RaidRow[];
  readonly withOther: string;
  readonly hand: string;
}

const nice = (n: number): string =>
  Number.isInteger(n) ? `${n}` : n.toFixed(1).replace(/\.0$/, '');

/**
 * Итог следующей вылазки. Здесь нет параллельных формул: здоровье, обзор,
 * вместимость и модификаторы берутся из тех же функций, что собирают RaidState.
 * Не входят только место, событие и карты — их ещё не выбрали.
 */
export function raidSummary(
  context: RaidContext,
  gear: GearState,
  offhand: Offhand,
): RaidSummary {
  const { loadout } = context;
  const now = gearMods(gear, offhand);
  const hand: Offhand = offhand === 'torch' ? 'shield' : 'torch';
  const alt = gearMods(gear, hand);
  const capacity = (mods: typeof now): number => Math.max(
    1,
    Math.floor(storageCapacity(context.storageLevel) * loadout.bagMul)
      + mods.capacity
      + Math.max(0, context.capacityBonus),
  );
  const vision = (mods: typeof now): number =>
    visionRadius(loadout.knowledge, false, true) + mods.vision + Math.max(0, context.visionBonus);
  const row = (
    metric: RaidMetric,
    group: RaidRow['group'],
    name: string,
    a: number,
    b: number,
    format: (value: number) => string = nice,
  ): RaidRow => ({ metric, group, name, now: format(a), other: a === b ? null : format(b) });
  const percent = (value: number): string => `${Math.round(value * 100)}%`;

  return {
    hand: OFFHAND[offhand].name,
    withOther: `с ${OFFHAND[hand].name.toLowerCase()}`,
    rows: [
      row('attack', 'combat', 'Атака', loadout.attack + now.attack, loadout.attack + alt.attack),
      row('health', 'combat', 'Здоровье', HERO_HP + loadout.hp + now.wounds, HERO_HP + loadout.hp + alt.wounds),
      row('vision', 'combat', 'Обзор', vision(now), vision(alt)),
      row('defense', 'combat', 'Защита', loadout.defense + now.defense, loadout.defense + alt.defense),
      row('capacity', 'journey', 'Рюкзак', capacity(now), capacity(alt)),
      row('provisions', 'journey', 'Пища / шаг', FOOD_COST.step * now.foodStep, FOOD_COST.step * alt.foodStep),
      row('risk', 'journey', 'Защита добычи', 1 - now.risk, 1 - alt.risk, percent),
      ...(loadout.ranged
        ? [row('quiver', 'journey', 'Колчан', now.arrows + context.quiverBonus, alt.arrows + context.quiverBonus)]
        : []),
    ],
  };
}
