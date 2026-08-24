import type { CampState } from './camp';

/** Первая цель хозяйства: добыча считается после выдачи, а не по остатку. */
export const FARM_FOOD_GOAL = 30;

/** Первый огород: шесть видимых грядок, каждая живёт отдельным циклом. */
export const FARM_PLOT_COUNT = 6;
/**
 * Первый уровень начинает с внутренней пары у дорожки. Остальные полосы
 * остаются на виду как обещание развития, но не умножают ранний доход.
 */
export const FARM_STARTING_PLOT_COUNT = 2;
/** Массовый повтор появляется лишь там, где отдельные тапы становятся рутиной. */
export const FARM_RETURN_ACTION_PLOTS = 4;
/** Порядок расширения держит огород симметричным относительно дорожки. */
export const FARM_PLOT_UNLOCK_ORDER = [0, 3, 1, 4, 2, 5] as const;

export const FARM_CROP_IDS = ['turnip', 'barley'] as const;
export type FarmCropId = typeof FARM_CROP_IDS[number];

export interface FarmCropBalance {
  readonly seedFood: number;
  readonly growSeconds: number;
  readonly harvestFood: number;
}

/**
 * Репа отвечает на «пища нужна скоро», ячмень — на «можно подождать ради
 * отдачи». Оба посева берутся из общего запаса: валюты семян по-прежнему нет.
 */
export const FARM_CROPS: Readonly<Record<FarmCropId, FarmCropBalance>> = {
  turnip: { seedFood: 1, growSeconds: 60 * 60, harvestFood: 2 },
  barley: { seedFood: 1, growSeconds: 4 * 60 * 60, harvestFood: 6 },
};
export const FARM_DEFAULT_CROP: FarmCropId = 'barley';

/** Легаси-имена держат старые измерения на базовом, длинном урожае. */
export const FARM_SEED_FOOD = FARM_CROPS.barley.seedFood;
export const FARM_GROW_SECONDS = FARM_CROPS.barley.growSeconds;
export const FARM_HARVEST_FOOD = FARM_CROPS.barley.harvestFood;

export type FarmOnboardingStep = 'intro' | 'goal' | 'reward' | 'done';

export interface FarmPlot {
  /** Секунды эпохи по игровым часам (`core/clock.ts`). */
  readonly plantedAt: number;
  readonly crop: FarmCropId;
}

export type FarmPlotPhase = 'locked' | 'empty' | 'growing' | 'ready';

export interface FarmState {
  /** Запас в момент выдачи: нужен игроку как понятная точка отсчёта. */
  readonly foodAtStart: number;
  /** Валовая добыча после выдачи. Расход пищи это число не уменьшает. */
  gatheredFood: number;
  step: FarmOnboardingStep;
  unlocked: boolean;
  /** Сколько полос можно засевать; сами шесть полос всегда видны на сцене. */
  activePlots: number;
  /** Последняя выбранная карточка переживает переход и перезапуск. */
  selectedCrop: FarmCropId;
  /** null — свободная грядка; созревшая остаётся занятой до ручного сбора. */
  plots: (FarmPlot | null)[];
}

export interface FarmStatus {
  readonly active: number;
  readonly empty: number;
  readonly growing: number;
  readonly ready: number;
  readonly locked: number;
  readonly nextReadyAt: number | null;
}

export interface FarmReturnReport {
  readonly harvested: number;
  readonly replanted: number;
  readonly foodHarvested: number;
  readonly seedFood: number;
  readonly netFood: number;
}

export const emptyFarmPlots = (): (FarmPlot | null)[] =>
  Array.from({ length: FARM_PLOT_COUNT }, () => null);

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
    activePlots: FARM_STARTING_PLOT_COUNT,
    selectedCrop: FARM_DEFAULT_CROP,
    plots: emptyFarmPlots(),
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

/** Конец роста без мутации: показ и симуляция читают одну и ту же отметку. */
export function farmPlotReadyAt(plot: FarmPlot): number {
  return plot.plantedAt + FARM_CROPS[plot.crop].growSeconds;
}

export function isFarmCropId(value: unknown): value is FarmCropId {
  return typeof value === 'string' && (FARM_CROP_IDS as readonly string[]).includes(value);
}

/** Карточка меняет только следующий посев; уже растущие грядки не трогает. */
export function selectFarmCrop(camp: CampState, crop: FarmCropId): boolean {
  const farm = camp.farm;
  if (farm?.unlocked !== true || farm.selectedCrop === crop) return false;
  farm.selectedCrop = crop;
  return true;
}

/** Активные полосы идут не по индексу, а симметричными парами от дорожки. */
export function farmPlotIsActive(farm: FarmState | undefined, index: number): boolean {
  if (farm === undefined || !Number.isInteger(index) || index < 0 || index >= FARM_PLOT_COUNT) {
    return false;
  }
  const count = Math.max(0, Math.min(FARM_PLOT_COUNT, Math.floor(farm.activePlots)));
  return FARM_PLOT_UNLOCK_ORDER.slice(0, count).includes(index as 0 | 1 | 2 | 3 | 4 | 5);
}

