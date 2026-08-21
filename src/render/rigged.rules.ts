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
import { enemyParts, heroParts, settlerParts } from './models';
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

  /**
   * Поселенец у прогалины сидит, и «сидит» обязано быть видно числом,
   * а не на глаз: клип, который не опустил особь на землю, снаружи читается
   * как «стоит навытяжку», и разницу в пять сантиметров экрана глазом
   * не поймать. Замер: бёдра 0,272 в покое против 0,058 сидя, голова
   * 0,851 против 0,611 — особь ниже себя стоящей больше чем на четверть.
   *
   * Второе число важнее первого. У `Sit_Floor_Down`/`StandUp` в каталоге
   * набора смещение корня 0,44 и 0,38 — на глаз это половина клетки,
   * и поселенец, севший на одну клетку и вставший на другой, читался бы
   * рывком. В единицах мира, после `fit`, это **0,083 клетки**, а круг
   * «покой → сидит → встаёт → покой» возвращает особь ровно в точку старта.
   * Порог 0,25 клетки — четверть, дальше сдвиг видно.
   */
  test('сидящий сидит на земле и встаёт на своей клетке', () => {
    const rig = new Rigged(settlerParts('плут'), new THREE.MeshBasicMaterial());
    const at = (name: string): THREE.Matrix4 => {
      rig.root.updateMatrixWorld(true);
      const bone = rig.root.getObjectByName(name);
      assert.ok(bone !== undefined, `нет кости ${name}`);
      return bone.matrixWorld;
    };
    const y = (name: string): number => at(name).elements[13]!;
    const ground = (name: string): [number, number] => {
      const m = at(name).elements;
      return [m[12]!, m[14]!];
    };
    const run = (seconds: number): void => {
      for (let t = 0; t < seconds; t += 1 / 60) rig.update(1 / 60);
    };

    rig.play('покой');
    run(1.2);
    const standHips = y('hips');
    const standHead = y('head');
    const start = ground('hips');

    rig.play('сидит');
    run(3);
    assert.ok(
      standHips - y('hips') > standHips * 0.5,
      `сидя бёдра ${y('hips').toFixed(3)} против ${standHips.toFixed(3)} стоя — клип не опустил особь`,
    );
    assert.ok(standHead - y('head') > 0.15, 'сидя голова почти на той же высоте — сидящий не читается');
    const sat = ground('hips');

    rig.play('встаёт');
    run(1.4);
    const up = ground('hips');
    assert.ok(
      Math.hypot(up[0] - sat[0], up[1] - sat[1]) < 0.25,
      'вставание уводит с клетки больше чем на четверть — снаружи это рывок',
    );

    rig.play('покой');
    run(0.5);
    const back = ground('hips');
    assert.ok(
      Math.hypot(back[0] - start[0], back[1] - start[1]) < 0.25,
      'круг «покой → сидит → встаёт → покой» не вернул особь на место',
    );
    rig.dispose();
  });
});
