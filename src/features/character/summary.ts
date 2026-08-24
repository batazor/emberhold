import { OFFHAND, gearMods } from '../../sim/gear';
import type { GearState, Offhand } from '../../sim/gear';

/**
 * Сводка «что будет в вылазке» — числами, а не подписями.
 *
 * Считает её `gearMods()` из `sim/gear.ts`, и это главное правило файла:
 * ни одной своей формулы. Табличка, набранная руками рядом с формулой,
 * уже расходилась с ней в этом проекте — и стоила класса (`NO_MODS`
 * в `sim/gear.ts` помнит, как лучник остался без колчана, потому что
 * второй список написал ноль).
 *
 * Третья колонка — цена левой руки (§14.2). Она показывает, чем станет
 * то же число, если переложить руку: обзор против защиты. Появляется
 * только там, где число действительно меняется, — «→ 0 с фонарём» рядом
 * с нулём было бы шумом, а не выбором.
 *
 * Считается вне вёрстки, чтобы её можно было проверить в Node
 * (`character.rules.ts`): экран, который показывает числа, обязан быть
 * проверяемым без экрана.
 */
export interface RaidRow {
  readonly name: string;
  /** Что будет сейчас. */
  readonly now: string;
  /** Чем станет с другой вещью в левой руке. `null` — не изменится. */
  readonly other: string | null;
}

export interface RaidSummary {
  readonly rows: readonly RaidRow[];
  /** Подпись третьей колонки: «со щитом» или «с фонарём». */
  readonly withOther: string;
}

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
const percent = (x: number): string => `${signed(Math.round((x - 1) * 100))}%`;

export function raidSummary(gear: GearState, offhand: Offhand, ranged: boolean): RaidSummary {
  const now = gearMods(gear, offhand);
  const hand: Offhand = offhand === 'torch' ? 'shield' : 'torch';
  const alt = gearMods(gear, hand);
  const row = (name: string, a: number, b: number, fmt: (n: number) => string): RaidRow => ({
    name,
    now: fmt(a),
    other: a === b ? null : fmt(b),
  });
  const plain = (n: number): string => `${n}`;
  return {
    withOther: `с ${OFFHAND[hand].name.toLowerCase()}`,
    rows: [
      row('Атака', now.attack, alt.attack, plain),
      row('HP', now.wounds, alt.wounds, signed),
      row('Обзор', now.vision, alt.vision, signed),
      row('Защита', now.defense, alt.defense, plain),
      row('Рюкзак', now.capacity, alt.capacity, signed),
      row('Провиант за шаг', now.foodStep, alt.foodStep, percent),
      row('Под угрозой', now.risk, alt.risk, percent),
      // §14.3 — колчан показывается только тому, кто стреляет: ближнику
      // вместимость колчана не значит ничего, и строка была бы шумом.
      ...(ranged ? [row('Колчан', now.arrows, alt.arrows, plain)] : []),
    ],
  };
}
