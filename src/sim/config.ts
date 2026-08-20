/**
 * Числа из DESIGN §11. Всё, что там не зафиксировано, помечено как placeholder —
 * такие значения настраиваются телеметрией, а не спором.
 */
import type { Tier } from './types';

/**
 * Числа ярусов больше не назначаются здесь — они выводятся моделью (§22)
 * из описания сложности и переэкспортируются, чтобы существующие импорты
 * не менялись. Править ярус означает править TIER_SPEC в balance.ts,
 * а не четвёрку чисел, подогнанных друг под друга.
 */
export {
  FOOD_COST,
  HERO_WOUNDS,
  TIER_CONTAINERS,
  TIER_CONTAINER_BASE,
  TIER_DEPTH_VALUE,
  TIER_FOOD,
  TIER_KITCHEN_GATE,
  TIER_RISK,
  TIER_SIZE,
  modelKitchenFood,
} from './balance';

export const TIER_NAME: Record<Tier, string> = {
  0: 'Подступы',
  1: 'Ярус 1',
  2: 'Ярус 2',
  3: 'Дно',
};

/** §11.4 — радиус обзора в тайлах. */
export const visionRadius = (knowledge: number, night: boolean, torch: boolean): number =>
  3 + Math.floor(knowledge / 5) + (night ? -1 : 0) + (torch ? 2 : 0);

/**
 * Доля радиуса света, на которой противник просыпается. Меньше единицы —
 * значит игрок видит врага раньше, чем враг видит его, и у прохода через
 * комнату появляется решение: обойти, проскочить или драться (§15).
 * При единице все, кто попал в свет, кидаются разом, и решения нет.
 */
export const ENEMY_WAKE_SHARE = 0.6;

/** §11.3 — герой: раны переехали в balance.ts, там на них опирается модель. */
export const HERO_ATTACK_INTERVAL = 1.2;
export const HERO_REACH = 1.0;

/** §17.4 — закреплённая дизайнерская константа, не следствие анимации. */
export const HERO_SPEED = 1.67;

/** Вес добычи замедляет героя (§1). Доля скорости, теряемая на полном рюкзаке. */
export const WEIGHT_SLOWDOWN = 0.35;

/** Знание героя. Героев как сущностей ещё нет (§7 — этап 5), поэтому
 *  характеристика задана константой и питает формулу обзора из §11.4. */
export const HERO_KNOWLEDGE = 5;
