import { WEAPONS_MODELS, WEAPONS_SLOTS } from './weapons.data';
import type { WeaponModelName } from './weapons.data';
import { WEAPONS_PALETTE } from './palette';
import type { Part } from './baked';

/**
 * Готовые модели набора KayKit Fantasy Weapons Bits (§6.1.8) — то, что у героя
 * в руке. Распаковка общая для всех наборов, `baked.ts`; здесь остаётся
 * то, что относится именно к оружию: его палитра и лестница уровней §14.
 *
 * Своей геометрии этот модуль не собирает и собирать не должен: оружие
 * не стоит на земле, а кладётся в узел руки чужой модели. Поэтому наружу
 * уходит `Part`, а склеивает его с персонажем `adventurers.ts`.
 */
if (WEAPONS_PALETTE.length !== WEAPONS_SLOTS.length) {
  throw new Error(
    `палитра оружия рассинхронизирована: слотов ${WEAPONS_SLOTS.length}, ` +
      `цветов ${WEAPONS_PALETTE.length}`,
  );
}

export type { WeaponModelName };

/**
 * Лестница уровней оружия (§14). Индекс — уровень предмета: нулевой это
 * «не выковано», и в руке у героя тогда деревянный клинок набора. Дальше
 * каждая ковка меняет силуэт, и последняя ступень держит два уровня:
 * пятый уровень Мастерской меняет числа, а после двуручного в наборе
 * ничего нет — рисовать шестую ступень нечем, и врать про неё не нужно.
 */
export const WEAPON_LADDER: readonly WeaponModelName[] = [
  'sword_A', 'sword_B', 'sword_C', 'sword_D', 'sword_E',
];

/** Клинок по уровню предмета: выше лестницы — последняя ступень. */
export const weaponOf = (level: number): WeaponModelName =>
  WEAPON_LADDER[Math.min(Math.max(level, 0), WEAPON_LADDER.length - 1)]!;

/**
 * Оружие как часть чужой модели: геометрия отсюда, палитра отсюда, место —
 * матрица руки того, кто держит.
 */
export const weaponPart = (name: WeaponModelName, matrix?: readonly number[]): Part => ({
  model: WEAPONS_MODELS[name],
  palette: WEAPONS_PALETTE,
  ...(matrix === undefined ? {} : { matrix }),
});
