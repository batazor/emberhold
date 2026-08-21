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
import { mulberry32 } from '../src/core/rng';
import { POLICIES, playRaid } from '../src/sim/bot';
import { createRaid } from '../src/sim/raid';
import { findPath } from '../src/sim/pathfinding';
import { ENEMY_STATS } from '../src/sim/enemies';
import { emptyResources, RESOURCE_NAME } from '../src/sim/resources';
import type { ResourceKind, Resources } from '../src/sim/resources';
import type { Tier } from '../src/sim/types';

const RUNS = 300;
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
  byKind: Record<string, number>;
  /** Сколько камня принёс каждый заход, включая провальные. Нужно затем, что
   *  цену первого здания решает не средний игрок, а тот, кому её не хватило:
   *  среднее по 300 вылазкам такого игрока не показывает вовсе. */
  stoneRuns: number[];
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
    byKind: {},
    stoneRuns: [],
  };

  for (let seed = 1; seed <= RUNS; seed++) {
    // Игрок берётся у бота целиком. Своя копия здесь была третьей по счёту
    // — после карты опасности и приборов §22.6 — и пережила ровно до
    // пошагового боя: игрок, не умеющий ходить в бою, вешает вылазку,
    // и замер начинает мерить не игру, а обрыв. Одинаковые числа при
    // разных правках — верный признак, что меряется не то.
    const r = playRaid({ seed, tier, kitchenLevel, storageLevel }, POLICIES.cautious, mulberry32(seed));
    stat.runs += 1;
    stat.steps += r.steps;
    stat.seconds += r.durationSec;
    stat.depthShare += r.locMaxBack > 0 ? r.maxBack / r.locMaxBack : 0;
    stat.foodLeft += r.foodLeft;
    if (r.status !== 'evacuated') {
      // Причину больше не выводим здесь: её пишет сама вылазка по тому,
      // откуда пришла последняя рана (§9). Прежнее правило «раны кончились
      // раньше провианта» врало на стыке — голодного героя, добитого
      // скелетом, оно относило к бою, а раненного в бою и доевшего
      // провиант — к голоду. И, главное, знал причину только этот скрипт:
      // живой игрок про свою смерть не рассказывал ничего.
      if (r.cause === 'combat') {
        stat.byCombat += 1;
        const kind = r.lastHitBy ?? 'неизвестно';
        stat.byKind[kind] = (stat.byKind[kind] ?? 0) + 1;
      } else stat.byFood += 1;
    }
    // Провальный заход тоже считается: ставка §11.4 отнимает не всё, и вопрос
    // «хватит ли на Мастерскую» задаётся о любом возвращении, а не об удачном.
    stat.stoneRuns.push(r.carried.stone);
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

// §22.6 — прежние 65/35 сняты на старом бое и помечены черновыми. Цель
// назначается пересчётом модели, а не повторяется здесь числом.
console.log('\nПричины провала (цель — §22.6, прежние 65/35 черновые)');
console.log('─'.repeat(74));
for (const s of stats) {
  const fails = s.runs - s.success;
  if (fails === 0) {
    console.log(`  ярус ${s.tier}: провалов нет`);
    continue;
  }
  console.log(
    `  ярус ${s.tier}: провалов ${((fails / s.runs) * 100).toFixed(0)}% — ` +
      `провиант ${((s.byFood / fails) * 100).toFixed(0)}% · бой ${((s.byCombat / fails) * 100).toFixed(0)}%` +
      (s.byCombat > 0
        ? ` (${Object.entries(s.byKind)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${ENEMY_STATS[k as keyof typeof ENEMY_STATS]?.name ?? k} ${n}`)
            .join(' · ')})`
        : ''),
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

/*
 * Цена Мастерской (§16.1, третий акт пролога). Вопрос у неё свой, и ни §11.5,
 * ни бот на него не отвечают.
 *
 * §11.5 («добыча ≈ 70% цены») задаёт темп середины игры, а речь о первом
 * возвращении, которое обязано кончиться постройкой почти у всех.
 *
 * Бот же меряет не тот заход: он осторожен и уходит рано, а первую вылазку
 * ведёт раскадровка — кадр `bait` держит игрока, пока не вскрыты два
 * контейнера. Поэтому меряется то, что даёт вскрытая пара, а не средний
 * заход осторожного игрока: два ближних контейнера яруса 0.
 */
console.log('\nЦена Мастерской: что даёт первая вылазка (два ближних контейнера)');
console.log('─'.repeat(74));
{
  const hauls: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const state = createRaid({ seed: 20260820 + i, tier: 0, kitchenLevel: 1, storageLevel: 1 });
    const { loc } = state;
    const from = { x: Math.round(state.hero.x), z: Math.round(state.hero.z) };
    const near = [...loc.containers]
      .map((c) => ({ c, d: findPath(loc.size, loc.blocked, from, { x: c.x, z: c.z }).length }))
      .filter((e) => e.d > 0)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    hauls.push(near.reduce((sum, e) => sum + (e.c.kind === 'stone' ? e.c.amount : 0), 0));
  }
  const sorted = [...hauls].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
  console.log(
    `  камня в паре: медиана ${at(0.5)} · нижняя десятая ${at(0.1)} · ` +
      `нижняя четверть ${at(0.25)} · максимум ${at(1)}`,
  );
  console.log(`  ни камня вовсе: ${((hauls.filter((n) => n === 0).length / hauls.length) * 100).toFixed(0)}% ` +
    '— оба контейнера выпали деревом, и никакая цена этого не чинит');
  for (let price = 1; price <= 8; price += 1) {
    const share = hauls.filter((n) => n >= price).length / hauls.length;
    const mark = share >= 0.8 ? ' ←' : '';
    console.log(`  цена ${price}: хватило ${(share * 100).toFixed(0)}%${mark}`);
  }
  console.log('  (← — цены, которые покрывает четыре первых вылазки из пяти)');
}
