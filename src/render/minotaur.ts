import * as THREE from 'three';
import { bakedGeometry, bakedMaterial, fitOf } from './baked';
import { MINOTAUR_MODELS, MINOTAUR_SLOTS } from './minotaur.data';
import { MINOTAUR_PALETTE } from './palette';

if (MINOTAUR_PALETTE.length !== MINOTAUR_SLOTS.length) {
  throw new Error(`палитра минотавра рассинхронизирована: ${MINOTAUR_SLOTS.length}`);
}

let cached: THREE.BufferGeometry | null = null;

/** Бесплатная базовая модель Zero, приведённая к росту в клетках игры. */
export function minotaurGeometry(height: number): THREE.BufferGeometry {
  if (cached !== null) return cached;
  const model = MINOTAUR_MODELS.Minotaur;
  cached = bakedGeometry([{ model, palette: MINOTAUR_PALETTE }], fitOf(model, height));
  return cached;
}

export const minotaurMaterial = bakedMaterial;
