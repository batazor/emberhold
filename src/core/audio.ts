/**
 * Звук (DESIGN §18). Процедурный синтез, ноль ассетов: рецепты перенесены
 * из артбука `audioart.html` один в один, чтобы игра звучала ровно так, как
 * её слушали на странице, а не «примерно так же».
 *
 * Модуль намеренно лежит в core рядом с часами и циклом: как и они, он —
 * браузерная обвязка, а не игровая логика. Симуляция о нём не знает и знать
 * не должна — что играть, решает main по изменениям состояния.
 *
 * §18.1: звук несёт информацию и ничего не решает в одиночку. Всё, что здесь
 * звучит, продублировано на экране — игра обязана оставаться играбельной
 * с выключенным динамиком.
 */

/** Шины (§18.5): игрок должен уметь приглушить амбиент, не теряя провиант. */
export type Bus = 'sfx' | 'ui' | 'amb';

/**
 * Микшер (§18.5): общая громкость и три шины. Значения по умолчанию — те же,
 * что в артбуке `audioart.html`: игра запускается не в наушниках и часто при людях.
 */
export interface Mix {
  readonly master: number;
  readonly sfx: number;
  readonly ui: number;
  readonly amb: number;
}

export const DEFAULT_MIX: Mix = { master: 0.55, sfx: 0.9, ui: 0.7, amb: 0.5 };

/**
 * Текущее положение ручек. Живёт отдельно от узлов графа, потому что игрок
 * может подвинуть ползунок до первого жеста — то есть до того, как появится
 * AudioContext. Тогда значение просто дождётся `unlockAudio`.
 */
let mixNow: Mix = DEFAULT_MIX;

/** §18.5 — без предела бой в тесной комнате превращается в шум. */
const MAX_VOICES = 8;

/**
 * Пульс провианта (§18.2) — ключевая механика звукового дизайна.
 * Таблица чистая и лежит здесь же, а не в симуляции: это звук, а не правило
 * вылазки. Проверяется в `audio.rules.ts`.
 */
export interface Pulse {
  /** Период в миллисекундах. */
  readonly everyMs: number;
  readonly hz: number;
}

const ZONES: readonly { readonly above: number; readonly pulse: Pulse | null }[] = [
  // Молчание выше 60% — тоже состояние: без него появление пульса
  // не было бы событием, а фоновый тик обесценивается за две минуты.
  { above: 0.6, pulse: null },
  { above: 0.3, pulse: { everyMs: 2000, hz: 70 } },
  { above: 0.15, pulse: { everyMs: 1200, hz: 88 } },
  { above: -1, pulse: { everyMs: 600, hz: 110 } },
];

/** Пульс для текущей доли провианта; null — тишина. */
export function foodPulse(share: number): Pulse | null {
  for (const z of ZONES) if (share > z.above) return z.pulse;
  return ZONES[ZONES.length - 1]!.pulse;
}

/** Амбиент по ярусу (§18.4): ниже и плотнее с глубиной. */
interface AmbientSpec {
  readonly band: number;
  readonly gain: number;
  readonly breath: number;
  readonly hum: number | null;
}

const AMBIENT: readonly AmbientSpec[] = [
  { band: 700, gain: 0.055, breath: 0.12, hum: null }, // подступы: ветер, светлый
  { band: 700, gain: 0.055, breath: 0.12, hum: null },
  { band: 300, gain: 0.075, breath: 0.12, hum: 60 }, // копи: капель и низкий гул
  { band: 140, gain: 0.1, breath: 0.22, hum: 42 }, // дно: давящий низ
];

interface Voice {
  readonly stop: () => void;
  readonly until: number;
}

let ac: AudioContext | null = null;
let master: GainNode | null = null;
const buses = new Map<Bus, GainNode>();
let voices: Voice[] = [];
let noise: AudioBuffer | null = null;
let ambient: (() => void) | null = null;
let ambientTier = -1;
let pulseTimer: ReturnType<typeof setTimeout> | null = null;
let pulseShare = 1;
let pulseOn = false;

