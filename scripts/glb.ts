/**
 * Общий обмер скелетных GLB. Вырос из clips.ts, когда наборов анимаций стало
 * два: контейнер, прямая кинематика и четыре замера (проскальзывание, удар,
 * петля, снос корня) не зависят от того, чей риг внутри, — от имён костей
 * зависит только то, какие узлы им скормить, и это решает вызывающий скрипт.
 */
import { readFileSync } from 'node:fs';

/* ---------- glb ---------- */

export interface Gltf {
  readonly json: GltfJson;
  readonly bin: Buffer;
}

export interface GltfJson {
  readonly nodes: readonly GltfNode[];
  /** Расширения и внешние файлы: их читает не обмер, а ресемпл — чтобы отказаться. */
  readonly extensionsUsed?: readonly string[];
  readonly images?: readonly { readonly uri?: string }[];
  readonly buffers?: readonly { readonly uri?: string }[];
  readonly skins?: readonly { readonly joints: readonly number[] }[];
  readonly meshes?: readonly { readonly primitives: readonly GltfPrimitive[] }[];
  readonly animations?: readonly GltfAnimation[];
  readonly accessors: readonly GltfAccessor[];
  readonly bufferViews: readonly { readonly byteOffset?: number; readonly byteLength: number }[];
}

export interface GltfNode {
  readonly name?: string;
  readonly children?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
}

export interface GltfPrimitive {
  readonly attributes: Record<string, number>;
  readonly indices?: number;
}

export interface GltfAnimation {
  readonly name: string;
  readonly channels: readonly {
    readonly sampler: number;
    readonly target: { readonly node: number; readonly path: string };
  }[];
  readonly samplers: readonly { readonly input: number; readonly output: number }[];
}

export interface GltfAccessor {
  readonly bufferView: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly count: number;
  readonly type: string;
  readonly min?: readonly number[];
  readonly max?: readonly number[];
}

export const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/**
 * Контейнер GLB: заголовок 12 байт, дальше чанки «длина, тип, данные».
 * Нужны ровно два — JSON и BIN; всё остальное набор не использует.
 */
export function readGlb(file: string): Gltf {
  return parseGlb(readFileSync(file), file);
}

/**
 * Тот же контейнер, но уже в памяти. Нужен ресемплу: он сверяет позы файла
 * до и после, а «после» ещё не на диске и попадать туда до сверки не должно.
 */
