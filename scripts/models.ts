/**
 * Обмер и запекание готового набора моделей (§6.1: «готовые наборы теперь
 * применимы», формат glTF, плоское затенение без текстур, палитра обязательна).
 *
 * Набор KayKit Forest Nature Pack раскрашен одним градиентным атласом. Это
 * прямо противоречит «нет текстурных ассетов», поэтому цвет снимается с атласа
 * здесь, на запекании: треугольник получает слот палитры, а картинка в игру
 * не едет вовсе. Слот — это индекс, цвет ему назначает render/palette.ts,
 * то есть палитра остаётся одним списком и правится в одном месте.
 *
 * Запуск:
 *   npm run models            — отчёт: треугольники, габариты, куда легли цвета
 *   npm run models -- --write — переписать src/render/forest.data.ts и каталог
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const PACK = join(ROOT, 'assets/kaykit-forest');
const GLTF_DIR = join(PACK, 'gltf');

/* ---------- палитра: слоты, которые набор получает взамен атласа ---------- */

/**
 * Атлас набора — три градиента (листва, кора, камень) и четвёртый, серый:
 * незакрашенные слоты, из которых платные тарифы делают цветовые варианты.
 * Каждый градиент режется на четыре ступени — это и есть плоское затенение
 * из §6.1: у модели ровно столько цветов, сколько ступеней она задела.
 *
 * Имена ступеней — из палитры артбука (artbook.html, группы «Растительность»,
 * «Земля и дерево», «Камень и соль»). Здесь только имена: hex живёт
 * в render/palette.ts, потому что палитра — один список на игру, а не два.
 */
const RAMPS = [
  { id: 'leaf', title: 'листва', slots: ['хвоя-тень', 'хвоя', 'мох', 'трава'] },
  { id: 'bark', title: 'кора', slots: ['земля', 'дерево-тень', 'дерево', 'дерево-свет'] },
  { id: 'stone', title: 'камень', slots: ['камень', 'камень-свет', 'скол', 'соль-тень'] },
] as const;

const SLOTS: string[] = RAMPS.flatMap((r) => r.slots);

/* ---------- png ---------- */

interface Image {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 байта на пиксель. */
  readonly rgba: Uint8Array;
}

/**
 * Минимальный декодер PNG: 8 бит на канал, без чересстрочности — ровно то,
 * чем является атлас. Внешней зависимости ради одной картинки не берём.
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
interface Gltf {
  accessors: Accessor[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { uri?: string; byteLength: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
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

interface Mesh {
  /** Треугольники подряд: 9 чисел (три вершины) на треугольник. */
  readonly positions: Float64Array;
  /** UV центра треугольника: 2 числа на треугольник. */
  readonly uvs: Float64Array;
  readonly tris: number;
  readonly verts: number;
}

