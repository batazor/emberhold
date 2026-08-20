/**
 * Запекание сэмплов (§18.5: «позже заменяется сэмплами через тот же интерфейс
 * вызова»). Источник — Kenney RPG Audio в `assets/kenney-rpg-audio`, лицензия
 * CC0, каталог набора — `audioart.html`.
 *
 * Что здесь делается и почему именно здесь:
 *
 * **Нормализация по пику.** У набора нет сведения: пик файлов расходится
 * на 26 дБ, а часть декодируется выше нуля и клиппует. Порядок громкостей —
 * решение §18.3 («ранение самый громкий», «попадание не громче ранения»),
 * и он обязан остаться в коде, а не в чужих файлах. Поэтому все файлы
 * приводятся к одному пику, а громкость каждому назначает `SAMPLES`.
 *
 * **Ogg → m4a.** Safari научился Ogg Vorbis только в 18.4 (март 2025),
 * а §18.5 отдельно оговаривает iOS. Исходники остаются в `assets/` как пришли.
 *
 * **Моно, 32 кГц.** Игра сводит звук в один динамик телефона, стерео в ней
 * не участвует; 32 кГц при 48 кбит/с не дороже 24 кГц и оставляет верх шага.
 *
 * Запуск:
 *   npm run audio            — отчёт: пик до и после, длительность, вес
 *   npm run audio -- --write — переписать public/sfx
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SAMPLES, sampleFile } from '../src/core/audio';
import type { SfxName } from '../src/core/audio';

const ROOT = resolve(import.meta.dirname, '..');
const PACK = join(ROOT, 'assets/kenney-rpg-audio/audio');
const OUT = join(ROOT, 'public/sfx');

/**
 * Целевой пик. Не ноль и не −1: игра играет через AudioContext устройства,
 * а он пересчитывает 32 кГц в свою частоту, и на пересчёте пик подрастает —
 * замер в браузере дал до 0,8 дБ сверху. Двух децибел запаса хватает,
 * а слышимости это не стоит ничего: абсолютный уровень файла здесь только
 * точка отсчёта, громкость всё равно назначает `gain` из §18.3.
 */
const PEAK_DB = -2;
/** Насколько результат вправе разойтись с целью, дБ. */
const PEAK_EPS = 0.2;
/** Проходов нормализации. Обычно хватает двух; третий — страховка. */
const PASSES = 4;
const RATE = 32000;
const BITRATE = '48k';

const write = process.argv.includes('--write');

/** Замер одного файла: пик в dBFS и длительность в секундах. */
function measure(file: string): { peak: number; sec: number } {
  // volumedetect печатает замер в stderr и на успешном прогоне тоже, поэтому
  // execFileSync здесь не годится: он отдаёт только stdout.
  //
  // Меряет astats, а не volumedetect. Второй строит гистограмму в целых
  // 16 битах и упирается в ровный 0,0 дБ: файл, который на самом деле вышел
  // за полную шкалу, выглядит там идеально сведённым. Vorbis и AAC
  // декодируются во float, браузер их такими и слышит — astats так и меряет,
  // и его числа сходятся с теми, что считает `audioart.html` по семплам.
  const run = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-i', file,
      '-af', 'astats=measure_perchannel=none:measure_overall=Peak_level',
      '-f', 'null', '-',
    ],
    { encoding: 'utf8' },
  );
  const peak = Number(/Peak level dB:\s*(-?[\d.]+)/.exec(run.stderr ?? '')?.[1] ?? NaN);
  if (!Number.isFinite(peak)) throw new Error(`ffmpeg не измерил пик: ${file}`);
  const sec = Number(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { encoding: 'utf8' },
    ).trim(),
  );
  return { peak, sec };
}

function encode(from: string, to: string, gainDb: number): void {
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', from,
    '-af', `aformat=sample_fmts=fltp,volume=${gainDb.toFixed(2)}dB`,
    '-ac', '1',
    '-ar', String(RATE),
    '-c:a', 'aac',
    '-b:a', BITRATE,
    to,
  ]);
}

interface Row {
  readonly name: SfxName;
  readonly variant: number;
  readonly source: string;
  readonly sec: number;
  readonly was: number;
  readonly now: number;
  readonly bytes: number;
  readonly passes: number;
}

/**
 * Нормализация с обратной связью, а не в один проход. Считать поправку
 * по исходному пику недостаточно: AAC — сжатие с потерями, и восстановленный
 * сигнал выходит за пик исходного на 1–3,5 дБ. Поэтому результат каждого
 * прохода замеряется и поправка уточняется по нему. Возвращает число проходов.
 */
