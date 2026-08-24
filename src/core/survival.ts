/**
 * Площадь под кривой выживания.
 *
 * Одно тождество: **средняя продолжительность жизни равна интегралу функции
 * выживания**, `LT = ∫S(t)dt`. Оно не знает, что под ним, и в этом вся его
 * польза — под ним лежит и глубина вылазки, и день жизни игрока:
 *
 * - `S(d)` = доля вылазок, ещё живых на глубине `d` → площадь = докуда ярус
 *   пускает героя (§11.3);
 * - `S(t)` = доля игроков, ещё заходящих на день `t` → площадь = LT, и
 *   `LT × ARPDAU = LTV`, когда появятся игроки и покупки.
 *
 * Считать это средним по выборке нельзя, и вот почему. Наблюдение бывает
 * двух видов: **гибель** («умер на глубине 0,6») и **обрыв** («был жив
 * на 0,6 и ушёл домой»). Второе — не гибель на 0,6, а «прожил не меньше
 * 0,6», и среднее по одним погибшим выбрасывает всех, кто прошёл глубже
 * и вернулся. Оценка занижается тем сильнее, чем осторожнее играют.
 * Каплан—Мейер этого не делает: оборванное наблюдение остаётся в знаменателе
 * до момента обрыва и после него просто перестаёт считаться.
 *
 * Модуль чисто арифметический: игровых понятий здесь нет намеренно, чтобы
 * ту же функцию можно было позвать и из замера бота, и из разбора телеметрии.
 */

/** Одно наблюдение: докуда дожили и чем кончилось. */
export interface Observation {
  /** Момент конца: глубина, день, шаг — единица не важна, лишь бы одна. */
  readonly time: number;
  /** true — событие случилось. false — наблюдение оборвано живым (цензура). */
  readonly dead: boolean;
}

/** Ступень кривой: в момент `time` из `atRisk` живых погибло `deaths`. */
export interface SurvivalStep {
  readonly time: number;
  readonly atRisk: number;
  readonly deaths: number;
  /** S(time) — доля, пережившая этот момент. */
  readonly survival: number;
}

export interface SurvivalCurve {
  readonly steps: readonly SurvivalStep[];
  /** Самое позднее наблюдение. Дальше него данных нет вообще. */
  readonly horizon: number;
  readonly total: number;
  readonly deaths: number;
  /**
   * S(horizon) — доля, дожившая до края данных. Ноль означает, что кривая
   * досчитана до конца и площадь под ней — полное среднее. Всё, что больше
   * нуля, — необсчитанный хвост: его либо нет в природе (глубина упирается
   * в дно локации), либо он есть, и тогда его продлевают `powerFit`.
   */
  readonly tail: number;
}

/**
 * Оценка Каплана—Мейера. Ступени ставятся только там, где кто-то погиб;
 * обрывы двигают лишь знаменатель.
 */
export function kaplanMeier(obs: readonly Observation[]): SurvivalCurve {
  const sorted = [...obs].sort((a, b) => a.time - b.time);
  const steps: SurvivalStep[] = [];
  let survival = 1;
  let deaths = 0;
  let i = 0;
  while (i < sorted.length) {
    const time = sorted[i]!.time;
    // Живыми на момент `time` считаются все, чьё наблюдение ещё не кончилось,
    // включая тех, кто кончается ровно сейчас: смерть в момент t наступает
    // раньше обрыва в тот же момент — иначе обрыв «спасал» бы от неё.
    const atRisk = sorted.length - i;
    let d = 0;
    while (i < sorted.length && sorted[i]!.time === time) {
      if (sorted[i]!.dead) d += 1;
      i += 1;
    }
    if (d === 0) continue;
    deaths += d;
    survival *= 1 - d / atRisk;
    steps.push({ time, atRisk, deaths: d, survival });
  }
  return {
    steps,
    horizon: sorted.length > 0 ? sorted[sorted.length - 1]!.time : 0,
    total: sorted.length,
    deaths,
    tail: survival,
  };
}

/** S(t) по кривой. До первой ступени — единица. */
export function survivalAt(curve: SurvivalCurve, t: number): number {
  let s = 1;
  for (const step of curve.steps) {
    if (step.time > t) break;
    s = step.survival;
  }
  return s;
}

