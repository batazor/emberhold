/**
 * Лавка (§13.5) под прибором. Две части, и обе меряют, а не назначают:
 *
 *  1. **Курс** — три критерия перебором, и печатается, какие пары чисел
 *     их держат;
 *  2. **Запас** — течёт ли собранное местными (§13.8) в прилавок торговца,
 *     сколько его там, как часто прилавок пуст и что запас чинит.
 *
 * Запуск: npm run trade
 */
import { BUILD_COST } from '../src/sim/camp';
import { PARITY, STOCKED, feeOf, offerOf } from '../src/sim/trade';
import { generateCastleSite } from '../src/sim/castleSite';
import { BERRY_FOOD_AVG, BUSHES, RIPEN_SECONDS, berryYield, localsOf, localsTook, takenByLocals } from '../src/sim/berries';
import { FOOD_PER_MOUTH } from '../src/sim/balance';
import { WORK_CAP, WORK_SECONDS } from '../src/sim/residents';
import { DAY_SEC } from '../src/sim/world';
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

console.log(`\nпаритет в коде: камень ${PARITY['iron-stone'].give.stone} → железо ${PARITY['iron-stone'].take.iron}, дерево ${PARITY['iron-wood'].give.wood} → железо ${PARITY['iron-wood'].take.iron}`);

