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
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
  /** Окно насыщенности, [от, до] включительно. */
  readonly sat: readonly [number, number];
  /**
   * Окно яркости, [от, до] включительно; без него — вся шкала. Понадобилось
   * третьему набору: кожа отличается от дерева не тоном (и то и другое
   * оранжевое) и не насыщенностью (0,31 против 0,44), а тем, что она светлее
   * всего, что дерево на этом атласе даёт.
   */
  readonly lum?: readonly [number, number];
}

interface Pack {
  readonly id: string;
  /** Как набор называется в каталоге и в реестре лицензий. */
  readonly title: string;
  readonly dir: string;
  /**
   * Папки с моделями внутри `dir`. У леса и подземелья одна, у персонажей две:
   * реквизит лежит в `gltf` парами .gltf + .bin, сами персонажи — в `characters`
   * по одному .glb, где атлас упакован внутрь файла.
   */
  readonly sources: readonly string[];
  /**
   * Атлас набора — ответ для моделей, которые своей картинки не называют:
   * у леса так отдана трава, меш без материала. Персонажи называют атлас
   * каждый свой, и поля у набора нет.
   */
  readonly atlas?: string;
  /**
   * Папка с библиотеками клипов. Их меши моделями набора не считаются: это
   * манекен рига, а не персонаж. Набор без анимаций поля не имеет.
   */
  readonly clips?: string;
  /** Порядок объявления — очерёдность примерки окон: первое подошедшее и берут. */
  readonly ramps: readonly Ramp[];
  /** Нумерация слотов. Отдельно от градиентов: очерёдность примерки и порядок
   *  в палитре — разные вещи, и у подземелья они разошлись. */
  readonly slots: readonly string[];
  /**
   * Откуда берётся шкала яркости градиента: `atlas` — вся картинка, `used` —
   * только те цвета, которые действительно оказались под треугольниками.
   * У леса атлас и есть градиент, у подземелья три четверти картинки не задето
   * ни одной моделью, и шкала по всей картинке врёт.
   */
  readonly range: 'atlas' | 'used';
  /** Куда падает всё, что не попало ни в одно окно, — включая серое. */
  readonly fallback: string;
  readonly categoryOf: (name: string) => string;
  /**
   * Поза, в которой запекается скиннованная модель. Без неё скелет отдаёт позу
   * привязки — руки в стороны, — и в игру такое ставить нельзя. Берётся ключ
   * клипа из библиотеки: не интерполяция, а ровно тот кадр, который нарисован.
   */
  readonly pose?: { readonly library: string; readonly clip: string; readonly key: number };
  /** Раздел DESIGN.md, где записано решение по набору. */
  readonly section: string;
  /**
   * Клипы, которые игре нужны, и то, чем их искать в наборе. Список — из
   * артбука «Скелетные клипы»; регулярка здесь для того, чтобы «в наборе
   * такого клипа нет» было результатом поиска, а не мнением.
   */
  readonly needs?: readonly { readonly title: string; readonly match: RegExp }[];
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
  sources: ['gltf'],
  atlas: 'forest_texture.png',
  ramps: [
    { id: 'leaf', title: 'листва', slots: ['хвоя-тень', 'хвоя', 'мох', 'трава'], hue: [60, 170], sat: [GREY, 1] },
    { id: 'bark', title: 'кора', slots: ['земля', 'дерево-тень', 'дерево', 'дерево-свет'], hue: [330, 60], sat: [GREY, 1] },
    { id: 'stone', title: 'камень', slots: ['камень', 'камень-свет', 'скол', 'соль-тень'], hue: [170, 330], sat: [GREY, 1] },
  ],
  slots: [
    'хвоя-тень', 'хвоя', 'мох', 'трава',
    'земля', 'дерево-тень', 'дерево', 'дерево-свет',
    'камень', 'камень-свет', 'скол', 'соль-тень',
  ],
  range: 'atlas',
  fallback: 'stone',
  section: '6.1.1',
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
 * Атлас подземелья устроен иначе, чем лесной: это не три ровных градиента,
 * а раскрашенная картинка — 1148 разных цветов оказывается под треугольниками.
 * Поэтому окна заданы и по оттенку, и по насыщенности: золото отличается
 * от дерева не тоном (и то и другое — оранжевое), а тем, что оно вдвое
 * насыщеннее. По той же причине окна пересекаются, и порядок примерки решает:
 * золото раньше дерева, иначе дерево забирает его целиком.
 *
 * Слоты — те же двенадцать, что у леса, и в том же порядке: палитра одна
 * на игру, и второй набор обязан ложиться в неё, а не заводить свою.
 * Тринадцатый, «золото», — единственное, чего в списке слотов нет; цвет для
 * него у игры уже есть (PALETTE.loot), не заведён только слот моделей.
 * Синее и алое сукно знамён в такую палитру не ложится вовсе и уходит
 * в камень — это ответ про геральдику, а не дефект набора.
 */
const DUNGEON: Pack = {
  id: 'dungeon',
  title: 'KayKit Dungeon Pack 1.1 FREE',
  dir: 'assets/kaykit-dungeon',
  sources: ['gltf'],
  atlas: 'dungeon_texture.png',
  ramps: [
    { id: 'gold', title: 'золото', slots: ['золото'], hue: [20, 60], sat: [0.62, 1] },
    { id: 'moss', title: 'зелень', slots: ['хвоя-тень', 'хвоя', 'мох', 'трава'], hue: [60, 200], sat: [0.3, 1] },
    { id: 'wood', title: 'дерево', slots: ['земля', 'дерево-тень', 'дерево', 'дерево-свет'], hue: [330, 60], sat: [0.3, 1] },
    { id: 'stone', title: 'камень', slots: ['камень', 'камень-свет', 'скол', 'соль-тень'], hue: [150, 330], sat: [GREY, 0.62] },
  ],
  slots: [
    'хвоя-тень', 'хвоя', 'мох', 'трава',
    'земля', 'дерево-тень', 'дерево', 'дерево-свет',
    'камень', 'камень-свет', 'скол', 'соль-тень',
    'золото',
  ],
  range: 'used',
  fallback: 'stone',
  section: '6.1.2',
  categoryOf: (name) => DUNGEON_CATEGORIES[name.split('_')[0]!] ?? 'Прочее',
  /**
   * Пусто, и это решение, а не пропуск: набор измерен, страница есть, в бандл
   * не едет ничего. Что из подземелья заслуживает килобайтов у всех игроков —
   * вопрос к тому дню, когда вылазке понадобится не камень, а предмет.
   */
  adopted: [],
};

/** Категория персонажей — по первому слову имени файла, регистр не в счёт. */
const ADVENTURER_CATEGORIES: Record<string, string> = {
  barbarian: 'Персонажи',
  knight: 'Персонажи',
  mage: 'Персонажи',
  ranger: 'Персонажи',
  rogue: 'Персонажи',
  axe: 'Ближний бой',
  dagger: 'Ближний бой',
  sword: 'Ближний бой',
  arrow: 'Стрелковое',
  bow: 'Стрелковое',
  crossbow: 'Стрелковое',
  quiver: 'Стрелковое',
  shield: 'Щиты',
  staff: 'Магия',
  wand: 'Магия',
  spellbook: 'Магия',
  mug: 'Прочее',
  smokebomb: 'Прочее',
};

/**
 * Третий набор — и первый, который не про окружение: KayKit Adventurers 2.0
 * (§6.1.3). Отличий от первых двух три, и все три структурные.
 *
 * Первое: атлас не один. У каждого персонажа своя картинка 1024×1024, и модель
 * называет её сама — реквизит ссылкой на соседний файл, персонаж куском внутри
 * своего `.glb`. Шкала яркости при этом остаётся одна на набор: одинаковая кожа
 * обязана попасть в одну ступень, с картинки рыцаря она прочитана или с картинки
 * разбойника.
 *
 * Второе: к двенадцати слотам добавляется не только золото подземелья, но и
 * **кожа**. Отделить её от дерева тоном нельзя — оба оранжевые; насыщенностью
 * тоже (0,31 у кожи против 0,44 у ремня). Отделяет яркость, отсюда третье окно
 * в градиенте. Цвет для слота у игры уже есть — `PALETTE.heroBody`, которым
 * покрашен герой-примитив.
 *
 * Третье: половина набора — не геометрия. Клипы лежат отдельными библиотеками
 * на общий риг, и меряются они отдельно (см. `loadClips`), потому что бюджеты
 * на них заданы не в §6.1, а в артбуке «Скелетные клипы».
 */
const ADVENTURERS: Pack = {
  id: 'adventurers',
  title: 'KayKit Adventurers 2.0 FREE',
  dir: 'assets/kaykit-adventurers',
  sources: ['characters', 'gltf'],
  clips: 'clips',
  ramps: [
    { id: 'skin', title: 'кожа', slots: ['кожа'], hue: [8, 45], sat: [0.22, 0.62], lum: [0.62, 1] },
    { id: 'gold', title: 'золото', slots: ['золото'], hue: [35, 65], sat: [0.55, 1] },
    { id: 'moss', title: 'зелень', slots: ['хвоя-тень', 'хвоя', 'мох', 'трава'], hue: [65, 200], sat: [0.35, 1] },
    // Холодное серое — сталь, а не камень. Окно узкое по тону и с потолком
    // насыщенности: всё, что ярче, — уже не металл, а бирюза разбойника.
    { id: 'steel', title: 'сталь', slots: ['сталь-тень', 'сталь', 'сталь-свет'], hue: [170, 260], sat: [GREY, 0.62] },
    { id: 'wood', title: 'дерево', slots: ['земля', 'дерево-тень', 'дерево', 'дерево-свет'], hue: [330, 65], sat: [0.28, 1] },
    // Тёплое ненасыщенное делится по яркости: светлое — мех и кость, остальное —
    // сукно и войлок. В камень они уходили оба и делали персонажа каменным.
    { id: 'bone', title: 'кость', slots: ['кость'], hue: [300, 70], sat: [GREY, 0.28], lum: [0.55, 1] },
    { id: 'cloth', title: 'сукно', slots: ['сукно-тень', 'сукно', 'сукно-свет'], hue: [300, 70], sat: [GREY, 0.28] },
    // Всё остальное — камень: холодное, нейтральное и вовсе бесцветное.
    { id: 'stone', title: 'камень', slots: ['камень', 'камень-свет', 'скол', 'соль-тень'], hue: [0, 360], sat: [GREY, 0.62] },
  ],
  slots: [
    'хвоя-тень', 'хвоя', 'мох', 'трава',
    'земля', 'дерево-тень', 'дерево', 'дерево-свет',
    'камень', 'камень-свет', 'скол', 'соль-тень',
    'золото', 'кожа',
    'сталь-тень', 'сталь', 'сталь-свет',
    'сукно-тень', 'сукно', 'сукно-свет',
    'кость',
  ],
  range: 'used',
  fallback: 'stone',
  section: '6.1.3',
  /**
   * Ключ покоя. Поза привязки — руки в стороны, её нельзя ставить в лагерь;
   * анимации в игре пока нет, поэтому герой запекается одним нарисованным
   * кадром, а не интерполяцией между двумя.
   */
  pose: { library: 'Rig_Medium_General', clip: 'Idle_A', key: 0 },
  categoryOf: (name) => ADVENTURER_CATEGORIES[name.split('_')[0]!.toLowerCase()!] ?? 'Прочее',
  /**
   * Шесть клипов игры (артбук «Скелетные клипы», раздел 01). Разворот сюда
   * не входит: он поворачивает корень модели, а не играется клипом.
   */
  needs: [
    { title: 'Покой', match: /^idle/i },
    { title: 'Ходьба', match: /^walk/i },
    { title: 'Удар', match: /attack|slash|melee|swing|chop|stab|punch|unarmed/i },
    { title: 'Урон', match: /^hit/i },
    { title: 'Падение', match: /^death|^die/i },
  ],
  /**
   * Взят один персонаж — тот, которым играют с первой вылазки. Остальные пять
   * измерены и ждут: каждый следующий стоит килобайтов у всех игроков, и брать
   * их «на всякий случай» тут ещё дороже, чем в лесу, — персонаж тяжелее камня
   * в тридцать раз. Реквизит не взят: слоту «оружие» пока нечего показывать.
   */
  adopted: ['Barbarian'],
  data: { file: 'src/render/adventurers.data.ts', prefix: 'ADVENTURERS', type: 'Adventurer' },
};

const PACKS: readonly Pack[] = [FOREST, DUNGEON, ADVENTURERS];

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
  return decodePngBytes(readFileSync(file));
}

