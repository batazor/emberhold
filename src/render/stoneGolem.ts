import * as THREE from 'three';
import { bakedGeometry, fitOf } from './baked';
import { STONE_GOLEM_MODELS, STONE_GOLEM_SLOTS } from './stoneGolem.data';
import { STONE_GOLEM_PALETTE } from './palette';

if (STONE_GOLEM_PALETTE.length !== STONE_GOLEM_SLOTS.length) {
  throw new Error(`палитра каменного голема рассинхронизирована: ${STONE_GOLEM_SLOTS.length}`);
}

let cached: THREE.BufferGeometry | null = null;

/** Бесплатная статичная модель Zero, приведённая к росту в клетках игры. */
export function stoneGolemGeometry(height: number): THREE.BufferGeometry {
  if (cached !== null) return cached;
  const model = STONE_GOLEM_MODELS.StoneGolem;
  cached = bakedGeometry([{ model, palette: STONE_GOLEM_PALETTE }], fitOf(model, height));
  return cached;
}
