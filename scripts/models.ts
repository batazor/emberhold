/**
 * Обмер и запекание готовых наборов моделей (§6.1: «готовые наборы теперь
 * применимы», формат glTF, плоское затенение без текстур, палитра обязательна).
 *
 * Наборов два: KayKit Forest (§6.1.1) и KayKit Dungeon (§6.1.2). Оба раскрашены
 * атласом — это прямо противоречит «нет текстурных ассетов», поэтому цвет
 * снимается с атласа здесь, на запекании: треугольник получает слот палитры,
 * а картинка в игру не едет вовсе. Слот — это индекс, цвет ему назначает
 * render/palette.ts, то есть палитра остаётся одним списком и правится
 * в одном месте.
 *
 * Набор с пустым `adopted` измеряется, но в бандл не едет: каталог и страница
 * артбука есть, запечённой геометрии нет. Это состояние «набор взвешен,
 * решение не принято», а не недоделка.
 *
 * Запуск:
 *   npm run models                    — отчёт: треугольники, габариты, цвета
 *   npm run models -- --pack=dungeon  — то же по одному набору
 *   npm run models -- --write         — переписать каталоги и forest.data.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');

/* ---------- наборы: чем набор описывается ---------- */

/**
 * Насыщенность, ниже которой цвет считается серым. Серое не участвует
 * в замере диапазонов яркости: у леса это пустое поле атласа под платные
 * варианты, у подземелья — белая ткань и чёрные решётки. И то и другое
 * растянуло бы шкалу градиента на весь диапазон.
 */
const GREY = 0.08;

interface Ramp {
  readonly id: string;
  readonly title: string;
  /** Ступени градиента: имена слотов палитры, от тёмной к светлой. */
  readonly slots: readonly string[];
  /** Окно оттенка в градусах, [от, до); `от > до` — окно через ноль. */
  readonly hue: readonly [number, number];
  /** Окно насыщенности, [от, до] включительно; спор решает порядок объявления. */
  readonly sat: readonly [number, number];
}

interface Pack {
  readonly id: string;
  /** Как набор называется в каталоге и в реестре лицензий. */
  readonly title: string;
  readonly dir: string;
  readonly atlas: string;
  /** Порядок важен: слоты нумеруются подряд, ramps[0].slots идут с нуля. */
  readonly ramps: readonly Ramp[];
  /** Куда падает всё, что не попало ни в одно окно, — включая серое. */
  readonly fallback: string;
  readonly categoryOf: (name: string) => string;
  /** Что берёт игра. Пустой список — набор измерен, но в бандл не едет. */
  readonly adopted: readonly string[];
  /** Файл запечённой геометрии; без него набор остаётся каталогом. */
  readonly data?: { readonly file: string; readonly prefix: string; readonly type: string };
}

/**
 * Атлас леса — три градиента (листва, кора, камень) и четвёртый, серый:
 * незакрашенные слоты, из которых платные тарифы делают цветовые варианты.
 * Каждый градиент режется на четыре ступени — это и есть плоское затенение
 * из §6.1: у модели ровно столько цветов, сколько ступеней она задела.
 *
 * Имена ступеней — из палитры артбука (artbook.html, группы «Растительность»,
 * «Земля и дерево», «Камень и соль»). Здесь только имена: hex живёт
 * в render/palette.ts, потому что палитра — один список на игру, а не два.
 */
const FOREST: Pack = {
  id: 'forest',
  title: 'KayKit Forest Nature Pack 1.0 FREE',
  dir: 'assets/kaykit-forest',
  atlas: 'forest_texture.png',
  ramps: [
    { id: 'leaf', title: 'листва', slots: ['хвоя-тень', 'хвоя', 'мох', 'трава'], hue: [60, 170], sat: [GREY, 1] },
    { id: 'bark', title: 'кора', slots: ['земля', 'дерево-тень', 'дерево', 'дерево-свет'], hue: [330, 60], sat: [GREY, 1] },
    { id: 'stone', title: 'камень', slots: ['камень', 'камень-свет', 'скол', 'соль-тень'], hue: [170, 330], sat: [GREY, 1] },
  ],
  fallback: 'stone',
  categoryOf: (name) => name.split('_')[0]!,
  /**
   * Взятое из набора. Список короткий намеренно: запечённая геометрия едет
   * в бандл, и каждая лишняя модель — килобайты у всех игроков, а не файл
   * на диске. Варианты нужны только чтобы соседние камни не были близнецами.
   *
   * Деревьев в вылазке нет и не будет: локация под землёй, там лес не растёт.
   * Деревья стоят вокруг лагеря, который на поляне.
   */
  adopted: [
    'Rock_1_D_Color1',
    'Rock_1_E_Color1',
    'Rock_1_G_Color1',
    'Rock_2_D_Color1',
    'Rock_3_G_Color1',
    'Rock_3_H_Color1',
    'Tree_1_A_Color1',
    'Tree_2_B_Color1',
    'Tree_4_A_Color1',
    'Tree_Bare_2_B_Color1',
  ],
  data: { file: 'src/render/forest.data.ts', prefix: 'FOREST', type: 'Forest' },
};

