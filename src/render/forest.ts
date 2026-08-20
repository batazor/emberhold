import * as THREE from 'three';
import { bakedGeometry, bakedMaterial, checkPalette } from './baked';
import { FOREST_MODELS, FOREST_SLOTS } from './forest.data';
import type { ForestModelName } from './forest.data';
import { FOREST_PALETTE } from './palette';

/** Готовые модели набора KayKit Forest в виде геометрии three (§6.1.1). */
checkPalette('леса', FOREST_SLOTS, FOREST_PALETTE);

export type { ForestModelName };

export function forestGeometry(name: ForestModelName, height: number): THREE.BufferGeometry {
  return bakedGeometry(`forest:${name}`, FOREST_MODELS[name], FOREST_PALETTE, height);
}

export function forestMaterial(): THREE.MeshLambertMaterial {
  return bakedMaterial();
}
