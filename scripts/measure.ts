/**
 * Замер добычи по ярусам. §20.3 намеренно не назначает стоимость построек
 * до замеров, а §11.5 задаёт связующее правило: средняя добыча одной успешной
 * вылазки ≈ 70% стоимости следующего доступного улучшения.
 *
 * Живых игроков ещё нет, поэтому меряется бот с явной, простой политикой —
 * см. decide(). Это модель осторожного игрока, а не человек: числа отсюда
 * годятся как первая калибровка и обязаны быть перепроверены телеметрией.
 *
 * Запуск: npm run measure
 */
import { TICK } from '../src/core/loop';
import { idx } from '../src/sim/grid';
import { findPath } from '../src/sim/pathfinding';
import { commandMove, createRaid, raidResult, stepRaid } from '../src/sim/raid';
import type { RaidState } from '../src/sim/raid';
import { emptyResources, RESOURCE_NAME } from '../src/sim/resources';
import type { ResourceKind, Resources } from '../src/sim/resources';
import type { Tier } from '../src/sim/types';

const RUNS = 300;
const MAX_SECONDS = 240;
/** Запас провианта, который бот оставляет себе сверх расчётного пути назад. */
const SAFETY = 3;

/**
 * Политика бота: идти к ближайшему контейнеру, до которого хватает провианта
 * с учётом дороги назад, иначе — на выход. Жадности сверх этого нет: бот
 * не рискует, поэтому его добыча — нижняя граница, а не средний игрок.
 */
function decide(state: RaidState): void {
  const { loc, hero } = state;
  const from = { x: Math.round(hero.x), z: Math.round(hero.z) };

  if (state.bagTotal >= state.capacity) {
    commandMove(state, loc.evac);
    return;
  }

  let best: { x: number; z: number } | null = null;
  let bestLen = Infinity;
  for (const c of loc.containers) {
    if (c.opened) continue;
    const path = findPath(loc.size, loc.blocked, from, c);
    if (path.length === 0) continue;
    const back = loc.backSteps[idx(loc.size, c.x, c.z)] ?? -1;
    if (back < 0) continue;
    // шаги туда + вскрытие + шаги обратно + запас
    const need = path.length + 5 + back + SAFETY;
    if (need > state.food) continue;
    if (path.length < bestLen) {
      bestLen = path.length;
      best = c;
    }
  }

  commandMove(state, best ?? loc.evac);
}

interface TierStat {
  readonly tier: Tier;
  runs: number;
  success: number;
  carried: Resources;
  carriedTotal: number;
  steps: number;
  seconds: number;
  depthShare: number;
  foodLeft: number;
  /** §11.3 требует соотношения причин провала 65% провиант / 35% бой. */
  byFood: number;
  byCombat: number;
}

function measure(tier: Tier, kitchenLevel: number, storageLevel: number): TierStat {
  const stat: TierStat = {
    tier,
    runs: 0,
    success: 0,
    carried: emptyResources(),
    carriedTotal: 0,
    steps: 0,
    seconds: 0,
    depthShare: 0,
    foodLeft: 0,
    byFood: 0,
    byCombat: 0,
  };

  for (let seed = 1; seed <= RUNS; seed++) {
    const state = createRaid({ seed, tier, kitchenLevel, storageLevel });
    const limit = Math.round(MAX_SECONDS / TICK);
    for (let i = 0; i < limit && state.status === 'running'; i++) {
      if (state.path.length === 0) decide(state);
      // Ночь: вылазки в документе ночные, и это влияет на радиус и на врагов.
      stepRaid(state, TICK, true, 5);
      if (state.path.length === 0 && state.status === 'running' && state.food <= 0) {
        commandMove(state, state.loc.evac);
      }
    }

    const r = raidResult(state);
    stat.runs += 1;
    stat.steps += r.steps;
    stat.seconds += r.durationSec;
    stat.depthShare += r.locMaxBack > 0 ? r.maxBack / r.locMaxBack : 0;
    stat.foodLeft += r.foodLeft;
    if (r.status !== 'evacuated') {
      // Раны кончились — бой; иначе героя добил голод.
      if (state.hero.wounds <= 0 && state.food > 0) stat.byCombat += 1;
      else stat.byFood += 1;
    }
    if (r.status === 'evacuated') {
      stat.success += 1;
      stat.carriedTotal += r.carriedTotal;
      for (const k of Object.keys(stat.carried) as ResourceKind[]) stat.carried[k] += r.carried[k];
    }
  }
  return stat;
}

const PLAN: { tier: Tier; kitchen: number; storage: number }[] = [
  // Пары «ярус — уровни зданий» взяты из кривой §16 и гейта по Кухне:
  // на ярус 2 пускает Кухня 2, на ярус 3 — Кухня 3.
  { tier: 0, kitchen: 1, storage: 1 },
  { tier: 1, kitchen: 1, storage: 2 },
  { tier: 2, kitchen: 2, storage: 3 },
  { tier: 3, kitchen: 3, storage: 4 },
];

const num = (x: number, d = 1): string => x.toFixed(d).padStart(6);

console.log(`Замер: ${RUNS} вылазок на ярус, бот-осторожный, ночь\n`);
console.log('ярус  Кухня/Склад   успех   добыча   шагов   время   глубина  провиант');
console.log('─'.repeat(74));

const stats = PLAN.map(({ tier, kitchen, storage }) => {
  const s = measure(tier, kitchen, storage);
  const perSuccess = s.success > 0 ? s.carriedTotal / s.success : 0;
  console.log(
    `  ${tier}      ${kitchen} / ${storage}      ` +
      `${num((s.success / s.runs) * 100, 0)}% ${num(perSuccess)}  ${num(s.steps / s.runs, 0)}  ` +
      `${num(s.seconds / s.runs, 0)} с ${num((s.depthShare / s.runs) * 100, 0)}%  ${num(s.foodLeft / s.runs, 0)}`,
  );
  return s;
});

console.log('\nПричины провала (§11.3 хочет провиант 65% / бой 35%)');
console.log('─'.repeat(74));
for (const s of stats) {
  const fails = s.runs - s.success;
  if (fails === 0) {
    console.log(`  ярус ${s.tier}: провалов нет`);
    continue;
  }
  console.log(
    `  ярус ${s.tier}: провалов ${((fails / s.runs) * 100).toFixed(0)}% — ` +
      `провиант ${((s.byFood / fails) * 100).toFixed(0)}% · бой ${((s.byCombat / fails) * 100).toFixed(0)}%`,
  );
}

console.log('\nСостав добычи успешной вылазки (§13)');
console.log('─'.repeat(74));
for (const s of stats) {
  const parts = (Object.keys(s.carried) as ResourceKind[])
    .map((k) => `${RESOURCE_NAME[k]} ${(s.carried[k] / Math.max(1, s.success)).toFixed(1)}`)
    .join(' · ');
  console.log(`  ярус ${s.tier}: ${parts}`);
}

console.log('\nСтоимость улучшения по §11.5 (добыча ≈ 70% цены)');
console.log('─'.repeat(74));
for (const s of stats) {
  const per = s.success > 0 ? s.carriedTotal / s.success : 0;
  console.log(
    `  ярус ${s.tier}: добыча ${per.toFixed(1)} → цена ${(per / 0.7).toFixed(1)} ` +
      `(${(1 / 0.7).toFixed(2)} вылазки)`,
  );
}