/** Категория подземелья — по первому слову имени файла набора. */
const DUNGEON_CATEGORIES: Record<string, string> = {
  wall: 'Стены',
  pillar: 'Стены',
  column: 'Стены',
  barrier: 'Стены',
  ceiling: 'Стены',
  floor: 'Полы',
  rubble: 'Полы',
  stairs: 'Лестницы',
  barrel: 'Тара',
  box: 'Тара',
  chest: 'Тара',
  crates: 'Тара',
  keg: 'Тара',
  trunk: 'Тара',
  shelf: 'Тара',
  shelves: 'Тара',
  table: 'Мебель',
  chair: 'Мебель',
  stool: 'Мебель',
  bed: 'Мебель',
  bottle: 'Утварь',
  plate: 'Утварь',
  candle: 'Утварь',
  torch: 'Утварь',
  coin: 'Утварь',
  key: 'Утварь',
  keyring: 'Утварь',
  sword: 'Утварь',
  banner: 'Знамёна',
};

/**
 * Атлас подземелья устроен иначе, чем лесной: это не три градиента, а
 * раскрашенная картинка — 1148 разных цветов попадает под треугольники.
 * Поэтому окна заданы и по оттенку, и по насыщенности: золото отличается
 * от дерева не тоном, а тем, что оно втрое насыщеннее.
 *
 * Первые двенадцать слотов — те же, что у леса, и в том же порядке: палитра
 * одна на игру, и второй набор обязан ложиться в неё, а не заводить свою.
 * Последние четыре — то, чего в палитре нет; сколько это стоит, считает
 * отчёт и показывает dungeon.html.
 */
const DUNGEON: Pack = {
  id: 'dungeon',
  title: 'KayKit Dungeon Pack 1.1 FREE',
  dir: 'assets/kaykit-dungeon',
  atlas: 'dungeon_texture.png',
  ramps: [
    { id: 'moss', title: 'зелень', slots: ['хвоя-тень', 'хвоя', 'мох', 'трава'], hue: [70, 200], sat: [0.3, 1] },
    { id: 'wood', title: 'дерево', slots: ['земля', 'дерево-тень', 'дерево', 'дерево-свет'], hue: [330, 50], sat: [GREY, 0.62] },
    { id: 'stone', title: 'камень', slots: ['камень', 'камень-свет', 'скол', 'соль-тень'], hue: [200, 330], sat: [GREY, 0.62] },
    { id: 'gold', title: 'золото', slots: ['золото-тень', 'золото'], hue: [20, 70], sat: [0.62, 1] },
    { id: 'cloth', title: 'ткань', slots: ['ткань-тень', 'ткань'], hue: [200, 20], sat: [0.62, 1] },
  ],
  fallback: 'stone',
  categoryOf: (name) => DUNGEON_CATEGORIES[name.split('_')[0]!] ?? 'Прочее',
  /**
   * Пусто, и это решение, а не пропуск: набор измерен, страница есть, в бандл
   * не едет ничего. Что из подземелья заслуживает килобайтов у всех игроков —
   * вопрос к тому дню, когда вылазке понадобится не камень, а предмет.
   */
  adopted: [],
};

const PACKS: readonly Pack[] = [FOREST, DUNGEON];

/* ---------- png ---------- */

interface Image {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 байта на пиксель. */
  readonly rgba: Uint8Array;
}

