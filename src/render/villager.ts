import * as THREE from 'three';
import { VILLAGER_MODELS, VILLAGER_SLOTS } from './villager.data';
import type { VillagerModel, VillagerModelName } from './villager.data';
import { bakedGeometry, fitOf } from './baked';
import { VILLAGER_PALETTE } from './palette';

/**
 * Набор LOWPO Villager NPC (§6.1.13): кузнец, охотник и три предмета ремесла.
 * Распаковка общая для всех наборов, `baked.ts`; здесь остаётся то, что
 * относится именно к ним, — их палитра, их имена и кэш.
 *
 * **Скелета нет, и это решение, а не упущение.** Риг набора (rigify,
 * 27 костей) на общий `Rig_Medium` не ретаргетится, поэтому модели запечены
 * статикой с опущенными из T-позы руками. Во дворе они стоят, а не ходят:
 * ходячие жильцы остаются на своих моделях общего рига (`folk.ts`).
 */
if (VILLAGER_PALETTE.length !== VILLAGER_SLOTS.length) {
  throw new Error(
    `палитра жителей рассинхронизирована: слотов ${VILLAGER_SLOTS.length}, ` +
      `цветов ${VILLAGER_PALETTE.length}`,
  );
}

export type { VillagerModelName };

const cache = new Map<string, THREE.BufferGeometry>();

/**
 * Неподвижная геометрия: основание на y = 0, центр по x и z, заданная высота.
 * Другой формы у набора нет — см. шапку модуля.
 */
export function villagerGeometry(name: VillagerModelName, height: number): THREE.BufferGeometry {
  const key = `${name}@${height}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const model: VillagerModel = VILLAGER_MODELS[name];
  const geometry = bakedGeometry([{ model, palette: VILLAGER_PALETTE }], fitOf(model, height));
  cache.set(key, geometry);
  return geometry;
}
