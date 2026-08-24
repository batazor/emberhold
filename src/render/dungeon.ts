import { bakedGeometry, bakedMaterial, fitOf } from './baked';
import { DUNGEON_MODELS } from './dungeon.data';
import type { DungeonModelName } from './dungeon.data';
import { DUNGEON_PALETTE } from './palette';
import type * as THREE from 'three';

/**
 * Готовые модели набора KayKit Dungeon в виде геометрии three (§6.1.2).
 * Распаковка — общая для всех запечённых наборов, `baked.ts`; здесь остаётся
 * то, что относится именно к подземелью: палитра, имена и кэш.
 *
 * Сундуки приводятся к высоте предмета, а модульная архитектура сохраняет
 * общий масштаб плана: маленький пол и половина стены занимают одну клетку,
 * полная стена — две. Вертикаль прижата отдельно под изометрическую камеру;
 * на совпадение панелей с границей `blocked` это не влияет.
 */
export type { DungeonModelName };

/** Вид сундука → модель набора. Ключи — рабочие слова, не лор (§0.1). */
export const CHEST_MODEL = {
  'простой': 'chest',
  'золотой': 'chest_gold',
} as const satisfies Record<string, DungeonModelName>;

export type ChestLook = keyof typeof CHEST_MODEL;

const cache = new Map<string, THREE.BufferGeometry>();

/** Две исходные единицы KayKit Dungeon равны одной клетке игры. */
export const DUNGEON_SCALE = 0.5;

/** Стены набора рассчитаны на ближнюю камеру; в изометрии верх не закрывает ход. */
export const DUNGEON_HEIGHT_SCALE = 0.62;

/** Геометрия модели: основание на y = 0, центр по x и z, заданная высота. */
export function dungeonGeometry(name: DungeonModelName, height: number): THREE.BufferGeometry {
  const key = `${name}@${height}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const model = DUNGEON_MODELS[name];
  const geometry = bakedGeometry([{ model, palette: DUNGEON_PALETTE }], fitOf(model, height));
  cache.set(key, geometry);
  return geometry;
}

/** Модульная архитектура в едином масштабе, с основанием на y=0. */
export function dungeonModuleGeometry(name: DungeonModelName): THREE.BufferGeometry {
  const key = `${name}@module`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const model = DUNGEON_MODELS[name];
  const geometry = bakedGeometry([{ model, palette: DUNGEON_PALETTE }], {
    scale: DUNGEON_SCALE,
    shift: [
      (model.min[0] + model.max[0]) / 2,
      model.min[1],
      (model.min[2] + model.max[2]) / 2,
    ],
  });
  geometry.scale(1, DUNGEON_HEIGHT_SCALE, 1);
  cache.set(key, geometry);
  return geometry;
}

/** Сундук заданного вида. Высота — доля клетки, чтобы читался предметом. */
export const chestGeometry = (look: ChestLook, height: number): THREE.BufferGeometry =>
  dungeonGeometry(CHEST_MODEL[look], height);

/** Материал для запечённых моделей: цвет приходит из вершин, а не из карты. */
export const dungeonMaterial = bakedMaterial;