/**
 * Запуск по первому жесту (§18.5). Safari не даёт звук без него, и отдельный
 * экран «включить звук» не нужен: первый тап — это шаг из первого кадра.
 * Вызывается сколько угодно раз, работает один.
 */
export function unlockAudio(): void {
  if (ac === null) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return;
    ac = new Ctor();
    master = ac.createGain();
    master.gain.value = mixNow.master;
    master.connect(ac.destination);
    for (const bus of ['sfx', 'ui', 'amb'] as const) {
      const g = ac.createGain();
      g.gain.value = mixNow[bus];
      g.connect(master);
      buses.set(bus, g);
    }
  }
  if (ac.state === 'suspended') void ac.resume();
  loadSamples();
  loadMusic();
  // Сейв просыпается прямо в лагере: startCampTune тогда случился до первого
  // жеста, при пустом контексте, и его таймер умер молча. Перезапуск здесь,
  // а не в сцене — жест приносит звук, сцена уже на месте.
  if (tuneOn && tuneTimer === null && musicSrc === null) {
    tuneTimer = setTimeout(playPhrase, 1200);
  }
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/** Текущее положение ручек — панель настроек рисует ползунки по нему. */
export function mix(): Mix {
  return mixNow;
}

/** Поставить весь микшер разом: так он приезжает из сохранённых настроек. */
export function setMix(next: Mix): void {
  mixNow = {
    master: clamp01(next.master),
    sfx: clamp01(next.sfx),
    ui: clamp01(next.ui),
    amb: clamp01(next.amb),
  };
  if (master !== null) master.gain.value = mixNow.master;
  for (const bus of ['sfx', 'ui', 'amb'] as const) {
    const g = buses.get(bus);
    if (g !== undefined) g.gain.value = mixNow[bus];
  }
}

export function setVolume(value: number): void {
  setMix({ ...mixNow, master: value });
}

/** Одна шина (§18.5): амбиент глушится отдельно от боя и интерфейса. */
export function setBusVolume(bus: Bus, value: number): void {
  setMix({ ...mixNow, [bus]: value });
}

function busOf(bus: Bus): GainNode | null {
  return buses.get(bus) ?? null;
}

/** Шум генерируется один раз: четыре секунды хватает и на удары, и на петлю. */
function noiseBuffer(): AudioBuffer | null {
  if (ac === null) return null;
  if (noise === null) {
    const n = Math.floor(ac.sampleRate * 4);
    noise = ac.createBuffer(1, n, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** Учёт голосов: сверх восьми глушится старейший, а не отбрасывается новый —
 *  свежее событие всегда важнее доигрывающего хвоста. */
function hold(stop: () => void, until: number): void {
  const now = ac?.currentTime ?? 0;
  voices = voices.filter((v) => v.until > now);
  if (voices.length >= MAX_VOICES) {
    const oldest = voices.shift();
    oldest?.stop();
  }
  voices.push({ stop, until });
}

interface NoiseOpts {
  f0: number;
  f1?: number;
  dur?: number;
  gain?: number;
  q?: number;
  type?: BiquadFilterType;
  at?: number;
  bus?: Bus;
}

function nz(o: NoiseOpts): void {
  const buf = noiseBuffer();
  const out = busOf(o.bus ?? 'sfx');
  if (ac === null || buf === null || out === null) return;
  const t = ac.currentTime + (o.at ?? 0);
  const dur = o.dur ?? 0.1;

  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.f0, t);
  if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1), t + dur);
  f.Q.value = o.q ?? 1;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
  hold(() => src.stop(), t + dur);
}

interface ToneOpts {
  f0: number;
  f1?: number;
  dur?: number;
  gain?: number;
  type?: OscillatorType;
  at?: number;
  bus?: Bus;
}

function tn(o: ToneOpts): void {
  const out = busOf(o.bus ?? 'sfx');
  if (ac === null || out === null) return;
  const t = ac.currentTime + (o.at ?? 0);
  const dur = o.dur ?? 0.15;

  const osc = ac.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.18, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  hold(() => osc.stop(), t + dur);
}

