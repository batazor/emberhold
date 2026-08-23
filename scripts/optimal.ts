/**
 * Как ходит оптимальный игрок — и сколько бот у него проигрывает.
 *
 * Вопрос задаёт §22.5, но задаёт его наполовину. Раздел выводит правило
 *
 *   EV(идти) = (B + g)·(1 − p·ρ)   EV(уйти) = B   →   идти, если g > B·p·ρ/(1 − p·ρ)
 *
 * и это правило **близорукое**: оно взвешивает одну следующую находку против
 * рюкзака и ничего не знает о том, что будет после неё. Между тем «взять ещё
 * или уйти» — классическая задача об оптимальной остановке, и у неё есть
 * точное решение обратной индукцией: считать не «стоит ли следующий шаг»,
 * а «сколько стоит вся оставшаяся вылазка отсюда».
 *
 * Откуда взят метод. В литературе ближайший родственник — правило Пандоры
 * (Weitzman, 1979): коробки с известными распределениями, цена вскрытия,
 * резервная цена `z`, решающая `E[(V − z)⁺] = c`. Оно у нас **не применимо
 * дословно**, и это надо сказать прямо: у Пандоры игрок забирает лучшую
 * коробку, а у нас добыча **накапливается** и вся целиком стоит под ставкой
 * §11.2. Поэтому берётся не формула Пандоры, а то, из чего она сама выведена, —
 * обратная индукция по состоянию. Для накопления с риском разорения это
 * и есть правильная форма.
 *
 * Что прибор делает:
 *   1. снимает с прогонов сокращённую модель вылазки — цену находки,
 *      её ценность и вероятность не дойти из состояния;
 *   2. решает её обратной индукцией и печатает **порог рюкзака** `B*(s)`:
 *      при каком запасе и какой добыче оптимальный игрок разворачивается;
 *   3. сравнивает этот порог с близоруким порогом §22.5;
 *   4. подаёт оба правила боту и печатает последствия на настоящей игре.
 *
 * Чего он не делает: не объявляет числа §22.5 неверными. Сокращённая модель
 * калибруется на прогонах самого бота, и её `V` — величина модели, а не
 * обещание игроку. Читать надо разницу правил, а не абсолют.
 *
 * Запуск: npm run optimal
 */
import { mulberry32 } from '../src/core/rng';
import { POLICIES, playRaid } from '../src/sim/bot';
import type { Decision, StopRule } from '../src/sim/bot';
import { referenceLoadout } from '../src/sim/heroes';
import {
  FOOD_COST,
  TIER_HERO_LEVEL,
  TIER_KITCHEN_GATE,
  TIER_RISK,
  indifferenceBag,
} from '../src/sim/balance';
import type { Tier } from '../src/sim/types';

/** Забегов на ярус. Столько же, сколько у `npm run stop`: приборы обязаны
 *  говорить об одной и той же вылазке. */
const RUNS = 300;
/** Ширина ведра запаса. Та же, что в §22.5-приборе: шаг «одна лишняя
 *  комната». */
const BUCKET = FOOD_COST.container;
/** Потолок рюкзака в сетке обратной индукции и шаг сетки. Потолок взят
 *  заведомо выше вместимости Склада: сетка обязана накрывать состояния,
 *  до которых игрок дойти может, а не только те, куда доходит бот. */
const BAG_MAX = 60;
const BAG_STEP = 0.5;
const BAG_CELLS = Math.round(BAG_MAX / BAG_STEP) + 1;

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

/* ---------- 1. Сокращённая модель, снятая с прогонов ---------- */

interface Run {
  readonly failed: boolean;
  readonly decisions: readonly Decision[];
  readonly carried: number;
  readonly depth: number;
}