export function parseGlb(buf: Buffer, file: string): Gltf {
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file}: не GLB`);
  let at = 12;
  let json: GltfJson | undefined;
  let bin: Buffer = Buffer.alloc(0);
  while (at + 8 <= buf.length) {
    const length = buf.readUInt32LE(at);
    const type = buf.readUInt32LE(at + 4);
    const data = buf.subarray(at + 8, at + 8 + length);
    at += 8 + length;
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8')) as GltfJson;
    else if (type === 0x004e4942) bin = data;
  }
  if (json === undefined) throw new Error(`${file}: в GLB нет JSON-чанка`);
  return { json, bin };
}

/** Аксессор как массив кортежей. Наборы целиком во float — другого не ждём. */
export function read(gltf: Gltf, index: number): Float32Array[] {
  const a = gltf.json.accessors[index]!;
  if (a.componentType !== 5126) throw new Error(`аксессор ${index}: тип ${a.componentType}, ждали float`);
  const view = gltf.json.bufferViews[a.bufferView]!;
  const size = COMPONENTS[a.type]!;
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out: Float32Array[] = [];
  for (let i = 0; i < a.count; i++) {
    const at = start + i * size * 4;
    const v = new Float32Array(size);
    for (let k = 0; k < size; k++) v[k] = gltf.bin.readFloatLE(at + k * 4);
    out.push(v);
  }
  return out;
}

/** Сколько байт занимают дорожки клипа — из них и складывается его цена. */
export function bytesOf(gltf: Gltf, anim: GltfAnimation): number {
  const seen = new Set<number>();
  let bytes = 0;
  for (const s of anim.samplers) {
    for (const index of [s.input, s.output]) {
      if (seen.has(index)) continue;
      seen.add(index);
      const a = gltf.json.accessors[index]!;
      bytes += a.count * COMPONENTS[a.type]! * 4;
    }
  }
  return bytes;
}

/* ---------- прямая кинематика ---------- */

export type Mat4 = Float64Array;

export function compose(t: ArrayLike<number>, r: ArrayLike<number>, s: ArrayLike<number>): Mat4 {
  const [x, y, z, w] = [r[0]!, r[1]!, r[2]!, r[3]!];
  const [xx, yy, zz] = [x + x, y + y, z + z];
  const m = new Float64Array(16);
  m[0] = (1 - (y * yy + z * zz)) * s[0]!;
  m[1] = (x * yy + w * zz) * s[0]!;
  m[2] = (x * zz - w * yy) * s[0]!;
  m[4] = (x * yy - w * zz) * s[1]!;
  m[5] = (1 - (x * xx + z * zz)) * s[1]!;
  m[6] = (y * zz + w * xx) * s[1]!;
  m[8] = (x * zz + w * yy) * s[2]!;
  m[9] = (y * zz - w * xx) * s[2]!;
  m[10] = (1 - (x * xx + y * yy)) * s[2]!;
  m[12] = t[0]!;
  m[13] = t[1]!;
  m[14] = t[2]!;
  m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const m = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!;
      m[c * 4 + r] = sum;
    }
  }
  return m;
}

export interface Track {
  readonly times: Float32Array[];
  readonly values: Float32Array[];
}

/**
 * Значение дорожки в момент t. Интерполяция в наборах везде линейная —
 * кватернионы всё же считаются через nlerp, иначе поза «схлопывается»
 * на больших углах и нога уезжает не туда, куда её вёл аниматор.
 */
export function at(track: Track, t: number, quat: boolean): Float32Array {
  const { times, values } = track;
  if (t <= times[0]![0]!) return values[0]!;
  const last = times.length - 1;
  if (t >= times[last]![0]!) return values[last]!;
  let i = 1;
  while (times[i]![0]! < t) i++;
  const a = times[i - 1]![0]!;
  const b = times[i]![0]!;
  const u = b === a ? 0 : (t - a) / (b - a);
  const va = values[i - 1]!;
  let vb = values[i]!;
  if (quat) {
    let dot = 0;
    for (let k = 0; k < 4; k++) dot += va[k]! * vb[k]!;
    if (dot < 0) vb = vb.map((v) => -v) as Float32Array;
  }
  const out = new Float32Array(va.length);
  let len = 0;
  for (let k = 0; k < va.length; k++) {
    out[k] = va[k]! + (vb[k]! - va[k]!) * u;
    len += out[k]! * out[k]!;
  }
  if (quat && len > 0) {
    const inv = 1 / Math.sqrt(len);
    for (let k = 0; k < out.length; k++) out[k] = out[k]! * inv;
  }
  return out;
}

/** Позы клипа: мировая матрица каждого узла в момент t. */
export class Posed {
  private readonly parent = new Map<number, number>();
  private readonly tracks = new Map<number, Map<string, Track>>();
  readonly duration: number = 0;
  readonly keys: number = 0;

  constructor(
    private readonly gltf: Gltf,
    anim: GltfAnimation,
  ) {
    this.gltf.json.nodes.forEach((n, i) => {
      for (const child of n.children ?? []) this.parent.set(child, i);
    });
    let duration = 0;
    let keys = 0;
    for (const channel of anim.channels) {
      const sampler = anim.samplers[channel.sampler]!;
      const times = read(gltf, sampler.input);
      duration = Math.max(duration, times[times.length - 1]![0]!);
      keys = Math.max(keys, times.length);
      const byPath = this.tracks.get(channel.target.node) ?? new Map<string, Track>();
      byPath.set(channel.target.path, { times, values: read(gltf, sampler.output) });
      this.tracks.set(channel.target.node, byPath);
    }
    this.duration = duration;
    this.keys = keys;
  }

  /** Узлы, у которых есть хоть одна дорожка. */
  get animated(): number {
    return this.tracks.size;
  }

  track(node: number, path: string): Track | undefined {
    return this.tracks.get(node)?.get(path);
  }

  world(t: number): (node: number) => Mat4 {
    const cache = new Map<number, Mat4>();
    const of = (node: number): Mat4 => {
      const hit = cache.get(node);
      if (hit !== undefined) return hit;
      const n = this.gltf.json.nodes[node]!;
      const byPath = this.tracks.get(node);
      const t3 = byPath?.get('translation');
      const r4 = byPath?.get('rotation');
      const s3 = byPath?.get('scale');
      let m = compose(
        t3 === undefined ? (n.translation ?? [0, 0, 0]) : at(t3, t, false),
        r4 === undefined ? (n.rotation ?? [0, 0, 0, 1]) : at(r4, t, true),
        s3 === undefined ? (n.scale ?? [1, 1, 1]) : at(s3, t, false),
      );
      const up = this.parent.get(node);
      if (up !== undefined) m = multiply(of(up), m);
      cache.set(node, m);
      return m;
    };
    return of;
  }
}

/* ---------- замеры ---------- */

export const round = (n: number, digits = 2): number => {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
};

/** Кадров на секунду обмера: чаще, чем ключей в наборах (30/с), и с запасом. */
export const SAMPLES_PER_SECOND = 60;

/**
 * Опорная нога — та, чей носок ниже. Пока она не меняется, персонаж стоит
 * на ней, и её ход по горизонтали — это ход земли: набор нарисован на месте,
 * и в игре под ним поедет пол, а не он.
 *
 * Считается не длина следа, а сумма сдвигов «начало опоры → конец опоры»
 * векторами. Длина следа объявила бы ходьбой любой замах: нога там тоже
 * ездит, только возвращается обратно, и векторы гасят друг друга. У шага
 * гасить нечего — обе опоры едут назад, — поэтому цикл выживает, а стойка нет.
 *
 * Считать по бёдрам или по корню нельзя: они гуляют вверх-вниз и вперёд-назад
 * внутри шага, и «скорость» из них выходит вдвое больше настоящей.
 */
export function measureSlide(pose: Posed, toes: readonly number[]): number {
  if (pose.duration === 0 || toes.length !== 2) return 0;
  const steps = Math.max(2, Math.round(pose.duration * SAMPLES_PER_SECOND));
  let sumX = 0;
  let sumZ = 0;
  let stance: { foot: number; x: number; z: number } | undefined;
  let last: { foot: number; x: number; z: number } | undefined;
  const close = (): void => {
    if (stance === undefined || last === undefined || last.foot !== stance.foot) return;
    sumX += last.x - stance.x;
    sumZ += last.z - stance.z;
  };
  for (let i = 0; i <= steps; i++) {
    const world = pose.world((pose.duration * i) / steps);
    const feet = toes.map((node) => world(node));
    const foot = feet[0]![13]! <= feet[1]![13]! ? 0 : 1;
    const m = feet[foot]!;
    const now = { foot, x: m[12]!, z: m[14]! };
    if (stance === undefined || stance.foot !== foot) {
      close();
      stance = now;
    }
    last = now;
  }
  close();
  return Math.hypot(sumX, sumZ) / pose.duration;
}

/**
 * Момент удара — пик скорости самой быстрой конечности. Физически удар и есть
 * та точка, где оружие разогнано: до неё идёт замах, после — возврат.
 *
 * Пик, а не крайняя точка выноса: у рубящего вынос приходится на конец дуги,
 * у колющего — на её середину, и «дальше всего» у них означает разные фазы.
 * Скорость означает одну и ту же.
 *
 * Из равных пиков берётся первый, и строгого `>` для этого мало. Клип, который
 * успевает повторить свой цикл несколько раз, даёт пики равные по существу,
 * но не побайтно: `Ranged_2H_Shooting` — четыре выстрела за 1,07 с с пиком
 * 1,9507 в каждом, и какой из них «главный», решал седьмой знак. Пересчёт
 * файла перекидывал момент с 0,05 с на 0,32 с, а с ним и вердикт «успевает ли
 * скелет замахнуться». Поэтому поздний пик обязан быть не просто больше,
 * а больше заметно — на TIE.
 */

/**
 * Ширина ничьей между пиками, доля от главного. Не «побольше для верности»:
 * ширину выбрал замер — 132 ударных клипа, прогнанных до и после прорядки
 * набора, и доля тех, у кого момент удара не переехал:
 *
 *   0      — 129 из 132     1e-4 — 127
 *   1e-6   — 126            1e-3 — 128
 *   1e-5   — 126            3e-3 — 130, и дальше не растёт
 *
 * Узкая ничья хуже, чем никакая: она ловит только совпадения байт в байт,
 * а обмер шумит на полпроцента — конечность считается разностью положений,
 * и прорядка ключей эту разность чуть меняет. С 3e-3 «равные» значит равные
 * в пределах шума, и это ровно то, ради чего правило вводилось.
 */
const TIE = 3e-3;

export function measureStrike(pose: Posed, limbs: readonly number[]): { at: number; peak: number } {
  if (pose.duration === 0 || limbs.length === 0) return { at: 0, peak: 0 };
  const steps = Math.max(2, Math.round(pose.duration * SAMPLES_PER_SECOND));
  const dt = pose.duration / steps;

  // Скорость самой быстрой конечности в каждой выборке. Кто именно быстрее,
  // клип решает сам: мечом бьют рукой, «Kick» — ногой, и различать их незачем.
  const speeds: number[] = [];
  let previous: number[][] | undefined;
  for (let i = 0; i <= steps; i++) {
    const world = pose.world(dt * i);
    const now = limbs.map((node) => {
      const m = world(node);
      return [m[12]!, m[13]!, m[14]!];
    });
    if (previous !== undefined) {
      let fastest = 0;
      for (let k = 0; k < now.length; k++) {
        const a = previous[k]!;
        const b = now[k]!;
        fastest = Math.max(fastest, Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!) / dt);
      }
      speeds.push(fastest);
    }
    previous = now;
  }

  // Пик сначала весь, момент потом: сравнивать на ходу с текущим максимумом
  // нельзя — плавно разгоняющаяся рука прошла бы ничью по шагу и оставила
  // момент в начале разгона. Ничья считается от готового пика.
  let peak = 0;
  for (const speed of speeds) peak = Math.max(peak, speed);
  if (peak === 0) return { at: 0, peak: 0 };
  const first = speeds.findIndex((speed) => speed >= peak * (1 - TIE));
  // speeds[j] — скорость на отрезке между выборками j и j+1, то есть к моменту
  // dt*(j+1): удар случился к концу отрезка, а не в его начале.
  return { at: dt * (first + 1), peak };
}

/** Насколько поза в конце клипа не совпала с позой в начале. */
export function measureLoop(pose: Posed, joints: readonly number[]): number {
  if (pose.duration === 0) return 0;
  const first = pose.world(0);
  const last = pose.world(pose.duration);
  let worst = 0;
  for (const joint of joints) {
    const a = first(joint);
    const b = last(joint);
    worst = Math.max(worst, Math.hypot(a[12]! - b[12]!, a[13]! - b[13]!, a[14]! - b[14]!));
  }
  return worst;
}

/** Сдвинул ли клип корень — тот самый запрет «клип не двигает персонажа». */
export function measureDrift(pose: Posed, root: number): number {
  const track = pose.track(root, 'translation');
  if (track === undefined || pose.duration === 0) return 0;
  const a = track.values[0]!;
  const b = track.values[track.values.length - 1]!;
  return Math.hypot(b[0]! - a[0]!, b[2]! - a[2]!);
}
