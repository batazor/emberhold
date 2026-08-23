/**
 * Правило остановки §22.5 — прибор.
 *
 * Раздел выводит условие живого решения: игрок идёт дальше, пока
 * ожидаемая ценность продолжения выше синицы в руке,
 *
 *   EV(идти) = (B + g)·(1 − p·ρ)   EV(уйти) = B   →   идти, если g > B·p·ρ/(1 − p·ρ)
 *
 * и объявляет, что **точка безразличия обязана попадать внутрь забега**:
 * если g всегда выше порога — игрок всегда идёт дальше, и решения нет;
 * если всегда ниже — уходит сразу, и глубины нет.
 *
 * Условие было выведено и ни разу не измерено: `shouldContinue` и
 * `indifferenceBag` до этого прибора не звал никто — ни игра, ни бот,
 * ни один `.rules.ts`. Ставка ρ и кривая ценности глубины настраивались
 * порознь ровно тем способом, который §22.5 запрещает.
 *
 * Что прибор НЕ делает: не водит бота по правилу. Бот по-прежнему ходит
 * по политике (`POLICIES.cautious`), а правило прикладывается к его
 * решениям со стороны. Порядок такой затем, что вопрос сейчас — «есть ли
 * в забеге момент выбора», а не «что будет, если игрок станет считать EV».
 * Второй задаётся после того, как первый получил ответ.
 *
 * Запуск: npm run stop
 */
import { mulberry32 } from '../src/core/rng';
import { POLICIES, playRaid } from '../src/sim/bot';
import type { Decision, StopRule } from '../src/sim/bot';
import { referenceLoadout } from '../src/sim/heroes';
import {
  FOOD_COST,
  TIER_DEPTH_VALUE,
  TIER_HERO_LEVEL,
  TIER_KITCHEN_GATE,
  TIER_RISK,
  indifferenceBag,
  shouldContinue,
} from '../src/sim/balance';
import type { Tier } from '../src/sim/types';

const RUNS = 300;

/**
 * Ширина ведра, в которых меряется вероятность не дойти. Состояние забега
 * сворачивается в одно число — **запас провианта сверх дороги домой**:
 * именно им игрок и рискует, решая взять ещё одну находку. Пять единиц —
 * это шаг «одна лишняя комната» (`FOOD_COST.container`), и мельче ведро
 * делать нечем: в нём перестаёт хватать забегов на оценку доли.
 */
const BUCKET = FOOD_COST.container;

/**
 * Доля вырожденного исхода, при которой вердикт падает. Не «настройка
 * сложности», а граница читаемости: ярус, где девять забегов из десяти
 * не имеют момента выбора вовсе, §22.5 не выполняет — как бы ни выглядели
 * остальные метрики.
 */
const DEGENERATE = 0.9;

interface Run {
  readonly tier: Tier;
  readonly failed: boolean;
  readonly decisions: readonly Decision[];
  readonly carried: number;
  /** Доля глубины локации, до которой дошли. */
  readonly depth: number;
  /** Добыча до вычета ставки: под чужой ρ она считается заново. */
  readonly bagTotal: number;
}

/** Ведро состояния: запас сверх дороги домой, огрублённый до шага комнаты. */
function bucketOfSpare(spare: number): number {
  return Math.max(0, Math.floor(spare / BUCKET));
}

function bucketOf(d: Decision): number {
  return bucketOfSpare(d.foodLeft - d.backSteps * FOOD_COST.step);
}

/**
 * Прогон яруса. `stop` — правило §22.5, поданное боту: без него это базовая
 * линия, с ним — вторая модель игрока. Сиды одни и те же, чтобы разница
 * была разницей поведения, а не карт.
 */
function run(tier: Tier, kitchen: number, storage: number, stop?: StopRule): Run[] {
  const out: Run[] = [];
  for (let seed = 1; seed <= RUNS; seed++) {
    // Вход списывается с `measure` целиком, включая гейт Кухни: §22.8 стоило
    // яруса ровно то, что прибор списал пару «ярус — здание» руками.
    const r = playRaid(
      { seed, tier, kitchenLevel: kitchen, storageLevel: storage, loadout: referenceLoadout(TIER_HERO_LEVEL[tier]), stop },
      POLICIES.cautious,
      mulberry32(seed),
    );
    out.push({
      tier,
      failed: r.status !== 'evacuated',
      decisions: r.decisions,
      carried: r.carriedTotal,
      depth: r.locMaxBack > 0 ? r.maxBack / r.locMaxBack : 0,
      bagTotal: r.bagTotal,
    });
  }
  return out;
}