/* ---------- сэмплы (§18.5) ---------- */

/**
 * Загруженные сэмплы и громкость к ним. Пусты, пока файлы не приехали, —
 * и это рабочее состояние, а не сбой: рецепт §18.3 остаётся на месте и играет
 * сам, пока сэмпла нет. Поэтому звук есть с первого кадра, а не с первой
 * удачной загрузки.
 */
const sampled = new Map<string, AudioBuffer[]>();
const sampleGain = new Map<string, number>();
const sampleTurn = new Map<string, number>();

/**
 * Сыграть сэмпл вместо рецепта. Возвращает false, если сэмпла нет, —
 * вызывающий рецепт тогда синтезирует, как раньше.
 *
 * Варианты идут по кругу по той же причине, по которой у синтезированного
 * шага их два (§18.3): буквально повторяемый звук слышится метрономом.
 */
function sample(name: string): boolean {
  const list = sampled.get(name);
  const out = busOf('sfx');
  if (ac === null || out === null || list === undefined || list.length === 0) return false;

  const i = (sampleTurn.get(name) ?? 0) % list.length;
  sampleTurn.set(name, i + 1);
  const buf = list[i]!;

  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  // Файл нормализован по пику на запекании, громкость назначает §18.3.
  g.gain.value = sampleGain.get(name) ?? 0.1;
  src.connect(g);
  g.connect(out);
  src.start();
  hold(() => src.stop(), ac.currentTime + buf.duration);
  return true;
}

let stepFlip = 0;

/**
 * Библиотека §18.3. Правило отбора то же, что в артбуке: звук, которому
 * нечего написать в строке «что сообщает», сюда не попадает.
 */
