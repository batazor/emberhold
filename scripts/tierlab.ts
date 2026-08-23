/**
 * Стенд яруса: прогнать **описание сложности**, которого в игре нет.
 *
 * Модель §22 выводит числа яруса из описания (`TierSpec`), но выведенные
 * таблицы считаются один раз при загрузке. Поэтому спросить «а что было бы
 * при другой щедрости» нельзя, не подменив таблицы: генератор возьмёт размер
 * и состав из загруженных, и опыт померит одну и ту же локацию под разными
 * подписями.
 *
 * Модуль делает ровно одно: подменяет таблицы яруса на время прогона
 * и восстанавливает их в `finally`. Приём тот же, что в `scripts/combat.ts`
 * с таблицей классов, и живёт он здесь, а не в двух приборах сразу: копия
 * подмены — это копия страховки, а страховка, разошедшаяся с оригиналом,
 * хуже её отсутствия.
 *
 * Запас и вместимость не подменяются в таблицах, а передаются вылазке
 * напрямую: лагерь в этих опытах не участвует, и числа обязаны приходить
 * из описания, а не из уровня Кухни.
 */
import { mulberry32 } from '../src/core/rng';
import { POLICIES, playRaid } from '../src/sim/bot';
import {
  TIER_CONTAINERS,
  TIER_CONTAINER_BASE,
  TIER_DEPTH_VALUE,
  TIER_HERO_LEVEL,
  TIER_RISK,
  TIER_ROSTER,
  TIER_SIZE,
  deriveTier,
} from '../src/sim/balance';
import type { TierSpec } from '../src/sim/balance';
import { generateLocation } from '../src/sim/generate';
import { referenceLoadout } from '../src/sim/heroes';
import type { Tier } from '../src/sim/types';

/** Что ярус отвечает на прогоне. Все четыре величины — те, которыми §22
 *  и §11.3 описывают ярус: успех, добыча и **где** приходит провал. */
export interface TierOutcome {
  readonly success: number;
  readonly haul: number;
  /** Доля локации, пройденная теми, кто не вернулся. */
  readonly failDepth: number;
  /** Доля локации, пройденная теми, кто вернулся. */
  readonly okDepth: number;
  /** Доля провалов, нанесённых голодом (остальное — бой). */
  readonly byFood: number;
  /** Сколько забегов вообще кончились провалом: без них две глубины
   *  не определены, и читать их нельзя. */
  readonly fails: number;
}

/** Прогон описания на боте. `seedBase` общий у всех точек опыта намеренно:
 *  разница между настройками обязана быть разницей настроек, а не сидов. */
export function evaluateSpec(
  tier: Tier,
  spec: TierSpec,
  runs: number,
  seedBase = 1,
): TierOutcome {
  const d = deriveTier(spec);
  const saved = {
    size: TIER_SIZE[tier],
    containers: TIER_CONTAINERS[tier],
    base: TIER_CONTAINER_BASE[tier],
    depth: TIER_DEPTH_VALUE[tier],
    risk: TIER_RISK[tier],
    roster: TIER_ROSTER[tier],
  };
  TIER_SIZE[tier] = spec.size;
  TIER_CONTAINERS[tier] = spec.containers;
  TIER_CONTAINER_BASE[tier] = spec.base;
  TIER_DEPTH_VALUE[tier] = spec.depthValue;
  TIER_RISK[tier] = spec.risk;
  TIER_ROSTER[tier] = d.roster;

  try {
    let ok = 0;
    let haul = 0;
    let failDepth = 0;
    let okDepth = 0;
    let fails = 0;
    let food = 0;
    for (let i = 0; i < runs; i++) {
      const seed = seedBase + i;
      const r = playRaid(
        {
          seed,
          tier,
          kitchenLevel: 3,
          storageLevel: 3,
          food: d.food,
          capacity: d.capacity,
          loadout: referenceLoadout(TIER_HERO_LEVEL[tier]),
          loc: generateLocation(seed, tier, 1),
        },
        POLICIES.cautious,
        mulberry32(seed),
      );
      haul += r.carriedTotal;
      const depth = r.locMaxBack > 0 ? r.maxBack / r.locMaxBack : 0;
      if (r.status === 'evacuated') {
        ok += 1;
        okDepth += depth;
      } else {
        fails += 1;
        failDepth += depth;
        if (r.cause === 'food') food += 1;
      }
    }
    return {
      success: ok / runs,
      haul: haul / runs,
      // Глубина не определена, когда сторона пуста. Половина — то место,
      // которое §11.3 называет границей: величина не читается, но и не тянет
      // выводы в сторону, которой в замере нет.
      failDepth: fails > 0 ? failDepth / fails : 0.5,
      okDepth: ok > 0 ? okDepth / ok : 0.5,
      byFood: fails > 0 ? food / fails : 0,
      fails,
    };
  } finally {
    TIER_SIZE[tier] = saved.size;
    TIER_CONTAINERS[tier] = saved.containers;
    TIER_CONTAINER_BASE[tier] = saved.base;
    TIER_DEPTH_VALUE[tier] = saved.depth;
    TIER_RISK[tier] = saved.risk;
    TIER_ROSTER[tier] = saved.roster;
  }
}
