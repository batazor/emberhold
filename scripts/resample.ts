/**
 * Прорядка ключей анимации в наборах (§6.1: готовые наборы применимы).
 *
 * Наборы экспортированы покадрово: ключ на каждый кадр каждой кости, даже
 * когда кость весь клип стоит. Играет это одинаково, а весит по-разному —
 * UAL1_Standard.glb отдавал 7,3 МБ при 8,5 тысячах вершин, и всё это дорожки.
 * Скрипт выбрасывает ключ, который восстанавливается прямой между соседями
 * с точностью SHIFT и TURN, и склеивает получившиеся одинаковые дорожки:
 * стоячая кость после прорядки — это две точки, а таких костей в наборе
 * тысячи, и в файле они весят не байтами, а строками JSON.
 *
 * Гонять повторно незачем: по уже прорядженному набору скрипт снимает доли
 * процента, а сверяет позы с ним же, а не с исходником, — то есть расхождение
 * с оригиналом копится, а выигрыш нет.
 *
 * Прорядка — правка исходника, а не сборки, поэтому проверяет себя сама:
 * файл сверяется с собой же до записи, по всем костям скина, 60 раз в секунду
 * клипа. Разошлись позы больше POSE_LIMIT — файл не записывается. Клипы после
 * этого всё равно нужно перемерить (`npm run clips`, `npm run ual`): здесь
 * доказано, что поза та же, а годность клипа игре решают там.
 *
 * От чего отказывается и почему: файлы с расширениями glTF и с внешними
 * файлами рядом. Читать их нечем — расширения здесь не зарегистрированы,
 * а внешнюю картинку запись втянула бы внутрь GLB, — и молча превратить
 * набор в другой набор хуже, чем не тронуть.
 *
 * Запуск:
 *   npm run resample            — отчёт: что и на сколько похудеет
 *   npm run resample -- --write — переписать файлы
 */
import { createHash } from 'node:crypto';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, Document, NodeIO, Root } from '@gltf-transform/core';
import { Posed, SAMPLES_PER_SECOND, parseGlb, readGlb, round } from './glb';
import type { Gltf } from './glb';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WRITE = process.argv.includes('--write');

/** Допуск на сдвиг и масштаб, в единицах модели: рост героя — 1,11 ед. */
const SHIFT = 1e-4;

/**
 * Допуск на поворот, в радианах — примерно сотая доля градуса. Отдельный от сдвига,
 * и не для порядка: поворот у корня руки уезжает не собой, а кистью — плечо,
 * локоть и запястье складывают ошибку и умножают её на длину кости.
 *
 * Число подобрано замером. Прогон по всем наборам:
 *
 *   0,0002 рад — вес −38,0%, позы разъезжаются на 1,3e-3 ед.
 *   0,0005 рад — вес −41,8%, позы 1,7e-3
 *   0,001  рад — вес −43,6%, позы 3,1e-3
 *   0,002  рад — вес −45,1%, позы 5,3e-3
 *
 * Выбрана первая строка, и не из-за поз: на 0,0005 у `Melee_2H_Attack_Spinning`
 * проскальзывание встаёт с нуля на 0,23 м/с, и клип-вертушка попадает
 * в таблицу циклов хода. Четыре процента веса не стоят отчёта, который
 * называет ходьбой вращение на месте.
 */
const TURN = 2e-4;

/**
 * Насколько кости позволено уехать. Рост героя — 1,11 ед., так что это
 * полпроцента роста: под ортокамерой вылазки — меньше пикселя. Сегодняшний
 * худший случай вчетверо меньше предела, и запас здесь намеренный: предел
 * сторожит будущие наборы, а не подпирает сегодняшние.
 */
const POSE_LIMIT = 5e-3;

/* ---------- обход ---------- */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.glb')) out.push(full);
  }
  return out;
}

/** Причина не трогать файл — или undefined, если трогать можно. */
function refusal(gltf: Gltf): string | undefined {
  const { json } = gltf;
  if ((json.animations ?? []).length === 0) return 'клипов нет';
  const extensions = json.extensionsUsed ?? [];
  if (extensions.length > 0) return `расширения ${extensions.join(', ')}`;
  const external = [...(json.images ?? []), ...(json.buffers ?? [])]
    .map((r) => r.uri)
    .filter((uri): uri is string => uri !== undefined && !uri.startsWith('data:'));
  if (external.length > 0) return `внешние файлы ${[...new Set(external)].join(', ')}`;
  return undefined;
}

/* ---------- прорядка ---------- */