export const SFX = {
  /** Поверхность под ногами. Два варианта по очереди — иначе метроном. */
  step: (): void => {
    if (sample('step')) return;
    stepFlip ^= 1;
    nz({ f0: stepFlip ? 1150 : 900, f1: 520, dur: 0.055, gain: 0.09, q: 1.2 });
  },
  /** Тяжёлый шаг большого существа: низ остаётся короче боевого удара. */
  heavyStep: (): void => {
    tn({ type: 'sine', f0: 82, f1: 48, dur: 0.14, gain: 0.18 });
    nz({ type: 'lowpass', f0: 360, f1: 110, dur: 0.11, gain: 0.13, q: 0.7 });
  },
  /** Камень принимает или наносит удар — сухой скол поверх тяжёлого толчка. */
  stoneHit: (): void => {
    nz({ f0: 720, f1: 240, dur: 0.12, gain: 0.2, q: 2.6 });
    tn({ type: 'triangle', f0: 120, f1: 62, dur: 0.18, gain: 0.18 });
  },
  /** Рёв минотавра предупреждает о начале схватки и таране. */
  roar: (): void => {
    tn({ type: 'sawtooth', f0: 92, f1: 54, dur: 0.62, gain: 0.12 });
    nz({ type: 'bandpass', f0: 520, f1: 150, dur: 0.68, gain: 0.2, q: 0.8 });
  },
  /** Голем распадается несколькими каменными обвалами, а не обычной смертью. */
  golemBreak: (): void => {
    for (const [at, f] of [[0, 520], [0.08, 390], [0.17, 280]] as const) {
      nz({ f0: f, f1: 100, dur: 0.2, gain: 0.19, q: 1.8, at });
      tn({ type: 'triangle', f0: f * 0.24, f1: 42, dur: 0.22, gain: 0.12, at });
    }
  },
  /** Атака началась — отдельно от результата. */
  swing: (): void => nz({ type: 'highpass', f0: 900, f1: 2600, dur: 0.09, gain: 0.11, q: 0.7 }),
  /** Урон нанесён. Не громче ранения: иначе успех звучит опаснее неудачи. */
  hit: (): void => {
    if (sample('hit')) return;
    nz({ f0: 1600, f1: 400, dur: 0.09, gain: 0.2, q: 1.4 });
    tn({ type: 'triangle', f0: 180, f1: 90, dur: 0.12, gain: 0.16 });
  },
  /** Потеряна рана. Самый громкий и самый низкий звук игры: ран всего три. */
  wound: (): void => {
    tn({ type: 'sine', f0: 90, f1: 52, dur: 0.42, gain: 0.34 });
    nz({ type: 'lowpass', f0: 800, f1: 180, dur: 0.3, gain: 0.22, q: 0.6 });
    tn({ type: 'square', f0: 140, f1: 70, dur: 0.16, gain: 0.06 });
  },
  /** Путь свободен. Затухает вниз и быстро — долгая смерть тормозит темп. */
  kill: (): void => {
    nz({ f0: 2200, f1: 260, dur: 0.26, gain: 0.18, q: 1.1 });
    tn({ type: 'triangle', f0: 300, f1: 120, dur: 0.2, gain: 0.1 });
  },
  /** Добыча получена. Единственный по-настоящему приятный звук в вылазке. */
  chest: (): void => {
    // Рецепт §18.3 — «щелчок + тона 880 и 1320». Сэмпл заменяет щелчок,
    // тона остаются синтезом: они и есть награда, а награду набор не привёз.
    if (!sample('chest')) nz({ f0: 600, f1: 1400, dur: 0.07, gain: 0.12, q: 2 });
    tn({ type: 'triangle', f0: 880, dur: 0.18, gain: 0.14, at: 0.05 });
    tn({ type: 'triangle', f0: 1320, dur: 0.26, gain: 0.12, at: 0.12 });
  },
  /** Ресурс зачислен — по одному на строку экрана возврата. */
  pick: (): void => {
    if (sample('pick')) return;
    tn({ type: 'sine', f0: 1180, f1: 1560, dur: 0.09, gain: 0.12 });
  },
  /** −10% провианта. Тихий, но регулярный: расход считается не глядя. */
  tick: (): void => tn({ type: 'sine', f0: 640, dur: 0.05, gain: 0.09 }),
  /** Вылазка удалась. Вверх и светлее: выход — облегчение, а не конец. */
  evac: (): void => {
    for (const [i, f] of [660, 880, 1320].entries()) {
      tn({ type: 'triangle', f0: f, dur: 0.22, gain: 0.16, at: i * 0.1 });
    }
  },
  /** Добыча потеряна. Вниз и глухо, но коротко: провал и так стоил добычи. */
  fail: (): void => {
    tn({ type: 'sine', f0: 220, f1: 110, dur: 0.5, gain: 0.24 });
    tn({ type: 'sine', f0: 165, f1: 82, dur: 0.7, gain: 0.18, at: 0.14 });
  },
  /** Работа началась. Один раз на старте, а не циклом: стук утомляет. */
  build: (): void => {
    if (sample('build')) return;
    nz({ f0: 420, f1: 260, dur: 0.11, gain: 0.18, q: 2.4 });
    nz({ f0: 700, f1: 300, dur: 0.08, gain: 0.12, q: 2, at: 0.1 });
  },
  /** Здание выросло. Единственное настоящее созвучие — больше нигде. */
  levelup: (): void => {
    for (const [i, f] of [523, 659, 784, 1046].entries()) {
      tn({ type: 'triangle', f0: f, dur: 0.4, gain: 0.11, at: i * 0.07 });
    }
  },
  /**
   * Подарок за вход взят (§29). Крышка и две ноты квинтой.
   *
   * Три вещи, которых здесь нет, и все три — решения. **Не созвучие**:
   * трезвучие и арпеджио приберегаются росту здания (§18.3), а подарок —
   * не главная награда меты, он приходит сам. **Не «сундук» вылазки**: тот
   * говорит «добыча получена» и звучит там, где за неё рисковали; тона
   * поэтому взяты ниже — 587 и 880 против 880 и 1320. **Не «подбор»**:
   * подбор считает единицы, а подарок случается раз в сутки и обязан
   * звучать крупнее одного тона.
   *
   * Шина игровая, а не интерфейсная: это событие лагеря, как стройка,
   * а не отклик на палец.
   */
  gift: (): void => {
    nz({ f0: 380, f1: 1100, dur: 0.1, gain: 0.13, q: 1.6 });
    tn({ type: 'triangle', f0: 587, dur: 0.22, gain: 0.13, at: 0.06 });
    tn({ type: 'triangle', f0: 880, dur: 0.3, gain: 0.11, at: 0.15 });
  },
  /** Касание принято. Верхние частоты, чтобы не спорить с боем. */
  tap: (): void => nz({ type: 'highpass', f0: 2600, dur: 0.028, gain: 0.07, bus: 'ui' }),
  /** Действие невозможно. Неприятный ровно настолько, чтобы не повторять. */
  deny: (): void => tn({ type: 'square', f0: 150, f1: 120, dur: 0.14, gain: 0.09, bus: 'ui' }),
} as const;