export function farmPlotPhase(camp: CampState, index: number, now: number): FarmPlotPhase {
  const farm = camp.farm;
  if (farm === undefined || !Number.isInteger(index) || index < 0 || index >= FARM_PLOT_COUNT) {
    return 'locked';
  }
  const plot = farm.plots[index];
  // Урожай из сейва короткого шестигрядочного среза не пропадает: закрытая
  // полоса отдаёт уже посеянное один раз и закрывается только после сбора.
  if (plot == null) return farmPlotIsActive(farm, index) ? 'empty' : 'locked';
  return now >= farmPlotReadyAt(plot) ? 'ready' : 'growing';
}

/** Сводка для кнопки локации и будущих улучшений, без мутации таймеров. */
export function farmStatus(farm: FarmState | undefined, now: number): FarmStatus {
  let empty = 0;
  let growing = 0;
  let ready = 0;
  let locked = 0;
  let nextReadyAt: number | null = null;
  for (let index = 0; index < FARM_PLOT_COUNT; index += 1) {
    const plot = farm?.plots[index] ?? null;
    if (plot !== null) {
      const readyAt = farmPlotReadyAt(plot);
      if (now >= readyAt) ready += 1;
      else {
        growing += 1;
        nextReadyAt = nextReadyAt === null ? readyAt : Math.min(nextReadyAt, readyAt);
      }
    } else if (farmPlotIsActive(farm, index)) empty += 1;
    else locked += 1;
  }
  return {
    active: farm === undefined ? 0 : Math.max(0, Math.min(FARM_PLOT_COUNT, Math.floor(farm.activePlots))),
    empty,
    growing,
    ready,
    locked,
    nextReadyAt,
  };
}

export type FarmPlantBlock = 'ok' | 'locked' | 'bed' | 'plot' | 'occupied' | 'food';

/** Причина отказа нужна интерфейсу: молчащая грядка выглядит сломанной. */
export function farmPlantBlock(
  camp: CampState,
  index: number,
  crop: FarmCropId = camp.farm?.selectedCrop ?? FARM_DEFAULT_CROP,
): FarmPlantBlock {
  const farm = camp.farm;
  if (farm?.unlocked !== true) return 'locked';
  if (!Number.isInteger(index) || index < 0 || index >= FARM_PLOT_COUNT) return 'plot';
  if (farm.plots[index] != null) return 'occupied';
  if (!farmPlotIsActive(farm, index)) return 'bed';
  if (camp.resources.food < FARM_CROPS[crop].seedFood) return 'food';
  return 'ok';
}

/** Посев оплачивается сразу; отмены цикла нет, поэтому возврат не требуется. */
export function plantFarmPlot(
  camp: CampState,
  index: number,
  crop: FarmCropId,
  now: number,
): boolean {
  if (farmPlantBlock(camp, index, crop) !== 'ok' || !Number.isFinite(now)) return false;
  camp.resources.food -= FARM_CROPS[crop].seedFood;
  camp.farm!.plots[index] = { plantedAt: now, crop };
  return true;
}

/**
 * Собрать созревшую грядку. Возвращает фактическую прибавку, чтобы событие
 * интерфейса не повторяло баланс и не могло соврать после его правки.
 */
export function harvestFarmPlot(camp: CampState, index: number, now: number): number {
  const farm = camp.farm;
  if (farm?.unlocked !== true || farmPlotPhase(camp, index, now) !== 'ready') return 0;
  const plot = farm.plots[index];
  if (plot === null || plot === undefined) return 0;
  farm.plots[index] = null;
  const gathered = FARM_CROPS[plot.crop].harvestFood;
  camp.resources.food += gathered;
  return gathered;
}

/** Открыто ли необязательное действие возвращения для крупного огорода. */
export function farmReturnActionUnlocked(farm: FarmState | undefined): boolean {
  return farm?.unlocked === true && farm.activePlots >= FARM_RETURN_ACTION_PLOTS;
}

/**
 * Одним решением повторить только законченные циклы. Культура каждой грядки
 * сохраняется; пустые и растущие полосы не трогаются. Обычные тапы остаются
 * полноценной альтернативой, поэтому это удобство не меняет урожайность.
 */
export function repeatReadyFarmPlots(camp: CampState, now: number): FarmReturnReport {
  const empty: FarmReturnReport = {
    harvested: 0,
    replanted: 0,
    foodHarvested: 0,
    seedFood: 0,
    netFood: 0,
  };
  const farm = camp.farm;
  if (!farmReturnActionUnlocked(farm) || !Number.isFinite(now)) return empty;

  const foodBefore = camp.resources.food;
  let harvested = 0;
  let replanted = 0;
  let foodHarvested = 0;
  let seedFood = 0;
  for (let index = 0; index < FARM_PLOT_COUNT; index += 1) {
    if (farmPlotPhase(camp, index, now) !== 'ready') continue;
    const crop = farm!.plots[index]?.crop;
    if (crop === undefined) continue;
    const gathered = harvestFarmPlot(camp, index, now);
    if (gathered <= 0) continue;
    harvested += 1;
    foodHarvested += gathered;
    if (plantFarmPlot(camp, index, crop, now)) {
      replanted += 1;
      seedFood += FARM_CROPS[crop].seedFood;
    }
  }
  return {
    harvested,
    replanted,
    foodHarvested,
    seedFood,
    netFood: camp.resources.food - foodBefore,
  };
}