/**
 * Восстанавливается ли ключ b прямой между a и c. Повороты сравниваются
 * не покомпонентно: q и −q — один и тот же поворот, и покомпонентная разница
 * объявила бы совпавшие позы разными.
 */
function reachable(
  a: Float32Array,
  b: Float32Array,
  c: Float32Array,
  k: number,
  rotation: boolean,
): boolean {
  if (rotation) {
    let dot = 0;
    for (let i = 0; i < 4; i++) dot += a[i]! * c[i]!;
    const sign = dot < 0 ? -1 : 1;
    const between = new Float32Array(4);
    let length = 0;
    for (let i = 0; i < 4; i++) {
      between[i] = a[i]! + (c[i]! * sign - a[i]!) * k;
      length += between[i]! * between[i]!;
    }
    length = Math.sqrt(length) || 1;
    let same = 0;
    for (let i = 0; i < 4; i++) same += b[i]! * (between[i]! / length);
    return 2 * Math.acos(Math.min(1, Math.abs(same))) <= TURN;
  }
  for (let i = 0; i < b.length; i++) {
    if (Math.abs(b[i]! - (a[i]! + (c[i]! - a[i]!) * k)) > SHIFT) return false;
  }
  return true;
}

interface Thinned {
  readonly before: number;
  readonly after: number;
}

function thin(doc: Document): Thinned {
  const buffer = doc.getRoot().listBuffers()[0];
  if (buffer === undefined) throw new Error('в файле нет буфера');

  const pool = new Map<string, Accessor>();
  /** Одинаковые дорожки живут одним аксессором: их в наборе тысячи. */
  const share = (array: Float32Array<ArrayBuffer>, type: ReturnType<Accessor['getType']>): Accessor => {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const key = `${type}:${createHash('sha1').update(bytes).digest('base64')}`;
    const found = pool.get(key);
    if (found !== undefined) return found;
    const made = doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
    pool.set(key, made);
    return made;
  };

  const retired = new Set<Accessor>();
  const done = new Map<Accessor, Map<Accessor, { input: Accessor; output: Accessor }>>();
  let before = 0;
  let after = 0;

  for (const anim of doc.getRoot().listAnimations()) {
    const pathOf = new Map(anim.listChannels().map((ch) => [ch.getSampler(), ch.getTargetPath()]));
    for (const sampler of anim.listSamplers()) {
      const input = sampler.getInput();
      const output = sampler.getOutput();
      if (input === null || output === null) continue;
      if (input.getComponentType() !== 5126 || output.getComponentType() !== 5126) {
        throw new Error('дорожка не во float — обмер такого не читает');
      }
      // Кубический сплайн хранит по три значения на ключ и прямой между
      // соседями не описывается. В наборах его нет; появится — пройдёт мимо.
      if (sampler.getInterpolation() === 'CUBICSPLINE') continue;

      // Одна пара дорожек висит на многих клипах. Прорядить её дважды значит
      // оставить в файле обе копии: старую держит чужая ссылка.
      const already = done.get(input)?.get(output);
      if (already !== undefined) {
        before += input.getCount();
        after += already.input.getCount();
        sampler.setInput(already.input).setOutput(already.output);
        retired.add(input).add(output);
        continue;
      }

      const times = input.getArray() as Float32Array;
      const values = output.getArray() as Float32Array;
      const size = output.getElementSize();
      const count = times.length;
      const at = (i: number): Float32Array => values.subarray(i * size, i * size + size);
      const step = sampler.getInterpolation() === 'STEP';
      const rotation = pathOf.get(sampler) === 'rotation';
      before += count;

      const keep = [0];
      // Выброшенные с последнего оставленного ключа. Проверять только соседей
      // мало: ошибка копится, и дорожка уезжает целыми кадрами, хотя каждый
      // шаг по отдельности в допуске укладывался.
      let dropped: number[] = [];
      for (let j = 1; j < count - 1; j++) {
        const i = keep[keep.length - 1]!;
        const span = times[j + 1]! - times[i]!;
        const fits = [...dropped, j].every((n) =>
          step
            ? at(n).every((v, c) => v === at(i)[c])
            : reachable(at(i), at(n), at(j + 1), span === 0 ? 0 : (times[n]! - times[i]!) / span, rotation),
        );
        if (fits) dropped.push(j);
        else {
          keep.push(j);
          dropped = [];
        }
      }
      if (count > 1) keep.push(count - 1);
      after += keep.length;
      if (keep.length === count) continue;

      const nextTimes = new Float32Array(keep.length);
      const nextValues = new Float32Array(keep.length * size);
      keep.forEach((src, dst) => {
        nextTimes[dst] = times[src]!;
        nextValues.set(at(src), dst * size);
      });
      const next = { input: share(nextTimes, 'SCALAR'), output: share(nextValues, output.getType()) };
      sampler.setInput(next.input).setOutput(next.output);
      (done.get(input) ?? done.set(input, new Map()).get(input)!).set(output, next);
      retired.add(input).add(output);
    }
  }

  // Осиротевшие дорожки контейнер сам не убирает: без этого файл только растёт.
  for (const accessor of retired) {
    if (accessor.listParents().every((parent) => parent instanceof Root)) accessor.dispose();
  }
  return { before, after };
}