/**
 * Площадь под кривой до горизонта — та самая `∫S(t)dt`, обрезанная там, где
 * кончились данные. Обрезка честная и обязана быть видна рядом с числом:
 * при `tail > 0` это не среднее время жизни, а среднее время жизни
 * **в пределах наблюдения**.
 */
export function restrictedMean(curve: SurvivalCurve, horizon: number = curve.horizon): number {
  let area = 0;
  let prev = 0;
  let s = 1;
  for (const step of curve.steps) {
    if (step.time >= horizon) break;
    area += s * (step.time - prev);
    prev = step.time;
    s = step.survival;
  }
  return area + s * Math.max(0, horizon - prev);
}

/** Ведро риска: сколько живых вошло в отрезок и сколько в нём погибло. */
export interface HazardBin {
  readonly from: number;
  readonly to: number;
  /** Живые на входе в отрезок — знаменатель условной вероятности. */
  readonly atRisk: number;
  readonly deaths: number;
  /**
   * `ĥ` на единицу времени: `deaths / atRisk / (to − from)`. Делить на ширину
   * обязательно — иначе число меряется в вёдрах, и вдвое более узкая сетка
   * даёт вдвое меньший «риск» на тех же данных.
   */
  readonly rate: number;
}

/**
 * Функция риска по наблюдениям — вероятность погибнуть в отрезке при условии,
 * что до него дожили. То же `deaths / atRisk`, что уже считает `kaplanMeier`,
 * но не свёрнутое в произведение: кривая отвечает «сколько дошло», риск —
 * **где именно их убавляет**.
 *
 * Разница не косметическая. `S(t)` убывает всегда, и по ней стена неотличима
 * от ровного отсева: обе дают падающую линию. Риск разделяет их сразу —
 * ровный отсев держит `ĥ` постоянной, стена выбрасывает пик в одном ведре.
 *
 * Живыми на входе считаются все, чьё наблюдение не кончилось раньше `from`,
 * включая кончающихся ровно на границе, — та же условность, что в `kaplanMeier`:
 * гибель в момент `t` наступает раньше обрыва в тот же момент.
 *
 * Ширина ведра — не деталь округления, а разрешение прибора: узкие вёдра
 * ловят стену, но набирают шум, широкие наоборот. Поэтому она задаётся
 * зовущим, а `atRisk` печатается рядом со ставкой, чтобы «риск 400%»
 * при трёх живых нельзя было прочесть как факт.
 */
export function hazard(
  obs: readonly Observation[],
  width: number,
  until?: number,
): readonly HazardBin[] {
  if (width <= 0 || obs.length === 0) return [];
  const end = until ?? obs.reduce((a, o) => Math.max(a, o.time), 0);
  const bins: HazardBin[] = [];
  for (let from = 0; from < end - 1e-9; from += width) {
    const to = from + width;
    let atRisk = 0;
    let deaths = 0;
    for (const o of obs) {
      if (o.time >= from - 1e-9) atRisk += 1;
      if (o.dead && o.time >= from - 1e-9 && o.time < to - 1e-9) deaths += 1;
    }
    if (atRisk === 0) break;
    bins.push({ from, to, atRisk, deaths, rate: deaths / atRisk / width });
  }
  return bins;
}

/** Среднее по одним погибшим — то, как это считается без кривой. */
export function meanOfDeaths(obs: readonly Observation[]): number | null {
  const dead = obs.filter((o) => o.dead);
  if (dead.length === 0) return null;
  return dead.reduce((a, o) => a + o.time, 0) / dead.length;
}

/** Среднее по всем наблюдениям, где обрыв засчитан как гибель. */
export function meanOfAll(obs: readonly Observation[]): number {
  if (obs.length === 0) return 0;
  return obs.reduce((a, o) => a + o.time, 0) / obs.length;
}

/** Степенная подгонка `y = a·x^b`. */
export interface PowerFit {
  readonly a: number;
  readonly b: number;
  /** Качество подгонки — в логарифмах, потому что и метод наименьших
   *  квадратов применён к ним же. Единице соответствует точная степень. */
  readonly r2: number;
}

