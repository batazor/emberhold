import * as THREE from 'three';
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

/** Выбор варианта от координаты: без RNG, чтобы вид не зависел от порядка.
 *  Общий у вылазки и лагеря — лес обязан совпадать сам с собой между сценами. */
export const cellHash = (a: number, b: number, mod: number): number =>
  Math.floor(((((Math.sin(a + b) * 43758.5453) % 1) + 1) % 1) * mod) % mod;

/**
 * Матрица дерева (или валуна кромки) на клетке. Всё выведено из координаты —
 * тот же приём, что у выбора модели: лес обязан совпадать сам с собой между
 * заходами и сценами. Лагерь стоит на той же поляне, где герой ходил в
 * прологе (§16.1), и его лес — буквально тот же лес: клетка в клетку,
 * поворот в поворот. `turn` сдвигает вывод для дерева, вставшего на место
 * срубленного на кромке: рубят там вечно, и стоять на месте упавшего
 * обязан не он сам.
 */
export function treeStand(x: number, z: number, tree: boolean, turn: number): THREE.Matrix4 {
  const dummy = new THREE.Object3D();
  const t = ((Math.sin(x * 3.1 + z * 7.7 + turn * 2.3) * 1000) % 1 + 1) % 1;
  // Дерево ростом с камень читалось бы кустом: тот же размах,
  // что у леса вокруг лагеря, иначе это два разных леса.
  const s = tree ? 1.9 + t * 1.1 : 0.85 + t * 0.55;
  dummy.position.set(x + (t - 0.5) * 0.22, tree ? -0.05 : -0.12, z + (t - 0.5) * 0.18);
  dummy.rotation.set(0, t * 6.28, 0);
  dummy.scale.set(s, s * (tree ? 0.9 + t * 0.25 : 0.8 + t * 0.5), s);
  dummy.updateMatrix();
  return dummy.matrix.clone();
}
