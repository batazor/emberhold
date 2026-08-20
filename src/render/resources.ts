import { bakedGeometry, bakedMaterial, fitOf } from './baked';
import { RESOURCES_MODELS, RESOURCES_SLOTS } from './resources.data';
import type { ResourceModelName } from './resources.data';
import { RESOURCES_PALETTE } from './palette';
import type { ResourceKind } from '../sim/resources';
import type * as THREE from 'three';

/**
 * Готовые модели набора KayKit Resource Bits в виде геометрии three (§6.1.5).
 * Распаковка — общая для всех запечённых наборов, `baked.ts`; здесь остаётся
 * то, что относится именно к ресурсам: их палитра, их имена и кэш.
 */
if (RESOURCES_PALETTE.length !== RESOURCES_SLOTS.length) {
  throw new Error(
    `палитра ресурсов рассинхронизирована: слотов ${RESOURCES_SLOTS.length}, ` +
      `цветов ${RESOURCES_PALETTE.length}`,
  );
}

export type { ResourceModelName };

/**
 * Что лежит в контейнере — то и стоит на клетке (§13). Кристалла в наборе нет:
 * самоцветы автор оставил платному тарифу, и у кристалла остаётся октаэдр,
 * которым до этого рисовались все четыре. Заглушкой он при этом быть перестал:
 * кристалл и есть октаэдр.
 *
 * Соль — самородки серебра: набор красит их клеткой атласа, которая в нашей
 * палитре и есть соль (иней, соль, сталь). На экране это белые обломки,
 * а не металл.
 */
export const RESOURCE_MODEL: Record<ResourceKind, ResourceModelName | null> = {
  salt: 'Silver_Nuggets',
  wood: 'Wood_Log_A',
  iron: 'Iron_Bars_Stack_Small',
  crystal: null,
};

const cache = new Map<string, THREE.BufferGeometry>();

/** Геометрия модели: основание на y = 0, центр по x и z, заданная высота. */
export function resourceGeometry(name: ResourceModelName, height: number): THREE.BufferGeometry {
  const key = `${name}@${height}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const model = RESOURCES_MODELS[name];
  const geometry = bakedGeometry([{ model, palette: RESOURCES_PALETTE }], fitOf(model, height));
  cache.set(key, geometry);
  return geometry;
}

/** Материал для запечённых моделей: цвет приходит из вершин, а не из карты. */
export const resourceMaterial = bakedMaterial;
