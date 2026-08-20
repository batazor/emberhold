import * as THREE from 'three';

/**
 * Общая часть запечённых наборов (§6.1). `scripts/models.ts` разложил модель
 * на треугольники и слоты палитры; здесь слот становится цветом вершины.
 *
 * Ни текстуры, ни загрузчика glTF в игре нет, и три следствия из этого одни
 * и те же для любого набора: модели доступны синхронно, весь набор
 * перекрашивается правкой одного списка цветов, и плоское затенение получается
 * само — вершины не склеены, поэтому нормаль у каждого треугольника своя.
 *
 * Файл появился на третьем наборе. До него та же работа стояла в `forest.ts`
 * и была там уместна: набор был один.
 */
export interface BakedModel {
  readonly tris: number;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** base64 Int16Array: 9 чисел на треугольник, три несклеенные вершины. */
  readonly pos: string;
  /** base64 Uint8Array: индекс в списке слотов, один на треугольник. */
  readonly slot: string;
}

function decode(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Слотов и цветов обязано быть поровну: иначе набор молча красится в фуксию. */
export function checkPalette(what: string, slots: readonly string[], palette: readonly number[]): void {
  if (palette.length !== slots.length) {
    throw new Error(`палитра ${what} рассинхронизирована: слотов ${slots.length}, цветов ${palette.length}`);
  }
}

const cache = new Map<string, THREE.BufferGeometry>();

/**
 * Геометрия модели, приведённая к игре: основание на y = 0, центр по x и z,
 * заданная высота. Наборы нарисованы в своём масштабе — дерево там 4 единицы
 * при клетке в одну, — и приводить его на месте использования означало бы
 * разбросать по коду магические множители.
 */
export function bakedGeometry(
  key: string,
  model: BakedModel,
  palette: readonly number[],
  height: number,
): THREE.BufferGeometry {
  const cacheKey = `${key}@${height}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;

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
    color.setHex(palette[slot[t]!] ?? 0xff00ff);
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
  cache.set(cacheKey, geometry);
  return geometry;
}

/** Материал для запечённых моделей: цвет приходит из вершин, а не из карты. */
export function bakedMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}
