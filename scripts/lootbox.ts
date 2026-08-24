/** Числовой отчёт ларца снабжения; формулы и Monte Carlo рядом. */
import {
  SUPPLY_BOX_CHANCE,
  SUPPLY_HARD_PITY,
  SUPPLY_RARE_CHANCE,
  SUPPLY_REWARDS,
  simulateSupplyBoxes,
  supplyValueSummary,
} from '../src/sim/lootbox';

const pct = (n: number): string => `${(n * 100).toFixed(2)}%`;
const num = (n: number): string => n.toFixed(2);
const summary = supplyValueSummary();
const simulation = simulateSupplyBoxes(100_000, 0x51a7);

console.log('ЛАРЕЦ СНАБЖЕНИЯ');
console.log(`появление в заходе яруса 2–3: ${pct(SUPPLY_BOX_CHANCE)}`);
console.log(`базовый редкий шанс: ${pct(SUPPLY_RARE_CHANCE)} · hard pity: ${SUPPLY_HARD_PITY}`);
console.log('');
console.log(`цель: ${num(summary.target)}`);
console.log(`EV без pity: ${num(summary.baseExpected)}`);
console.log(`EV длинной серии: ${num(summary.longRunExpected)} (${pct(summary.overTarget)} к цели)`);
console.log(`разброс: ${num(summary.min)}…${num(summary.max)} · σ ${num(summary.standardDeviation)}`);
console.log('');
console.log(`редкая награда раз в ${num(summary.pity.expectedBoxes)} ларца`);
console.log(`фактическая редкость: ${pct(summary.pity.longRunRareRate)}`);
console.log(`до hard pity доходит: ${pct(summary.pity.hardPityShare)}`);
console.log(`P50 / P90 / P95: ${summary.pity.p50} / ${summary.pity.p90} / ${summary.pity.p95}`);
console.log('');
console.log(`Monte Carlo ${simulation.count}: EV ${num(simulation.averageValue)}, ` +
  `редких ${pct(simulation.rareRate)}, принудительных ${pct(simulation.forcedRate)}`);
console.log('');
console.log('награда'.padEnd(22), 'ценность'.padStart(9), 'выпало'.padStart(9));
for (const reward of Object.values(SUPPLY_REWARDS)) {
  console.log(reward.name.padEnd(22), num(reward.value).padStart(9),
    String(simulation.rewardCounts[reward.id]).padStart(9));
}