function run(tier: Tier, stop?: StopRule): Run[] {
  const kitchen = TIER_KITCHEN_GATE[tier];
  const storage = tier + 1;
  const out: Run[] = [];
  for (let seed = 1; seed <= RUNS; seed++) {
    const r = playRaid(
      {
        seed,
        tier,
        kitchenLevel: kitchen,
        storageLevel: storage,
        loadout: referenceLoadout(TIER_HERO_LEVEL[tier]),
        stop,
      },
      POLICIES.cautious,
      mulberry32(seed),
    );
    out.push({
      failed: r.status !== 'evacuated',
      decisions: r.decisions,
      carried: r.carriedTotal,
      depth: r.locMaxBack > 0 ? r.maxBack / r.locMaxBack : 0,
    });
  }
  return out;
}

/** Запас сверх дороги домой — то, чем игрок вправду рискует. */
const spareOf = (d: Decision): number => d.foodLeft - d.backSteps * FOOD_COST.step;
const bucketOfSpare = (spare: number): number => Math.max(0, Math.floor(spare / BUCKET));

/**
 * Настоящие решения: бот пересматривает маршрут каждые три клетки, и одна
 * находка даёт несколько записей подряд. Решением считается первое и каждое
 * после того, как рюкзак изменился, — рюкзак растёт ровно на вскрытии.
 * Правило то же, что в `npm run stop`: иначе два прибора считали бы разное
 * под одним словом.
 */
function choices(decisions: readonly Decision[]): Decision[] {
  const out: Decision[] = [];
  let bag = -1;
  for (const d of decisions) {
    if (d.kind !== 'container') continue;
    if (d.bag !== bag) {
      out.push(d);
      bag = d.bag;
    }
  }
  return out;
}

interface Model {
  /** Вероятность, что забег кончится провалом, если идти дальше из ведра. */
  readonly fail: (spare: number) => number;
  /** Средняя ценность находки. */
  readonly gain: number;
  /** Во что обходится одна находка запасом: шаги до неё плюс вскрытие. */
  readonly cost: number;
  /** Ставка яруса (§11.2). */
  readonly risk: number;
  /** Запас на входе — с него начинается вылазка. */
  readonly spare0: number;
}

function fit(tier: Tier, runs: readonly Run[]): Model {
  const total = new Map<number, number>();
  const failed = new Map<number, number>();
  const gains: number[] = [];
  const costs: number[] = [];
  const starts: number[] = [];

  for (const r of runs) {
    const picks = choices(r.decisions);
    if (picks.length > 0) starts.push(spareOf(picks[0]!));
    picks.forEach((d, i) => {
      const b = bucketOfSpare(spareOf(d));
      total.set(b, (total.get(b) ?? 0) + 1);
      if (r.failed) failed.set(b, (failed.get(b) ?? 0) + 1);
      gains.push(d.gain);
      const next = picks[i + 1];
      // Цена находки — падение запаса до следующего решения. Отрицательных
      // не бывает: запас сверх дороги домой только убывает, пока идут вглубь.
      if (next !== undefined) costs.push(Math.max(0.5, spareOf(d) - spareOf(next)));
    });
  }

  /**
   * Доля провалов по ведру — но только там, где ведро набрало наблюдений.
   * Без порога редкое ведро даёт «не дойти 100%» с трёх решений, и обратная
   * индукция строит политику вокруг числа, которого нет. Пустые и редкие
   * вёдра берут значение ближайшего населённого.
   */
  const MIN_SAMPLE = 20;
  const p = new Map<number, number>();
  for (const [b, n] of total) if (n >= MIN_SAMPLE) p.set(b, (failed.get(b) ?? 0) / n);
  const nearest = (b: number): number => {
    if (p.size === 0) return 0;
    let best = Infinity;
    let val = 0;
    for (const [k, v] of p) {
      const d = Math.abs(k - b);
      if (d < best) {
        best = d;
        val = v;
      }
    }
    return val;
  };

  return {
    fail: (spare) => {
      const b = bucketOfSpare(spare);
      return p.get(b) ?? nearest(b);
    },
    gain: mean(gains),
    cost: costs.length > 0 ? mean(costs) : BUCKET,
    risk: TIER_RISK[tier],
    spare0: starts.length > 0 ? mean(starts) : 0,
  };
}

/* ---------- 2. Обратная индукция ---------- */

