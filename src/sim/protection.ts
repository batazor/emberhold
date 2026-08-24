/**
 * §11.3 — единственный расчёт защиты.
 *
 * Бою, прогнозу и HUD нужна не только конечная рана, но и её
 * происхождение: сколько сняла Защита, сколько — Блок. Хранить
 * три копии формулы значило бы рано или поздно показать игроку
 * то, чего бой не сделает.
 */
import { MIN_DAMAGE, MIN_DAMAGE_SHARE } from './config';

export interface ProtectionResult {
  /** Атака до личной Защиты цели. */
  readonly attack: number;
  /** Урон после Защиты, до особого приёма и Блока. */
  readonly afterDefense: number;
  /** Урон после тарана или каменной брони. */
  readonly afterTechnique: number;
  /** Сколько реально снять с цели. */
  readonly dealt: number;
  readonly preventedByDefense: number;
  readonly preventedByGuard: number;
}

export interface ProtectionOptions {
  readonly guarding?: boolean;
  /** Плоская прибавка после Защиты: таран минотавра. */
  readonly add?: number;
  /** Плоское смягчение после Защиты: каменная броня. */
  readonly absorb?: number;
  readonly guardShare?: number;
}

/** Личная Защита цели. Доля удара всегда проходит. */
export const damageOf = (attack: number, defense: number): number =>
  Math.max(MIN_DAMAGE, attack * MIN_DAMAGE_SHARE, attack - defense / 2);

/**
 * Разложить готовый удар по слоям. `attack` может быть уже
 * ослаблен пустым колчаном; каким оружием били, защите неважно.
 */
export function protectionOf(
  attack: number,
  defense: number,
  options: ProtectionOptions = {},
): ProtectionResult {
  const afterDefense = damageOf(attack, defense);
  return finishProtection({
    attack,
    afterDefense,
    afterTechnique: afterDefense,
    dealt: afterDefense,
    preventedByDefense: Math.max(0, attack - afterDefense),
    preventedByGuard: 0,
  }, options);
}

/** Наложить приём и Блок на уже посчитанную личную Защиту. */
export function finishProtection(
  base: ProtectionResult,
  options: ProtectionOptions = {},
): ProtectionResult {
  const afterTechnique = Math.max(
    MIN_DAMAGE,
    base.afterDefense + (options.add ?? 0) - (options.absorb ?? 0),
  );
  const dealt = options.guarding
    ? Math.max(MIN_DAMAGE, Math.round(afterTechnique * (options.guardShare ?? 0.5)))
    : afterTechnique;
  return {
    ...base,
    afterTechnique,
    dealt,
    preventedByGuard: Math.max(0, afterTechnique - dealt),
  };
}
