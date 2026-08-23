/**
 * Матмодель как гипотеза. Прибор написан под четвёртый текст цикла
 * «Игровой баланс» (gdcuffs) и под то, чем на этот вопрос отвечает индустрия.
 *
 * Статья говорит одно и говорит верно: **матмодель — это гипотеза, которая
 * требует доказательства в геймплее**, а таблица сама по себе ничего
 * не гарантирует. Наша матмодель — §22: ярус описывается сложностью,
 * числа выводит `deriveTier`. Доказательство в геймплее у нас тоже есть —
 * бот. Не хватало третьего: **проверки самого сильного утверждения модели.**
 *
 * §22.1 заявляет, что осей сложности три и они независимы, и ссылается
 * на подбор ботом «120 забегов на точку». Так меряют по одной ручке за раз
 * (one-at-a-time). Метод этот в литературе по анализу чувствительности
 * считается негодным ровно для того вывода, ради которого мы его применили:
 * он щупает окрестность одной точки и по построению не видит **взаимодействий**
 * ручек. «Почти независимы» из §22.1 — это утверждение про одну точку,
 * а не про модель.
 *
 * Отраслевой ответ на это — глобальный анализ чувствительности; в питоне
 * он лежит готовым в `SALib`, здесь два его метода написаны прямо тут,
 * потому что тащить питон в проект ради двухсот строк арифметики незачем:
 *
 *  - **Моррис** (elementary effects) — дешёвый просев: какая ручка вообще
 *    двигает результат. Даёт `μ*` (сила влияния) и `σ` (насколько влияние
 *    зависит от того, где стоят остальные ручки).
 *  - **Соболь** (variance-based) — дорогой и точный: раскладывает дисперсию
 *    результата на доли ручек. `S1` — что ручка делает сама, `ST` — что она
 *    делает вместе со всеми. **Разрыв `ST − S1` и есть взаимодействие**,
 *    то самое, которого не видит замер по одной ручке.
 *
 * Что здесь меряется: не «хорошие ли числа в `TIER_SPEC`» — на это отвечает
 * `npm run measure`, — а **годится ли сама модель как ручки для дизайнера.**
 * Ось, у которой `S1` мал, а `ST` велик, — не ось: крутить её в отрыве
 * от остальных бессмысленно.
 *
 * Отдельным блоком снимается **шум прибора**. Бот случаен, и часть дисперсии
 * не объясняется ручками вовсе; не зная её доли, любой индекс можно принять
 * за находку. Ниже шума ничего не читается — это граница разрешения, и она
 * печатается первой.
 *
 * Запуск: npm run model
 */
import { mulberry32 } from '../src/core/rng';
import { TIER_SPEC } from '../src/sim/balance';
import { playSession, RAIDS } from '../src/sim/session';
import { evaluateSpec } from './tierlab';
import type { TierSpec } from '../src/sim/balance';
import type { Tier } from '../src/sim/types';

/** Ярус, на котором ставится опыт. Середина кривой: есть и дорога,
 *  и находки, и все три роли врагов. */
const TIER: Tier = 2;
/**
 * Забегов на одну точку пространства. Столько же, сколько снимает
 * `npm run encounter`, и сиды у всех точек **одни и те же** — приём
 * называется общими случайными числами и нужен затем, что иначе разница
 * между двумя настройками тонет в разнице между сидами.
 */
const RUNS = 200;
/** Траекторий Морриса. */
const TRAJECTORIES = 12;
/** Уровней сетки Морриса. Чётное, шаг — `p/(2(p−1))`. */
const LEVELS = 8;
/** Базовый размер выборки Соболя: всего вызовов модели — `n·(k+2)`. */
const SOBOL_N = 128;

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const variance = (xs: readonly number[]): number => {
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
};
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

/* ---------- ручки и то, что модель на них отвечает ---------- */

/**
 * Ручки берутся те, что §22 называет осями, плюс две геометрические.
 * Границы — не «любые числа», а тот коридор, внутри которого дизайнер
 * вправду двигает ярус: за ним модель отвечает уже не про эту игру.
 *
 * `containers` в список не входит, потому что она не свободна: в `TIER_SPEC`
 * находок ровно `размер/2 − 1` на всех четырёх ярусах, и развязывать их —
 * значит мерить ярусы, которых в игре нет.
 */