/**
 * Ценность состояния «в рюкзаке `B`, запаса сверх дороги домой `s`».
 *
 * ```
 * V(B, s) = max( B,  (1 − h)·V(B + g, s − c) + h·(1 − ρ)·B )
 * ```
 *
 * Первое слагаемое — уйти сейчас: добыча в руках целиком. Второе — пойти
 * за следующей находкой: с вероятностью `1 − h` она взята и вылазка
 * продолжается уже из нового состояния, с вероятностью `h` забег кончается
 * провалом, и от рюкзака остаётся доля `1 − ρ`.
 *
 * Индукция обратная по запасу: `s` только убывает, поэтому граф ациклический
 * и решается одним проходом от малых `s` к большим — никаких итераций
 * до сходимости не нужно.
 *
 * Чего здесь нет намеренно: вместимости рюкзака и кривой ценности глубины.
 * Обе живут в настоящей вылазке, и обе прибор берёт замером — `gain`
 * усреднён по тому, что бот вправду находил. Сокращённая модель обязана
 * быть проще игры, иначе она не модель, а вторая игра.
 */
interface Solved {
  /** Порог рюкзака: при какой добыче оптимальный игрок разворачивается. */
  readonly threshold: (spare: number) => number;
  /** Ценность старта по сокращённой модели. Величина модели, а не игры:
   *  ею проверяется только калибровка. */
  readonly alwaysGo: number;
}

function solve(m: Model, spareMax: number): Solved {
  const steps = Math.max(1, Math.ceil(spareMax / m.cost));
  // Сетка по числу оставшихся шагов, а не по сырому запасу: шаг фиксирован
  // и равен цене находки, поэтому состояние — это «сколько ещё находок
  // по карману».
  const V: Float64Array[] = Array.from({ length: steps + 1 }, () => new Float64Array(BAG_CELLS));
  const goOn: Uint8Array[] = Array.from({ length: steps + 1 }, () => new Uint8Array(BAG_CELLS));

  const bagAt = (i: number): number => i * BAG_STEP;
  const cellOf = (b: number): number => Math.min(BAG_CELLS - 1, Math.max(0, Math.round(b / BAG_STEP)));

  // Шагов не осталось — только уйти.
  for (let i = 0; i < BAG_CELLS; i++) V[0]![i] = bagAt(i);

  for (let k = 1; k <= steps; k++) {
    const spare = k * m.cost;
    const h = Math.min(1, Math.max(0, m.fail(spare)));
    for (let i = 0; i < BAG_CELLS; i++) {
      const bag = bagAt(i);
      const leave = bag;
      const next = V[k - 1]![cellOf(bag + m.gain)]!;
      const go = (1 - h) * next + h * (1 - m.risk) * bag;
      V[k]![i] = Math.max(leave, go);
      goOn[k]![i] = go > leave ? 1 : 0;
    }
  }

  return {
    threshold: (spare: number): number => {
      const k = Math.min(steps, Math.max(0, Math.round(spare / m.cost)));
      /**
       * Порог — первая добыча, с которой оптимальная политика велит уйти.
       *
       * Верх сетки порогом не считается, и это не придирка: у последней
       * ячейки `B + g` упирается в потолок, ценность продолжения перестаёт
       * расти, и «уйти» побеждает **из-за края сетки**, а не из-за игры.
       * Прибор, который печатает такой порог, сообщает размер массива.
       */
      const ceiling = BAG_MAX - 2 * m.gain;
      for (let i = 0; i < BAG_CELLS; i++) {
        if (goOn[k]![i] === 0) return bagAt(i) >= ceiling ? Infinity : bagAt(i);
      }
      return Infinity;
    },
    /** Ценность старта, если идти до упора: с ней сверяется калибровка. */
    alwaysGo: V[Math.min(steps, Math.max(0, Math.round(m.spare0 / m.cost)))]![0]!,
  };
}

/* ---------- 3. Отчёт ---------- */

const TIERS: readonly Tier[] = [0, 1, 2, 3];