/** Что заход даёт по всем вылазкам, а не по удачным (§22.8). */
interface Outcome {
  readonly success: number;
  readonly haulAll: number;
  readonly depth: number;
}

function outcome(runs: readonly Run[]): Outcome {
  const n = Math.max(1, runs.length);
  return {
    success: runs.filter((r) => !r.failed).length / n,
    haulAll: runs.reduce((a, r) => a + r.carried, 0) / n,
    depth: runs.reduce((a, r) => a + r.depth, 0) / n,
  };
}

/**
 * Вероятность не дойти, снятая с прогона, а не назначенная. Для каждого
 * ведра состояния — доля решений, чей забег кончился провалом. Это оценка
 * по состоянию: один забег даёт несколько решений и попадает в несколько
 * вёдер, и так и надо — вопрос «какова вероятность не дойти **отсюда**»,
 * а не «какова доля провальных забегов».
 */
function failChanceByBucket(runs: readonly Run[]): Map<number, number> {
  const total = new Map<number, number>();
  const failed = new Map<number, number>();
  for (const r of runs) {
    for (const d of r.decisions) {
      const b = bucketOf(d);
      total.set(b, (total.get(b) ?? 0) + 1);
      if (r.failed) failed.set(b, (failed.get(b) ?? 0) + 1);
    }
  }
  const p = new Map<number, number>();
  for (const [b, n] of total) p.set(b, (failed.get(b) ?? 0) / n);
  return p;
}

/**
 * Моменты настоящего выбора. Бот пересматривает маршрут каждые три клетки,
 * поэтому одна находка даёт несколько решений подряд с одной и той же целью,
 * и считать их находками нельзя: `k` раздувается втрое, а «перелом на 53%
 * забега» меряется в пересмотрах вместо находок.
 *
 * Настоящий выбор — первое решение и каждое, принятое после того, как рюкзак
 * изменился: рюкзак растёт ровно тогда, когда находка вскрыта.
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

type Verdict = 'сразу' | 'внутри' | 'никогда';

interface TierReport {
  readonly tier: Tier;
  readonly risk: number;
  /** Забеги, разложенные по тому, где правило велит развернуться. */
  readonly where: Record<Verdict, number>;
  /** Средняя доля забега, на которой наступает перелом (только «внутри»). */
  readonly at: number;
  /** Забеги, в которых бот шёл дальше после перелома. */
  readonly overran: number;
  /** Сколько находок бот взял после перелома в среднем по таким забегам. */
  readonly extra: number;
  /** Чем кончилось у тех, кто шёл дальше, против тех, кто развернулся вовремя. */
  readonly failAfterOverrun: number;
  readonly failWithin: number;
  /** Сколько забегов вообще имели решение «взять находку». */
  readonly counted: number;
  /** Среднее число находок за забег — то самое `k`, от которого зависит,
   *  достижим ли перелом в принципе: он требует (1−pρ)/(pρ) < k−1. */
  readonly picks: number;
}

function report(tier: Tier, runs: readonly Run[]): TierReport {
  const p = failChanceByBucket(runs);
  const risk = TIER_RISK[tier];
  const where: Record<Verdict, number> = { сразу: 0, внутри: 0, никогда: 0 };
  let atSum = 0;
  let overran = 0;
  let extraSum = 0;
  let failAfterOverrun = 0;
  let withinRuns = 0;
  let failWithin = 0;
  let counted = 0;
  let picksSum = 0;

  for (const r of runs) {
    // Решение считается только там, где есть что взвешивать: у ухода и крюка
    // следующей находки нет, и `g` там ноль — правило на них не про игру.
    const picks = choices(r.decisions);
    if (picks.length === 0) continue;
    counted += 1;
    picksSum += picks.length;

    let flip = -1;
    for (let i = 0; i < picks.length; i++) {
      const d = picks[i];
      const fail = p.get(bucketOf(d)) ?? 0;
      if (!shouldContinue(d.bag, d.gain, fail, risk)) {
        flip = i;
        break;
      }
    }

    if (flip < 0) {
      where.никогда += 1;
      continue;
    }
    if (flip === 0) {
      where.сразу += 1;
      continue;
    }
    where.внутри += 1;
    withinRuns += 1;
    atSum += flip / picks.length;
    if (r.failed) failWithin += 1;
    // Бот правила не знает, поэтому «после перелома» он почти всегда идёт
    // дальше. Величина нужна не как обвинение боту, а как цена вопроса:
    // столько находок стоит на кону, если правило подключить.
    const after = picks.length - flip;
    if (after > 0) {
      overran += 1;
      extraSum += after;
      if (r.failed) failAfterOverrun += 1;
    }
  }

  return {
    tier,
    risk,
    where,
    at: withinRuns > 0 ? atSum / withinRuns : 0,
    overran,
    extra: overran > 0 ? extraSum / overran : 0,
    failAfterOverrun: overran > 0 ? failAfterOverrun / overran : 0,
    failWithin: withinRuns > 0 ? failWithin / withinRuns : 0,
    counted,
    picks: counted > 0 ? picksSum / counted : 0,
  };
}

