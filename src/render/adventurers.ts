import * as THREE from 'three';
import { ADVENTURERS_MODELS, ADVENTURERS_SLOTS } from './adventurers.data';
import type { AdventurerModelName } from './adventurers.data';
import { bakedGeometry, checkPalette } from './baked';
import { ADVENTURERS_PALETTE } from './palette';

/**
 * Готовые модели набора KayKit Adventurers (§6.1.3). Отличие от леса одно
 * и оно не в коде: модель запечена не в позе привязки, а в ключе покоя —
 * `scripts/models.ts` применяет скиннинг на запекании, потому что скелета
 * в бандле нет и не будет, пока в игре нет анимации.
 */
checkPalette('персонажей', ADVENTURERS_SLOTS, ADVENTURERS_PALETTE);

export type { AdventurerModelName };

export function adventurerGeometry(name: AdventurerModelName, height: number): THREE.BufferGeometry {
  return bakedGeometry(`adventurers:${name}`, ADVENTURERS_MODELS[name], ADVENTURERS_PALETTE, height);
}