console.log(`Оптимальная остановка: обратная индукция против правила §22.5\n`);
console.log(`${RUNS} вылазок на ярус, бот-осторожный, сиды общие\n`);

interface Row {
  readonly tier: Tier;
  readonly m: Model;
  readonly s: Solved;
  readonly base: Run[];
}

const rows: Row[] = TIERS.map((tier) => {
  const base = run(tier);
  const m = fit(tier, base);
  return { tier, m, s: solve(m, m.spare0), base };
});

console.log('══ 1. Сокращённая модель, снятая с прогонов ══\n');
console.log('ярус   находка g   цена находки c   запас на входе   ставка ρ   шагов по карману');
for (const { tier, m } of rows) {
  console.log(
    `  ${tier}      ${m.gain.toFixed(1).padStart(5)}${m.cost.toFixed(1).padStart(17)}` +
      `${m.spare0.toFixed(1).padStart(17)}${m.risk.toFixed(2).padStart(12)}` +
      `${Math.round(m.spare0 / m.cost).toString().padStart(19)}`,
  );
}

console.log('\n\n══ 2. Порог рюкзака: оптимальный против близорукого ══\n');
console.log('Порог — добыча, при которой правило велит уйти. ∞ значит «идти всегда».\n');
console.log('ярус   запас   не дойти h   порог §22.5   порог оптимальный   рюкзак к концу');
for (const { tier, m, s, base } of rows) {
  // Рюкзак, до которого забег вправду доходит: порог выше него означает,
  // что правило не сработает ни при каком поведении игрока.
  const bagEnd = mean(
    base.map((r) => {
      const last = r.decisions[r.decisions.length - 1];
      return last === undefined ? 0 : last.bag;
    }),
  );
  for (const k of [1, 2, 3, 4]) {
    const spare = k * m.cost;
    if (spare > m.spare0 + m.cost) continue;
    const h = m.fail(spare);
    const my = indifferenceBag(m.gain, h, m.risk);
    const opt = s.threshold(spare);
    console.log(
      `  ${tier}${spare.toFixed(0).padStart(8)}${pct(h).padStart(13)}` +
        `${(Number.isFinite(my) ? my.toFixed(1) : '∞').padStart(14)}` +
        `${(Number.isFinite(opt) ? opt.toFixed(1) : '∞').padStart(20)}` +
        `${bagEnd.toFixed(1).padStart(17)}`,
    );
  }
}

/**
 * Главное сравнение раздела. Близорукое правило смотрит на один шаг вперёд
 * и потому обязано быть **осторожнее** оптимального: оно не видит, что
 * следующие находки тоже принесут добычу. Если пороги совпадают, §22.5
 * ничего не теряет своей близорукостью; если оптимальный порог заметно выше,
 * раздел советует уходить раньше, чем следует.
 */
console.log('\n\n══ 3. Последствия на настоящей игре ══\n');

const rule = (m: Model): StopRule => ({ fail: m.fail, risk: m.risk });
const optimalRule = (m: Model, s: Solved): StopRule => ({
  fail: m.fail,
  risk: m.risk,
  decide: ({ bag, spare }) => bag < s.threshold(spare),
});

const outcome = (runs: readonly Run[]): { success: number; haul: number; depth: number } => ({
  success: runs.filter((r) => !r.failed).length / Math.max(1, runs.length),
  haul: mean(runs.map((r) => r.carried)),
  depth: mean(runs.map((r) => r.depth)),
});

