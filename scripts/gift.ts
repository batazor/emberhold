/**
 * Подарок за вход: сколько он стоит в вылазках (§29).
 *
 * Прибор отвечает на один вопрос — **не обгоняет ли вход игру**, — и отвечает
 * на него замером, а не таблицей. Добыча яруса берётся не из констант, а тем
 * же ботом, каким её меряет `npm run measure`: константа `TIER_HAUL` могла
 * устареть, а гарантия §29.1 сформулирована про настоящую добычу.
 *
 * Доля вылазки (`GIFT_SHARE`) здесь не проверяется, а **выводится**: прибор
 * перебирает доли и печатает наибольшую, при которой все гарантии держатся
 * на округлённых числах и на всех ярусах. Записанная в `daily.ts` доля обязана
 * совпасть с выведенной — иначе строка вердикта скажет, чем именно.
 *
 * Запуск: npm run gift
 */
import { mulberry32 } from '../src/core/rng';
import { POLICIES, playRaid } from '../src/sim/bot';
import { referenceLoadout } from '../src/sim/heroes';
import { TIER_HAUL, TIER_HERO_LEVEL, TIER_KITCHEN_GATE, deriveBuildCost, roundNice } from '../src/sim/balance';
import {
  CYCLE_WEEK,
  DAY_WEIGHT,
  GIFT_SHARE,
  ROOKIE_WEEK,
  WEEK,
  WEEK_BUDGET_SHARE,
  giftAt,
  giftLoot,
} from '../src/sim/daily';
import { totalOf } from '../src/sim/resources';
import type { Resources } from '../src/sim/resources';
import type { Tier } from '../src/sim/types';

const RUNS = 150;
const TIERS: readonly Tier[] = [0, 1, 2, 3];

const sum = (r: Partial<Resources>): number =>
  totalOf({ stone: 0, wood: 0, iron: 0, crystal: 0, ...r });

/**
 * Две добычи одного яруса. `success` — средняя удачной вылазки, та самая,
 * что записана в `TIER_HAUL`; `all` — средняя любого захода, включая
 * провальные, у которых ставка §11.2 отняла часть унесённого.
 *
 * Гарантии считаются по `all`, а не по `success`, и это решение: доход
 * игрока — это то, что он приносит домой, а не то, что приносит удачный
 * день. Размер подарка при этом выводится из `TIER_HAUL` — константы
 * стабильной, — и потому обе величины нужны сразу.
 */
function haulOf(tier: Tier): { success: number; all: number } {
  let carried = 0;
  let ok = 0;
  let okCarried = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const r = playRaid(
      {
        seed,
        tier,
        kitchenLevel: TIER_KITCHEN_GATE[tier],
        storageLevel: tier + 1,
        loadout: referenceLoadout(TIER_HERO_LEVEL[tier]),
      },
      POLICIES.cautious,
      mulberry32(seed),
    );
    carried += r.carriedTotal;
    if (r.status === 'evacuated') {
      ok += 1;
      okCarried += r.carriedTotal;
    }
  }
  return { success: ok > 0 ? okCarried / ok : 0, all: carried / RUNS };
}

/**
 * Кучка дня при произвольной доле. Повторяет `giftLoot`, но с чужой долей:
 * перебор без этого невозможен, а менять модуль ради перебора нельзя.
 */
function loot(share: number, weight: number, kinds: number, haul: number): number {
  if (kinds === 0) return 0;
  return Math.max(kinds, roundNice(share * weight * haul));
}

console.log(`Подарок за вход: ${RUNS} вылазок на ярус, бот-осторожный\n`);

/* ---------- добыча: замер против константы ---------- */

const hauls = new Map<Tier, number>();
console.log('ярус   удачная   TIER_HAUL   расхождение   любой заход');
console.log('─'.repeat(58));
for (const tier of TIERS) {
  const haul = haulOf(tier);
  hauls.set(tier, haul.all);
  const drift = ((haul.success - TIER_HAUL[tier]) / TIER_HAUL[tier]) * 100;
  console.log(
    `  ${tier}     ${haul.success.toFixed(2).padStart(6)}      ${TIER_HAUL[tier].toFixed(1).padStart(6)}` +
      `        ${((drift >= 0 ? '+' : '') + drift.toFixed(0) + '%').padStart(5)}        ${haul.all.toFixed(2).padStart(6)}`,
  );
}

/* ---------- вывод доли ---------- */

/**
 * Держатся ли обе гарантии при этой доле. Считается по округлённым кучкам
 * и по замеренной добыче — то есть ровно по тому, что получит игрок.
 */
