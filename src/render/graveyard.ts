import * as THREE from 'three';
import { bakedGeometry, bakedMaterial, fitOf, type Fit } from './baked';
import { GRAVEYARD_MODELS, GRAVEYARD_SLOTS } from './graveyard.data';
import type { GraveyardPartModelName } from './graveyard.data';
import { FENCE_CELL } from '../sim/fence';
import { GRAVEYARD_PALETTE } from './palette';

/**
 * Детали набора Kenney Graveyard Kit в виде геометрии three (§6.1.7).
 * Распаковка общая для всех запечённых наборов (`baked.ts`); здесь остаётся
 * то, что относится именно к кладбищу: масштаб, палитра и кэш.
 *
 * Набор делится надвое, и приводятся половины по-разному. **Ограда —
 * модуль**: её клетка приходит из симуляции, потому что ограда занимает
 * клетки локации, и рисовать её в другом масштабе значило бы поставить
 * забор мимо той клетки, которую он загораживает. **Дерево, надгробие
 * и привидение — предмет**: у них никакой сетки нет, и приводит их высота,
 * ровно как `forestGeometry(name, height)` приводит дерево леса.
 */
if (GRAVEYARD_PALETTE.length !== GRAVEYARD_SLOTS.length) {
  throw new Error(
    `палитра кладбища рассинхронизирована: слотов ${GRAVEYARD_SLOTS.length}, цветов ${GRAVEYARD_PALETTE.length}`,
  );
}

export type { GraveyardPartModelName };

/** Масштаб ограды приходит из симуляции — она раскладывает её по клеткам. */
export const FENCE_SCALE = FENCE_CELL;

const FIT: Fit = { scale: FENCE_SCALE, shift: [0, 0, 0] };

const cache = new Map<string, THREE.BufferGeometry>();

/**
 * Деталь ограды в клетках локации. Ноль детали уже стоит в центре клетки
 * набора, основание — на нуле, поэтому сдвига нет и масштаб один на все
 * детали: выравнивание по высоте развалило бы стык прямой с углом.
 */
export function fenceGeometry(name: GraveyardPartModelName): THREE.BufferGeometry {
  const key = `fence:${name}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const geometry = bakedGeometry([{ model: GRAVEYARD_MODELS[name], palette: GRAVEYARD_PALETTE }], FIT);
  cache.set(key, geometry);
  return geometry;
}

/** Предмет набора заданной высоты: основание на y = 0, центр по x и z. */
export function graveyardGeometry(name: GraveyardPartModelName, height: number): THREE.BufferGeometry {
  const key = `${name}@${height}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const model = GRAVEYARD_MODELS[name];
  const geometry = bakedGeometry([{ model, palette: GRAVEYARD_PALETTE }], fitOf(model, height));
  cache.set(key, geometry);
  return geometry;
}

/** Материал запечённых моделей: цвет приходит из вершин, а не из карты. */
export const graveyardMaterial = bakedMaterial;
