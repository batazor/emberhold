import * as THREE from 'three';

/**
 * Распаковка запечённых наборов (§6.1). Наборов в игре два — лес и скелеты, —
 * а код распаковки один: писал оба файла один и тот же `npm run models`,
 * и второй разбор разошёлся бы с первым молча.
 *
 * Ни текстуры, ни загрузчика glTF в игре нет: `scripts/models.ts` заранее
 * разложил модель на треугольники и слоты палитры, а здесь слот превращается
 * в цвет вершины. Отсюда три следствия — модели доступны синхронно, набор
 * перекрашивается правкой палитры, и плоское затенение получается само:
 * вершины не склеены, поэтому нормаль у каждого треугольника своя.
 */
export interface BakedModel {
  readonly tris: number;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** base64 Int16Array: 9 чисел на треугольник, три несклеенные вершины. */
  readonly pos: string;
  /** base64 Uint8Array: индекс в палитре набора, один на треугольник. */
  readonly slot: string;
  /** Мировая матрица руки в единицах набора; есть только у моделей со скелетом. */
  readonly hand?: readonly number[];
}

/** Часть будущей геометрии: что рисуем, чем красим и куда ставим. */
export interface Part {
  readonly model: BakedModel;
  readonly palette: readonly number[];
  /** Матрица 4×4 по столбцам, как её задаёт glTF. Без неё — свои координаты. */
  readonly matrix?: readonly number[];
}

function decode(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Позиции модели в единицах набора: 9 чисел на треугольник. */
function positionsOf(part: Part): Float64Array {
  const { model, matrix } = part;
  const packed = new Int16Array(decode(model.pos).buffer);
  const span = [
    model.max[0] - model.min[0],
    model.max[1] - model.min[1],
    model.max[2] - model.min[2],
  ];
  const out = new Float64Array(model.tris * 9);

  for (let i = 0; i < out.length; i += 3) {
    const p = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      // Обратное квантование: 16 бит на ось внутри габаритов модели.
      const unit = (packed[i + c]! + 32767) / 65534;
      p[c] = model.min[c]! + unit * span[c]!;
    }
    for (let c = 0; c < 3; c++) {
      out[i + c] = matrix === undefined
        ? p[c]!
        : matrix[c]! * p[0]! + matrix[4 + c]! * p[1]! + matrix[8 + c]! * p[2]! + matrix[12 + c]!;
    }
  }
  return out;
}

/**
 * Геометрия частей, приведённая к игре: основание на y = 0, центр по x и z,
 * заданная высота. Набор нарисован в своём масштабе — дерево там 4 единицы
 * при клетке в одну, — и приводить его на месте использования означало бы
 * разбросать по коду магические множители.
 *
 * Рост считается по первой части и только по ней. Древко в руке торчит выше
 * головы, и если мерить по нему, скелет с посохом окажется ниже голого ровно
 * настолько, насколько длинный у него посох.
 */
export function bakedGeometry(parts: readonly Part[], height: number): THREE.BufferGeometry {
  const first = parts[0]!.model;
  const span = [
    first.max[0] - first.min[0],
    first.max[1] - first.min[1],
    first.max[2] - first.min[2],
  ];
  const scale = span[1]! > 0 ? height / span[1]! : 1;
  // Сдвиг в единицах набора: по горизонтали в центр габарита, по вертикали в пол.
  const shift = [(first.min[0] + first.max[0]) / 2, first.min[1], (first.min[2] + first.max[2]) / 2];

  const tris = parts.reduce((sum, p) => sum + p.model.tris, 0);
  const positions = new Float32Array(tris * 9);
  const colors = new Float32Array(tris * 9);
  const color = new THREE.Color();
  let at = 0;

  for (const part of parts) {
    const source = positionsOf(part);
    const slot = decode(part.model.slot);
    for (let t = 0; t < part.model.tris; t++) {
      color.setHex(part.palette[slot[t]!] ?? 0xff00ff);
      for (let v = 0; v < 3; v++) {
        const to = at + t * 9 + v * 3;
        const from = t * 9 + v * 3;
        for (let c = 0; c < 3; c++) positions[to + c] = (source[from + c]! - shift[c]!) * scale;
        colors[to] = color.r;
        colors[to + 1] = color.g;
        colors[to + 2] = color.b;
      }
    }
    at += part.model.tris * 9;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Материал для запечённых моделей: цвет приходит из вершин, а не из карты. */
export function bakedMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}
