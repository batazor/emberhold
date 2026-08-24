import * as THREE from 'three';
import { bakedGeometry, fitOf } from './baked';
import { MINI_FOREST_MODELS, MINI_FOREST_SLOTS } from './miniForest.data';
import type { MiniForestPartModelName } from './miniForest.data';
import { MINI_FOREST_PALETTE } from './palette';

/**
 * Набор Kenney Mini Forest (§6.1.18) — пост лесника у стен замка (§6.1.6.3):
 * палатка и мишень. Распаковка общая для всех запечённых наборов
 * (`baked.ts`); здесь остаётся то, что относится именно к этому набору, —
 * его палитра, его имена и кэш.
 *
 * Приводится **высотой**, а не клеткой: ни палатка, ни мишень ничем
 * не стыкуются с соседом, и сетки у них нет — ровно как у дерева леса
 * (`forestGeometry`). Число высоты назначает тот, кто ставит: рост поста
 * читается рядом с человеком, а человек в этой сцене мерится ростом героя.
 */
if (MINI_FOREST_PALETTE.length !== MINI_FOREST_SLOTS.length) {
  throw new Error(
    `палитра поста рассинхронизирована: слотов ${MINI_FOREST_SLOTS.length}, ` +
      `цветов ${MINI_FOREST_PALETTE.length}`,
  );
}

export type { MiniForestPartModelName };

const cache = new Map<string, THREE.BufferGeometry>();

/** Деталь поста заданной высоты: основание на y = 0, центр по x и z. */
export function miniForestGeometry(
  name: MiniForestPartModelName,
  height: number,
): THREE.BufferGeometry {
  const key = `${name}@${height}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const model = MINI_FOREST_MODELS[name];
  const geometry = bakedGeometry([{ model, palette: MINI_FOREST_PALETTE }], fitOf(model, height));
  cache.set(key, geometry);
  return geometry;
}
