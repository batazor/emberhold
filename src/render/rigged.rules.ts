/**
 * Правило привязки скина. Скелет собирается в игре из запечённых чисел, и
 * обратные матрицы привязки `THREE.Skeleton` выводит сам — из мировых матриц
 * костей, какими они окажутся в момент вызова конструктора. Если поза к тому
 * моменту не посчитана, он молча выводит их из единичных: ошибки нет, скин
 * остаётся в позе набора, а кости едут по нему — руки уходят в тело, ноги
 * в пол. Глазом это читается как «сломана анимация», а сломана привязка.
 *
 * Проверяется не картинка, а тождество: в позе привязки скин обязан
 * совпасть с моделью набора, приведённой тем же `fit`, каким игра ставит
 * модель, — до нуля, а не «на глаз похоже».
 *
 * Запуск: npm run check
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as THREE from 'three';
import { CLASS_ORDER } from '../sim/heroes';
import type { RaidEnemyKind } from '../sim/types';
import { enemyParts, heroParts } from './models';
import { WEAPON_LADDER } from './weapons';
import { WEAPONS_MODELS } from './weapons.data';
import { Rigged } from './rigged';
import type { RiggedParts } from './rigged';

const ENEMY_KINDS: readonly RaidEnemyKind[] = ['minion', 'warrior', 'mage'];

/**
 * Сколько единиц набора вершине позволено разойтись с поставленной моделью.
 *
 * Порог — шаг квантования веса, а не круглое число. Вес пишется в байт
 * (`npm run models`), то есть с точностью 1/255, и вершина, у которой веса
 * делятся между костями, в позе привязки промахивается на половину шага,
 * умноженную на её плечо. Замерено: у моделей с целыми весами расхождение
 * порядка 1e-8, у Ranger — 1,9e-3. Это пол точности, а не ошибка.
 *
 * Настоящая ошибка привязки — обратные матрицы из единичных, перепутанный
 * порядок костей, потерянный скиннинг — двигает вершину на десятые доли
 * и выше, то есть на два порядка дальше этого порога. Он остаётся сторожем
 * ровно того, ради чего заведён.
 *
 * Прежнее значение 1e-4 держалось на том, что все взятые модели имели веса
 * 1 и 0. Первая же модель со смешанными весами его пробила.
 */
const EXACT = 4e-3;

/** Расхождение скина в позе привязки с моделью, приведённой тем же fit. */
function bindError(parts: RiggedParts): number {
  const rig = new Rigged(parts, new THREE.MeshBasicMaterial());
  let skin: THREE.SkinnedMesh | null = null;
  rig.root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skin = o as THREE.SkinnedMesh;
  });
  assert.ok(skin !== null, 'у особи нет меша со скином');
  const mesh: THREE.SkinnedMesh = skin;
  const { skeleton } = mesh;

  rig.root.updateMatrixWorld(true);
  skeleton.update();

  const pos = mesh.geometry.getAttribute('position');
  const si = mesh.geometry.getAttribute('skinIndex');
  const sw = mesh.geometry.getAttribute('skinWeight');
  const { fit } = parts;
  const v = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let worst = 0;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    acc.set(0, 0, 0);
    // То же смешивание, что делает шейдер: кость на обратную матрицу привязки.
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w === 0) continue;
      const b = si.getComponent(i, k);
      m.multiplyMatrices(skeleton.bones[b]!.matrixWorld, skeleton.boneInverses[b]!);
      acc.add(tmp.copy(v).applyMatrix4(m).multiplyScalar(w));
    }
    tmp.set(
      (v.x - fit.shift[0]) * fit.scale,
      (v.y - fit.shift[1]) * fit.scale,
      (v.z - fit.shift[2]) * fit.scale,
    );
    worst = Math.max(worst, acc.distanceTo(tmp));
  }

  rig.dispose();
  return worst;
}

describe('привязка скина', () => {
  test('обратные матрицы выведены из позы, а не из единичных', () => {
    const parts = enemyParts('minion');
    const rig = new Rigged(parts, new THREE.MeshBasicMaterial());
    let skin: THREE.SkinnedMesh | null = null;
    rig.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skin = o as THREE.SkinnedMesh;
    });
    const inverses = (skin as unknown as THREE.SkinnedMesh).skeleton.boneInverses;
    const unit = new THREE.Matrix4();
    const single = inverses.filter((x) => x.equals(unit)).length;
    assert.equal(single, 0, `единичных обратных матриц: ${single} из ${inverses.length}`);
    rig.dispose();
  });

  for (const kind of ENEMY_KINDS) {
    test(`противник ${kind}: скин стоит в позе привязки`, () => {
      assert.ok(bindError(enemyParts(kind)) < EXACT);
    });
  }

  for (const cls of CLASS_ORDER) {
    const parts = heroParts(cls);
    if (parts === null) continue;
    test(`герой ${cls}: скин стоит в позе привязки`, () => {
      assert.ok(bindError(parts) < EXACT);
    });
  }

  /**
   * Вылазка берёт героя со скином, а не неподвижной геометрией, и предмет
   * в руке у неё свой меш (§6.1.8). Проверяется, что уровень доходит и сюда:
   * иначе клинок менялся бы в лагере и не менялся в вылазке — а это ровно
   * тот случай, когда «в игре» и «на экране» расходятся молча.
   */
  test('клинок §14 доезжает до вылазки, а не только до лагеря', () => {
    const held = WEAPON_LADDER.map((_, level) => {
      const parts = heroParts('knight', level);
      assert.ok(parts !== null && parts.hold?.['handslot.r'] !== undefined, `уровень ${level}: рука пустая`);
      const count = parts.hold?.['handslot.r'].index!.count / 3;
      parts.hold?.['handslot.r'].dispose();
      return count;
    });
    for (let level = 0; level < WEAPON_LADDER.length; level++) {
      assert.equal(
        held[level],
        WEAPONS_MODELS[WEAPON_LADDER[level]!].tris,
        `уровень ${level}: в руке не та модель`,
      );
    }
  });
});
