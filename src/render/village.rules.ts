import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { VILLAGE_MODELS, VILLAGE_SLOTS } from './village.data';
import { VILLAGE_SLOT_ORDER } from './palette';
import { heroGeometry } from './models';
import {
  DEPTHS, GAME_HUMAN, SPANS, VILLAGE_SCALE, houseGeometry, housePlanOf, houseSpecOf, streetOf,
} from './village';
import type { HouseSpec } from './village';

/**
 * Генератор домов (§6.1) на словаре Medieval Village MegaKit. Проверяется
 * не «красив ли дом», а обещания, которые протухают молча.
 *
 * Первое: словарь замкнут. План называет крышу и фронтон строкой по пролёту
 * и глубине, и модель, выпавшая из `adopted`, обнаружилась бы только кадром
 * с дырой вместо крыши.
 *
 * Второе: дом стоит по сетке. Ширина клетки и высота этажа меряются
 * по запечённой стене, и разъехаться они могут только с самим набором.
 *
 * Третье: масштаб выведен из замера, а не подобран. Человек игры — 1,51,
 * и если героя перерисуют выше, дом обязан узнать об этом здесь, тестом,
 * а не глазом на кадре.
 */

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

describe('Генератор домов: словарь и сетка', () => {
  test('человек игры 1,51 — замер, а не выбор', () => {
    const geo = heroGeometry('knight');
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    assert.ok(Math.abs(b.max.y - b.min.y - GAME_HUMAN) < 0.005, `рыцарь ${(b.max.y - b.min.y).toFixed(3)}`);
    geo.dispose();
  });

  test('под каждый план есть крыша и фронтон', () => {
    for (const span of SPANS) {
      assert.ok(`Roof_Front_Brick${span}` in VILLAGE_MODELS, `нет фронтона на пролёт ${span}`);
      for (const depth of DEPTHS[span]) {
        assert.ok(`Roof_RoundTiles_${span}x${depth}` in VILLAGE_MODELS, `нет черепицы ${span}×${depth}`);
      }
    }
  });

  test('клетка стены — 2 м, этаж — 3,12 м: сетка набора не уехала', () => {
    const wall = VILLAGE_MODELS['Wall_Plaster_Straight'];
    assert.ok(Math.abs(wall.max[0] - wall.min[0] - 2) < 0.01, 'ширина клетки');
    assert.ok(Math.abs(wall.max[1] - 3.123) < 0.01, 'высота этажа');
    // Все стены словаря стоят в одной клетке: чужая по габариту стена
    // порвала бы периметр молча.
    for (const [name, model] of Object.entries(VILLAGE_MODELS)) {
      if (!name.startsWith('Wall_')) continue;
      assert.ok(Math.abs(model.max[0] - model.min[0] - 2) < 0.01, `${name}: ширина`);
      assert.ok(Math.abs(model.max[1] - wall.max[1]) < 0.01, `${name}: высота`);
    }
  });

  test('порядок слотов в палитре — тот же, что в запечённом наборе', () => {
    assert.deepEqual([...VILLAGE_SLOT_ORDER], [...VILLAGE_SLOTS]);
  });
});

describe('Генератор домов: план', () => {
  test('дом из сида воспроизводим', () => {
    for (const seed of [3, 17, 99]) {
      assert.deepEqual(houseSpecOf(seed), houseSpecOf(seed));
    }
  });

  test('дверь одна и на первом этаже', () => {
    for (const seed of SEEDS) {
      const spec = houseSpecOf(seed);
      const doors = spec.bays.flatMap((floorRows, f) =>
        floorRows.flatMap((cells) => cells.filter((b) => b === 'дверь').map(() => f)));
      assert.deepEqual(doors, [0], `сид ${seed}`);
      const leafs = housePlanOf(spec).filter((p) => p.model === 'Door_1_Round');
      assert.equal(leafs.length, 1, `сид ${seed}: полотно`);
    }
  });

  test('каждая деталь плана запечена в бандл', () => {
    for (const seed of SEEDS) {
      for (const part of housePlanOf(houseSpecOf(seed))) {
        assert.ok(part.model in VILLAGE_MODELS, `сид ${seed}: ${part.model}`);
      }
    }
  });

  test('фахверк — примета штукатурки', () => {
    for (const seed of SEEDS) {
      const spec = houseSpecOf(seed);
      if (spec.material === 'штукатурка') continue;
      const timber = spec.bays.flat(2).filter((b) => b === 'фахверк');
      assert.equal(timber.length, 0, `сид ${seed}`);
    }
  });

  test('периметр замкнут: стен ровно по клеткам, углов четыре на этаж', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const spec = houseSpecOf(seed);
      const parts = housePlanOf(spec);
      const cells = (spec.span / 2 + spec.depth / 2) * 2;
      const wallCount = parts.filter((p) => p.model.startsWith('Wall_')).length;
      assert.equal(wallCount, cells * spec.floors, `сид ${seed}: стены`);
      const corners = parts.filter((p) => p.model === 'Corner_Exterior_Wood').length;
      assert.equal(corners, 4 * spec.floors, `сид ${seed}: углы`);
    }
  });
});

