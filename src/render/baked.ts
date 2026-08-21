import * as THREE from 'three';

/**
 * Распаковка запечённых наборов (§6.1). Наборов в игре два — лес и скелеты, —
 * а код распаковки один: писал оба файла один и тот же `npm run models`,
 * и второй разбор разошёлся бы с первым молча.
 *
 * Ни текстуры, ни загрузчика glTF в игре нет: `scripts/models.ts` заранее
 * разложил модель на вершины и слоты палитры, а здесь слот превращается
 * в цвет вершины. Отсюда следствия — модели доступны синхронно, набор
 * перекрашивается правкой палитры, и никакой асинхронности при входе в сцену.
 *
 * Запись индексированная: вершина хранится один раз и переиспользуется
 * соседними треугольниками. Ломается она только на границе слота — три
 * вершины треугольника обязаны быть одного цвета. Плоское затенение при этом
 * даёт материал (`flatShading`), а не несклеенные вершины: считать нормаль
 * по производной в шейдере дешевле, чем возить втрое больше вершин.
 */
export interface BakedModel {
  readonly tris: number;
  readonly verts: number;
  /** Габарит позы привязки: в нём квантованы позиции. */
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** base64 Int16Array: 3 числа на вершину. */
  readonly pos: string;
  /** base64 Uint16Array: 3 индекса на треугольник. */
  readonly idx: string;
  /** base64 Uint8Array: слот палитры, один на треугольник. */
  readonly slot: string;
  /** base64 Uint8Array: до трёх костей на вершину; только у моделей со скином. */
  readonly bone?: string;
  /** base64 Uint8Array: два веса из трёх; третий выводится. */
  readonly weight?: string;
  /** Мировая матрица руки в единицах набора; есть только у моделей со скелетом. */
  /**
   * Мировые матрицы узлов рук в позе запекания. Карта, а не одно поле:
   * рук две (§14.2), и обе живут на одном риге.
   */
  readonly hand?: Readonly<Record<string, readonly number[]>>;
}

/** Часть будущей геометрии: что рисуем, чем красим и куда ставим. */
export interface Part {
  readonly model: BakedModel;
  readonly palette: readonly number[];
  /** Матрица 4×4 по столбцам, как её задаёт glTF. Без неё — свои координаты. */
  readonly matrix?: readonly number[];
  /**
   * Взять только треугольники этих слотов; без поля — все. Нужен модели,
   * у которой часть треугольников живёт другим материалом: плафон фонаря
   * светится ночью, а столб — нет, и делить их надо по слоту, а не второй
   * моделью (§6.1.11 — тем же делением стекло хижины отделено от сруба).
   */
  readonly only?: ReadonlySet<number>;
}

export function decode(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Позиции модели в единицах набора: 3 числа на вершину. */
function positionsOf(part: Part): Float64Array {
  const { model, matrix } = part;
  const packed = new Int16Array(decode(model.pos).buffer);
  const span = [
    model.max[0] - model.min[0],
    model.max[1] - model.min[1],
    model.max[2] - model.min[2],
  ];
  const out = new Float64Array(model.verts * 3);

  for (let v = 0; v < model.verts; v++) {
    const p = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      // Обратное квантование: 16 бит на ось внутри габаритов модели.
      const unit = (packed[v * 3 + c]! + 32767) / 65534;
      p[c] = model.min[c]! + unit * span[c]!;
    }
    for (let c = 0; c < 3; c++) {
      out[v * 3 + c] = matrix === undefined
        ? p[c]!
        : matrix[c]! * p[0]! + matrix[4 + c]! * p[1]! + matrix[8 + c]! * p[2]! + matrix[12 + c]!;
    }
  }
  return out;
}

/** Приведение набора к игре: основание на y = 0, центр по x и z, заданная высота. */
export interface Fit {
  readonly scale: number;
  readonly shift: readonly [number, number, number];
}

/**
 * Как поставить модель в игру. Набор нарисован в своём масштабе — дерево там
 * 4 единицы при клетке в одну, — и приводить его на месте использования
 * означало бы разбросать по коду магические множители.
 *
 * Считается по первой части и только по ней. Древко в руке торчит выше головы,
 * и если мерить по нему, скелет с посохом окажется ниже голого ровно
 * настолько, насколько длинный у него посох.
 */
export function fitOf(model: BakedModel, height: number): Fit {
  const span = model.max[1] - model.min[1];
  return {
    scale: span > 0 ? height / span : 1,
    shift: [
      (model.min[0] + model.max[0]) / 2,
      model.min[1],
      (model.min[2] + model.max[2]) / 2,
    ],
  };
}

/**
 * Геометрия частей. `fit` приводит её к игре сразу; без него вершины остаются
 * в единицах набора — так их берёт скиннинг, который приводит модель
 * трансформом меша, а не правкой вершин.
 */
export function bakedGeometry(parts: readonly Part[], fit?: Fit): THREE.BufferGeometry {
  const verts = parts.reduce((sum, p) => sum + p.model.verts, 0);
  const tris = parts.reduce((sum, p) => sum + p.model.tris, 0);
  const positions = new Float32Array(verts * 3);
  const colors = new Float32Array(verts * 3);
  const indices = new Uint16Array(tris * 3);
  const color = new THREE.Color();
  let vertexAt = 0;
  let indexAt = 0;

  for (const part of parts) {
    const source = positionsOf(part);
    const index = new Uint16Array(decode(part.model.idx).buffer);
    const slot = decode(part.model.slot);

    for (let v = 0; v < part.model.verts; v++) {
      for (let c = 0; c < 3; c++) {
        const value = source[v * 3 + c]!;
        positions[(vertexAt + v) * 3 + c] = fit === undefined
          ? value
          : (value - fit.shift[c]!) * fit.scale;
      }
    }
    // Цвет вершины — цвет её треугольника: вершина сломана по слоту, поэтому
    // второго цвета у неё быть не может. Треугольник чужого слота при фильтре
    // просто не попадает в индекс: вершины остаются, на них никто не ссылается.
    for (let t = 0; t < part.model.tris; t++) {
      if (part.only !== undefined && !part.only.has(slot[t]!)) continue;
      color.setHex(part.palette[slot[t]!] ?? 0xff00ff);
      for (let k = 0; k < 3; k++) {
        const v = vertexAt + index[t * 3 + k]!;
        colors[v * 3] = color.r;
        colors[v * 3 + 1] = color.g;
        colors[v * 3 + 2] = color.b;
        indices[indexAt++] = v;
      }
    }
    vertexAt += part.model.verts;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, indexAt), 1));
  geometry.computeVertexNormals();
  return geometry;
}

/** Материал для запечённых моделей: цвет приходит из вершин, а не из карты,
 *  а плоское затенение — из производной, а не из несклеенных вершин. */
export function bakedMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
}
