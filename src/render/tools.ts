import * as THREE from 'three';
import { TOOLS_MODELS, TOOLS_SLOTS } from './tools.data';
import type { ToolModelName } from './tools.data';
import { TOOLS_PALETTE } from './palette';
import { bakedGeometry } from './baked';

/**
 * Готовые модели набора KayKit RPG Tools Bits (§6.1.14) — инструмент
 * в руке жильца. Распаковка общая для всех наборов, `baked.ts`; здесь
 * остаётся то, что относится именно к инструментам: их палитра и кэш.
 *
 * Своей геометрии «на земле» модуль не собирает по той же причине, что
 * оружие (§6.1.8): инструмент не стоит на площадке, а кладётся в узел
 * руки чужой модели. Рукоять у набора в нуле, поэтому геометрия вкладывается
 * в кость `handslot.r` общего рига как есть, без своей матрицы, — рука
 * уносит её сама (`rigged.ts`).
 */
if (TOOLS_PALETTE.length !== TOOLS_SLOTS.length) {
  throw new Error(
    `палитра инструментов рассинхронизирована: слотов ${TOOLS_SLOTS.length}, ` +
      `цветов ${TOOLS_PALETTE.length}`,
  );
}

export type { ToolModelName };

const cache = new Map<ToolModelName, THREE.BufferGeometry>();

/** Инструмент как предмет в кулак: геометрия в единицах набора, грип в нуле. */
export function toolGeometry(name: ToolModelName): THREE.BufferGeometry {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const geometry = bakedGeometry([{ model: TOOLS_MODELS[name], palette: TOOLS_PALETTE }]);
  cache.set(name, geometry);
  return geometry;
}