interface Knob {
  readonly key: keyof TierSpec;
  readonly name: string;
  readonly lo: number;
  readonly hi: number;
  readonly whole?: boolean;
}

const KNOBS: readonly Knob[] = [
  { key: 'size', name: 'размер N', lo: 8, hi: 20, whole: true },
  { key: 'generosity', name: 'щедрость θ', lo: 0.2, hi: 1 },
  { key: 'capacityRatio', name: 'рюкзак λ', lo: 0.8, hi: 2.2 },
  { key: 'woundBudget', name: 'бюджет ран ω', lo: 0.2, hi: 1.2 },
  { key: 'depthValue', name: 'цена глубины', lo: 1.2, hi: 3.5 },
];

/** Что модель отвечает. Четыре величины, каждую из которых §22 обещает
 *  держать: успех, добыча, глубина провала и то, чем провал нанесён. */
interface Answer {
  readonly success: number;
  readonly haul: number;
  readonly failDepth: number;
  readonly byFood: number;
}
const OUTPUTS: readonly { key: keyof Answer; name: string }[] = [
  { key: 'success', name: 'доля успеха' },
  { key: 'haul', name: 'добыча за заход' },
  { key: 'failDepth', name: 'глубина провала' },
  { key: 'byFood', name: 'провалов от голода' },
];

/** Точка пространства ручек: доли 0..1 по каждой ручке. */
type Point = readonly number[];

/** Описание яруса из точки. Ручки, которых нет в списке, остаются свои. */
function specOf(p: Point): TierSpec {
  const spec: Record<string, number> = { ...TIER_SPEC[TIER] };
  KNOBS.forEach((k, i) => {
    const raw = k.lo + (k.hi - k.lo) * Math.min(1, Math.max(0, p[i]!));
    spec[k.key] = k.whole ? Math.round(raw) : raw;
  });
  // Находки привязаны к размеру той же формулой, что стоит в `TIER_SPEC`.
  spec.containers = Math.max(2, Math.round(spec.size! / 2) - 1);
  return spec as unknown as TierSpec;
}

/* ---------- вызов модели: описание → числа → бот ---------- */

/** Прогон точки. Подменой таблиц занимается общий стенд (`tierlab.ts`):
 *  страховка «восстановить в finally» обязана быть одна на все приборы. */
function evaluate(p: Point, runs = RUNS, seedBase = 1): Answer {
  const got = evaluateSpec(TIER, specOf(p), runs, seedBase);
  return { success: got.success, haul: got.haul, failDepth: got.failDepth, byFood: got.byFood };
}

const K = KNOBS.length;
const rng = mulberry32(20260823);

console.log('Матмодель как гипотеза: глобальная чувствительность модели §22\n');
console.log(
  `ярус ${TIER}, ${RUNS} забегов на точку, ручек ${K}, сиды у всех точек общие\n`,
);

/* ══════════════════════════════════════════════════════════════════════════
   0. Шум прибора — граница разрешения всего остального
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Одно и то же описание, разные сиды забегов. Всё, что прибор покажет ниже
 * этой величины, — не находка, а дрожь бота.
 */
console.log('══ 0. Шум прибора: то же описание, другие сиды ══\n');