// Лестница наценки: критерии выше меряют паритет — лучшую цену лавки;
// незнакомому дороже, и это в пользу продавца по построению (feeOf ≥ 0).
console.log('\nотношения: наценка по сделкам');
for (let d = 0; d <= 5; d++) {
  const stone = offerOf('iron-stone', d).give.stone;
  const wood = offerOf('iron-wood', d).give.wood;
  console.log(`  сделок ${d}: наценка ${(feeOf(d) * 100).toFixed(0)} на сто · камень ${stone} · дерево ${wood}`);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Часть 2. Запас прилавка (§13.5 × §13.8)                                */
/* ══════════════════════════════════════════════════════════════════════ */

console.log('\n\n══ Запас: течёт ли собранное местными в лавку ══\n');

const SEEDS = 300;
const DAYS = 30;

/** Сколько пищи местные унесли у замка за сутки — по сидам и дням. */
const daily: number[] = [];
const perSeed: number[] = [];
for (let i = 0; i < SEEDS; i++) {
  const site = generateCastleSite(1000 + i * 7919);
  let sum = 0;
  for (let d = 0; d < DAYS; d++) {
    const food = localsTook(site.loc.seed, site.bushes, localsOf(site.gate, site.bushes), d * DAY_SEC + 60);
    daily.push(food);
    sum += food;
  }
  perSeed.push(sum / DAYS);
}
daily.sort((a, b) => a - b);
perSeed.sort((a, b) => a - b);
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const q = (xs: readonly number[], p: number): number => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const share = (xs: readonly number[], ok: (x: number) => boolean): number =>
  xs.filter(ok).length / xs.length;

console.log(`кустов у замка: ${BUSHES.castleMin}–${BUSHES.castleMax} · окно созревания ${RIPEN_SECONDS / 3600} ч · сутки ${DAY_SEC / 3600} ч`);
console.log(`пищи за сутки, ${SEEDS} замков × ${DAYS} суток: среднее ${mean(daily).toFixed(2)} · медиана ${q(daily, 0.5)} · верхняя четверть ${q(daily, 0.75)}`);
console.log(`прилавок пуст: ${(share(daily, (f) => f === 0) * 100).toFixed(0)}% суток · держит хоть одну пищу: ${(share(daily, (f) => f >= 1) * 100).toFixed(0)}%`);
console.log(`по замкам (пищи в сутки): худший ${perSeed[0]!.toFixed(2)} · медиана ${q(perSeed, 0.5).toFixed(2)} · лучший ${perSeed.at(-1)!.toFixed(2)}`);
console.log(`замков, где прилавок пуст всегда (<0,5 в сутки): ${(share(perSeed, (f) => f < 0.5) * 100).toFixed(0)}%`);

/**
 * Горизонт запаса: почему сутки, а не окно созревания. Окно — родной срок
 * куста, и первое, что просится; замер его и отменяет.
 */
const windowly: number[] = [];
for (let i = 0; i < SEEDS; i++) {
  const site = generateCastleSite(1000 + i * 7919);
  for (let e = 0; e < (DAYS * DAY_SEC) / RIPEN_SECONDS; e++) {
    const at = e * RIPEN_SECONDS + 60;
    let food = 0;
    const locals = localsOf(site.gate, site.bushes);
    for (const bush of site.bushes) {
      if (takenByLocals(site.loc.seed, bush, locals, at)) food += berryYield(bush);
    }
    windowly.push(food);
  }
}
console.log('\nгоризонт запаса — за какой срок считать принесённое местными:');
console.log(`  окно созревания (${RIPEN_SECONDS / 3600} ч): ${mean(windowly).toFixed(2)} пищи · прилавок пуст ${(share(windowly, (f) => f === 0) * 100).toFixed(0)}% приходов`);
console.log(`  сутки (${DAY_SEC / 3600} ч):            ${mean(daily).toFixed(2)} пищи · прилавок пуст ${(share(daily, (f) => f === 0) * 100).toFixed(0)}% приходов`);
console.log('  ← окно отменено замером: меньше единицы на прилавке — это не запас, а закрытая лавка.');
console.log('    Сутки взяты не на глаз: ягода не лежит дольше дня, а день игра уже считает (§29).');

/* ---------- зачем запас: требование, которое было записано и не держалось ---------- */

/**
 * `trade.ts` про пищевую строку: «обмен обязан проигрывать своему добытчику,
 * иначе жилец с приказом „Добывать пищу“ теряет смысл, а вместе с ним
 * и выбор между людьми». `npm run upkeep` проверяет это на темпе **жильца**
 * и получает «проигрывает». Здесь то же требование меряется на темпе
 * **игрока** — и до запаса оно не держалось.
 */
const stonePerFood = (PARITY['food-stone'].give.stone ?? 0) / (PARITY['food-stone'].take.food ?? 1);
const shopPerHour = ((t0.stone / t0.secs) * 3600) / stonePerFood;
const gathererPerHour = 3600 / WORK_SECONDS;
const campBushPerHour = (BUSHES.camp * BERRY_FOOD_AVG) / (RIPEN_SECONDS / 3600);
const counterPerHour = mean(daily) / (DAY_SEC / 3600);

console.log('\nпищи в час, все источники разом:');
console.log(`  добытчик (§13.7, идёт сам)          ${gathererPerHour.toFixed(2)}`);
console.log(`  кусты лагеря (§13.8, за внимание)   ${campBushPerHour.toFixed(2)}`);
console.log(`  прилавок с запасом                  ${counterPerHour.toFixed(2)}`);
console.log(`  прилавок без запаса, темп игрока    ${shopPerHour.toFixed(0)}  ← ${(shopPerHour / gathererPerHour).toFixed(0)}× добытчика`);
console.log(
  `\nсуточное содержание лагеря окупается вылазками за:` );
for (const mouthsN of [3, 6, 9]) {
  const perAbsence = mouthsN * FOOD_PER_MOUTH * WORK_CAP;
  const secs = ((perAbsence * stonePerFood) / t0.stone) * t0.secs;
  console.log(`  ${mouthsN} ртов: ${perAbsence.toFixed(1)} пищи за отлучку = ${(perAbsence * stonePerFood).toFixed(0)} камня = ${secs.toFixed(0)} с`);
}
console.log(
  counterPerHour < gathererPerHour
    ? `✓ С запасом лавка проигрывает добытчику: ${counterPerHour.toFixed(2)} против ${gathererPerHour.toFixed(2)} пищи в час.\n` +
        '  Приказ «Добывать пищу» снова выбор, а обмен — страховка, как и записано.'
    : `⚠ Запас не помог: ${counterPerHour.toFixed(2)} против ${gathererPerHour.toFixed(2)} — лавка всё ещё обгоняет добытчика.`,
);

/* ---------- чего запас не трогает ---------- */

/**
 * Запас **убавляет сделки, а не цену**, поэтому три критерия он сдвинуть
 * не может по построению: все три — верхние границы на курс. Печатается это
 * затем, чтобы довод стоял рядом с числами, а не в памяти автора.
 */
const raidsPerTradeStone = (PARITY['iron-stone'].give.stone ?? 8) / t0.stone;
console.log('\nтри критерия §13.5 до запаса и после — одни и те же числа:');
console.log('  критерий                                   без запаса   с запасом');
console.log(`  1. железа в минуту обменом                 ${((1 / (raidsPerTradeStone * t0.secs)) * 60).toFixed(2).padStart(9)}   ${((1 / (raidsPerTradeStone * t0.secs)) * 60).toFixed(2).padStart(9)}`);
console.log(`  2. заходов за один обмен                   ${raidsPerTradeStone.toFixed(2).padStart(9)}   ${raidsPerTradeStone.toFixed(2).padStart(9)}`);
console.log(`  3. на сколько заходов отодвинута Кухня 2   ${raidsPerTradeStone.toFixed(2).padStart(9)}   ${raidsPerTradeStone.toFixed(2).padStart(9)}`);
console.log('\nСовпадение здесь не удача, а построение: все три критерия — границы');
console.log('на **курс**, а запас убавляет сделки, не трогая цену. Сдвинуть их он');
console.log('не может ни в какую сторону, и мерить их заново незачем — но напечатать');
console.log('рядом стоит, чтобы довод жил числом, а не памятью автора.');
console.log(`\nсчёт стоит только на: ${STOCKED.join(', ')}. Железа счёт не знает: в мире его`);
console.log('никто для торговца не добывает, всякое число было бы назначенным, а §13.2');
console.log('требует, чтобы у камня остался безусловный сток. Отсюда и §13.1: пустой');
console.log('прилавок не отказ после дороги — за железом в замок можно прийти всегда.');