interface Reach {
  /** Порог рюкзака: при какой добыче средняя находка перестаёт окупать риск. */
  readonly threshold: number;
  /** Сколько в рюкзаке к концу забега на самом деле. Если порог выше этого,
   *  правило не может сработать ни при каком поведении игрока. */
  readonly bagEnd: number;
  /** Средняя ценность находки и средняя вероятность не дойти — из прогона. */
  readonly gain: number;
  readonly fail: number;
  /**
   * Какая ставка поставила бы перелом на конец забега. Печатается не как
   * рецепт: §22.5 прямо говорит, что ρ и кривая ценности глубины
   * не настраиваются порознь. Это мера промаха — во сколько раз нынешняя
   * связка мимо.
   */
  readonly riskForEnd: number;
}

function reach(tier: Tier, runs: readonly Run[]): Reach {
  const p = failChanceByBucket(runs);
  let gains = 0;
  let n = 0;
  let fails = 0;
  let bagEnd = 0;
  let ends = 0;
  for (const r of runs) {
    for (const d of choices(r.decisions)) {
      gains += d.gain;
      fails += p.get(bucketOf(d)) ?? 0;
      n += 1;
    }
    // Рюкзак к концу забега — по последнему решению: это и есть B, до которого
    // игрок доходит на самом деле. Взятое с последней находки сюда не входит,
    // и так и надо: решение о ней принимается до того, как она в рюкзаке.
    const last = r.decisions[r.decisions.length - 1];
    if (last !== undefined) {
      bagEnd += last.bag;
      ends += 1;
    }
  }
  if (n === 0) return { threshold: Infinity, bagEnd: 0, gain: 0, fail: 0, riskForEnd: Infinity };
  const gain = gains / n;
  const fail = fails / n;
  const end = ends > 0 ? bagEnd / ends : 0;
  return {
    threshold: indifferenceBag(gain, fail, TIER_RISK[tier]),
    bagEnd: end,
    gain,
    fail,
    // pρ = g/(g+B) ставит точку безразличия ровно в конец забега.
    riskForEnd: fail > 0 ? gain / (fail * (gain + end)) : Infinity,
  };
}

const PLAN: { tier: Tier; kitchen: number; storage: number }[] = ([0, 1, 2, 3] as Tier[]).map(
  (tier) => ({ tier, kitchen: TIER_KITCHEN_GATE[tier], storage: tier + 1 }),
);

const pct = (x: number): string => `${(x * 100).toFixed(0).padStart(3)}%`;

console.log(`Правило остановки §22.5: ${RUNS} вылазок на ярус, бот-осторожный\n`);
console.log('ярус  ставка   уйти сразу   перелом внутри   идти всегда   перелом на');
console.log('─'.repeat(74));

const measured = PLAN.map(({ tier, kitchen, storage }) => {
  // Первый проход — без правила: он и снимает `p`. Считать вероятность
  // не дойти на прогоне, который уже ходит по правилу, значило бы мерить
  // линейкой её собственную длину.
  const base = run(tier, kitchen, storage);
  const p = failChanceByBucket(base);
  const rule: StopRule = {
    fail: (spare) => p.get(bucketOfSpare(spare)) ?? 0,
    risk: TIER_RISK[tier],
  };
  // Второй проход — тот же сид, но бот считает EV. Разница и есть последствия.
  const ev = run(tier, kitchen, storage, rule);
  return { tier, rep: report(tier, base), reach: reach(tier, base), base: outcome(base), ev: outcome(ev) };
});

