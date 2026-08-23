import type { CampState } from './camp';

/** Первая цель хозяйства: добыча считается после выдачи, а не по остатку. */
export const FARM_FOOD_GOAL = 30;

export type FarmOnboardingStep = 'intro' | 'goal' | 'reward' | 'done';

export interface FarmState {
  /** Запас в момент выдачи: нужен игроку как понятная точка отсчёта. */
  readonly foodAtStart: number;
  /** Валовая добыча после выдачи. Расход пищи это число не уменьшает. */
  gatheredFood: number;
  step: FarmOnboardingStep;
  unlocked: boolean;
}

/**
 * Выдать цель после появления второго приглашённого жителя.
 * Повторный вызов ничего не сбрасывает: загрузка и повторный вход безопасны.
 */
export function startFarmOnboarding(camp: CampState): boolean {
  if (camp.farm !== undefined || camp.residents.length < 2) return false;
  camp.farm = {
    foodAtStart: camp.resources.food,
    gatheredFood: 0,
    step: 'intro',
    unlocked: false,
  };
  return true;
}

/** Зачесть только реально добытую пищу. Подарки и торговля сюда не идут. */
export function gatherFarmFood(camp: CampState, amount: number): boolean {
  const farm = camp.farm;
  if (farm === undefined || farm.unlocked || amount <= 0) return false;
  const before = farm.gatheredFood;
  farm.gatheredFood = Math.min(FARM_FOOD_GOAL, before + Math.floor(amount));
  if (farm.gatheredFood >= FARM_FOOD_GOAL) {
    farm.unlocked = true;
    farm.step = 'reward';
  }
  return farm.gatheredFood !== before;
}

/** Кнопка карточки двигает только показ; условие награды проверяет симуляция. */
export function advanceFarmOnboarding(camp: CampState): boolean {
  const farm = camp.farm;
  if (farm === undefined) return false;
  if (farm.step === 'intro') {
    farm.step = 'goal';
    return true;
  }
  if (farm.step === 'reward' && farm.unlocked) {
    farm.step = 'done';
    return true;
  }
  return false;
}

