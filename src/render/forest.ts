import * as THREE from 'three';
import { FOREST_MODELS, FOREST_SLOTS } from './forest.data';
import type { ForestModelName } from './forest.data';
import { FOREST_PALETTE } from './palette';

/**
 * Готовые модели набора KayKit Forest в виде геометрии three (§6.1).
 *
 * Ни текстуры, ни загрузчика glTF в игре нет: `scripts/models.ts` заранее
 * разложил модель на треугольники и слоты палитры, а здесь слот превращается
 * в цвет вершины. Отсюда три следствия — модели доступны синхронно, весь набор
 * перекрашивается правкой FOREST_PALETTE, и плоское затенение получается само:
 * вершины не склеены, поэтому нормаль у каждого треугольника своя.
 */
if (FOREST_PALETTE.length !== FOREST_SLOTS.length) {
  throw new Error(
    `палитра моделей рассинхронизирована: слотов ${FOREST_SLOTS.length}, цветов ${FOREST_PALETTE.length}`,
  );
}

export type { ForestModelName };

function decode(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const cache = new Map<string, THREE.BufferGeometry>();

/**
 * Геометрия модели, приведённая к игре: основание на y = 0, центр по x и z,
 * заданная высота. Набор нарисован в своём масштабе — дерево там 4 единицы
 * при клетке в одну, — и приводить его на месте использования означало бы
 * разбросать по коду магические множители.
 */
export function forestGeometry(name: ForestModelName, height: number): THREE.BufferGeometry {
  const key = `${name}@${height}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const model = FOREST_MODELS[name];
  const pos = new Int16Array(decode(model.pos).buffer);
  const slot = decode(model.slot);

  const span = [
    model.max[0] - model.min[0],
    model.max[1] - model.min[1],
    model.max[2] - model.min[2],
  ];
  const scale = span[1]! > 0 ? height / span[1]! : 1;
  // Сдвиг в единицах модели: по горизонтали в центр габарита, по вертикали в пол.
  const shift = [(model.min[0] + model.max[0]) / 2, model.min[1], (model.min[2] + model.max[2]) / 2];

  const positions = new Float32Array(model.tris * 9);
  const colors = new Float32Array(model.tris * 9);
  const color = new THREE.Color();

  for (let t = 0; t < model.tris; t++) {
    color.setHex(FOREST_PALETTE[slot[t]!] ?? 0xff00ff);
    for (let v = 0; v < 3; v++) {
      const at = t * 9 + v * 3;
      for (let c = 0; c < 3; c++) {
        // Обратное квантование: 16 бит на ось внутри габаритов модели.
        const unit = (pos[at + c]! + 32767) / 65534;
        positions[at + c] = (model.min[c]! + unit * span[c]! - shift[c]!) * scale;
      }
      colors[at] = color.r;
      colors[at + 1] = color.g;
      colors[at + 2] = color.b;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  cache.set(key, geometry);
  return geometry;
}

/** Материал для запечённых моделей: цвет приходит из вершин, а не из карты. */
export function forestMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}
