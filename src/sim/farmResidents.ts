import type { CampState } from './camp';
import { FARM_PLOT_COUNT, farmPlotReadyAt, harvestFarmPlot } from './farm';
import { hasRoof, residentUuid, scheduledWorkSeconds } from './residents';

/** Полчаса рабочей смены после созревания — цена автоматического сбора. */
export const FARM_CARE_SECONDS = 30 * 60;
/** Бережный сбор помощника отличает связь с жителем от одного сэкономленного тапа. */
export const FARM_CARE_BONUS = 1;

export interface FarmCareHelper {
  readonly index: number;
  readonly name: string;
}

export interface FarmCareReport {
  readonly helpers: readonly string[];
  readonly plots: number;
  readonly food: number;
  readonly bonus: number;
}

/** Кто сможет помогать огороду: то же поручение, крыша и отсутствие отлучки. */
export function farmCareHelpers(
  camp: CampState,
  excludedIds: ReadonlySet<string> = new Set(),
): FarmCareHelper[] {
  return camp.residents.flatMap((resident, index) =>
    resident.answer === 'кормим' && !resident.rest && resident.hunt === undefined &&
      hasRoof(camp, index) && !excludedIds.has(residentUuid(resident))
      ? [{ index, name: resident.name }]
      : []
  );
}

/**
 * Помощник собирает не больше одной грядки за возвращение. Он не сеет:
 * культура и расход семян остаются решением игрока, а житель снимает только
 * созревший результат. Несколько помощников могут разобрать несколько грядок.
 */
export function collectResidentFarmHarvest(
  camp: CampState,
  from: number,
  to: number,
  working: number = camp.residents.length,
  excludedIds: ReadonlySet<string> = new Set(),
): FarmCareReport {
  const empty: FarmCareReport = { helpers: [], plots: 0, food: 0, bonus: 0 };
  const farm = camp.farm;
  if (farm?.unlocked !== true || to <= from) return empty;

  const ready = Array.from({ length: FARM_PLOT_COUNT }, (_, index) => ({
    index,
    plot: farm.plots[index],
  }))
    .filter((entry): entry is { index: number; plot: NonNullable<typeof entry.plot> } =>
      entry.plot !== null && entry.plot !== undefined && farmPlotReadyAt(entry.plot) <= to
    )
    .sort((a, b) => farmPlotReadyAt(a.plot) - farmPlotReadyAt(b.plot));
  if (ready.length === 0) return empty;

  const helpers: string[] = [];
  let food = 0;
  let plots = 0;
  for (const helper of farmCareHelpers(camp, excludedIds)) {
    if (helper.index >= working || ready.length === 0) continue;
    const resident = camp.residents[helper.index]!;

    const readyIndex = ready.findIndex(({ plot }) =>
      scheduledWorkSeconds(resident, Math.max(from, farmPlotReadyAt(plot)), to) >= FARM_CARE_SECONDS
    );
    if (readyIndex < 0) continue;
    const [{ index }] = ready.splice(readyIndex, 1);
    const gathered = harvestFarmPlot(camp, index, to);
    if (gathered <= 0) continue;
    camp.resources.food += FARM_CARE_BONUS;
    helpers.push(helper.name);
    plots += 1;
    food += gathered + FARM_CARE_BONUS;
  }

  return { helpers, plots, food, bonus: plots * FARM_CARE_BONUS };
}
