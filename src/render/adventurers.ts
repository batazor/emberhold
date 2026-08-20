import * as THREE from 'three';
import { ADVENTURERS_MODELS, ADVENTURERS_SLOTS } from './adventurers.data';
import type { AdventurerModel, AdventurerModelName } from './adventurers.data';
import { bakedGeometry, fitOf } from './baked';
import { skinnedGeometry } from './rigged';
import type { RiggedParts } from './rigged';
import type { Part } from './baked';
import { ADVENTURERS_PALETTE } from './palette';

/**
 * Готовые модели набора KayKit Adventurers (§6.1.4) — герой, которым играют.
 * Распаковка общая для всех наборов, `baked.ts`; здесь остаётся то, что
 * относится именно к персонажам: их палитра, их имена и кэш.
 *
 * Скелета в бандле нет и не будет, пока в игре нет анимации: `npm run models`
 * применяет скиннинг на запекании и кладёт сюда один нарисованный кадр —
 * ключ клипа покоя, а не позу привязки, в которой набор лежит на диске.
 */
if (ADVENTURERS_PALETTE.length !== ADVENTURERS_SLOTS.length) {
  throw new Error(
    `палитра персонажей рассинхронизирована: слотов ${ADVENTURERS_SLOTS.length}, ` +
      `цветов ${ADVENTURERS_PALETTE.length}`,
  );
}

export type { AdventurerModelName };

const cache = new Map<string, THREE.BufferGeometry>();

/**
 * Геометрия персонажа: основание на y = 0, центр по x и z, заданная высота.
 * Второе имя — предмет в правой руке. Место для него — узел `handslot.r`
 * самого набора, чья матрица запечена вместе с моделью, поэтому рукоять
 * оказывается в кулаке, а не там, куда её подвинули на глаз. Рост при этом
 * считается по персонажу: топор торчит выше плеча, и мерить по нему значило бы
 * делать вооружённого героя ниже безоружного ровно на длину топорища.
 */
export function adventurerGeometry(
  name: AdventurerModelName,
  height: number,
  holds?: AdventurerModelName,
): THREE.BufferGeometry {
  const key = `${name}+${holds ?? ''}@${height}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const model: AdventurerModel = ADVENTURERS_MODELS[name];
  const parts: Part[] = [{ model, palette: ADVENTURERS_PALETTE }];
  if (holds !== undefined) {
    if (model.hand === undefined) throw new Error(`у модели ${name} нет узла руки`);
    parts.push({ model: ADVENTURERS_MODELS[holds], palette: ADVENTURERS_PALETTE, matrix: model.hand });
  }

  const geometry = bakedGeometry(parts, fitOf(model, height));
  cache.set(key, geometry);
  return geometry;
}

const rigCache = new Map<string, RiggedParts>();

/** Та же модель со скином: героя тоже двигают кости, а не подмена кадра. */
export function adventurerParts(
  name: AdventurerModelName,
  height: number,
  holds?: AdventurerModelName,
): RiggedParts {
  const key = `${name}+${holds ?? ''}@${height}`;
  const hit = rigCache.get(key);
  if (hit !== undefined) return hit;

  const model: AdventurerModel = ADVENTURERS_MODELS[name];
  const parts: RiggedParts = {
    body: skinnedGeometry([{ model, palette: ADVENTURERS_PALETTE }]),
    ...(holds === undefined
      ? {}
      : { held: bakedGeometry([{ model: ADVENTURERS_MODELS[holds], palette: ADVENTURERS_PALETTE }]) }),
    fit: fitOf(model, height),
  };
  rigCache.set(key, parts);
  return parts;
}
