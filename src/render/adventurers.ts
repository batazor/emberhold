import * as THREE from 'three';
import { ADVENTURERS_MODELS, ADVENTURERS_SLOTS } from './adventurers.data';
import type { AdventurerModelName } from './adventurers.data';
import { bakedGeometry } from './baked';
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

/** Геометрия персонажа: основание на y = 0, центр по x и z, заданная высота. */
export function adventurerGeometry(name: AdventurerModelName, height: number): THREE.BufferGeometry {
  const key = `${name}@${height}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const geometry = bakedGeometry(
    [{ model: ADVENTURERS_MODELS[name], palette: ADVENTURERS_PALETTE }],
    height,
  );
  cache.set(key, geometry);
  return geometry;
}
