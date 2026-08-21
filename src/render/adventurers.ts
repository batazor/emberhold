import * as THREE from 'three';
import { ADVENTURERS_MODELS, ADVENTURERS_SLOTS } from './adventurers.data';
import type { AdventurerModel, AdventurerModelName } from './adventurers.data';
import { bakedGeometry, fitOf } from './baked';
import { skinnedGeometry } from './rigged';
import type { RiggedParts } from './rigged';
import type { BakedModel, Part } from './baked';
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

/**
 * Предмет в правой руке. Набор у него свой: оружие приезжает
 * из `weapons.data.ts` (§6.1.8), а рука — из этого набора, и палитра
 * у каждого своя, потому что порядок слотов у наборов разный.
 *
 * Имя нужно кэшу: две модели с одинаковым ключом слиплись бы в одну,
 * и уровень оружия перестал бы меняться на глазах.
 */
export interface Held {
  readonly name: string;
  readonly model: BakedModel;
  readonly palette: readonly number[];
}

/**
 * Предмет из этого же набора: реквизит персонажей (мечи, луки, кружки) едет
 * вместе с ними и красится их палитрой. Оружие героя приезжает из своего
 * набора (§6.1.8) и собирается там же — здесь остаётся то, у чего своего
 * набора нет.
 */
export const adventurerHeld = (name: AdventurerModelName): Held => ({
  name,
  model: ADVENTURERS_MODELS[name],
  palette: ADVENTURERS_PALETTE,
});

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
  holds?: Held,
): THREE.BufferGeometry {
  const key = `${name}+${holds?.name ?? ''}@${height}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const model: AdventurerModel = ADVENTURERS_MODELS[name];
  const parts: Part[] = [{ model, palette: ADVENTURERS_PALETTE }];
  if (holds !== undefined) {
    const hand = model.hand?.['handslot.r'];
    if (hand === undefined) throw new Error(`у модели ${name} нет узла правой руки`);
    parts.push({ model: holds.model, palette: holds.palette, matrix: hand });
  }

  const geometry = bakedGeometry(parts, fitOf(model, height));
  cache.set(key, geometry);
  return geometry;
}

const rigCache = new Map<string, RiggedParts>();

/**
 * Та же модель со скином: героя тоже двигают кости, а не подмена кадра.
 * Рук две (§14.2) — правая держит оружие, левая щит, факел или вторую
 * половину лука, — и обе ставятся по узлам самого набора.
 */
export function adventurerParts(
  name: AdventurerModelName,
  height: number,
  right?: Held,
  left?: Held,
): RiggedParts {
  const key = `${name}+${right?.name ?? ''}+${left?.name ?? ''}@${height}`;
  const hit = rigCache.get(key);
  if (hit !== undefined) return hit;

  const model: AdventurerModel = ADVENTURERS_MODELS[name];
  const held = (which?: Held): THREE.BufferGeometry | undefined =>
    which === undefined
      ? undefined
      : bakedGeometry([{ model: which.model, palette: which.palette }]);

  const hold: Record<string, THREE.BufferGeometry> = {};
  const r = held(right);
  const l = held(left);
  if (r !== undefined) hold['handslot.r'] = r;
  if (l !== undefined) hold['handslot.l'] = l;

  const parts: RiggedParts = {
    body: skinnedGeometry([{ model, palette: ADVENTURERS_PALETTE }]),
    ...(Object.keys(hold).length === 0 ? {} : { hold }),
    fit: fitOf(model, height),
  };
  rigCache.set(key, parts);
  return parts;
}
