import type * as THREE from 'three';
import { bakedGeometry, bakedMaterial } from './baked';
import { CAVE_MODELS } from './cave.data';
import type { CaveModelName } from './cave.data';
import { CAVE_PALETTE } from './palette';

export type { CaveModelName };

const cache = new Map<CaveModelName, THREE.BufferGeometry>();

/** Четыре единицы набора равны одной клетке игровой сетки. */
export const CAVE_SCALE = 0.25;
/** Подъём готовой лестницы: 4.4 единицы набора между площадками. */
export const CAVE_LEVEL_HEIGHT = 4.4 * CAVE_SCALE;

/**
 * Каменная оболочка, лестница или ворота. Детали Kenney центрируются по своим
 * габаритам; у клеточных модулей это даёт точный стык 4×4.
 */
export function caveModuleGeometry(name: CaveModelName): THREE.BufferGeometry {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const model = CAVE_MODELS[name];
  const geometry = bakedGeometry([{ model, palette: CAVE_PALETTE }], {
    scale: CAVE_SCALE,
    shift: [
      (model.min[0] + model.max[0]) / 2,
      // Вертикальный сдвиг сохраняется: gate-overhang уже стоит над проёмом.
      // У клеточных модулей и остальных деталей min.y равен нулю.
      0,
      (model.min[2] + model.max[2]) / 2,
    ],
  });
  cache.set(name, geometry);
  return geometry;
}

export const caveMaterial = bakedMaterial;
