import * as THREE from 'three';
import { bakedGeometry, fitOf } from './baked';
import type { Part } from './baked';
import { SKELETON_PALETTE } from './palette';
import { SKELETON_MODELS, SKELETON_SLOTS } from './skeleton.data';
import type { SkeletonModel, SkeletonModelName } from './skeleton.data';

/**
 * Готовые модели набора KayKit Skeletons в виде геометрии three (§6.1.3).
 * Отличие от леса ровно одно и оно в руке: набор держит оружие отдельной
 * моделью, и место для неё — узел `handslot.r` самого набора, чья матрица
 * запечена вместе с геометрией. Поэтому древко оказывается в кулаке,
 * а не там, куда его подвинули на глаз.
 */
if (SKELETON_PALETTE.length !== SKELETON_SLOTS.length) {
  throw new Error(
    `палитра скелетов рассинхронизирована: слотов ${SKELETON_SLOTS.length}, цветов ${SKELETON_PALETTE.length}`,
  );
}

export type { SkeletonModelName };

const cache = new Map<string, THREE.BufferGeometry>();

/**
 * Геометрия модели: основание на y = 0, центр по x и z, заданная высота.
 * Второе имя — предмет в правой руке; рост при этом считается по скелету,
 * а не по предмету.
 */
export function skeletonGeometry(
  name: SkeletonModelName,
  height: number,
  holds?: SkeletonModelName,
): THREE.BufferGeometry {
  const key = `${name}+${holds ?? ''}@${height}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const model: SkeletonModel = SKELETON_MODELS[name];
  const parts: Part[] = [{ model, palette: SKELETON_PALETTE }];
  if (holds !== undefined) {
    if (model.hand === undefined) throw new Error(`у модели ${name} нет узла руки`);
    parts.push({ model: SKELETON_MODELS[holds], palette: SKELETON_PALETTE, matrix: model.hand });
  }

  const geometry = bakedGeometry(parts, fitOf(model, height));
  cache.set(key, geometry);
  return geometry;
}