export type SfxName = keyof typeof SFX;

/**
 * Что берётся из чужого набора (§18.5). Правило отбора то же, что у самой
 * библиотеки: сэмпл заменяет рецепт только там, где он **сообщает то же
 * самое**. Восемь сигнальных имён — ранение, смерть, тик провианта,
 * возвращение, провал, уровень здания, тап, отказ — остаются синтезом: их тембр
 * выведен из разнесения по частоте (§18.1), и записанного звука, который
 * сообщал бы то же, в наборе нет.
 *
 * Взмах тоже остался синтезом, хотя кандидат был: `drawKnife` — это
 * извлечение клинка, а §18.3 просит свист начатой атаки. Разные события.
 *
 * Громкость не подбиралась на слух: файл нормализован по пику на запекании,
 * а `gain` — то же число, что стоит в рецепте §18.3, который сэмпл заменяет.
 * Так порядок громкостей игры остаётся решением §18.3, а сэмпл приносит
 * только тембр.
 */
export interface SampleSpec {
  readonly name: SfxName;
  /** Файлы набора без расширения; играются по кругу. */
  readonly files: readonly string[];
  readonly gain: number;
}

export const SAMPLES: readonly SampleSpec[] = [
  // Четыре шага из десяти в наборе: десять вариантов звучат лучше, но каждый
  // едет в бандл, а метроном ломается уже на четырёх.
  { name: 'step', files: ['footstep00', 'footstep03', 'footstep06', 'footstep09'], gain: 0.09 },
  { name: 'hit', files: ['knifeSlice', 'knifeSlice2'], gain: 0.2 },
  { name: 'chest', files: ['metalLatch'], gain: 0.12 },
  { name: 'pick', files: ['handleCoins2'], gain: 0.12 },
  { name: 'build', files: ['chop'], gain: 0.18 },
];

/** Где лежат запечённые сэмплы. `npm run audio -- --write` пишет их туда. */
const SFX_DIR = './sfx/';

/** Имя файла в сборке: имя §18.3 плюс номер варианта. */
export const sampleFile = (name: SfxName, i: number): string => `${name}${i}.m4a`;

let samplesAsked = false;

/**
 * Забрать сэмплы. Вызывается из `unlockAudio`, то есть после первого жеста
 * (§18.5), и ничего не блокирует: пока файлы едут — и если они не доедут
 * вовсе, — играют рецепты §18.3. Отсюда и молчаливый catch: неудачная
 * загрузка это не потеря звука, а потеря тембра.
 */
export function loadSamples(): void {
  if (samplesAsked || ac === null) return;
  samplesAsked = true;
  for (const spec of SAMPLES) {
    sampleGain.set(spec.name, spec.gain);
    void Promise.all(
      spec.files.map(async (_, i) => {
        const res = await fetch(SFX_DIR + sampleFile(spec.name, i));
        if (!res.ok) throw new Error(String(res.status));
        return await ac!.decodeAudioData(await res.arrayBuffer());
      }),
    )
      .then((bufs) => sampled.set(spec.name, bufs))
      .catch(() => {});
  }
}

