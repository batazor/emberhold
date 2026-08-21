import * as THREE from 'three';
import { FOLK_MODELS, FOLK_SLOTS } from './folk.data';
import type { FolkModel, FolkModelName } from './folk.data';
import { bakedGeometry, fitOf } from './baked';
import { skinnedGeometry } from './rigged';
import type { RiggedParts } from './rigged';
import { FOLK_PALETTE } from './palette';

/**
 * Свои модели — жильцы двора (§6.1.6.1): поселенец и торговец. Распаковка
 * общая для всех наборов, `baked.ts`; здесь остаётся то, что относится
 * именно к ним, — их палитра, их имена и кэш.
 *
 * Отличий от чужого набора в коде ровно ноль, и это главное, что здесь стоит
 * знать: своя модель проходит тем же конвейером, что и покупная. Отличие одно
 * и оно не в коде — цвет назван слотом палитры в самом файле модели, поэтому
 * запеканию нечего угадывать (`scripts/models.ts`, набор `folk`).
 *
 * Предмета в руке у жильцов нет: узел `handslot.r` в модели есть, потому что
 * риг общий, но ни поселенцу, ни торговцу вкладывать в кулак нечего.
 * Торговля §13.5 — панель, а не предмет.
 */
if (FOLK_PALETTE.length !== FOLK_SLOTS.length) {
  throw new Error(
    `палитра жильцов рассинхронизирована: слотов ${FOLK_SLOTS.length}, ` +
      `цветов ${FOLK_PALETTE.length}`,
  );
}

export type { FolkModelName };

const cache = new Map<string, THREE.BufferGeometry>();

/**
 * Неподвижная геометрия: основание на y = 0, центр по x и z, заданная высота.
 * Ею рисуются замеры и страницы; во дворе жилец ходит, и там берётся `folkParts`.
 */
export function folkGeometry(name: FolkModelName, height: number): THREE.BufferGeometry {
  const key = `${name}@${height}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const model: FolkModel = FOLK_MODELS[name];
  const geometry = bakedGeometry([{ model, palette: FOLK_PALETTE }], fitOf(model, height));
  cache.set(key, geometry);
  return geometry;
}

const rigCache = new Map<string, RiggedParts>();

/** Та же модель со скином: во дворе жильца двигают кости, а не подмена кадра. */
export function folkParts(name: FolkModelName, height: number): RiggedParts {
  const key = `${name}@${height}`;
  const hit = rigCache.get(key);
  if (hit !== undefined) return hit;

  const model: FolkModel = FOLK_MODELS[name];
  const parts: RiggedParts = {
    body: skinnedGeometry([{ model, palette: FOLK_PALETTE }]),
    fit: fitOf(model, height),
  };
  rigCache.set(key, parts);
  return parts;
}