const centre: Point = KNOBS.map(() => 0.5);
const repeats = Array.from({ length: 12 }, (_, i) => evaluate(centre, RUNS, 1 + i * RUNS));
console.log('величина              среднее   разброс (σ)   шум как доля среднего');
const noise: Record<string, number> = {};
for (const out of OUTPUTS) {
  const xs = repeats.map((r) => r[out.key]);
  const sd = Math.sqrt(variance(xs));
  noise[out.key] = sd;
  console.log(
    `${out.name.padEnd(20)}${mean(xs).toFixed(3).padStart(9)}${sd.toFixed(4).padStart(14)}` +
      `${pct(sd / Math.max(0.001, Math.abs(mean(xs)))).padStart(24)}`,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   1. Моррис: какая ручка вообще двигает результат
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Elementary effects. Траектория — это точка на сетке и `k` шагов из неё,
 * каждый по своей ручке; эффект ручки на шаге — приращение результата,
 * делённое на длину шага. Метод стоит `r·(k+1)` вызовов вместо `n·(k+2)`
 * у Соболя и потому идёт первым: он говорит, что вообще стоит считать точно.
 *
 * Читаются два числа. `μ*` — среднее модуля эффекта, то есть сила ручки.
 * `σ` — разброс эффекта по траекториям: **большая σ означает, что ручка
 * работает по-разному в зависимости от остальных**, а это и есть след
 * взаимодействия, невидимый замеру по одной ручке.
 */
console.log('\n\n══ 1. Моррис: просев ручек ══\n');

const delta = LEVELS / (2 * (LEVELS - 1));
const grid = (): number => Math.floor(rng() * (LEVELS / 2)) / (LEVELS - 1);

const effects: number[][][] = KNOBS.map(() => OUTPUTS.map(() => []));

for (let t = 0; t < TRAJECTORIES; t++) {
  const base = KNOBS.map(() => grid());
  const order = KNOBS.map((_, i) => i).sort(() => rng() - 0.5);
  let cur = [...base];
  let prev = evaluate(cur);
  for (const i of order) {
    const next = [...cur];
    // Шаг всегда внутрь области: у края идём в другую сторону, иначе точка
    // выпадает за коридор и модель считает ярус, которого в игре нет.
    const step = next[i]! + delta <= 1 ? delta : -delta;
    next[i] = next[i]! + step;
    const got = evaluate(next);
    OUTPUTS.forEach((out, j) => {
      effects[i]![j]!.push((got[out.key] - prev[out.key]) / step);
    });
    cur = next;
    prev = got;
  }
}

for (const [j, out] of OUTPUTS.entries()) {
  console.log(`— ${out.name} —`);
  console.log('ручка              μ* (сила)   σ (зависит от соседей)');
  const rows = KNOBS.map((k, i) => {
    const es = effects[i]![j]!;
    return { name: k.name, mu: mean(es.map(Math.abs)), sd: Math.sqrt(variance(es)) };
  }).sort((a, b) => b.mu - a.mu);
  for (const r of rows) {
    console.log(`${r.name.padEnd(18)}${r.mu.toFixed(3).padStart(10)}${r.sd.toFixed(3).padStart(25)}`);
  }
  console.log('');
}

/* ══════════════════════════════════════════════════════════════════════════
   2. Соболь: сколько дисперсии за какой ручкой
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Схема Салтелли: две независимые выборки `A` и `B` и `k` смешанных `AB_i`,
 * где у `A` подменена одна колонка. Оценки — те же, что в `SALib`:
 * `S1` по Салтелли (2010), `ST` по Янсену.
 *
 * Что читать. `S1` — доля дисперсии, которую ручка объясняет сама по себе;
 * `ST` — вместе со всеми своими взаимодействиями. Сумма `S1` заметно меньше
 * единицы или сумма `ST` заметно больше — значит модель не раскладывается
 * на независимые ручки, и «оси независимы» из §22.1 придётся переписать.
 */
console.log('\n══ 2. Соболь: доли дисперсии ══\n');

const sample = (): number[] => KNOBS.map(() => rng());
const A = Array.from({ length: SOBOL_N }, sample);
const B = Array.from({ length: SOBOL_N }, sample);

const evalAll = (pts: readonly Point[]): Answer[] => pts.map((p) => evaluate(p));
const yA = evalAll(A);
const yB = evalAll(B);
const yAB: Answer[][] = KNOBS.map((_, i) =>
  evalAll(A.map((row, r) => row.map((v, c) => (c === i ? B[r]![c]! : v)))),
);

console.log(`вызовов модели: ${SOBOL_N * (K + 2)} × ${RUNS} забегов\n`);

const interactions: Record<string, number> = {};
for (const out of OUTPUTS) {
  const a = yA.map((y) => y[out.key]);
  const b = yB.map((y) => y[out.key]);
  const varY = variance([...a, ...b]);
  console.log(`— ${out.name} — дисперсия ${varY.toFixed(4)}, шум ${(noise[out.key]! ** 2).toFixed(4)}`);
  /**
   * Вырожденная величина: делить на дисперсию, которой нет, — значит
   * печатать шум в виде индексов, и именно так прибор и врал, показывая
   * `ST = 3,07` у доли провалов от голода. Порог абсолютный, а не только
   * по шуму: при обеих величинах около нуля сравнение «дисперсия не выше
   * шума» ничего не отсекает.
   *
   * Один процентный пункт разброса — граница, ниже которой величина
   * для дизайнера стоит на месте.
   */
  const sd = Math.sqrt(varY);
  if (sd < 0.01 || varY <= (noise[out.key] ?? 0) ** 2) {
    console.log(
      `  ⚠ величина не двигается: разброс ${sd.toFixed(4)} при среднем ` +
        `${mean([...a, ...b]).toFixed(3)}. Ручки §22 её не меняют, и индексы\n` +
        '     здесь считали бы шум.\n',
    );
    continue;
  }
  console.log('ручка                    S1 (сама)   ST (со всеми)   взаимодействие');
  let sumS1 = 0;
  let sumST = 0;
  const rows = KNOBS.map((k, i) => {
    const ab = yAB[i]!.map((y) => y[out.key]);
    // Салтелли-2010: S1 = 1/n Σ f(B)·(f(AB) − f(A)) / Var
    const s1 = mean(b.map((v, r) => v * (ab[r]! - a[r]!))) / varY;
    // Янсен: ST = 1/(2n) Σ (f(A) − f(AB))² / Var
    const st = mean(a.map((v, r) => (v - ab[r]!) ** 2)) / (2 * varY);
    sumS1 += s1;
    sumST += st;
    return { name: k.name, s1, st };
  }).sort((x, y2) => y2.st - x.st);
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(22)}${r.s1.toFixed(3).padStart(10)}${r.st.toFixed(3).padStart(16)}` +
        `${(r.st - r.s1).toFixed(3).padStart(17)}`,
    );
  }
  const share = Math.max(0, 1 - sumS1);
  interactions[out.key] = share;
  console.log(
    `${'сумма'.padEnd(22)}${sumS1.toFixed(3).padStart(10)}${sumST.toFixed(3).padStart(16)}\n` +
      `  на взаимодействия и шум приходится ${pct(share)} дисперсии\n`,
  );
}

/**
 * Вердикт. Порог в четверть выбран не из литературы, а из того, чем модель
 * пользуются: если больше четверти поведения яруса живёт во взаимодействиях,
 * дизайнер, крутящий одну ручку, получает не то, что обещает таблица §22.1.
 */
/** Самая переплетённая ручка. Средний вердикт может пройти при том,
 *  что одна ось наполовину состоит из взаимодействий, — и крутить в отрыве
 *  надо запрещать именно её, а не «модель вообще». */
let tangled = { name: '—', gap: 0 };
for (const out of OUTPUTS) {
  const a = yA.map((y) => y[out.key]);
  const b = yB.map((y) => y[out.key]);
  const varY = variance([...a, ...b]);
  if (Math.sqrt(varY) < 0.01) continue;
  KNOBS.forEach((k, i) => {
    const ab = yAB[i]!.map((y) => y[out.key]);
    const s1 = mean(b.map((v, r) => v * (ab[r]! - a[r]!))) / varY;
    const st = mean(a.map((v, r) => (v - ab[r]!) ** 2)) / (2 * varY);
    if (st - s1 > tangled.gap) tangled = { name: `${k.name} (${out.name})`, gap: st - s1 };
  });
}

const worst = Math.max(0, ...Object.values(interactions));
const worstOut = OUTPUTS.find((o) => interactions[o.key] === worst)?.name ?? '—';
console.log(
  worst <= 0.25
    ? `✓ Оси раскладываются: на взаимодействия и шум приходится не больше\n` +
        `  ${pct(worst)} дисперсии (хуже всего — «${worstOut}»). Заявление §22.1\n` +
        '  про независимость держится и при глобальной проверке, а не только\n' +
        '  в окрестности нынешних чисел.'
    : `⚠ Оси не раскладываются: до ${pct(worst)} дисперсии живёт во взаимодействиях\n` +
        `  и шуме (хуже всего — «${worstOut}»). Замер по одной ручке этого\n` +
        '  не видит по построению, и «почти независимы» из §22.1 — утверждение\n' +
        '  про одну точку, а не про модель.',
);
console.log(
  tangled.gap >= 0.2
    ? `\n  Но одна ось переплетена сильно: ${tangled.name}, разрыв ST − S1 = ${tangled.gap.toFixed(2)}.\n` +
        '  Её нельзя крутить в отрыве от остальных, даже если модель в среднем\n' +
        '  раскладывается.'
    : `\n  Самая переплетённая ось — ${tangled.name}, разрыв ${tangled.gap.toFixed(2)}: терпимо.`,
);

/* ══════════════════════════════════════════════════════════════════════════
   3. Чистое и расчётное время — то, с чего статья велит начинать
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Статья требует до всякой таблицы знать четыре числа: чистое время до целей,
 * расчётное время с таймерами, объём контента и жёсткость экономики —
 * когда игроку не хватает. Три из четырёх у нас снимаются существующей
 * моделью сессии (`src/sim/session.ts`), и снимать их отдельным прибором
 * незачем — незачем и держать их ненапечатанными.
 *
 * «Нет ресурсов» здесь и есть жёсткость: доля возвратов в лагерь, когда
 * купить нечего именно из-за денег, а не из-за гейта.
 */
console.log('\n\n══ 3. Чистое время, объём и жёсткость (по модели сессии) ══\n');

const SESSIONS = 40;
const runsOut = Array.from({ length: SESSIONS }, (_, i) => playSession(20260800 + i));
const levelsOf = (id: 'kitchen' | 'storage' | 'hq'): number => mean(runsOut.map((r) => r.levels[id]));
const noOfferTotal = (key: 'слот занят' | 'потолок Жилья' | 'нет ресурсов'): number =>
  mean(runsOut.map((r) => r.noOffer[key]));
const offers = (['слот занят', 'потолок Жилья', 'нет ресурсов'] as const).map((k) => ({
  k,
  v: noOfferTotal(k),
}));
const denied = offers.reduce((a, o) => a + o.v, 0);

console.log(`сессий ${SESSIONS} по ${RAIDS} вылазок\n`);
console.log(`чистое время (только вылазки)   ${mean(runsOut.map((r) => r.rows.reduce((a, x) => a + x.durationSec, 0) / 60)).toFixed(1)} мин`);
console.log(`расчётное время (с таймерами)   ${mean(runsOut.map((r) => r.elapsedHours)).toFixed(1)} ч`);
console.log(`докуда доросла лестница         Кухня ${levelsOf('kitchen').toFixed(1)}, Склад ${levelsOf('storage').toFixed(1)}, Жильё ${levelsOf('hq').toFixed(1)}`);
console.log(`возвратов без покупки           ${denied.toFixed(1)} из ${RAIDS}`);
for (const o of offers) {
  console.log(`  ${o.k.padEnd(30)}${o.v.toFixed(1)}`);
}
const hard = offers.find((o) => o.k === 'нет ресурсов')!.v / RAIDS;
console.log(
  hard >= 0.15 && hard <= 0.6
    ? `\n✓ Жёсткость экономики в рабочем коридоре: денег не хватает в ${pct(hard)}\n` +
        '  возвратов. Ресурс дефицитен, но не запирает лестницу.'
    : hard < 0.15
      ? `\n⚠ Экономика мягкая: денег не хватает лишь в ${pct(hard)} возвратов —\n` +
          '  ресурс перестаёт быть решением, и цена постройки ничего не значит.'
      : `\n⚠ Экономика жёсткая: денег не хватает в ${pct(hard)} возвратов —\n` +
          '  лестница упирается в добычу, а не в решения игрока.',
);

console.log(
  '\n\nЧто из этого менять — решает не прибор. Он отвечает на то, годится ли\n' +
    'модель §22 как ручки и сколько времени занимает нынешний контент.',
);