export function play(name: SfxName): void {
  if (ac === null) return;
  SFX[name]();
}

/* ---------- пульс провианта (§18.2) ---------- */

/**
 * Пульс идёт по шине боя, а не амбиента, хотя тембр у него фоновый. Причина
 * записана в §18.5: игрок должен уметь приглушить амбиент, не теряя сигнал
 * провианта, — а пульс и есть этот сигнал (§18.2). Пока он висел на амбиенте,
 * ползунок «Амбиент» на нуле отнимал главный звук вылазки.
 *
 * Громкость пересчитана под шину, чтобы пульс звучал ровно как в артбуке:
 * шина боя громче амбиента, и без поправки он стал бы вдвое навязчивее.
 */
const PULSE_TRIM = DEFAULT_MIX.amb / DEFAULT_MIX.sfx;

function schedulePulse(): void {
  if (pulseTimer !== null) clearTimeout(pulseTimer);
  pulseTimer = null;
  if (!pulseOn || ac === null) return;

  const p = foodPulse(pulseShare);
  if (p === null) {
    // Тишина — тоже состояние, но доля меняется, и проверять её надо.
    pulseTimer = setTimeout(schedulePulse, 300);
    return;
  }
  tn({ type: 'sine', f0: p.hz, f1: p.hz * 0.82, dur: 0.26, gain: 0.3 * PULSE_TRIM });
  nz({ type: 'lowpass', f0: 260, f1: 120, dur: 0.18, gain: 0.07 * PULSE_TRIM });
  pulseTimer = setTimeout(schedulePulse, p.everyMs);
}

/** Доля оставшегося провианта, 0..1. Пульс сам решает, звучать ли. */
export function setFoodShare(share: number): void {
  pulseShare = share;
}

export function startPulse(): void {
  if (pulseOn) return;
  pulseOn = true;
  schedulePulse();
}

export function stopPulse(): void {
  pulseOn = false;
  if (pulseTimer !== null) clearTimeout(pulseTimer);
  pulseTimer = null;
}

/* ---------- амбиент (§18.4) ---------- */

/**
 * Подложка яруса. Не музыка: полосовой шум с медленным дыханием. Мелодии
 * здесь нет и в вылазке не будет — она положена только лагерю (§18.4).
 */
export function startAmbient(tier: number): void {
  const out = busOf('amb');
  const buf = noiseBuffer();
  if (ac === null || out === null || buf === null) return;
  if (ambientTier === tier && ambient !== null) return;
  stopAmbient();

  const spec = AMBIENT[Math.max(0, Math.min(AMBIENT.length - 1, tier))]!;
  const t = ac.currentTime;

  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = spec.band;
  filter.Q.value = 0.8;
  const gain = ac.createGain();
  gain.gain.value = spec.gain;

  const lfo = ac.createOscillator();
  lfo.frequency.value = spec.breath;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = spec.gain * 0.55;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  src.start(t);
  lfo.start(t);

  const nodes: AudioScheduledSourceNode[] = [src, lfo];
  if (spec.hum !== null) {
    const hum = ac.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = spec.hum;
    const hg = ac.createGain();
    hg.gain.value = 0.05;
    hum.connect(hg);
    hg.connect(out);
    hum.start(t);
    nodes.push(hum);
  }

  ambientTier = tier;
  ambient = (): void => {
    for (const n of nodes) {
      try {
        n.stop();
      } catch {
        /* уже остановлен — гасить дважды не ошибка */
      }
    }
  };
}

/* ---------- мелодия лагеря (§18.4) ---------- */

