/**
 * Печать одной сессии из двадцати вылазок. Сам прогон — src/sim/session.ts.
 * Это отчёт для чтения, а не замер: для калибровки есть measure,
 * для регрессии — verify.
 *
 * Запуск: npm run play [сид]
 */
import { BUILDINGS, BUILDING_ORDER } from '../src/sim/camp';
import { RAIDS, playSession } from '../src/sim/session';

const SEED = Number(process.argv[2] ?? 20260820);
const r = playSession(SEED);
const s = r.summary;
const pct = (x: number): string => `${Math.round(x * 100)}%`;

console.log(`Сессия, сид ${SEED}\n`);
console.log('Вылазка               Вынес Потерял Время Глубина  Предложено      Начато');
console.log('─'.repeat(92));
for (const row of r.rows) {
  console.log(
    `${String(row.n).padStart(2)}  ярус ${row.tier}  ` +
      `${row.evacuated ? 'вышел ' : 'провал '} ` +
      `${String(row.carried).padStart(3)}  ` +
      `${String(row.lost).padStart(3)}  ` +
      `${String(Math.round(row.durationSec)).padStart(4)} с  ` +
      `${String(Math.round(row.depthShare * 100)).padStart(4)}%  ` +
      `${row.offer === null ? 'нечего купить' : BUILDINGS[row.offer].name.padEnd(7)}  ${row.started}`,
  );
}

console.log('\nТелеметрия (§9)');
console.log('─'.repeat(92));
console.log(`  Вылазок                    ${s.raids} из ${RAIDS}`);
console.log(`  Провалов                   ${pct(s.failRate)}          как часто не доходят домой`);
console.log(`  Глубина выхода             ${pct(s.avgDepthShare)}          ниже половины = уходят рано (§9)`);
console.log(`  Вынесено за вылазку        ${s.avgCarried.toFixed(1)}`);
console.log(`  Потеряно за вылазку        ${s.avgLost.toFixed(1)}`);
console.log(`  Покупка была доступна      ${pct(s.buyOfferRate)}          цель 60–80% (§20.1)`);
console.log(`  Из них выбрали стройку     ${pct(s.buyTakeRate)}`);
console.log(
  `  Почему не предложена       ${Object.entries(r.noOffer)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ')}`,
);
console.log(`  Построено первым           ${s.firstBuilding === null ? '—' : BUILDINGS[s.firstBuilding].name}`);
console.log(
  `  Возврат после таймера      ${s.medianReturnMin === null ? '—' : `${s.medianReturnMin.toFixed(0)} мин`}          сравнивать с §20.2`,
);
console.log(`  Выходы из сессии           вылазка ${s.exits.raid} · лагерь ${s.exits.camp} · возврат ${s.exits.return}`);

console.log('\nЛагерь на конец');
console.log('─'.repeat(92));
console.log(`  ${BUILDING_ORDER.map((id) => `${BUILDINGS[id].name} ${r.levels[id]}`).join(' · ')}`);
console.log(
  `  Осталось: камень ${r.resources.stone} · дерево ${r.resources.wood} · ` +
    `железо ${r.resources.iron} · кристалл ${r.resources.crystal}`,
);
console.log(`  Прошло игрового времени: ${r.elapsedHours.toFixed(1)} ч`);