/** То же из байтов: в .glb атлас лежит внутри файла, а не рядом с ним. */
function decodePngBytes(buf: Buffer): Image {
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
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
  min?: number[];
  max?: number[];
}
interface Node {
  name?: string;
  mesh?: number;
  /** Есть у мешей персонажа: такой меш скинится скелетом, а не узлом. */
  skin?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}
interface Channel {
  sampler: number;
  target: { node?: number; path: 'translation' | 'rotation' | 'scale' | 'weights' };
}
interface Animation {
  name?: string;
  channels: Channel[];
  samplers: { input: number; output: number; interpolation?: string }[];
}
interface Gltf {
  accessors: Accessor[];
  skins?: { joints: number[]; inverseBindMatrices?: number }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { uri?: string; byteLength: number }[];
  meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  nodes?: Node[];
  scenes?: { nodes: number[] }[];
  scene?: number;
  images?: { name?: string; uri?: string; bufferView?: number }[];
  animations?: Animation[];
}

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

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

/**
 * Прочитанный файл набора. `.gltf` держит буфер отдельным `.bin`, `.glb` —
 * вторым куском внутри себя; дальше по коду разницы между ними нет.
 */
interface Doc {
  readonly gltf: Gltf;
  readonly bin: Buffer;
  readonly file: string;
}