/**
 * Единственная мелодия в игре. Вылазке она не положена: сессия там две
 * минуты, и музыка надоедает за день.
 *
 * Нота задаётся номером MIDI, а не герцами, ровно затем, чтобы строй можно
 * было проверить правилом: вся петля лежит в ля-миноре — том же строе, что
 * арпеджио роста здания (523·659·784·1046 — до-мажор, §18.3). Здание,
 * достроившееся под музыку, попадает внутрь неё, а не поверх.
 */
export interface Note {
  /** Номер MIDI: 69 — ля первой октавы, 440 Гц. */
  readonly midi: number;
  /** Секунды от начала фразы. */
  readonly at: number;
  readonly dur: number;
}

export interface Phrase {
  readonly notes: readonly Note[];
  /** Тишина после фразы, в секундах. */
  readonly restSec: number;
}

/**
 * Две фразы вперемешку, а не одна: повторяемая буквально петля превращается
 * в метроном на третьем круге — та же причина, по которой у шага два
 * варианта (§18.3).
 */
export const CAMP_PHRASES: readonly Phrase[] = [
  {
    notes: [
      { midi: 69, at: 0, dur: 0.9 },
      { midi: 72, at: 0.55, dur: 0.7 },
      { midi: 76, at: 1.1, dur: 1.1 },
      { midi: 74, at: 2.0, dur: 0.8 },
      { midi: 69, at: 2.7, dur: 1.4 },
    ],
    restSec: 6,
  },
  {
    notes: [
      { midi: 64, at: 0, dur: 1.0 },
      { midi: 67, at: 0.6, dur: 0.8 },
      { midi: 69, at: 1.2, dur: 1.2 },
      { midi: 67, at: 2.2, dur: 0.7 },
      { midi: 64, at: 2.8, dur: 1.6 },
    ],
    restSec: 9,
  },
];

/** Гудящая нота под фразой: ля большой октавы, почти неслышно. */
const CAMP_DRONE = 45;

export const midiHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** Длина фразы — до конца последней ноты, а не до её начала. */
export const phraseSec = (p: Phrase): number =>
  p.notes.reduce((end, n) => Math.max(end, n.at + n.dur), 0);

let tuneTimer: ReturnType<typeof setTimeout> | null = null;
let tuneOn = false;
let tuneAt = 0;

/**
 * Запечённая музыка. Как и сэмплы §18.3: файл — это тембр, а не звук.
 * Плейлиста два: наземный и пещерный (копи и дно, решает сцена в
 * `soundFor`). Пока файлы едут — и если не доедут вовсе — играют фразы
 * CAMP_PHRASES, поэтому игра не бывает немой из-за сети.
 */
export type MusicMood = 'camp' | 'cave';
const MUSIC_FILES: Record<MusicMood, readonly string[]> = {
  camp: ['./music/camp0.m4a', './music/camp1.m4a'],
  cave: ['./music/cave0.m4a', './music/cave1.m4a'],
};
/** Под шину амбиента: треки смастерены громче процедурных фраз. */
const MUSIC_GAIN = 0.35;
/** Пауза между треками: подряд без вдоха они слипаются в радио. */
const MUSIC_GAP_SEC = 4;
const musicBufs: Record<MusicMood, (AudioBuffer | null)[]> = {
  camp: MUSIC_FILES.camp.map(() => null),
  cave: MUSIC_FILES.cave.map(() => null),
};
let musicAsked = false;
let musicMood: MusicMood = 'camp';
let musicAt = 0;
let musicSrc: AudioBufferSourceNode | null = null;

function loadMusic(): void {
  if (musicAsked || ac === null) return;
  musicAsked = true;
  for (const mood of ['camp', 'cave'] as const) {
    MUSIC_FILES[mood].forEach((file, i) => {
      void fetch(file)
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          return await ac!.decodeAudioData(await res.arrayBuffer());
        })
        .then((buf) => {
          // Файл доехал посреди игры: фразы уступят ему на ближайшей
          // границе — playPhrase сам увидит буфер. Перебивать звучащую
          // фразу нельзя, это два слоя музыки разом.
          musicBufs[mood][i] = buf;
        })
        .catch(() => {});
    });
  }
}