function normalize(from: string, to: string): { peak: number; sec: number; passes: number } {
  const tried: { gain: number; peak: number; sec: number }[] = [];
  let gain = PEAK_DB - measure(from).peak;

  for (let pass = 1; pass <= PASSES; pass++) {
    encode(from, to, gain);
    const now = measure(to);
    if (Math.abs(now.peak - PEAK_DB) <= PEAK_EPS) return { ...now, passes: pass };
    tried.push({ gain, peak: now.peak, sec: now.sec });
    gain += PEAK_DB - now.peak;
  }

  // Не сошлось за отведённые проходы: перерасход не строго линеен, и поправка
  // может ходить вокруг цели. Тогда берётся лучший из проверенных — самый
  // громкий, который цель не перешёл. Промахнуться вниз безопасно, вверх — нет:
  // выше нуля файл клиппует, а это ровно то, от чего нормализация и заводилась.
  const under = tried.filter((t) => t.peak <= PEAK_DB + PEAK_EPS);
  const best =
    under.length > 0
      ? under.reduce((a, b) => (b.peak > a.peak ? b : a))
      : tried.reduce((a, b) => (b.peak < a.peak ? b : a));
  encode(from, to, best.gain);
  return { peak: best.peak, sec: best.sec, passes: PASSES + 1 };
}

/* ---------- проверка источников до всякой работы ---------- */

const missing: string[] = [];
for (const spec of SAMPLES) {
  for (const f of spec.files) {
    if (!existsSync(join(PACK, `${f}.ogg`))) missing.push(`${spec.name}: ${f}.ogg`);
  }
}
if (missing.length > 0) {
  console.error(`Нет исходников в ${PACK}:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

if (write) {
  // Папка переписывается целиком: файл, выпавший из SAMPLES, обязан исчезнуть
  // и из сборки, иначе вес растёт молча.
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
}

/* ---------- запекание ---------- */

const tmp = join(ROOT, 'node_modules/.cache/sfx');
mkdirSync(tmp, { recursive: true });

const rows: Row[] = [];
for (const spec of SAMPLES) {
  spec.files.forEach((source, i) => {
    const from = join(PACK, `${source}.ogg`);
    const was = measure(from);
    const to = join(write ? OUT : tmp, sampleFile(spec.name, i));
    const now = normalize(from, to);
    rows.push({
      name: spec.name,
      variant: i,
      source,
      sec: now.sec,
      was: was.peak,
      now: now.peak,
      bytes: statSync(to).size,
      passes: now.passes,
    });
  });
}

if (!write) rmSync(tmp, { recursive: true, force: true });

/* ---------- отчёт ---------- */

const kb = (b: number): string => `${(b / 1024).toFixed(1)} КБ`;
const gains = new Map<string, number>(SAMPLES.map((s) => [s.name, s.gain]));

console.log(
  `\nСэмплы §18.3: ${rows.length} файлов на ${SAMPLES.length} имён, моно ${RATE} Гц, AAC ${BITRATE}\n`,
);
console.log('имя      файл        источник             длит.   пик было   пик стал  проходов      вес  громкость');
for (const r of rows) {
  console.log(
    `${r.name.padEnd(8)} ${sampleFile(r.name, r.variant).padEnd(11)} ${r.source.padEnd(20)} ` +
      `${r.sec.toFixed(2)}с ${`${r.was.toFixed(1)} дБ`.padStart(10)} ${`${r.now.toFixed(1)} дБ`.padStart(10)} ` +
      `${String(r.passes).padStart(9)} ${kb(r.bytes).padStart(8)}  ${String(gains.get(r.name))}`,
  );
}

const total = rows.reduce((s, r) => s + r.bytes, 0);
const wasSpread = Math.max(...rows.map((r) => r.was)) - Math.min(...rows.map((r) => r.was));
const nowSpread = Math.max(...rows.map((r) => r.now)) - Math.min(...rows.map((r) => r.now));
console.log(
  `\nвсего ${kb(total)} · разброс пика был ${wasSpread.toFixed(1)} дБ, стал ${nowSpread.toFixed(1)} дБ`,
);
console.log(
  `имён §18.3 четырнадцать, сэмплом закрыто ${SAMPLES.length}; остальные синтезируются — ` +
    'записанного эквивалента у сигнальных звуков нет (§18.1)',
);

if (write) {
  const files = readdirSync(OUT).sort();
  console.log(`\nзаписано в public/sfx: ${files.length} файлов — ${files.join(', ')}`);
} else {
  console.log('\nничего не записано: npm run audio -- --write');
}