/**
 * Минимальный декодер PNG: 8 бит на канал, без чересстрочности — ровно то,
 * чем являются оба атласа. Внешней зависимости ради двух картинок не берём.
 */
function decodePng(file: string): Image {
  const buf = readFileSync(file);
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Buffer[] = [];

  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8]!;
      const colorType = data[9]!;
      if (depth !== 8) throw new Error(`PNG: глубина ${depth}, ожидалось 8`);
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType as 0 | 2 | 4 | 6] ?? 0;
      if (channels === 0) throw new Error(`PNG: тип цвета ${colorType} не поддержан`);
      if (data[12] !== 0) throw new Error('PNG: чересстрочный не поддержан');
    } else if (type === 'IDAT') {
      parts.push(Buffer.from(data));
    } else if (type === 'IEND') break;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  let read = 0;
  let prev = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[read++]!;
    const line = new Uint8Array(raw.subarray(read, read + stride));
    read += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      let value = line[x]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = value & 255;
    }
    out.set(line, y * stride);
    prev = line;
  }

  if (channels === 4) return { width, height, rgba: out };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    rgba[i * 4] = out[s]!;
    rgba[i * 4 + 1] = out[s + (channels >= 3 ? 1 : 0)]!;
    rgba[i * 4 + 2] = out[s + (channels >= 3 ? 2 : 0)]!;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

/* ---------- glTF ---------- */

