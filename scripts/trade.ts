/**
 * Курс лавки (§13.4). Не подбор «на глаз»: три критерия проверяются перебором,
 * и печатается, какие пары чисел их держат.
 *
 * Запуск: npm run trade
 */
import { BUILD_COST } from '../src/sim/camp';
import { OFFERS } from '../src/sim/trade';
import { GEAR_COST } from '../src/sim/gear';
import { playRaid, POLICIES } from '../src/sim/bot';
import { mulberry32 } from '../src/core/rng';
import type { Tier } from '../src/sim/types';

const RUNS = 200;

/** Средняя добыча и длительность захода на ярус, по боту. */
function tierYield(tier: Tier, kitchen: number, storage: number) {
  const rng = mulberry32(20260820 + tier);
  let stone = 0, wood = 0, iron = 0, secs = 0, ok = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = playRaid(
      { seed: (rng() * 1e9) | 0, tier, kitchenLevel: kitchen, storageLevel: storage },
      POLICIES.balanced, rng,
    );
    secs += r.durationSec;
    if (r.status === 'evacuated') {
      ok++; stone += r.carried.stone; wood += r.carried.wood; iron += r.carried.iron;
    }
  }
  return {
    stone: stone / RUNS, wood: wood / RUNS, iron: iron / RUNS,
    secs: secs / RUNS, success: ok / RUNS,
  };
}

const t0 = tierYield(0, 1, 1);
const t1 = tierYield(1, 2, 2);

console.log('Курс лавки: три критерия\n');
console.log(`ярус 0 (Кухня 1): камень ${t0.stone.toFixed(1)} · дерево ${t0.wood.toFixed(1)} · железо ${t0.iron.toFixed(1)} · ${t0.secs.toFixed(0)} с · успех ${(t0.success*100).toFixed(0)}%`);
console.log(`ярус 1 (Кухня 2): камень ${t1.stone.toFixed(1)} · дерево ${t1.wood.toFixed(1)} · железо ${t1.iron.toFixed(1)} · ${t1.secs.toFixed(0)} с · успех ${(t1.success*100).toFixed(0)}%`);

/** Железа в минуту, если просто ходить на ярус 1. */
const ironPerMinRaid = (t1.iron / t1.secs) * 60;
console.log(`\nжелеза в минуту вылазкой на ярус 1: ${ironPerMinRaid.toFixed(2)}`);

const FIRST_ITEM = GEAR_COST[1]?.iron ?? 4;
const KITCHEN = BUILD_COST[2] ?? {};
console.log(`первый предмет: ${FIRST_ITEM} железа · Кухня ур. 2: камень ${KITCHEN.stone} дерево ${KITCHEN.wood}\n`);

console.log('Критерий 2 в прежнем виде («ковка успевает, пока ярус 1 закрыт»)');
console.log('снят: окно длиной в два захода, и курс, успевающий в него, обязан');
console.log('давать железо быстрее вылазки — то есть ломать §13. Кадр `craft`');
console.log('чинится таймингом кадра, а не курсом.\n');

console.log('камень→железо   железа/мин   1: проигрывает вылазке   2: за один заход   3: Кухня не ждёт');
console.log('─'.repeat(94));
const rows: string[] = [];
for (const price of [4, 5, 6, 7, 8, 9, 10, 12]) {
  for (const gain of [1, 2]) {
    const perMin = (gain / ((price / t0.stone) * t0.secs)) * 60;

    // 1. После открытия яруса 1 обмен обязан проигрывать вылазке — иначе
    //    ярус 1 не нужен, и §13 рушится.
    const loses = perMin < ironPerMinRaid;

    // 2. Один обмен должен стоить не дороже пары заходов, иначе им не
    //    воспользуется никто и лавки всё равно что нет.
    const raidsPerTrade = price / t0.stone;
    const reachable = raidsPerTrade <= 2.5;

    // 3. Обмен не отодвигает Кухню ур. 2 больше чем на два захода: лавка,
    //    тормозящая выход на ярус 1, работает против себя.
    const delay = raidsPerTrade;
    const kitchenOk = delay <= 2;

    const mark = loses && reachable && kitchenOk ? ' ←' : '';
    rows.push(
      `  ${String(price).padStart(2)} → ${gain}    ` +
      `${perMin.toFixed(2).padStart(9)}   ` +
      `${(loses ? 'да' : 'НЕТ').padStart(21)}   ` +
      `${(reachable ? `${raidsPerTrade.toFixed(1)} зах.` : `${raidsPerTrade.toFixed(1)} зах. ✘`).padStart(16)}   ` +
      `${(kitchenOk ? `+${delay.toFixed(1)} зах.` : `+${delay.toFixed(1)} ✘`).padStart(15)}${mark}`,
    );
  }
}
console.log(rows.join('\n'));
console.log('\n← пары, держащие все три критерия');
console.log(`\nна первый предмет (${FIRST_ITEM} железа) уходит:`);
for (const price of [6, 7, 8, 9]) {
  for (const gain of [1, 2]) {
    const trades = Math.ceil(FIRST_ITEM / gain);
    console.log(`  курс ${price}→${gain}: ${trades} обмена, ${trades * price} камня, ` +
      `${((trades * price) / t0.stone).toFixed(1)} заходов нулевого яруса`);
  }
}
console.log('\nДровяная строка: то же по трём критериям, но валюта — дерево');
console.log('─'.repeat(94));
console.log('дерево→железо   железа/мин   1: проигрывает вылазке   2: за один заход   3: Кухня не ждёт');
for (const price of [3, 4, 5, 6, 8, 10]) {
  const gain = 1;
  const perMin = (gain / ((price / t0.wood) * t0.secs)) * 60;
  const raidsPerTrade = price / t0.wood;
  const loses = perMin < ironPerMinRaid;
  const reachable = raidsPerTrade <= 2.5;
  // Дерева на Кухню нужно четыре, и это весь дровяной доход за два захода.
  // Обмен, съедающий столько же, отодвигает ярус 1 ровно на свою цену.
  const kitchenOk = raidsPerTrade <= 2;
  const mark = loses && reachable && kitchenOk ? ' ←' : '';
  console.log(
    `  ${String(price).padStart(2)} → ${gain}    ` +
    `${perMin.toFixed(2).padStart(9)}   ` +
    `${(loses ? 'да' : 'НЕТ').padStart(21)}   ` +
    `${(reachable ? `${raidsPerTrade.toFixed(1)} зах.` : `${raidsPerTrade.toFixed(1)} зах. ✘`).padStart(16)}   ` +
    `${(kitchenOk ? `+${raidsPerTrade.toFixed(1)} зах.` : `+${raidsPerTrade.toFixed(1)} ✘`).padStart(15)}${mark}`,
  );
}
console.log(`\nдерева за заход яруса 0: ${t0.wood.toFixed(1)} · Кухне ур. 2 нужно ${KITCHEN.wood}`);
console.log('то есть весь дровяной доход двух заходов уходит в Кухню целиком.');

console.log(`\nсейчас в коде: камень ${OFFERS['iron-stone'].give.stone} → железо ${OFFERS['iron-stone'].take.iron}, дерево ${OFFERS['iron-wood'].give.wood} → железо ${OFFERS['iron-wood'].take.iron}`);