describe('Генератор домов: геометрия', () => {
  /** Габарит собранной геометрии. */
  const boundsOf = (spec: HouseSpec): { min: number[]; max: number[] } => {
    const geo = houseGeometry(spec);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    const out = { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
    geo.dispose();
    return out;
  };

  test('дом стоит подошвой на земле и держит план по ширине', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const spec = houseSpecOf(seed);
      const b = boundsOf(spec);
      // Подошва: цоколь стены чуть уходит под ноль, но не глубже фаски.
      assert.ok(b.min[1]! > -0.1 && b.min[1]! < 0.05, `сид ${seed}: подошва ${b.min[1]}`);
      // Ширина: не уже стен и не шире свеса крыши.
      const roof = VILLAGE_MODELS[`Roof_RoundTiles_${spec.span}x${spec.depth}` as keyof typeof VILLAGE_MODELS];
      const wallHalf = (spec.span / 2) * VILLAGE_SCALE;
      const eavesHalf = roof.max[0] * VILLAGE_SCALE;
      assert.ok(b.max[0]! >= wallHalf - 0.01 && b.max[0]! <= eavesHalf + 0.15, `сид ${seed}: ширина ${b.max[0]}`);
    }
  });

  test('высота дома — этажи плюс крыша, в масштабе игры', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const spec = houseSpecOf(seed);
      const b = boundsOf(spec);
      const wall = VILLAGE_MODELS['Wall_Plaster_Straight'];
      const roof = VILLAGE_MODELS[`Roof_RoundTiles_${spec.span}x${spec.depth}` as keyof typeof VILLAGE_MODELS];
      const chimney = VILLAGE_MODELS['Prop_Chimney2'];
      const ridge = spec.floors * wall.max[1] + roof.max[1];
      const top = (ridge + (chimney.max[1] - chimney.min[1]) / 2) * VILLAGE_SCALE;
      assert.ok(Math.abs(b.max[1]! - top) < 0.05, `сид ${seed}: верх ${b.max[1]} ≠ ${top.toFixed(2)}`);
    }
  });
});

describe('Генератор домов: улица', () => {
  test('дома улицы не пересекаются', () => {
    for (const seed of [1, 7, 42]) {
      const street = streetOf(seed, 12);
      const boxes = street.map((h) => {
        // Дом повёрнут на 0 или π: габарит по осям не меняется.
        const w = h.spec.span * VILLAGE_SCALE;
        const d = h.spec.depth * VILLAGE_SCALE;
        return { x0: h.x - w / 2, x1: h.x + w / 2, z0: h.z - d / 2, z1: h.z + d / 2 };
      });
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const apart = a.x1 <= b.x0 + 1e-9 || b.x1 <= a.x0 + 1e-9 || a.z1 <= b.z0 + 1e-9 || b.z1 <= a.z0 + 1e-9;
          assert.ok(apart, `сид ${seed}: дома ${i} и ${j}`);
        }
      }
    }
  });

  test('улица оставляет проезд между порядками', () => {
    const street = streetOf(5, 12);
    for (const h of street) {
      const near = Math.abs(h.z) - (h.spec.depth / 2) * VILLAGE_SCALE;
      assert.ok(near > 1, `дом у ${h.x.toFixed(1)}: до оси ${near.toFixed(2)}`);
    }
  });
});