function loadMesh(file: string): Mesh {
  const gltf = JSON.parse(readFileSync(file, 'utf8')) as Gltf;
  const uri = gltf.buffers[0]?.uri;
  if (uri === undefined) throw new Error(`${basename(file)}: буфер без uri`);
  const bin = readFileSync(join(file, '..', decodeURIComponent(uri)));

  const positions: number[] = [];
  const uvs: number[] = [];
  let verts = 0;

  for (const mesh of gltf.meshes) {
    for (const prim of mesh.primitives) {
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
          positions.push(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
          cu += uv[v * 2]!;
          cv += uv[v * 2 + 1]!;
        }
        uvs.push(cu / 3, cv / 3);
      }
    }
  }
  return {
    positions: Float64Array.from(positions),
    uvs: Float64Array.from(uvs),
    tris: uvs.length / 2,
    verts,
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

type RampId = (typeof RAMPS)[number]['id'];

/**
 * Какой градиент атласа задет. Серый (насыщенность около нуля) — это пустые
 * слоты набора под платные цветовые варианты; в бесплатном тарифе туда
 * попадают редкие треугольники, и им честнее всего лечь в камень.
 */
function rampOf(r: number, g: number, b: number): RampId {
  const { hue, sat } = hueSat(r, g, b);
  if (sat < 0.08) return 'stone';
  if (hue >= 60 && hue < 170) return 'leaf';
  if (hue < 60 || hue >= 330) return 'bark';
  return 'stone';
}

/** Диапазон яркости каждого градиента — свойство самого атласа, не моделей. */
function rampRanges(atlas: Image): Record<RampId, { min: number; max: number }> {
  const out: Record<string, { min: number; max: number }> = {};
  for (const r of RAMPS) out[r.id] = { min: 1, max: 0 };
  for (let i = 0; i < atlas.width * atlas.height; i++) {
    const r = atlas.rgba[i * 4]!;
    const g = atlas.rgba[i * 4 + 1]!;
    const b = atlas.rgba[i * 4 + 2]!;
    const { sat } = hueSat(r, g, b);
    // Серое поле атласа — это заготовка под платные варианты, а не градиент:
    // его яркость растянула бы шкалу камня на весь диапазон.
    if (sat < 0.08) continue;
    const band = out[rampOf(r, g, b)]!;
    const l = luminance(r, g, b);
    if (l < band.min) band.min = l;
    if (l > band.max) band.max = l;
  }
  return out as Record<RampId, { min: number; max: number }>;
}

interface Sampler {
  slotOf(u: number, v: number): number;
  colorAt(u: number, v: number): [number, number, number];
}

function makeSampler(atlas: Image): Sampler {
  const ranges = rampRanges(atlas);
  const base = new Map<RampId, number>();
  let at = 0;
  for (const r of RAMPS) {
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
      const ramp = rampOf(r, g, b);
      const steps = RAMPS.find((x) => x.id === ramp)!.slots.length;
      const { min, max } = ranges[ramp];
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
  /** Треугольники, попавшие в серое поле атласа — пустые слоты набора. */
  readonly grey: number;
}

function bake(file: string, sampler: Sampler): Baked {
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
    if (hueSat(c[0], c[1], c[2]).sat < 0.08) grey++;
  }

  return {
    name,
    category: name.split('_')[0]!,
    tris: mesh.tris,
    verts: mesh.verts,
    min,
    max,
    pos,
    slot,
    grey,
  };
}

/* ---------- что берёт игра ---------- */

/**
 * Взятое из набора. Список короткий намеренно: запечённая геометрия едет
 * в бандл, и каждая лишняя модель — килобайты у всех игроков, а не файл
 * на диске. Варианты нужны только чтобы соседние камни не были близнецами.
 *
 * Деревьев в вылазке нет и не будет: локация — соляные копи (§12.1), под
 * землёй лес не растёт. Деревья стоят вокруг лагеря, который на поляне.
 */
const ADOPTED = [
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
] as const;

const b64 = (data: Int16Array | Uint8Array): string =>
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');

function writeData(models: Baked[]): string {
  const chosen = ADOPTED.map((name) => {
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
export interface ForestModel {
  readonly tris: number;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** base64 Int16Array: 9 чисел на треугольник, три несклеенные вершины. */
  readonly pos: string;
  /** base64 Uint8Array: индекс в FOREST_SLOTS, один на треугольник. */
  readonly slot: string;
}

/** Порядок слотов — контракт с render/palette.ts. */
export const FOREST_SLOTS = [
${SLOTS.map((s) => `  '${s}',`).join('\n')}
] as const;

export const FOREST_MODELS = {
${body}
} satisfies Record<string, ForestModel>;

export type ForestModelName = keyof typeof FOREST_MODELS;
`;
}

/* ---------- отчёт ---------- */

const atlas = decodePng(join(PACK, 'forest_texture.png'));
const sampler = makeSampler(atlas);
const files = readdirSync(GLTF_DIR)
  .filter((f) => f.endsWith('.gltf'))
  .sort()
  .map((f) => join(GLTF_DIR, f));

if (files.length === 0) {
  console.error(`Набор не найден: ${GLTF_DIR}`);
  process.exit(1);
}

const models = files.map((f) => bake(f, sampler));
const write = process.argv.includes('--write');

const byCategory = new Map<string, Baked[]>();
for (const m of models) {
  const list = byCategory.get(m.category) ?? [];
  list.push(m);
  byCategory.set(m.category, list);
}

console.log(`Набор: ${models.length} моделей, атлас ${atlas.width}×${atlas.height}\n`);
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
const perSlot = new Array<number>(SLOTS.length).fill(0);
for (const m of models) for (const s of m.slot) perSlot[s] = perSlot[s]! + 1;
console.log('\nтреугольников по слотам палитры:');
let at = 0;
for (const ramp of RAMPS) {
  const parts = ramp.slots.map((name, i) => {
    const share = ((perSlot[at + i]! / totalTris) * 100).toFixed(1);
    return `${name} ${share}%`;
  });
  console.log(`  ${ramp.title.padEnd(8)} ${parts.join(' · ')}`);
  at += ramp.slots.length;
}

const grey = models.reduce((s, m) => s + m.grey, 0);
console.log(
  `\nв сером поле атласа (пустые слоты набора): ${grey} треугольников` +
    ` — ${((grey / totalTris) * 100).toFixed(1)}%`,
);

// §6.1 задаёт бюджеты герою, врагу и зданию. Растительности бюджета не было —
// её и меряем: сравнивать окружение с героем нечестно, но потолок нужен.
const BUDGET = 1500;
const over = models.filter((m) => m.tris > BUDGET);
console.log(
  `\nтяжелее ${BUDGET} треугольников: ${over.length}` +
    (over.length > 0 ? ` (${over.map((m) => `${m.name} ${m.tris}`).join(', ')})` : ''),
);

const adopted = models.filter((m) => (ADOPTED as readonly string[]).includes(m.name));
const adoptedTris = adopted.reduce((s, m) => s + m.tris, 0);
const bytes = adopted.reduce((s, m) => s + m.pos.byteLength + m.slot.byteLength, 0);
console.log(
  `\nберёт игра: ${adopted.length} моделей, ${adoptedTris} треугольников, ` +
    `${Math.round((bytes / 1024) * 10) / 10} КБ в бандле (base64 ≈ ${Math.round((bytes * 1.34) / 1024)} КБ)`,
);

if (!write) {
  console.log('\n(--write не задан: файлы не тронуты)');
  process.exit(0);
}

writeFileSync(join(ROOT, 'src/render/forest.data.ts'), writeData(models), 'utf8');

// Каталог для forestart.html: страница берёт геометрию из самих .gltf, а отсюда —
// числа и разметку цветов, чтобы не повторять запекание вторым кодом.
const catalog = {
  pack: 'KayKit Forest Nature Pack 1.0 FREE',
  license: 'CC0',
  atlas: { width: atlas.width, height: atlas.height },
  slots: SLOTS,
  ramps: RAMPS.map((r) => ({
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
          // Серое поле атласа — заготовка под платные варианты, а не градиент:
          // его большинством голосов оно бы выиграло у настоящих цветов.
          if (hueSat(c[0], c[1], c[2]).sat < 0.08) continue;
          if (sampler.slotOf(u, v) !== SLOTS.indexOf(r.slots[i]!)) continue;
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
  adopted: ADOPTED,
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
};
writeFileSync(join(PACK, 'catalog.json'), JSON.stringify(catalog), 'utf8');

console.log('\nзаписано: src/render/forest.data.ts, assets/kaykit-forest/catalog.json');