for (const { tier, rep } of measured) {
  const n = Math.max(1, rep.counted);
  console.log(
    `  ${tier}     ${rep.risk.toFixed(2)}       ${pct(rep.where.сразу / n)}` +
      `            ${pct(rep.where.внутри / n)}          ${pct(rep.where.никогда / n)}` +
      `        ${rep.at > 0 ? pct(rep.at) : '   —'}`,
  );
}

console.log('\nДостижим ли порог: рюкзак к концу забега против порога §22.5\n');
console.log('ярус   находка g   не дойти p   ставка ρ    порог B*   рюкзак к концу   ставка «в конец»');
console.log('─'.repeat(92));
for (const { tier, rep, reach: h } of measured) {
  console.log(
    `  ${tier}      ${h.gain.toFixed(1).padStart(5)}      ${pct(h.fail)}        ${rep.risk.toFixed(2)}` +
      `    ${Number.isFinite(h.threshold) ? h.threshold.toFixed(1).padStart(7) : '      ∞'}` +
      `      ${h.bagEnd.toFixed(1).padStart(7)}          ` +
      `${Number.isFinite(h.riskForEnd) ? h.riskForEnd.toFixed(2).padStart(6) : '     ∞'}`,
  );
}

const reports = measured.map((m) => m.rep);

console.log('\nПоследствия: тот же сид, бот считает EV против бота по политике\n');
console.log('ярус     успех             средний заход          глубина');
console.log('─'.repeat(72));
for (const { tier, base, ev } of measured) {
  const arrow = (a: number, b: number, d = 1): string =>
    `${a.toFixed(d).padStart(5)} → ${b.toFixed(d).padStart(5)}`;
  console.log(
    `  ${tier}    ${arrow(base.success * 100, ev.success * 100, 0)}%     ` +
      `${arrow(base.haulAll, ev.haulAll)}     ` +
      `${arrow(base.depth * 100, ev.depth * 100, 0)}%`,
  );
}

console.log('\nЦена вопроса — что стоит на кону, если правило подключить к игроку:\n');
console.log('ярус   шёл дальше порога   находок сверх   провалов у них');
console.log('─'.repeat(66));
for (const r of reports) {
  const n = Math.max(1, r.counted);
  console.log(
    `  ${r.tier}          ${pct(r.overran / n)}             ${r.extra.toFixed(1).padStart(5)}` +
      `          ${r.overran > 0 ? pct(r.failAfterOverrun) : '   —'}`,
  );
}

/* ---------- вердикт ---------- */

const problems: string[] = [];
for (const { rep: r, reach: h } of measured) {
  // Ярус 0 обучающий, ставка нулевая (§11.2): терять нечего, порог бесконечен,
  // и «идти всегда» там — решение дизайна, а не поломка модели. Требовать
  // от него момента выбора значило бы требовать риска, который снят нарочно.
  if (r.risk === 0) continue;
  const n = Math.max(1, r.counted);
  const never = r.where.никогда / n;
  const now = r.where.сразу / n;
  if (never >= DEGENERATE) {
    // Красная строка обязана называть рычаг, иначе её перестают читать.
    // Перелом внутри забега требует (1−pρ)/(pρ) < k−1; когда нужная ставка
    // выше потолка 1,0, связка ρ×μ бессильна по арифметике, а не по настройке,
    // и чинит только то, что растит число находок k (щедрость θ, containers).
    const lever =
      h.riskForEnd > 1
        ? `нужна ставка ${h.riskForEnd.toFixed(2)} при потолке 1,00 — ` +
          `связка ρ×μ этого не даёт, рычаг в числе находок (k=${r.picks.toFixed(1)})`
        : `ставка «в конец» ${h.riskForEnd.toFixed(2)} достижима — связка ρ×μ не докручена`;
    problems.push(
      `ярус ${r.tier}: правило говорит «идти дальше» в ${pct(never)} забегов — ` +
        `решения нет. ${lever}`,
    );
  }
  if (now >= DEGENERATE) {
    problems.push(
      `ярус ${r.tier}: правило говорит «уходить» на первой же находке в ${pct(now)} забегов — ` +
        `глубины нет`,
    );
  }
}

console.log('');
if (problems.length === 0) {
  console.log('  ✓ Точка безразличия попадает внутрь забега на всех ярусах со ставкой');
} else {
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exitCode = 1;
}