function loadDoc(file: string): Doc {
  if (file.endsWith('.glb')) {
    const buf = readFileSync(file);
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${basename(file)}: не glb`);
    const total = buf.readUInt32LE(8);
    let at = 12;
    let json: Gltf | undefined;
    let bin = Buffer.alloc(0);
    while (at + 8 <= total) {
      const length = buf.readUInt32LE(at);
      // Тип куска — четыре байта ascii, у BIN четвёртый нулевой.
      const type = buf.toString('ascii', at + 4, at + 8).replace(/\0/g, '');
      const body = buf.subarray(at + 8, at + 8 + length);
      if (type === 'JSON') json = JSON.parse(body.toString('utf8')) as Gltf;
      else if (type === 'BIN') bin = body;
      at += 8 + length;
    }
    if (json === undefined) throw new Error(`${basename(file)}: в glb нет куска JSON`);
    return { gltf: json, bin, file };
  }
  const gltf = JSON.parse(readFileSync(file, 'utf8')) as Gltf;
  const uri = gltf.buffers[0]?.uri;
  if (uri === undefined) throw new Error(`${basename(file)}: буфер без uri`);
  return { gltf, bin: readFileSync(join(file, '..', decodeURIComponent(uri))), file };
}

/**
 * Атлас модели называет сама модель, а не набор: у леса и подземелья это
 * всегда одна и та же картинка рядом с файлом, у персонажей — своя на каждого,
 * и у половины набора она лежит внутри `.glb`. Картинки тяжёлые, поэтому
 * читаются один раз на путь.
 */
const atlasCache = new Map<string, Image>();

function atlasOf(doc: Doc, pack: Pack, packDir: string): { name: string; image: Image } {
  const image = doc.gltf.images?.[0] ?? (pack.atlas === undefined ? undefined : { uri: pack.atlas });
  if (image === undefined) throw new Error(`${basename(doc.file)}: модель без атласа`);
  if (image.uri !== undefined) {
    // Модель зовёт атлас соседним файлом, а в репозитории он лежит в корне
    // набора: одна картинка на сотню моделей рядом с каждой не нужна.
    const named = decodeURIComponent(image.uri);
    const beside = join(doc.file, '..', named);
    const path = existsSync(beside) ? beside : join(packDir, named);
    let decoded = atlasCache.get(path);
    if (decoded === undefined) {
      decoded = decodePng(path);
      atlasCache.set(path, decoded);
    }
    return { name: basename(path), image: decoded };
  }
  if (image.bufferView === undefined) throw new Error(`${basename(doc.file)}: атлас ни в файле, ни рядом`);
  const key = `${doc.file}#${image.bufferView}`;
  let decoded = atlasCache.get(key);
  if (decoded === undefined) {
    const view = doc.gltf.bufferViews[image.bufferView]!;
    decoded = decodePngBytes(doc.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
    atlasCache.set(key, decoded);
  }
  return { name: `${'name' in image && image.name !== undefined ? image.name : basename(doc.file, '.glb')}.png`, image: decoded };
}

/* ---------- поза и скиннинг ---------- */

/**
 * Поза: TRS по имени узла. Клип лежит в отдельном файле и адресует узлы
 * своими индексами, поэтому связка со скелетом персонажа идёт по именам —
 * риг у набора один, и имена в нём совпадают.
 */
type Pose = ReadonlyMap<string, { t?: number[]; r?: number[]; s?: number[] }>;

/**
 * Ключ клипа как поза. Берётся именно ключ, а не значение во времени:
 * интерполяция дала бы кадр, которого художник не рисовал, а нам нужен
 * ровно нарисованный.
 */
function poseOf(doc: Doc, clip: string, key: number): Pose {
  const { gltf, bin } = doc;
  const anim = gltf.animations?.find((a) => a.name === clip);
  if (anim === undefined) throw new Error(`${basename(doc.file)}: нет клипа ${clip}`);

  const out = new Map<string, { t?: number[]; r?: number[]; s?: number[] }>();
  for (const channel of anim.channels) {
    const path = channel.target.path;
    if (path === 'weights') continue;
    const node = channel.target.node;
    const name = node === undefined ? undefined : gltf.nodes?.[node]?.name;
    if (name === undefined) continue;
    const sampler = anim.samplers[channel.sampler]!;
    const size = path === 'rotation' ? 4 : 3;
    const values = readAccessor(gltf, bin, sampler.output);
    const at = Math.min(key, gltf.accessors[sampler.output]!.count - 1) * size;
    const value = Array.from(values.slice(at, at + size));
    const entry = out.get(name) ?? {};
    if (path === 'translation') entry.t = value;
    else if (path === 'rotation') entry.r = value;
    else entry.s = value;
    out.set(name, entry);
  }
  return out;
}

/**
 * Матрицы суставов: мировая матрица сустава в позе, умноженная на обратную
 * привязку. Именно они двигают вершины — трансформ узла скиннованного меша
 * по glTF не значит ничего.
 */
function jointMatrices(doc: Doc, skinIndex: number, pose: Pose | undefined): Mat4[] {
  const { gltf, bin } = doc;
  const skin = gltf.skins![skinIndex]!;
  const world = new Map<number, Mat4>();

  const walk = (index: number, parent: Mat4): void => {
    const node = gltf.nodes?.[index];
    if (node === undefined) return;
    const posed = node.name === undefined ? undefined : pose?.get(node.name);
    // Поза задаёт TRS, поэтому готовая матрица узла, если она была, не участвует.
    let local = localOf(node);
    if (posed !== undefined) {
      const next: Node = {};
      const t = posed.t ?? node.translation;
      const r = posed.r ?? node.rotation;
      const scale = posed.s ?? node.scale;
      if (t !== undefined) next.translation = t;
      if (r !== undefined) next.rotation = r;
      if (scale !== undefined) next.scale = scale;
      local = localOf(next);
    }
    const m = multiply(parent, local);
    world.set(index, m);
    for (const child of node.children ?? []) walk(child, m);
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  for (const root of scene?.nodes ?? []) walk(root, IDENTITY);

  const inverse =
    skin.inverseBindMatrices === undefined ? undefined : readAccessor(gltf, bin, skin.inverseBindMatrices);
  return skin.joints.map((joint, i) => {
    const w = world.get(joint) ?? IDENTITY;
    return inverse === undefined ? w : multiply(w, Array.from(inverse.slice(i * 16, i * 16 + 16)));
  });
}

/** Линейный блендинг: четыре сустава с весами складываются матрицами. */
function blended(mats: readonly Mat4[], joints: Float64Array, weights: Float64Array, v: number): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let k = 0; k < 4; k++) {
    const w = weights[v * 4 + k]!;
    if (w === 0) continue;
    const m = mats[joints[v * 4 + k]!]!;
    for (let c = 0; c < 16; c++) out[c] += m[c]! * w;
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
  /** Узлов с собственным трансформом — их и ради них ходим по сцене. */
  readonly moved: number;
  /** Атлас, который модель назвала своим. */
  readonly atlas: string;
  readonly atlasImage: Image;
  /**
   * Меши модели по отдельности. У реквизита он один, у персонажа их девять:
   * голова, шлем, забрало, плащ, корпус, руки, ноги — и это не декоративное
   * деление, каждый меш рисуется своим вызовом.
   */
  readonly parts: readonly { readonly name: string; readonly tris: number }[];
  /** Суставов в скелете; 0 — модель без рига. */
  readonly joints: number;
}

function loadMesh(doc: Doc, pack: Pack, packDir: string, pose: Pose | undefined): Mesh {
  const { gltf, bin } = doc;
  const { name: atlas, image: atlasImage } = atlasOf(doc, pack, packDir);
  // Матрицы считаются один раз на модель: скелет у неё один.
  const mats = gltf.skins === undefined ? undefined : jointMatrices(doc, 0, pose);

  const positions: number[] = [];
  const uvs: number[] = [];
  const parts: { name: string; tris: number }[] = [];
  let verts = 0;
  let moved = 0;

  const takeMesh = (index: number, world: Mat4, mats: readonly Mat4[] | undefined): void => {
    const before = uvs.length / 2;
    for (const prim of gltf.meshes[index]!.primitives) {
      const posIndex = prim.attributes['POSITION'];
      const uvIndex = prim.attributes['TEXCOORD_0'];
      if (posIndex === undefined || uvIndex === undefined || prim.indices === undefined) continue;
      const pos = readAccessor(gltf, bin, posIndex);
      const uv = readAccessor(gltf, bin, uvIndex);
      const idx = readAccessor(gltf, bin, prim.indices);
      const jointIndex = prim.attributes['JOINTS_0'];
      const weightIndex = prim.attributes['WEIGHTS_0'];
      const skinned =
        mats !== undefined && jointIndex !== undefined && weightIndex !== undefined
          ? { joints: readAccessor(gltf, bin, jointIndex), weights: readAccessor(gltf, bin, weightIndex) }
          : undefined;
      verts += gltf.accessors[posIndex]!.count;
      for (let i = 0; i < idx.length; i += 3) {
        let cu = 0;
        let cv = 0;
        for (let k = 0; k < 3; k++) {
          const v = idx[i + k]!;
          const p = [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!];
          const m = skinned === undefined ? world : blended(mats!, skinned.joints, skinned.weights, v);
          for (let c = 0; c < 3; c++) {
            positions.push(m[c]! * p[0]! + m[4 + c]! * p[1]! + m[8 + c]! * p[2]! + m[12 + c]!);
          }
          cu += uv[v * 2]!;
          cv += uv[v * 2 + 1]!;
        }
        uvs.push(cu / 3, cv / 3);
      }
    }
    parts.push({ name: gltf.meshes[index]!.name ?? `mesh_${index}`, tris: uvs.length / 2 - before });
  };

  /**
   * Суставы скелета сдвинутыми узлами не считаются: их трансформ — это поза,
   * а не сборка модели из частей. Иначе у каждого персонажа набора «сдвинутых
   * узлов» оказалось бы двадцать три, и метрика перестала бы значить то,
   * ради чего заведена, — крышку сундука, вынесенную отдельным узлом.
   */
  const joints = new Set<number>();
  for (const skin of gltf.skins ?? []) for (const j of skin.joints) joints.add(j);

  const walk = (index: number, parent: Mat4): void => {
    const node = gltf.nodes?.[index];
    if (node === undefined) return;
    const local = localOf(node);
    if (!joints.has(index) && local !== IDENTITY && JSON.stringify(local) !== JSON.stringify(IDENTITY)) moved++;
    const world = multiply(parent, local);
    /**
     * Скиннованный меш стоит не там, где его узел: по glTF трансформ такого
     * узла игнорируется, вершины ставит скелет. Без заданной позы это поза
     * привязки — руки в стороны; с позой — ключ клипа.
     */
    if (node.mesh !== undefined) {
      takeMesh(node.mesh, node.skin === undefined ? world : IDENTITY, node.skin === undefined ? undefined : mats);
    }
    for (const child of node.children ?? []) walk(child, world);
  };

  const scene = gltf.scenes?.[gltf.scene ?? 0];
  if (scene === undefined) {
    // Сцены нет — набор отдал голые меши; берём их как есть, без трансформа.
    for (let i = 0; i < gltf.meshes.length; i++) takeMesh(i, IDENTITY, undefined);
  } else {
    for (const root of scene.nodes) walk(root, IDENTITY);
  }

  return {
    positions: Float64Array.from(positions),
    uvs: Float64Array.from(uvs),
    tris: uvs.length / 2,
    verts,
    moved,
    atlas,
    atlasImage,
    parts: parts.filter((p) => p.tris > 0),
    joints: joints.size,
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
 * Какой градиент задет. Окна пересекаются начиная со второго набора, поэтому
 * решает порядок объявления: первое подошедшее и берут. Всё, что мимо окон, —
 * включая серое — идёт в запасной.
 */
function rampOf(pack: Pack, r: number, g: number, b: number): string {
  const { hue, sat } = hueSat(r, g, b);
  const lum = luminance(r, g, b);
  for (const ramp of pack.ramps) {
    if (sat < ramp.sat[0] || sat > ramp.sat[1]) continue;
    if (ramp.lum !== undefined && (lum < ramp.lum[0] || lum > ramp.lum[1])) continue;
    const [lo, hi] = ramp.hue;
    const inside = lo < hi ? hue >= lo && hue < hi : hue >= lo || hue < hi;
    if (inside) return ramp.id;
  }
  return pack.fallback;
}

/** Цвет атласа в точке UV. В glTF v считается от верхнего края — как строки
 *  в PNG, поэтому переворачивать её не нужно. */
function colorOf(atlas: Image, u: number, v: number): [number, number, number] {
  const x = Math.min(atlas.width - 1, Math.max(0, Math.floor(u * atlas.width)));
  const y = Math.min(atlas.height - 1, Math.max(0, Math.floor(v * atlas.height)));
  const o = (y * atlas.width + x) * 4;
  return [atlas.rgba[o]!, atlas.rgba[o + 1]!, atlas.rgba[o + 2]!];
}

/** Сколько треугольников набора пришлось на каждый цвет атласа. */
type Usage = ReadonlyMap<number, number>;

function usageOf(meshes: readonly Mesh[]): Usage {
  const out = new Map<number, number>();
  for (const mesh of meshes) {
    for (let t = 0; t < mesh.tris; t++) {
      const [r, g, b] = colorOf(mesh.atlasImage, mesh.uvs[t * 2]!, mesh.uvs[t * 2 + 1]!);
      const key = (r << 16) | (g << 8) | b;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * Диапазон яркости каждого градиента. Считается либо по всей картинке, либо
 * по одним задетым цветам: у леса атлас и есть градиент, у подземелья это
 * раскрашенная текстура, и незадетые углы растянули бы шкалу так, что
 * настоящее дерево оказалось бы в самой тёмной ступени.
 */
function rampRanges(
  pack: Pack,
  atlases: readonly Image[],
  usage: Usage | undefined,
): Record<string, { min: number; max: number }> {
  const out: Record<string, { min: number; max: number }> = {};
  for (const r of pack.ramps) out[r.id] = { min: 1, max: 0 };
  const take = (r: number, g: number, b: number): void => {
    if (hueSat(r, g, b).sat < GREY) return;
    const band = out[rampOf(pack, r, g, b)]!;
    const l = luminance(r, g, b);
    if (l < band.min) band.min = l;
    if (l > band.max) band.max = l;
  };
  if (usage === undefined) {
    for (const atlas of atlases) {
      for (let i = 0; i < atlas.width * atlas.height; i++) {
        take(atlas.rgba[i * 4]!, atlas.rgba[i * 4 + 1]!, atlas.rgba[i * 4 + 2]!);
      }
    }
  } else {
    for (const key of usage.keys()) take((key >> 16) & 255, (key >> 8) & 255, key & 255);
  }
  return out;
}

/**
 * Шкала яркости у набора одна на все его атласы. Это и есть смысл палитры:
 * одинаковое дерево обязано попасть в одну ступень, с картинки рыцаря оно
 * прочитано или с картинки мага.
 */
interface Sampler {
  /** Слот по точке атласа — так спрашивает запекание. */
  slotOf(atlas: Image, u: number, v: number): number;
  /** Слот по цвету — так спрашивает каталог, у которого UV уже нет. */
  slotOfColor(r: number, g: number, b: number): number;
  colorAt(atlas: Image, u: number, v: number): [number, number, number];
}

function makeSampler(pack: Pack, atlases: readonly Image[], usage: Usage | undefined): Sampler {
  const ranges = rampRanges(pack, atlases, usage);
  const index = new Map(pack.slots.map((s, i) => [s, i]));

  const slotOfColor = (r: number, g: number, b: number): number => {
    const ramp = pack.ramps.find((x) => x.id === rampOf(pack, r, g, b))!;
    const steps = ramp.slots.length;
    const { min, max } = ranges[ramp.id]!;
    const t = max > min ? (luminance(r, g, b) - min) / (max - min) : 0;
    const step = Math.min(steps - 1, Math.max(0, Math.round(t * (steps - 1))));
    return index.get(ramp.slots[step]!)!;
  };

  return {
    colorAt: (atlas, u, v) => colorOf(atlas, u, v),
    slotOfColor,
    slotOf(atlas, u, v) {
      const [r, g, b] = colorOf(atlas, u, v);
      return slotOfColor(r, g, b);
    },
  };
}

/* ---------- клипы ---------- */

/**
 * Клип из библиотеки анимаций. Мерить их приходится отдельно от моделей:
 * у леса и подземелья анимаций нет вовсе, а у персонажей это половина набора
 * и единственное, что §6.1 не описывал — там был бюджет на треугольники,
 * а здесь бюджет на клипы и кости (артбук «Скелетные клипы»).
 */
interface Clip {
  readonly library: string;
  readonly name: string;
  readonly seconds: number;
  /** Ключей во всех дорожках клипа. */
  readonly keys: number;
  readonly channels: number;
  /**
   * Насколько клип уезжает корнем скелета по горизонтали, в юнитах набора.
   * Игра требует обратного: «клип не двигает персонажа», перемещение считает
   * симуляция по сетке. Величина здесь — и есть проверка этого требования.
   */
  readonly travel: number;
  /** Байты ключей: входы и выходы сэмплеров, каждый аксессор один раз. */
  readonly bytes: number;
}

/** Корень скелета — сустав, который никому из суставов не ребёнок. */
function rootJointOf(gltf: Gltf): number | undefined {
  const joints = gltf.skins?.[0]?.joints;
  if (joints === undefined) return undefined;
  const inside = new Set(joints);
  const hasParent = new Set<number>();
  for (const j of joints) {
    for (const child of gltf.nodes?.[j]?.children ?? []) if (inside.has(child)) hasParent.add(child);
  }
  return joints.find((j) => !hasParent.has(j));
}

function loadClips(file: string): Clip[] {
  const doc = loadDoc(file);
  const { gltf, bin } = doc;
  const library = basename(file, '.glb');
  const root = rootJointOf(gltf);

  const sizeOf = (index: number): number => {
    const acc = gltf.accessors[index]!;
    return acc.count * TYPE_SIZE[acc.type]! * COMPONENT_SIZE[acc.componentType]!;
  };

  return (gltf.animations ?? []).map((anim) => {
    let seconds = 0;
    let keys = 0;
    const counted = new Set<number>();
    let bytes = 0;
    for (const sampler of anim.samplers) {
      const input = gltf.accessors[sampler.input]!;
      seconds = Math.max(seconds, input.max?.[0] ?? 0);
      keys += input.count;
      for (const index of [sampler.input, sampler.output]) {
        if (counted.has(index)) continue;
        counted.add(index);
        bytes += sizeOf(index);
      }
    }

    // Горизонтальный сдвиг корня: не размах бедра вверх-вниз, а именно то,
    // уезжает ли персонаж от точки, в которой стоял.
    let travel = 0;
    if (root !== undefined) {
      for (const channel of anim.channels) {
        if (channel.target.node !== root || channel.target.path !== 'translation') continue;
        const out = readAccessor(gltf, bin, anim.samplers[channel.sampler]!.output);
        const x0 = out[0] ?? 0;
        const z0 = out[2] ?? 0;
        for (let i = 0; i < out.length; i += 3) {
          travel = Math.max(travel, Math.hypot(out[i]! - x0, out[i + 2]! - z0));
        }
      }
    }

    return {
      library,
      name: anim.name ?? '(без имени)',
      seconds: Math.round(seconds * 1000) / 1000,
      keys,
      channels: anim.channels.length,
      travel: Math.round(travel * 1000) / 1000,
      bytes,
    };
  });
}

/* ---------- бюджеты ---------- */

// §6.1 задаёт бюджеты герою, врагу и зданию. Окружению бюджета не было —
// его и меряем: сравнивать окружение с героем нечестно, но потолок нужен.
const BUDGET = 1500;

/** §6.1: «герой ≤ 900 треугольников». Единственный бюджет, заданный не нами. */
const HERO_BUDGET = 900;

/** Артбук «Скелетные клипы», раздел 04: кости и вес одного набора клипов. */
const BONES = 24;
const CLIP_SET_KB = 40;

/** §6.1.3: потолок запечённого персонажа в бандле. Проверяет models.rules.ts. */
const BAKED_KB = 200;

/* ---------- запекание ---------- */

interface Baked {
  readonly name: string;
  /** Путь внутри набора: страница артбука читает ту же геометрию отсюда. */
  readonly file: string;
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
  /** Чьим атласом раскрашена модель. */
  readonly atlas: string;
  /** Меши модели по отдельности — они же вызовы отрисовки. */
  readonly parts: readonly { readonly name: string; readonly tris: number }[];
  /** Суставов в скелете; 0 — модель без рига. */
  readonly joints: number;
}

function bake(pack: Pack, name: string, file: string, mesh: Mesh, sampler: Sampler): Baked {
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
    slot[t] = sampler.slotOf(mesh.atlasImage, u, v);
    const c = sampler.colorAt(mesh.atlasImage, u, v);
    if (hueSat(c[0], c[1], c[2]).sat < GREY) grey++;
  }

  return {
    name,
    file,
    category: pack.categoryOf(name),
    tris: mesh.tris,
    verts: mesh.verts,
    min,
    max,
    pos,
    slot,
    grey,
    moved: mesh.moved,
    atlas: mesh.atlas,
    parts: mesh.parts,
    joints: mesh.joints,
  };
}

const b64 = (data: Int16Array | Uint8Array): string =>
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');

function writeData(pack: Pack, models: Baked[]): string {
  const data = pack.data!;
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
${pack.slots.map((s) => `  '${s}',`).join('\n')}
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
function writeCatalog(
  pack: Pack,
  atlases: readonly { name: string; image: Image }[],
  sampler: Sampler,
  models: Baked[],
  usage: Usage | undefined,
  clips: readonly Clip[],
): string {
  const pixels = atlases.reduce((sum, a) => sum + a.image.width * a.image.height, 0);
  return JSON.stringify({
    pack: pack.title,
    license: 'CC0',
    // Атласов может быть несколько: у персонажей своя картинка на каждого,
    // и страница обязана показывать их числом, а не одним «атлас 1024×1024».
    atlases: atlases.map((a) => ({ file: a.name, width: a.image.width, height: a.image.height })),
    slots: pack.slots,
    ramps: pack.ramps.map((r) => ({
      id: r.id,
      title: r.title,
      slots: r.slots,
      // Цвет из атласа, который лёг в каждую ступень: это и есть «было → стало».
      // Голоса считаются там же, где и шкала: по картинке или по задетому.
      source: r.slots.map((_, i) => {
        const target = pack.slots.indexOf(r.slots[i]!);
        let best: [number, number, number] = [0, 0, 0];
        let bestCount = 0;
        const counts = new Map<string, number>();
        const vote = (c: [number, number, number], weight: number): void => {
          // Серое поле не участвует: большинством голосов оно выиграло бы
          // у настоящих цветов градиента.
          if (hueSat(c[0], c[1], c[2]).sat < GREY) return;
          if (rampOf(pack, c[0], c[1], c[2]) !== r.id) return;
          const key = c.join(',');
          const n = (counts.get(key) ?? 0) + weight;
          counts.set(key, n);
          if (n > bestCount) {
            bestCount = n;
            best = c;
          }
        };
        if (usage === undefined) {
          for (const { image } of atlases) {
            for (let y = 0; y < image.height; y += 2) {
              for (let x = 0; x < image.width; x += 2) {
                const u = (x + 0.5) / image.width;
                const v = (y + 0.5) / image.height;
                if (sampler.slotOf(image, u, v) !== target) continue;
                vote(sampler.colorAt(image, u, v), 1);
              }
            }
          }
        } else {
          for (const [key, tris] of usage) {
            const c: [number, number, number] = [(key >> 16) & 255, (key >> 8) & 255, key & 255];
            if (sampler.slotOfColor(c[0], c[1], c[2]) !== target) continue;
            vote(c, tris);
          }
        }
        return `#${best.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
      }),
    })),
    adopted: pack.adopted,
    // Поза запекания: страница артбука обязана показывать модель ровно в той,
    // в которой её посчитали, иначе картинка и числа под ней разойдутся.
    ...(pack.pose === undefined ? {} : { pose: pack.pose }),
    // Бюджеты живут здесь же, чтобы отчёт в консоли и страница артбука брали
    // их из одного места: разойтись молча они могут только по разным спискам.
    budgets: { hero: HERO_BUDGET, model: BUDGET, bones: BONES, clipKb: CLIP_SET_KB, bakedKb: BAKED_KB },
    // Чем набор закрывает список клипов игры. Пустой `found` — это результат
    // поиска, а не пропуск: искали регуляркой, не нашли ничем.
    needs: (pack.needs ?? []).map((need) => ({
      title: need.title,
      found: clips.filter((c) => need.match.test(c.name)).map((c) => c.name),
    })),
    // Сколько картинки набор вообще трогает: страница объясняет этим, почему
    // шкала градиента считается по задетому, а не по атласу.
    ...(usage === undefined
      ? {}
      : {
          touched: (() => {
            const all = new Map<number, number>();
            for (const { image } of atlases) {
              for (let i = 0; i < image.width * image.height; i++) {
                const key = (image.rgba[i * 4]! << 16) | (image.rgba[i * 4 + 1]! << 8) | image.rgba[i * 4 + 2]!;
                all.set(key, (all.get(key) ?? 0) + 1);
              }
            }
            let hit = 0;
            for (const [key, n] of all) if (usage.has(key)) hit += n;
            return {
              colors: usage.size,
              atlasColors: all.size,
              share: Math.round((hit / pixels) * 1000) / 1000,
            };
          })(),
        }),
    // Клипы — у набора без анимаций список пустой, и страница про них молчит.
    clips: clips.map((c) => ({
      library: c.library,
      name: c.name,
      seconds: c.seconds,
      keys: c.keys,
      channels: c.channels,
      travel: c.travel,
      bytes: c.bytes,
    })),
    models: models.map((m) => ({
      name: m.name,
      category: m.category,
      file: m.file,
      atlas: m.atlas,
      tris: m.tris,
      verts: m.verts,
      joints: m.joints,
      parts: m.parts,
      size: [m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]].map(
        (v) => Math.round(v * 100) / 100,
      ),
      slot: b64(m.slot),
    })),
  });
}

/* ---------- отчёт ---------- */

function report(pack: Pack, write: boolean): void {
  const dir = join(ROOT, pack.dir);
  const files = pack.sources.flatMap((source) =>
    readdirSync(join(dir, source))
      .filter((f) => f.endsWith('.gltf') || f.endsWith('.glb'))
      .sort()
      .map((f) => ({ path: join(dir, source, f), rel: `${source}/${f}` })),
  );

  if (files.length === 0) {
    console.error(`Набор не найден: ${dir}`);
    process.exit(1);
  }

  // Два прохода: сначала геометрия, потом цвет. Шкала градиента может зависеть
  // от того, что набор задел, а это известно только после чтения всех моделей.
  // Поза читается до моделей: она одна на набор и нужна каждой скиннованной.
  const pose =
    pack.pose === undefined
      ? undefined
      : poseOf(loadDoc(join(dir, pack.clips!, `${pack.pose.library}.glb`)), pack.pose.clip, pack.pose.key);
  const meshes = files.map((f) => ({
    name: basename(f.path).replace(/\.(gltf|glb)$/, ''),
    rel: f.rel,
    mesh: loadMesh(loadDoc(f.path), pack, dir, pose),
  }));
  // Атласы — те, которые назвали сами модели, в порядке первого упоминания.
  const atlases: { name: string; image: Image }[] = [];
  for (const m of meshes) {
    if (!atlases.some((a) => a.name === m.mesh.atlas)) {
      atlases.push({ name: m.mesh.atlas, image: m.mesh.atlasImage });
    }
  }
  const images = atlases.map((a) => a.image);
  const usage = pack.range === 'used' ? usageOf(meshes.map((m) => m.mesh)) : undefined;
  const sampler = makeSampler(pack, images, usage);
  const models = meshes.map((m) => bake(pack, m.name, m.rel, m.mesh, sampler));
  const clips =
    pack.clips === undefined
      ? []
      : readdirSync(join(dir, pack.clips))
          .filter((f) => f.endsWith('.glb'))
          .sort()
          .flatMap((f) => loadClips(join(dir, pack.clips!, f)));
  const slots = pack.slots;


  const byCategory = new Map<string, Baked[]>();
  for (const m of models) {
    const list = byCategory.get(m.category) ?? [];
    list.push(m);
    byCategory.set(m.category, list);
  }

  const atlasLine = atlases.length === 1
    ? `атлас ${images[0]!.width}×${images[0]!.height}`
    : `${atlases.length} атласа по ${images[0]!.width}×${images[0]!.height}`;
  console.log(`\n${pack.title}: ${models.length} моделей, ${atlasLine}\n`);
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
  for (const ramp of pack.ramps) {
    const parts = ramp.slots.map((name) => {
      const share = ((perSlot[slots.indexOf(name)]! / totalTris) * 100).toFixed(1);
      return `${name} ${share}%`;
    });
    console.log(`  ${ramp.title.padEnd(8)} ${parts.join(' · ')}`);
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

  // Персонаж — не окружение: у него бюджет из §6.1 есть, и он вдвое строже
  // потолка здания. Сравнение с ним — главный вопрос к набору персонажей.
  const heroes = models.filter((m) => m.category === 'Персонажи');
  if (heroes.length > 0) {
    const worst = heroes.reduce((a, b) => (a.tris > b.tris ? a : b));
    console.log(
      `тяжелее героя (${HERO_BUDGET}): ${heroes.filter((m) => m.tris > HERO_BUDGET).length}` +
        ` из ${heroes.length}, худший ${worst.name} ${worst.tris} —` +
        ` ${(worst.tris / HERO_BUDGET).toFixed(1)}× бюджета`,
    );
    const parts = heroes.reduce((s, m) => s + m.parts.length, 0);
    console.log(
      `мешей на персонажа: ${(parts / heroes.length).toFixed(1)} в среднем` +
        ` (${heroes.map((m) => m.parts.length).join(', ')}) — столько же вызовов отрисовки`,
    );
    console.log(`суставов в скелете: ${[...new Set(heroes.map((m) => m.joints))].join(', ')} при бюджете ${BONES}`);
  }

  if (clips.length > 0) {
    const libraries = [...new Set(clips.map((c) => c.library))];
    console.log(`\nклипы: ${clips.length} в ${libraries.length} библиотеках`);
    for (const library of libraries) {
      const list = clips.filter((c) => c.library === library);
      const bytes = list.reduce((s, c) => s + c.bytes, 0);
      console.log(
        `  ${library.padEnd(26)} ${String(list.length).padStart(2)} клипов` +
          ` ${(list.reduce((s, c) => s + c.seconds, 0)).toFixed(1).padStart(6)} с` +
          ` ${(bytes / 1024).toFixed(1).padStart(7)} КБ ключей при бюджете ${CLIP_SET_KB} КБ`,
      );
    }
    const moving = clips.filter((c) => c.travel > 0.01);
    console.log(
      `корневое движение: ${moving.length} клипов из ${clips.length}` +
        (moving.length > 0 ? ` (${moving.map((c) => `${c.name} ${c.travel}`).join(', ')})` : ' — все играются на месте'),
    );
    for (const need of pack.needs ?? []) {
      const found = clips.filter((c) => need.match.test(c.name));
      console.log(
        `  ${need.title.padEnd(9)} ${found.length === 0 ? 'НЕ НАЙДЕН' : found.map((c) => `${c.name} ${c.seconds}с`).join(', ')}`,
      );
    }
  }

  if (pack.adopted.length === 0) {
    console.log(`\nберёт игра: ничего — набор измерен, в бандл не едет (§${pack.section})`);
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
  writeFileSync(join(ROOT, catalog), writeCatalog(pack, atlases, sampler, models, usage, clips), 'utf8');
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