/**
 * Подгонка удержания степенной функцией — тот самый шаг, ради которого
 * кривую вообще рисуют: данные кончаются на дне N, а жизнь игрока — нет.
 * Прямая по логарифмам, точки с нулём или отрицательным значением выпадают.
 *
 * **Это про удержание по дням и только про него.** Степень несёт в себе
 * утверждение о риске — `h(t) = −b/t`, то есть «риск падает», — и на уходе
 * игрока оно верно: кто пережил первую неделю, уходит уже неохотно. На глубине
 * вылазки оно ложно ровно наоборот: риск там растёт к дну (§22.17, `npm run
 * survive`), r² подгонки падает до 0,23, и `−b/t` расходится с измеренным
 * до ×17. Кривую глубины строить можно и нужно, а продлевать её степенью —
 * нельзя: семейство не то, и число выйдет уверенным и неправильным.
 */
export function powerFit(points: readonly { readonly x: number; readonly y: number }[]): PowerFit | null {
  const ok = points.filter((p) => p.x > 0 && p.y > 0);
  if (ok.length < 2) return null;
  const lx = ok.map((p) => Math.log(p.x));
  const ly = ok.map((p) => Math.log(p.y));
  const n = ok.length;
  const mx = lx.reduce((a, v) => a + v, 0) / n;
  const my = ly.reduce((a, v) => a + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (lx[i]! - mx) * (ly[i]! - my);
    sxx += (lx[i]! - mx) ** 2;
  }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  const lnA = my - b * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    ssRes += (ly[i]! - (lnA + b * lx[i]!)) ** 2;
    ssTot += (ly[i]! - my) ** 2;
  }
  return { a: Math.exp(lnA), b, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot };
}

/**
 * Риск по подогнанной кривой: `h(t) = −d(ln S)/dt`, а при `S = a·t^b` — просто
 * `−b/t`. Формула чужая (gdcuffs, «Функция риска»), и держать её рядом
 * с `powerFit` стоит затем, что она — **следствие выбора семейства кривых,
 * а не вывод из данных**: степень умеет падать и не умеет ничего другого.
 *
 * Отсюда единственный способ ей не поверить: считать `hazard` по наблюдениям
 * и смотреть, где расходится. Совпало — подгонка описывает данные; пик
 * в одном ведре — кривая его сгладила и спрятала.
 *
 * `a` в ответ не входит: высота кривой на риск не влияет, влияет наклон.
 */
export function fittedHazard(fit: PowerFit, t: number): number | null {
  if (t <= 0) return null;
  return -fit.b / t;
}

/**
 * Площадь хвоста `∫a·x^b dx` от `from` до бесконечности — то, что данные
 * не показали.
 *
 * `null` при `b >= -1` означает расходимость: подогнанная кривая обещает
 * бесконечную жизнь, и складывать её с обрезанной площадью нельзя. Это
 * не ошибка вычисления, а ответ «данных мало» — и он обязан быть видимым,
 * а не подменяться нулём.
 */
export function tailArea(fit: PowerFit, from: number): number | null {
  if (from <= 0 || fit.b >= -1) return null;
  return (fit.a * from ** (fit.b + 1)) / -(fit.b + 1);
}

/**
 * Площадь `∫a·x^b dx` на **конечном** отрезке `[from, to]`. В отличие
 * от `tailArea` считается всегда: расходится бесконечный хвост, а не кусок.
 *
 * Отдельная функция нужна не для удобства. Считать LT по подогнанной кривой
 * можно двумя способами, и они дают разные ответы: `restrictedMean + tailArea`
 * честно говорит «данных мало» отказом, а эта — всегда возвращает число.
 * Число конечно ровно потому, что `to` конечен, и при `b >= -1` оно
 * не приближение бесконечной площади, а другая величина: сколько наиграют
 * **за выбранный срок**. Срок здесь — не деталь округления, а главный
 * свободный параметр, и звать эту функцию, не назвав его вслух, значит
 * выдать выбор горизонта за свойство игры (§22.16).
 */
export function powerArea(fit: PowerFit, from: number, to: number): number | null {
  if (from <= 0 || to < from) return null;
  const p = fit.b + 1;
  if (p === 0) return fit.a * Math.log(to / from);
  return (fit.a * (to ** p - from ** p)) / p;
}