interface Accessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3';
  min?: number[];
  max?: number[];
}
interface Node {
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}
interface Gltf {
  accessors: Accessor[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { uri?: string; byteLength: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  nodes?: Node[];
  scenes?: { nodes: number[] }[];
  scene?: number;
}

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3 };

function readAccessor(gltf: Gltf, bin: Buffer, index: number): Float64Array {
  const acc = gltf.accessors[index]!;
  const view = gltf.bufferViews[acc.bufferView]!;
  const size = TYPE_SIZE[acc.type]!;
  const compSize = COMPONENT_SIZE[acc.componentType]!;
  const stride = view.byteStride ?? size * compSize;
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Float64Array(acc.count * size);

  for (let i = 0; i < acc.count; i++) {
    const at = start + i * stride;
    for (let c = 0; c < size; c++) {
      const o = at + c * compSize;
      out[i * size + c] =
        acc.componentType === 5126
          ? bin.readFloatLE(o)
          : acc.componentType === 5125
            ? bin.readUInt32LE(o)
            : acc.componentType === 5123
              ? bin.readUInt16LE(o)
              : bin.readUInt8(o);
    }
  }
  return out;
}

/** Матрица 4×4 по столбцам — как её задаёт glTF. */
type Mat4 = readonly number[];

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/**
 * Собственный трансформ узла. У леса его нет ни у одной модели, у подземелья
 * есть у четырёх — крышка сундука и створка двери вынесены отдельными узлами,
 * чтобы их можно было анимировать. Игнорировать трансформ значит собрать
 * сундук с крышкой внутри ящика, поэтому обмер ходит по сцене, а не по мешам.
 */
function localOf(node: Node): Mat4 {
  if (node.matrix !== undefined) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const rot = [
    1 - 2 * (y! * y! + z! * z!), 2 * (x! * y! + z! * w!), 2 * (x! * z! - y! * w!),
    2 * (x! * y! - z! * w!), 1 - 2 * (x! * x! + z! * z!), 2 * (y! * z! + x! * w!),
    2 * (x! * z! + y! * w!), 2 * (y! * z! - x! * w!), 1 - 2 * (x! * x! + y! * y!),
  ];
  return [
    rot[0]! * sx!, rot[1]! * sx!, rot[2]! * sx!, 0,
    rot[3]! * sy!, rot[4]! * sy!, rot[5]! * sy!, 0,
    rot[6]! * sz!, rot[7]! * sz!, rot[8]! * sz!, 0,
    tx!, ty!, tz!, 1,
  ];
}

interface Mesh {
  /** Треугольники подряд: 9 чисел (три вершины) на треугольник. */
  readonly positions: Float64Array;
  /** UV центра треугольника: 2 числа на треугольник. */
  readonly uvs: Float64Array;
  readonly tris: number;
  readonly verts: number;
  /** Узлов с собственным трансформом — их и ради них ходим по сцене. */
  readonly moved: number;
}

function loadMesh(file: string): Mesh {
  const gltf = JSON.parse(readFileSync(file, 'utf8')) as Gltf;
  const uri = gltf.buffers[0]?.uri;
  if (uri === undefined) throw new Error(`${basename(file)}: буфер без uri`);
  const bin = readFileSync(join(file, '..', decodeURIComponent(uri)));

  const positions: number[] = [];
  const uvs: number[] = [];
  let verts = 0;
  let moved = 0;

  const takeMesh = (index: number, world: Mat4): void => {
    for (const prim of gltf.meshes[index]!.primitives) {
      const posIndex = prim.attributes['POSITION'];
      const uvIndex = prim.attributes['TEXCOORD_0'];
      if (posIndex === undefined || uvIndex === undefined || prim.indices === undefined) continue;
      const pos = readAccessor(gltf, bin, posIndex);
      const uv = readAccessor(gltf, bin, uvIndex);
      const idx = readAccessor(gltf, bin, prim.indices);
      verts += gltf.accessors[posIndex]!.count;
      for (let i = 0; i < idx.length; i += 3) {
        let cu = 0;
        let cv = 0;
        for (let k = 0; k < 3; k++) {
          const v = idx[i + k]!;
          const p = [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!];
          for (let c = 0; c < 3; c++) {
            positions.push(world[c]! * p[0]! + world[4 + c]! * p[1]! + world[8 + c]! * p[2]! + world[12 + c]!);
          }
          cu += uv[v * 2]!;
          cv += uv[v * 2 + 1]!;
        }
        uvs.push(cu / 3, cv / 3);
      }
    }
  };

  const walk = (index: number, parent: Mat4): void => {
    const node = gltf.nodes?.[index];
    if (node === undefined) return;
    const local = localOf(node);
    if (local !== IDENTITY && JSON.stringify(local) !== JSON.stringify(IDENTITY)) moved++;
    const world = multiply(parent, local);
    if (node.mesh !== undefined) takeMesh(node.mesh, world);
    for (const child of node.children ?? []) walk(child, world);
  };

  const scene = gltf.scenes?.[gltf.scene ?? 0];
  if (scene === undefined) {
    // Сцены нет — набор отдал голые меши; берём их как есть, без трансформа.
    for (let i = 0; i < gltf.meshes.length; i++) takeMesh(i, IDENTITY);
  } else {
    for (const root of scene.nodes) walk(root, IDENTITY);
  }

  return {
    positions: Float64Array.from(positions),
    uvs: Float64Array.from(uvs),
    tris: uvs.length / 2,
    verts,
    moved,
  };
}

/* ---------- цвет атласа → слот палитры ---------- */

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Оттенок в градусах и насыщенность 0..1 — только чтобы опознать градиент. */
function hueSat(r: number, g: number, b: number): { hue: number; sat: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { hue: 0, sat: 0 };
  let hue: number;
  if (max === r) hue = ((g - b) / d + 6) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return { hue: hue * 60, sat: d / max };
}

/**
 * Какой градиент задет. Окна не пересекаются, поэтому порядок объявления
 * ничего не решает; всё, что мимо окон, — включая серое — идёт в запасной.
 */
function rampOf(pack: Pack, r: number, g: number, b: number): string {
  const { hue, sat } = hueSat(r, g, b);
  for (const ramp of pack.ramps) {
    if (sat < ramp.sat[0] || sat > ramp.sat[1]) continue;
    const [lo, hi] = ramp.hue;
    const inside = lo < hi ? hue >= lo && hue < hi : hue >= lo || hue < hi;
    if (inside) return ramp.id;
  }
  return pack.fallback;
}

/** Диапазон яркости каждого градиента — свойство самого атласа, не моделей. */
function rampRanges(pack: Pack, atlas: Image): Record<string, { min: number; max: number }> {
  const out: Record<string, { min: number; max: number }> = {};
  for (const r of pack.ramps) out[r.id] = { min: 1, max: 0 };
  for (let i = 0; i < atlas.width * atlas.height; i++) {
    const r = atlas.rgba[i * 4]!;
    const g = atlas.rgba[i * 4 + 1]!;
    const b = atlas.rgba[i * 4 + 2]!;
    if (hueSat(r, g, b).sat < GREY) continue;
    const band = out[rampOf(pack, r, g, b)]!;
    const l = luminance(r, g, b);
    if (l < band.min) band.min = l;
    if (l > band.max) band.max = l;
  }
  return out;
}

interface Sampler {
  slotOf(u: number, v: number): number;
  colorAt(u: number, v: number): [number, number, number];
}

function makeSampler(pack: Pack, atlas: Image): Sampler {
  const ranges = rampRanges(pack, atlas);
  const base = new Map<string, number>();
  let at = 0;
  for (const r of pack.ramps) {
    base.set(r.id, at);
    at += r.slots.length;
  }

  const colorAt = (u: number, v: number): [number, number, number] => {
    // UV в glTF считаются от левого верхнего угла — это и есть порядок строк
    // в PNG, поэтому v не переворачивается.
    const x = Math.min(atlas.width - 1, Math.max(0, Math.floor(u * atlas.width)));
    const y = Math.min(atlas.height - 1, Math.max(0, Math.floor(v * atlas.height)));
    const o = (y * atlas.width + x) * 4;
    return [atlas.rgba[o]!, atlas.rgba[o + 1]!, atlas.rgba[o + 2]!];
  };

  return {
    colorAt,
    slotOf(u, v) {
      const [r, g, b] = colorAt(u, v);
      const ramp = rampOf(pack, r, g, b);
      const steps = pack.ramps.find((x) => x.id === ramp)!.slots.length;
      const { min, max } = ranges[ramp]!;
      const t = max > min ? (luminance(r, g, b) - min) / (max - min) : 0;
      const step = Math.min(steps - 1, Math.max(0, Math.round(t * (steps - 1))));
      return base.get(ramp)! + step;
    },
  };
}

/* ---------- запекание ---------- */

interface Baked {
  readonly name: string;
  readonly category: string;
  readonly tris: number;
  readonly verts: number;
  readonly min: [number, number, number];
  readonly max: [number, number, number];
  /** Позиции, 16 бит на ось в габаритах модели: 9 чисел на треугольник. */
  readonly pos: Int16Array;
  /** Слот палитры, один байт на треугольник. */
  readonly slot: Uint8Array;
  /** Треугольники, попавшие в серое поле атласа. */
  readonly grey: number;
  /** Узлов с собственным трансформом. */
  readonly moved: number;
}

function bake(pack: Pack, file: string, sampler: Sampler): Baked {
  const name = basename(file, '.gltf');
  const mesh = loadMesh(file);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const value = mesh.positions[i + c]!;
      if (value < min[c]!) min[c] = value;
      if (value > max[c]!) max[c] = value;
    }
  }

  const pos = new Int16Array(mesh.tris * 9);
  const span = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const t = span[c]! > 0 ? (mesh.positions[i + c]! - min[c]!) / span[c]! : 0;
      pos[i + c] = Math.round(t * 65534) - 32767;
    }
  }

  const slot = new Uint8Array(mesh.tris);
  let grey = 0;
  for (let t = 0; t < mesh.tris; t++) {
    const u = mesh.uvs[t * 2]!;
    const v = mesh.uvs[t * 2 + 1]!;
    slot[t] = sampler.slotOf(u, v);
    const c = sampler.colorAt(u, v);
    if (hueSat(c[0], c[1], c[2]).sat < GREY) grey++;
  }

  return {
    name,
    category: pack.categoryOf(name),
    tris: mesh.tris,
    verts: mesh.verts,
    min,
    max,
    pos,
    slot,
    grey,
    moved: mesh.moved,
  };
}

