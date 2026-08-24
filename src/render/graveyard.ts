import * as THREE from 'three';
import { bakedGeometry, bakedMaterial, fitOf, type Fit } from './baked';
import { GRAVEYARD_MODELS, GRAVEYARD_SLOTS } from './graveyard.data';
import type { GraveyardPartModelName } from './graveyard.data';
import { FENCE_CELL } from '../sim/fence';
import type { CryptStyle } from '../sim/graveSite';
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

/**
 * Масштаб сборных склепов один на корпус, крышу и дверь. При 1,4 малый
 * склеп с крышей вырастает до 2,46 клетки — практически ровно прежние 2,4,
 * — а большой сохраняет измеренную набором дополнительную длину.
 */
export const CRYPT_SCALE = 1.4;

const move = (x: number, y: number, z: number): readonly number[] => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  x, y, z, 1,
];

/** Цельная геометрия одного варианта: детали уже совмещены до инстансинга. */
export function cryptGeometry(style: CryptStyle): THREE.BufferGeometry {
  const key = `crypt:${style.body}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  // Старый и два низких склепа — законченные модели. Им по-прежнему нужна
  // нормализация предмета, но низкие варианты остаются заметно ниже здания.
  if (style.roof === null || style.door === null) {
    const geometry = graveyardGeometry(
      style.body as GraveyardPartModelName,
      style.body === 'crypt' ? 2.4 : 1.7,
    );
    cache.set(key, geometry);
    return geometry;
  }

  const body = GRAVEYARD_MODELS[style.body as GraveyardPartModelName];
  const roof = GRAVEYARD_MODELS[style.roof as GraveyardPartModelName];
  const door = GRAVEYARD_MODELS[style.door as GraveyardPartModelName];
  const geometry = bakedGeometry([
    { model: body, palette: GRAVEYARD_PALETTE },
    { model: roof, palette: GRAVEYARD_PALETTE, matrix: move(0, body.max[1], 0) },
    // Локальный фасад смотрит в −z; вся сборка затем поворачивается к воротам.
    { model: door, palette: GRAVEYARD_PALETTE, matrix: move(0, 0, body.min[2] - 0.01) },
  ], { scale: CRYPT_SCALE, shift: [0, 0, 0] });
  cache.set(key, geometry);
  return geometry;
}

/** Материал запечённых моделей: цвет приходит из вершин, а не из карты. */
export const graveyardMaterial = bakedMaterial;
