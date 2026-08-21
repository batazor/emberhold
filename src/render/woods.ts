import type * as THREE from 'three';
import { forestGeometry } from './forest';
import type { ForestModelName } from './forest';
import { graveyardGeometry } from './graveyard';
import type { GraveyardPartModelName } from './graveyard';

/**
 * Порода дерева — и единственное место, где два набора моделей встречаются
 * в одном лесу (§6.1.1, §6.1.7).
 *
 * Раньше лес был одного набора, и списки пород были просто списками имён.
 * Набор кладбища принёс хвою, которой у KayKit в бесплатном тарифе нет
 * вовсе, — и лиственный лес поляны получил четыре хвойных породы. Смешение
 * безопасно ровно потому, что оба набора запечены в **одну палитру** (§6.1):
 * цвет приходит вершинами из одного списка на игру, и рядом стоящие ель
 * и берёза покрашены одними и теми же зелёными.
 *
 * Пенёк — тоже порода, и это не натяжка: он занимает место дерева, ставится
 * тем же способом и отличается только тем, что через него видно и по нему
 * ходят.
 */
export type Tree =
  | { readonly set: 'forest'; readonly model: ForestModelName }
  | { readonly set: 'grave'; readonly model: GraveyardPartModelName };

export const forest = (model: ForestModelName): Tree => ({ set: 'forest', model });
export const grave = (model: GraveyardPartModelName): Tree => ({ set: 'grave', model });

/** Геометрия породы заданной высоты. Кэш общий у обоих наборов, свой на набор. */
export const treeGeometry = (tree: Tree, height: number): THREE.BufferGeometry =>
  tree.set === 'forest' ? forestGeometry(tree.model, height) : graveyardGeometry(tree.model, height);

/**
 * Породы поляны и лагеря — один список на оба места. Это решение §6.1.1,
 * а не совпадение: герой выходит из этого леса и в нём же встаёт лагерем,
 * и разными породами это читалось бы как два разных места.
 *
 * Четыре лиственные — из набора леса, четыре хвойные — из набора кладбища.
 * Осенняя хвоя оранжевая только в своём наборе: оранжевой листвы в палитре
 * нет, и она уходит в дерево (§6.1.7). Породы от этого не становится меньше:
 * силуэт у неё свой, а читается силуэт раньше цвета (§15).
 */
export const WOODS: readonly Tree[] = [
  forest('Tree_1_A_Color1'),
  forest('Tree_2_B_Color1'),
  forest('Tree_4_A_Color1'),
  forest('Tree_Bare_2_B_Color1'),
  grave('pine'),
  grave('pine-crooked'),
  grave('pine-fall'),
  grave('pine-fall-crooked'),
];

/**
 * Пенёк, который остаётся от срубленного дерева (§13.3). Один на все места,
 * где рубят: просека обязана выглядеть одинаково везде, иначе она читается
 * не как след топора, а как свойство места.
 */
export const STUMP: Tree = grave('trunk');

/** Высота пенька в клетках локации: герою чуть выше колена. */
export const STUMP_HEIGHT = 0.42;