/* ---------- свип: связка ρ и depthValue (§22.5) ---------- */

/**
 * `npm run stop -- --свип`
 *
 * §22.5 запрещает крутить ставку и кривую ценности глубины порознь, поэтому
 * прибор перебирает их вместе. Хитрость, которая делает свип дешёвым:
 * **ставка не влияет на поведение бота.** Он её не знает — ρ решает только,
 * сколько добычи отнимет провал. Значит карты нужно перегенерировать
 * лишь под `depthValue`, а ρ перебирается аналитически по тем же записанным
 * решениям.
 *
 * Ярус 0 в свип не входит: ставка там ноль по решению §11.2, и перебирать
 * нечего.
 */
const MU_GRID = [1.0, 1.4, 1.8, 2.2, 2.6, 3.0, 3.5] as const;
const RHO_GRID = [0.3, 0.5, 0.7, 0.85, 1.0] as const;
const SWEEP_RUNS = 200;

interface Cell {
  readonly mu: number;
  readonly rho: number;
  /** Доля забегов, где точка безразличия попала внутрь забега. */
  readonly within: number;
  /** Что заход даёт в среднем по всем вылазкам при этой ставке (§22.8). */
  readonly haul: number;
}

function sweepTier(tier: Tier, kitchen: number, storage: number): Cell[] {
  const cells: Cell[] = [];
  const was = TIER_DEPTH_VALUE[tier];
  for (const mu of MU_GRID) {
    // Кривая ценности глубины подменяется в том же месте, откуда её читает
    // генератор (`generate.ts`), а не копией: прибор не списывает величину,
    // которую игра выводит (§22.8).
    TIER_DEPTH_VALUE[tier] = mu;
    const runs = run(tier, kitchen, storage);
    const p = failChanceByBucket(runs);
    for (const rho of RHO_GRID) {
      let within = 0;
      let counted = 0;
      let haul = 0;
      for (const r of runs) {
        // Добыча под чужой ставкой считается заново: та, что вернул забег,
        // снята при нынешней ρ и к перебору не годится.
        haul += r.failed ? r.bagTotal * (1 - rho) : r.bagTotal;
        const picks = choices(r.decisions);
        if (picks.length === 0) continue;
        counted += 1;
        for (let i = 0; i < picks.length; i++) {
          const d = picks[i];
          if (!shouldContinue(d.bag, d.gain, p.get(bucketOf(d)) ?? 0, rho)) {
            if (i > 0) within += 1;
            break;
          }
        }
      }
      cells.push({
        mu,
        rho,
        within: within / Math.max(1, counted),
        haul: haul / Math.max(1, runs.length),
      });
    }
  }
  TIER_DEPTH_VALUE[tier] = was;
  return cells;
}

if (process.argv.includes('--свип')) {
  console.log(`\nСвип связки ρ × depthValue: ${SWEEP_RUNS} вылазок на точку`);
  console.log('В клетке: доля забегов с переломом внутри / средний заход по всем вылазкам\n');
  for (const { tier, kitchen, storage } of PLAN) {
    if (TIER_RISK[tier] === 0) {
      console.log(`Ярус ${tier}: ставка ноль по §11.2 — перебирать нечего.\n`);
      continue;
    }
    const cells = sweepTier(tier, kitchen, storage);
    console.log(`Ярус ${tier} (сейчас ρ=${TIER_RISK[tier].toFixed(2)}, μ=${TIER_DEPTH_VALUE[tier].toFixed(1)}):`);
    console.log(`   μ \\ ρ ${RHO_GRID.map((r) => r.toFixed(2).padStart(12)).join('')}`);
    for (const mu of MU_GRID) {
      const row = cells.filter((c) => c.mu === mu);
      console.log(
        `  ${mu.toFixed(1).padStart(4)}  ` +
          row.map((c) => `${pct(c.within)}/${c.haul.toFixed(1).padStart(5)}`.padStart(12)).join(''),
      );
    }
    const best = cells.reduce((a, b) => (b.within > a.within ? b : a));
    console.log(
      `  лучшая клетка: μ=${best.mu.toFixed(1)} ρ=${best.rho.toFixed(2)} → ` +
        `перелом внутри ${pct(best.within)}, заход ${best.haul.toFixed(1)}\n`,
    );
  }
}