console.log('ярус        успех            средний заход           глубина');
const consequences = rows.map(({ tier, m, s, base }) => {
  const myopic = outcome(run(tier, rule(m)));
  const optimal = outcome(run(tier, optimalRule(m, s)));
  const b = outcome(base);
  const line = (name: string, o: { success: number; haul: number; depth: number }): string =>
    `${name.padEnd(12)}${pct(o.success).padStart(6)}${o.haul.toFixed(1).padStart(20)}${pct(o.depth).padStart(18)}`;
  console.log(`— ярус ${tier} —`);
  console.log('  ' + line('политика', b));
  console.log('  ' + line('§22.5', myopic));
  console.log('  ' + line('оптимум', optimal));
  /**
   * Калибровка, а не результат. Сокращённая модель обязана хотя бы попадать
   * в порядок величины настоящего захода; если не попадает — её пороги
   * читаются как порядок («выше — раньше уходить»), а не как числа добычи.
   */
  const off = Math.abs(s.alwaysGo - b.haul) / Math.max(0.1, b.haul);
  console.log(
    `  калибровка: модель обещает ${s.alwaysGo.toFixed(1)} за заход, игра даёт ${b.haul.toFixed(1)}` +
      ` — мимо на ${pct(off)}\n`,
  );
  return { tier, base: b, myopic, optimal, off };
});

/* ---------- 4. Вердикты ---------- */

console.log('══ 4. Вердикт ══\n');

/**
 * Первый вопрос — существует ли разворот вообще. Порог `∞` на всех запасах
 * означает, что оптимальная политика велит идти дальше при любой добыче:
 * решения «уйти или продолжить» в вылазке нет, и это не свойство бота,
 * а свойство яруса.
 */
const unreachable = rows.filter(({ m, s, base }) => {
  const bagEnd = mean(
    base.map((r) => {
      const last = r.decisions[r.decisions.length - 1];
      return last === undefined ? 0 : last.bag;
    }),
  );
  return [1, 2, 3, 4]
    .map((k) => k * m.cost)
    .filter((spare) => spare <= m.spare0 + m.cost)
    .every((spare) => !(s.threshold(spare) <= bagEnd));
});
if (unreachable.length > 0) {
  console.log(
    `⚠ На ярусах ${unreachable.map((r) => r.tier).join(', ')} порог оптимального игрока лежит выше\n` +
      '  той добычи, до которой забег вообще доходит. Разворот в этих ярусах\n' +
      '  не «редкий», а недостижимый: решения нет и у идеального игрока,\n' +
      '  а значит близорукость §22.5 тут ни при чём — чинить надо ставку\n' +
      '  и число находок, а не правило.',
  );
} else {
  console.log('✓ Порог достижим на каждом ярусе: разворот попадает внутрь забега.');
}

/**
 * Второй вопрос — во сколько обходится близорукость. Если правило §22.5
 * и оптимум ведут бота к одному и тому же исходу, разделу не нужна
 * обратная индукция; если расходятся, у §22.5 появляется цена.
 */
const drift = Math.max(
  ...consequences.map((c) => Math.abs(c.optimal.haul - c.myopic.haul) / Math.max(0.1, c.myopic.haul)),
);
console.log(
  drift <= 0.02
    ? `\n✓ Близорукость §22.5 ничего не стоит: средний заход у оптимума и у формулы\n` +
        `  расходится не больше чем на ${pct(drift)}. Правило раздела годится как есть,\n` +
        '  и обратная индукция нужна прибору, а не игре.'
    : `\n⚠ Близорукость §22.5 стоит до ${pct(drift)} среднего захода: формула раздела\n` +
        '  и оптимальная политика ведут игрока по-разному. Значит правило —\n' +
        '  приближение, и его цену надо записать рядом с ним.',
);

/**
 * Третий вопрос — сколько недобирает сам бот. Это и есть ответ на «сколько
 * в вылазке осталось решения»: если идеальная игра не отличается от политики,
 * решение уже принято за игрока — не правилом, так устройством вылазки.
 */
const gap = Math.max(
  ...consequences.map((c) => (c.optimal.haul - c.base.haul) / Math.max(0.1, c.base.haul)),
);
console.log(
  gap <= 0.03
    ? `\n⚠ Оптимальная игра даёт не больше ${pct(Math.max(0, gap))} сверх политики бота.\n` +
        '  Выбирать в вылазке нечего: разница между идеальным игроком\n' +
        '  и осторожной привычкой лежит в пределах шума.'
    : `\n✓ Оптимальная игра даёт до ${pct(gap)} сверх политики бота — столько\n` +
        '  в вылазке стоит умение решать.',
);