/* ---------- сверка ---------- */

/**
 * Насколько уехала самая непослушная кость. Мерится по костям скина, а не
 * по названным конечностям: имя кости — договор набора, а проверка обязана
 * работать на любом.
 */
function poseGap(before: Gltf, after: Gltf): number {
  const joints = before.json.skins?.[0]?.joints ?? [];
  const clips = after.json.animations ?? [];
  let worst = 0;
  (before.json.animations ?? []).forEach((anim, i) => {
    const next = clips[i];
    if (next === undefined || next.name !== anim.name) throw new Error(`клип ${anim.name} потерялся`);
    const was = new Posed(before, anim);
    const now = new Posed(after, next);
    const steps = Math.max(2, Math.round(was.duration * SAMPLES_PER_SECOND));
    for (let s = 0; s <= steps; s++) {
      const t = (was.duration * s) / steps;
      const a = was.world(t);
      const b = now.world(t);
      for (const joint of joints) {
        const m = a(joint);
        const n = b(joint);
        worst = Math.max(worst, Math.hypot(m[12]! - n[12]!, m[13]! - n[13]!, m[14]! - n[14]!));
      }
    }
  });
  return worst;
}

/* ---------- прогон ---------- */

const io = new NodeIO();
const mb = (bytes: number): string => (bytes / 1048576).toFixed(2).padStart(6);

const refused = new Map<string, string[]>();
let totalBefore = 0;
let totalAfter = 0;
let keysBefore = 0;
let keysAfter = 0;
let gap = 0;
let touched = 0;
let held = 0;

for (const file of walk(join(ROOT, 'assets'))) {
  const where = relative(ROOT, file);
  const source = readGlb(file);
  const why = refusal(source);
  if (why !== undefined) {
    (refused.get(why) ?? refused.set(why, []).get(why)!).push(where);
    continue;
  }

  const doc = await io.read(file);
  const keys = thin(doc);
  const glb = Buffer.from(await io.writeBinary(doc));
  const moved = poseGap(source, parseGlb(glb, where));
  gap = Math.max(gap, moved);

  const sizeBefore = statSync(file).size;
  if (moved > POSE_LIMIT) {
    console.log(`${mb(sizeBefore)} МБ  ${where}\n        поза уехала на ${moved} — не записан`);
    held++;
    continue;
  }

  if (WRITE) writeFileSync(file, glb);
  totalBefore += sizeBefore;
  totalAfter += glb.length;
  keysBefore += keys.before;
  keysAfter += keys.after;
  touched++;
  console.log(
    `${mb(sizeBefore)} → ${mb(glb.length)} МБ  ключей ${String(keys.before).padStart(6)} → ` +
      `${String(keys.after).padStart(6)}  ${where}`,
  );
}

const skipped = refused.get('клипов нет')?.length ?? 0;
console.log(`\nфайлов с клипами: ${touched + held}, без клипов: ${skipped}`);
for (const [why, where] of refused) {
  if (why === 'клипов нет') continue;
  console.log(`не тронуто, ${why}: ${where.length} — ${where.join(', ')}`);
}
if (held > 0) console.log(`не записано из-за разъехавшихся поз: ${held}`);
if (touched > 0) {
  console.log(
    `ключей ${keysBefore} → ${keysAfter}, вес ${mb(totalBefore)} → ${mb(totalAfter)} МБ ` +
      `(${round(100 - (totalAfter / totalBefore) * 100, 1)}% долой)`,
  );
  console.log(`худшее расхождение позы: ${gap.toExponential(1)} ед. при пределе ${POSE_LIMIT}`);
}
console.log(
  WRITE
    ? '\nфайлы переписаны: перемерить клипы — npm run clips, npm run ual'
    : '\n(--write не задан: файлы не тронуты)',
);