/** Первый уже доехавший трек настроения, начиная с `musicAt`; null — рано. */
function nextMusic(): AudioBuffer | null {
  const bufs = musicBufs[musicMood];
  for (let i = 0; i < bufs.length; i++) {
    const buf = bufs[(musicAt + i) % bufs.length];
    if (buf !== null && buf !== undefined) {
      musicAt = (musicAt + i) % bufs.length;
      return buf;
    }
  }
  return null;
}

function playMusic(): void {
  if (!tuneOn || ac === null || musicSrc !== null) return;
  const buf = nextMusic();
  if (buf === null) return;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = MUSIC_GAIN;
  src.connect(g);
  g.connect(buses.get('amb')!);
  src.onended = (): void => {
    if (musicSrc !== src) return; // остановлен снаружи
    musicSrc = null;
    musicAt = (musicAt + 1) % musicBufs[musicMood].length;
    if (tuneOn) tuneTimer = setTimeout(playMusic, MUSIC_GAP_SEC * 1000);
  };
  src.start();
  musicSrc = src;
}

function playPhrase(): void {
  if (tuneTimer !== null) clearTimeout(tuneTimer);
  tuneTimer = null;
  if (!tuneOn || ac === null) return;
  if (nextMusic() !== null) {
    playMusic();
    return;
  }

  const phrase = CAMP_PHRASES[tuneAt % CAMP_PHRASES.length]!;
  const len = phraseSec(phrase);
  tn({ type: 'sine', f0: midiHz(CAMP_DRONE), dur: len, gain: 0.05, bus: 'amb' });
  for (const n of phrase.notes) {
    tn({ type: 'triangle', f0: midiHz(n.midi), dur: n.dur, gain: 0.11, at: n.at, bus: 'amb' });
  }

  tuneAt++;
  tuneTimer = setTimeout(playPhrase, (len + phrase.restSec) * 1000);
}

/**
 * Мелодия лагеря. Начинается с тишины, а не с ноты: вход в лагерь
 * и так звучит — экраном возврата или ростом здания, — и музыка,
 * стартующая одновременно с ними, слышится как каша.
 */
export function startCampTune(mood: MusicMood = 'camp'): void {
  if (tuneOn) {
    if (mood === musicMood) return;
    // Настроение сменилось на ходу — под землю с наземным треком не ходят.
    stopCampTune();
  }
  musicMood = mood;
  musicAt = 0;
  tuneOn = true;
  loadMusic();
  tuneTimer = setTimeout(playPhrase, 1200);
}

export function stopCampTune(): void {
  tuneOn = false;
  if (tuneTimer !== null) clearTimeout(tuneTimer);
  tuneTimer = null;
  if (musicSrc !== null) {
    try {
      musicSrc.stop();
    } catch {
      /* уже остановлен */
    }
    musicSrc = null;
  }
}

export function stopAmbient(): void {
  ambient?.();
  ambient = null;
  ambientTier = -1;
}

/**
 * §18.5 — сворачивание глушит звук немедленно: звук из свёрнутой игры
 * это главная причина, по которой её удаляют.
 */
export function bindPageAudio(): void {
  // §18.5 — запуск по первому жесту, каким бы он ни был: тап по земле,
  // кнопка заставки или карточка в лагере. Слушатель на документе, а не
  // на канвасе, именно поэтому — первым игрок трогает кнопку «Играть».
  document.addEventListener('pointerdown', () => unlockAudio(), { once: true });

  // Что глушили при сворачивании — чтобы вернуть при развороте: сцена
  // о сворачивании не знает и перезапускать мелодию сама не станет.
  let tuneHushed = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      tuneHushed = tuneOn;
      stopPulse();
      stopAmbient();
      stopCampTune();
      if (ac !== null && ac.state === 'running') void ac.suspend();
    } else {
      if (ac !== null && ac.state === 'suspended') void ac.resume();
      if (tuneHushed) {
        tuneHushed = false;
        startCampTune(musicMood);
      }
    }
  });
}