const b64 = (data: Int16Array | Uint8Array): string =>
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');

function writeData(pack: Pack, models: Baked[]): string {
  const data = pack.data!;
  const slots = pack.ramps.flatMap((r) => r.slots);
  const chosen = pack.adopted.map((name) => {
    const m = models.find((x) => x.name === name);
    if (m === undefined) throw new Error(`в наборе нет модели ${name}`);
    return m;
  });

  const round = (v: number): number => Math.round(v * 1000) / 1000;
  const body = chosen
    .map((m) => {
      const fields = [
        `    tris: ${m.tris},`,
        `    min: [${m.min.map(round).join(', ')}],`,
        `    max: [${m.max.map(round).join(', ')}],`,
        `    pos: '${b64(m.pos)}',`,
        `    slot: '${b64(m.slot)}',`,
      ];
      return `  '${m.name}': {\n${fields.join('\n')}\n  },`;
    })
    .join('\n');

  return `/* СГЕНЕРИРОВАНО \`npm run models -- --write\`. Руками не править. */

/**
 * Геометрия принятых моделей набора KayKit Forest (CC0, см. assets/LICENSES.md),
 * запечённая по §6.1: без текстур, цвет — слот палитры на треугольник.
 * Позиции упакованы в 16 бит на ось в габаритах модели (min/max).
 */
export interface ${data.type}Model {
  readonly tris: number;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** base64 Int16Array: 9 чисел на треугольник, три несклеенные вершины. */
  readonly pos: string;
  /** base64 Uint8Array: индекс в ${data.prefix}_SLOTS, один на треугольник. */
  readonly slot: string;
}

/** Порядок слотов — контракт с render/palette.ts. */
export const ${data.prefix}_SLOTS = [
${slots.map((s) => `  '${s}',`).join('\n')}
] as const;

export const ${data.prefix}_MODELS = {
${body}
} satisfies Record<string, ${data.type}Model>;

export type ${data.type}ModelName = keyof typeof ${data.prefix}_MODELS;
`;
}

