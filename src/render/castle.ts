import * as THREE from 'three';
import { bakedGeometry, bakedMaterial, type Fit } from './baked';
import { BUILDER_MODELS, BUILDER_SLOTS } from './builder.data';
import type { BuilderPartModelName } from './builder.data';
import { CASTLE_MODELS, CASTLE_SLOTS } from './castle.data';
import type { CastlePartModelName as KenneyCastlePartModelName } from './castle.data';
import { CASTLE_CELL } from '../sim/castle';
import { BUILDER_PALETTE, CASTLE_PALETTE } from './palette';

/**
 * Детали набора Kenney Castle Kit в виде геометрии three (§6.1.6). Распаковка
 * общая для всех запечённых наборов (`baked.ts`); здесь остаётся то, что
 * относится именно к замку: масштаб, палитра и кэш.
 */
if (CASTLE_PALETTE.length !== CASTLE_SLOTS.length) {
  throw new Error(
    `палитра замка рассинхронизирована: слотов ${CASTLE_SLOTS.length}, цветов ${CASTLE_PALETTE.length}`,
  );
}
if (BUILDER_PALETTE.length !== BUILDER_SLOTS.length) {
  throw new Error(
    `палитра зданий рассинхронизирована: слотов ${BUILDER_SLOTS.length}, цветов ${BUILDER_PALETTE.length}`,
  );
}

export type CastlePartModelName = KenneyCastlePartModelName | BuilderPartModelName;

/**
 * Масштаб приходит из симуляции: она раскладывает замок по клеткам локации,
 * и рисовать его в другом масштабе значило бы поставить стену мимо той
 * клетки, которую она загораживает.
 */
export const CASTLE_SCALE = CASTLE_CELL;

/**
 * Приведение общее на весь набор: ноль детали уже стоит в центре клетки,
 * основание — на нуле. Поэтому сдвига нет вовсе, а масштаб один на все
 * детали. Приводить их поштучно по высоте, как приводится лес, здесь нельзя:
 * ярусы башни разной высоты, и выравнивание по высоте развалило бы стык.
 */
const FIT: Fit = { scale: CASTLE_SCALE, shift: [0, 0, 0] };
// Объекты Builder уже имеют след около 2×2, тогда как Kenney — 1×1.
const BUILDER_FIT: Fit = { scale: CASTLE_SCALE / 2, shift: [0, 0, 0] };

const cache = new Map<string, THREE.BufferGeometry>();

export function castleGeometry(name: CastlePartModelName): THREE.BufferGeometry {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const geometry = name in BUILDER_MODELS
    ? bakedGeometry([{
        model: BUILDER_MODELS[name as BuilderPartModelName],
        palette: BUILDER_PALETTE,
      }], BUILDER_FIT)
    : bakedGeometry([{
        model: CASTLE_MODELS[name as KenneyCastlePartModelName],
        palette: CASTLE_PALETTE,
      }], FIT);
  cache.set(name, geometry);
  return geometry;
}

/** Материал запечённых моделей: цвет приходит из вершин, а не из карты. */
export const castleMaterial = bakedMaterial;
