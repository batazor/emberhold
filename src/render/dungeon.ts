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
 * Пока из двухсот моделей набора игра берёт две — сундуки. Простой стоит
 * хранилищем в лагере и приманкой в замке, золотой — редкая находка
 * яруса 3. Оба запечены закрытыми: крышка вливается в корпус на сборке,
 * и «вскрытие» показывает симуляция, а не петля.
 */
export type { DungeonModelName };

/** Вид сундука → модель набора. Ключи — рабочие слова, не лор (§0.1). */
export const CHEST_MODEL = {
  'простой': 'chest',
  'золотой': 'chest_gold',
} as const satisfies Record<string, DungeonModelName>;

export type ChestLook = keyof typeof CHEST_MODEL;

const cache = new Map<string, THREE.BufferGeometry>();

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

/** Сундук заданного вида. Высота — доля клетки, чтобы читался предметом. */
export const chestGeometry = (look: ChestLook, height: number): THREE.BufferGeometry =>
  dungeonGeometry(CHEST_MODEL[look], height);

/** Материал для запечённых моделей: цвет приходит из вершин, а не из карты. */
export const dungeonMaterial = bakedMaterial;