/**
 * Каталог для страницы артбука: геометрию она берёт из самих .gltf, а отсюда —
 * числа и разметку цветов, чтобы не повторять запекание вторым кодом.
 */
function writeCatalog(pack: Pack, atlas: Image, sampler: Sampler, models: Baked[]): string {
  const slots = pack.ramps.flatMap((r) => r.slots);
  return JSON.stringify({
    pack: pack.title,
    license: 'CC0',
    atlas: { width: atlas.width, height: atlas.height },
    slots,
    ramps: pack.ramps.map((r) => ({
      id: r.id,
      title: r.title,
      slots: r.slots,
      // Цвет из атласа, который лёг в каждую ступень: это и есть «было → стало».
      source: r.slots.map((_, i) => {
        let best: [number, number, number] = [0, 0, 0];
        let bestCount = 0;
        const counts = new Map<string, number>();
        for (let y = 0; y < atlas.height; y += 2) {
          for (let x = 0; x < atlas.width; x += 2) {
            const u = (x + 0.5) / atlas.width;
            const v = (y + 0.5) / atlas.height;
            const c = sampler.colorAt(u, v);
            // Серое поле не участвует: большинством голосов оно выиграло бы
            // у настоящих цветов градиента.
            if (hueSat(c[0], c[1], c[2]).sat < GREY) continue;
            if (sampler.slotOf(u, v) !== slots.indexOf(r.slots[i]!)) continue;
            const key = c.join(',');
            const n = (counts.get(key) ?? 0) + 1;
            counts.set(key, n);
            if (n > bestCount) {
              bestCount = n;
              best = c;
            }
          }
        }
        return `#${best.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
      }),
    })),
    adopted: pack.adopted,
    models: models.map((m) => ({
      name: m.name,
      category: m.category,
      tris: m.tris,
      verts: m.verts,
      size: [m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]].map(
        (v) => Math.round(v * 100) / 100,
      ),
      slot: b64(m.slot),
    })),
  });
}

/* ---------- отчёт ---------- */

// §6.1 задаёт бюджеты герою, врагу и зданию. Окружению бюджета не было —
// его и меряем: сравнивать окружение с героем нечестно, но потолок нужен.
const BUDGET = 1500;

function report(pack: Pack, write: boolean): void {
  const dir = join(ROOT, pack.dir);
  const gltfDir = join(dir, 'gltf');
  const atlas = decodePng(join(dir, pack.atlas));
  const sampler = makeSampler(pack, atlas);
  const files = readdirSync(gltfDir)
    .filter((f) => f.endsWith('.gltf'))
    .sort()
    .map((f) => join(gltfDir, f));

  if (files.length === 0) {
    console.error(`Набор не найден: ${gltfDir}`);
    process.exit(1);
  }

  const models = files.map((f) => bake(pack, f, sampler));
  const slots = pack.ramps.flatMap((r) => r.slots);

  const byCategory = new Map<string, Baked[]>();
  for (const m of models) {
    const list = byCategory.get(m.category) ?? [];
    list.push(m);
    byCategory.set(m.category, list);
  }

  console.log(`\n${pack.title}: ${models.length} моделей, атлас ${atlas.width}×${atlas.height}\n`);
  console.log('категория   моделей  треугольников   средн.   макс.  самая тяжёлая');
  for (const [cat, list] of [...byCategory].sort()) {
    const total = list.reduce((s, m) => s + m.tris, 0);
    const worst = list.reduce((a, b) => (a.tris > b.tris ? a : b));
    console.log(
      `${cat.padEnd(11)} ${String(list.length).padStart(5)} ${String(total).padStart(14)}` +
        ` ${String(Math.round(total / list.length)).padStart(8)} ${String(worst.tris).padStart(7)}  ${worst.name}`,
    );
  }

  const totalTris = models.reduce((s, m) => s + m.tris, 0);
  console.log(`\nвсего треугольников: ${totalTris}`);

  // Куда легли цвета: если набор массово падает в один слот, палитра врёт.
  const perSlot = new Array<number>(slots.length).fill(0);
  for (const m of models) for (const s of m.slot) perSlot[s] = perSlot[s]! + 1;
  console.log('\nтреугольников по слотам палитры:');
  let at = 0;
  for (const ramp of pack.ramps) {
    const parts = ramp.slots.map((name, i) => {
      const share = ((perSlot[at + i]! / totalTris) * 100).toFixed(1);
      return `${name} ${share}%`;
    });
    console.log(`  ${ramp.title.padEnd(8)} ${parts.join(' · ')}`);
    at += ramp.slots.length;
  }

  const grey = models.reduce((s, m) => s + m.grey, 0);
  console.log(
    `\nв сером поле атласа (насыщенность ниже ${GREY * 100}%): ${grey} треугольников` +
      ` — ${((grey / totalTris) * 100).toFixed(1)}%`,
  );

  const moved = models.filter((m) => m.moved > 0);
  console.log(
    `узлов с собственным трансформом: ${moved.reduce((s, m) => s + m.moved, 0)}` +
      (moved.length > 0 ? ` (${moved.map((m) => m.name).join(', ')})` : ''),
  );

  const over = models.filter((m) => m.tris > BUDGET);
  console.log(
    `\nтяжелее ${BUDGET} треугольников: ${over.length}` +
      (over.length > 0 ? ` (${over.map((m) => `${m.name} ${m.tris}`).join(', ')})` : ''),
  );

  if (pack.adopted.length === 0) {
    console.log('\nберёт игра: ничего — набор измерен, в бандл не едет (§6.1.2)');
  } else {
    const adopted = models.filter((m) => pack.adopted.includes(m.name));
    const adoptedTris = adopted.reduce((s, m) => s + m.tris, 0);
    const bytes = adopted.reduce((s, m) => s + m.pos.byteLength + m.slot.byteLength, 0);
    console.log(
      `\nберёт игра: ${adopted.length} моделей, ${adoptedTris} треугольников, ` +
        `${Math.round((bytes / 1024) * 10) / 10} КБ в бандле (base64 ≈ ${Math.round((bytes * 1.34) / 1024)} КБ)`,
    );
  }

  if (!write) return;

  const written: string[] = [];
  if (pack.data !== undefined && pack.adopted.length > 0) {
    writeFileSync(join(ROOT, pack.data.file), writeData(pack, models), 'utf8');
    written.push(pack.data.file);
  }
  const catalog = join(pack.dir, 'catalog.json');
  writeFileSync(join(ROOT, catalog), writeCatalog(pack, atlas, sampler, models), 'utf8');
  written.push(catalog);
  console.log(`\nзаписано: ${written.join(', ')}`);
}

const write = process.argv.includes('--write');
const only = process.argv.find((a) => a.startsWith('--pack='))?.slice('--pack='.length);
const chosen = only === undefined ? PACKS : PACKS.filter((p) => p.id === only);

if (chosen.length === 0) {
  console.error(`Набора «${only}» нет. Есть: ${PACKS.map((p) => p.id).join(', ')}`);
  process.exit(1);
}

for (const pack of chosen) report(pack, write);

if (!write) console.log('\n(--write не задан: файлы не тронуты)');