function holds(share: number): { ok: boolean; why: string } {
  for (const tier of TIERS) {
    const haul = hauls.get(tier)!;
    let week = 0;
    for (let day = 0; day < WEEK; day++) {
      const kinds = CYCLE_WEEK[day]!.kinds.length;
      const got = loot(share, DAY_WEIGHT[day]!, kinds, haul);
      week += got;
      if (got > haul) {
        return { ok: false, why: `ярус ${tier}, день ${day + 1}: ${got} > вылазки ${haul.toFixed(1)}` };
      }
    }
    const budget = WEEK * haul * WEEK_BUDGET_SHARE;
    if (week > budget) {
      return { ok: false, why: `ярус ${tier}: неделя ${week} > бюджета ${budget.toFixed(1)}` };
    }
  }
  return { ok: true, why: '' };
}

console.log('\nПеребор доли: где кончаются гарантии §29.1');
console.log('─'.repeat(58));
let best = 0;
for (let share = 0.2; share <= 1.001; share += 0.05) {
  const round = Math.round(share * 100) / 100;
  const { ok, why } = holds(round);
  if (ok) best = round;
  console.log(`  ${round.toFixed(2)}   ${ok ? 'держатся' : `не держатся — ${why}`}`);
}

/* ---------- что получает игрок ---------- */

console.log(`\nКруг недели при доле ${GIFT_SHARE.toFixed(2)} (то, что записано в daily.ts)`);
console.log('─'.repeat(52));
console.log('ярус   д1  д2  д3  д4  д5  д6  д7   неделя   доля недели игрока');
for (const tier of TIERS) {
  const haul = hauls.get(tier)!;
  const days: number[] = [];
  for (let day = 0; day < WEEK; day++) days.push(sum(giftLoot(giftAt(WEEK + day), tier, WEEK + day)));
  const week = days.reduce((a, b) => a + b, 0);
  console.log(
    `  ${tier}   ${days.map((d) => String(d).padStart(3)).join(' ')}   ${String(week).padStart(4)}` +
      `     ${((week / (WEEK * haul)) * 100).toFixed(0)}% при одной вылазке в день` +
      `, ${((week / (WEEK * haul * 3)) * 100).toFixed(0)}% при трёх`,
  );
}

/* ---------- первая неделя ---------- */

console.log('\nПервая неделя: ресурсные дни те же, три дня — вещи и человек');
console.log('─'.repeat(52));
for (const tier of [0, 1] as Tier[]) {
  const line = ROOKIE_WEEK.map((gift, day) => {
    const got = sum(giftLoot(gift, tier, day));
    return got > 0 ? String(got) : gift.id.slice(0, 4);
  });
  console.log(`  ярус ${tier}:  ${line.join(' · ')}`);
}

/* ---------- сколько это в стройке ---------- */

/**
 * Перевод в понятную величину: сколько дней подарков стоит следующее
 * улучшение — и сколько вылазок стоит оно же. Вторая колонка обязана быть
 * меньше первой, иначе приходить выгоднее, чем ходить.
 */
console.log('\nСколько стоит следующее улучшение');
console.log('─'.repeat(52));
console.log('ур.   цена   вылазок   дней подарков');
for (let level = 2; level <= 5; level++) {
  const cost = sum(deriveBuildCost(level));
  const tier = Math.min(3, level - 1) as Tier;
  const haul = hauls.get(tier)!;
  let week = 0;
  for (let day = 0; day < WEEK; day++) week += sum(giftLoot(giftAt(WEEK + day), tier, WEEK + day));
  const perDay = week / WEEK;
  console.log(
    `  ${level}    ${String(cost).padStart(4)}     ${(cost / haul).toFixed(1).padStart(5)}` +
      `        ${(cost / perDay).toFixed(1).padStart(5)}`,
  );
}

/* ---------- вердикт ---------- */

const verdicts: string[] = [];
if (Math.abs(best - GIFT_SHARE) > 1e-9) {
  verdicts.push(
    `доля в daily.ts — ${GIFT_SHARE.toFixed(2)}, а замер держит ${best.toFixed(2)}: ` +
      (best > GIFT_SHARE ? 'подарок мельче, чем позволено' : 'подарок крупнее, чем позволено'),
  );
}
for (const tier of TIERS) {
  for (let taken = 0; taken < WEEK * 2; taken++) {
    if ((giftLoot(giftAt(taken), tier, taken).crystal ?? 0) > 0) {
      verdicts.push(`ярус ${tier}, подарок ${taken + 1} даёт кристалл — §13 отменён`);
    }
  }
}

console.log('\nВердикт');
console.log('─'.repeat(52));
if (verdicts.length === 0) {
  console.log(`  доля ${GIFT_SHARE.toFixed(2)} — наибольшая из тех, при которых гарантии держатся.`);
  process.exit(0);
}
for (const line of verdicts) console.log(`  ✗ ${line}`);
process.exit(1);
