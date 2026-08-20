import * as THREE from 'three';
import { bakedGeometry, bakedMaterial } from './baked';
import { FOREST_MODELS, FOREST_SLOTS } from './forest.data';
import type { ForestModelName } from './forest.data';
import { FOREST_PALETTE } from './palette';

/**
 * Готовые модели набора KayKit Forest в виде геометрии three (§6.1).
 * Распаковка — общая для всех запечённых наборов, `baked.ts`; здесь остаётся
 * то, что относится именно к лесу: его палитра, его имена и кэш.
 */
if (FOREST_PALETTE.length !== FOREST_SLOTS.length) {
  throw new Error(
    `палитра моделей рассинхронизирована: слотов ${FOREST_SLOTS.length}, цветов ${FOREST_PALETTE.length}`,
  );
}

export type { ForestModelName };

const cache = new Map<string, THREE.BufferGeometry>();

/** Геометрия модели: основание на y = 0, центр по x и z, заданная высота. */
export function forestGeometry(name: ForestModelName, height: number): THREE.BufferGeometry {
  const key = `${name}@${height}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const geometry = bakedGeometry([{ model: FOREST_MODELS[name], palette: FOREST_PALETTE }], height);
  cache.set(key, geometry);
  return geometry;
}

/** Материал для запечённых моделей: цвет приходит из вершин, а не из карты. */
export const forestMaterial = bakedMaterial;
