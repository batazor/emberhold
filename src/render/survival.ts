import * as THREE from 'three';
import { bakedGeometry, fitOf } from './baked';
import { SURVIVAL_MODELS, SURVIVAL_SLOTS } from './survival.data';
import { SURVIVAL_PALETTE } from './palette';

/** Палатка Kenney: стройка — каркас с половиной полотна, готовая — с полным. */
export type SurvivalTentStage = 'building' | 'complete';

if (SURVIVAL_PALETTE.length !== SURVIVAL_SLOTS.length) {
  throw new Error(
    `палитра Survival Kit рассинхронизирована: слотов ${SURVIVAL_SLOTS.length}, цветов ${SURVIVAL_PALETTE.length}`,
  );
}

const cache = new Map<SurvivalTentStage, THREE.BufferGeometry>();

/**
 * Высота до масштабирования здания в сцене. Совпадает с прежним блокингом:
 * подмена ассета не должна менять камеру, тень и читаемый размер Жилья.
 */
const TENT_HEIGHT = 2.05;

export function survivalTentGeometry(stage: SurvivalTentStage): THREE.BufferGeometry {
  const known = cache.get(stage);
  if (known !== undefined) return known;
  const frame = SURVIVAL_MODELS.tent;
  const model = SURVIVAL_MODELS[stage === 'building' ? 'tent-canvas-half' : 'tent-canvas'];
  // Варианты — полные модели с одним авторским нулём, а не добавочные куски:
  // складывать их друг с другом значило бы задвоить каркас. Приведение всё
  // равно считается по голому каркасу — полотно не меняет масштаб между
  // строительной и готовой версиями.
  const fit = fitOf(frame, TENT_HEIGHT);
  const geometry = bakedGeometry([{ model, palette: SURVIVAL_PALETTE }], fit);
  cache.set(stage, geometry);
  return geometry;
}
