/**
 * Темп уровней (§22.6). Отвечает на вопрос, которого не задаёт ни дуэль,
 * ни цена присутствия: **успевает ли герой дорасти до модельного уровня
 * яруса к моменту, когда ярус открывается.**
 *
 * Лестница `TIER_HERO_LEVEL` — это обещание всей модели баланса: цена
 * присутствия и лестница сложности сняты героем этих уровней, и если
 * настоящий темп опыта их не даёт, все замеры сняты не про ту игру.
 * Кривая `xpToNext` и награда `raidXp` перестают быть placeholder ровно
 * в тот момент, когда этот прибор говорит «сходится».
 *
 * Метод: та же петля, что у золотого мастера (`playSession`, восемь сидов
 * по двадцать вылазок), — модель игрока одна и живёт в одном месте.
 * По строкам петли считается уровень героя на входе в первую вылазку
 * каждого яруса и разрыв с модельным.
 *
 * Запуск: npm run levels
 */
import { TIER_HERO_LEVEL } from '../src/sim/balance';
import { playSession } from '../src/sim/session';
import type { Tier } from '../src/sim/types';

/** Сиды золотого мастера: темп меряется на той же петле, что и экономика. */
const SEEDS = [20260820, 7, 42, 1337, 90210, 555, 31337, 2718];

const TIERS: readonly Tier[] = [0, 1, 2, 3];
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

const runs = SEEDS.map(playSession);

console.log('Темп уровней: петля золотого мастера, 8 сидов × 20 вылазок\n');

console.log('ярус   открыт на вылазке   уровень героя   модельный   разрыв');
console.log('──────────────────────────────────────────────────────────────');
const gaps: number[] = [];
for (const tier of TIERS) {
  const firstRaid: number[] = [];
  const atLevel: number[] = [];
  for (const r of runs) {
    const row = r.rows.find((x) => x.tier === tier);
    if (row === undefined) continue;
    firstRaid.push(row.n);
    atLevel.push(row.heroLevel);
  }
  if (atLevel.length === 0) {
    console.log(`  ${tier}    не открылся ни в одном прогоне`);
    continue;
  }
  const gap = mean(atLevel) - TIER_HERO_LEVEL[tier];
  gaps.push(gap);
  console.log(
    `  ${tier}${mean(firstRaid).toFixed(1).padStart(16)}` +
      `${mean(atLevel).toFixed(1).padStart(16)}` +
      `${String(TIER_HERO_LEVEL[tier]).padStart(12)}` +
      `${(gap >= 0 ? '+' : '') + gap.toFixed(1).padStart(6)}`,
  );
}

const last = runs.map((r) => r.rows[r.rows.length - 1]?.heroLevel ?? 1);
console.log(`\nуровень на последней вылазке: ${mean(last).toFixed(1)} (в среднем по сидам)`);

/**
 * Вердикт. Разрыв меряется на открытии яруса: минус — герой пришёл слабее,
 * чем ярус измерен, и лестница сложности круче обещанной; плюс больше двух —
 * герой перерос, и ярус мягче обещанного. Полтора уровня — это меньше шага
 * лестницы (два уровня на ярус): точнее детерминированная петля не скажет.
 */
console.log('\nВердикт (§22.7 — вывод прибора отменяет оценку)');
console.log('──────────────────────────────────────────────────────────────');
const worst = Math.max(...gaps.map((g) => Math.abs(g)));
if (gaps.some((g) => g < -1.5)) {
  console.log('  ⚠ ГЕРОЙ НЕ УСПЕВАЕТ: ярус открывается раньше, чем темп опыта');
  console.log('    даёт модельный уровень. Кривую xpToNext — вниз, или raidXp — вверх.');
} else if (gaps.some((g) => g > 1.5)) {
  console.log('  ⚠ ГЕРОЙ ПЕРЕРАСТАЕТ: модельный уровень приходит раньше яруса.');
  console.log('    Кривую xpToNext — вверх, или raidXp — вниз.');
} else {
  console.log(`  ✓ Темп сходится с лестницей TIER_HERO_LEVEL: наибольший разрыв ${worst.toFixed(1)} ур.`);
}
