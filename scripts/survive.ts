/**
 * Глубина яруса как задача о выживании (§11.3, §22.7).
 *
 * §11.3 спрашивает, **где** приходит провал, и сегодня на это отвечают два
 * средних — `measure` печатает глубину отдельно у павших и у дошедших, а
 * золотой мастер сводит их в одно `avgDepthShare`. Оба числа смещены,
 * и в разные стороны:
 *
 * - **по погибшим** — вниз: все вылазки, прошедшие глубже и вернувшиеся
 *   домой живыми, из выборки выброшены целиком;
 * - **по всем** — оно вообще не про ярус. Дошедший остановился сам, и его
 *   глубина измеряет осторожность бота: поправь `decide()`, и метрика
 *   поедет на локации, которая не менялась.
 *
 * Площадь под кривой выживания (`src/core/survival.ts`) не выбрасывает
 * дошедших: возвращение домой — не гибель на этой глубине, а «прошёл
 * не меньше». Ровно этим оно и полезно.
 *
 * **Чего это число не делает.** Каплан—Мейер верен, когда наблюдение
 * обрывается по причине, не связанной с гибелью. Здесь связь есть: бот
 * идёт домой тогда, когда кончается провиант, то есть когда до гибели
 * ближе всего. Такой обрыв завышает оценку. Поэтому число читается
 * не как «истинная глубина», а как **верхний край вилки** — нижний
 * даёт среднее по погибшим. Ширина вилки и есть то, чего мы про ярус
 * не знаем; сузить её может только политика, уходящая домой по причине,
 * не связанной со смертью, — или живая телеметрия.
 *
 * Тот же модуль считает LT игрока, когда появятся заходы: там `S(t)` —
 * доля ещё играющих на день `t`, обрыв — «ещё не ушёл к концу выгрузки»
 * и связи с уходом уже не имеет, а `powerFit` с `tailArea` продлевают
 * кривую за край данных. `LT × ARPDAU` — это LTV.
 *
 * Запуск: npm run survive
 */
import { mulberry32 } from '../src/core/rng';
import { kaplanMeier, meanOfAll, meanOfDeaths, restrictedMean, survivalAt } from '../src/core/survival';
import type { Observation } from '../src/core/survival';
import { POLICIES, playRaid } from '../src/sim/bot';
import { referenceLoadout } from '../src/sim/heroes';
import { TIER_HERO_LEVEL, TIER_KITCHEN_GATE } from '../src/sim/balance';
import type { Tier } from '../src/sim/types';

const RUNS = 300;
const TIERS: readonly Tier[] = [0, 1, 2, 3];

/** Наблюдения одного яруса: докуда заход дошёл и сам ли он остановился. */
function observe(tier: Tier): Observation[] {
  const kitchenLevel = TIER_KITCHEN_GATE[tier];
  const storageLevel = tier + 1;
  const out: Observation[] = [];
  for (let seed = 1; seed <= RUNS; seed += 1) {
    const r = playRaid(
      { seed, tier, kitchenLevel, storageLevel, loadout: referenceLoadout(TIER_HERO_LEVEL[tier]) },
      POLICIES.cautious,
      mulberry32(seed),
    );
    out.push({
      time: r.locMaxBack > 0 ? r.maxBack / r.locMaxBack : 0,
      // Дошедший — оборванное наблюдение: он остановился сам, а не упёрся
      // в ярус. Статус в коде не переименован намеренно (§0.1).
      dead: r.status !== 'evacuated',
    });
  }
  return out;
}

const pct = (x: number, d = 0): string => `${(x * 100).toFixed(d)}%`;
const cell = (s: string, w: number): string => s.padStart(w);

console.log(`Глубина яруса: ${RUNS} вылазок, бот-осторожный\n`);
console.log('ярус  вылазок  гибелей   по погибшим   по всем      ∫S    вилка   дошли до дна');
console.log('─'.repeat(80));

const rows = TIERS.map((tier) => {
  const obs = observe(tier);
  const curve = kaplanMeier(obs);
  const low = meanOfDeaths(obs);
  const all = meanOfAll(obs);
  const area = restrictedMean(curve);
  console.log(
    `  ${tier}   ${cell(String(curve.total), 6)}  ${cell(pct(curve.deaths / curve.total), 6)}  ` +
      `${cell(low === null ? '—' : pct(low, 1), 12)}  ${cell(pct(all, 1), 8)}  ` +
      `${cell(pct(area, 1), 6)}  ${cell(low === null ? '—' : `×${(area / low).toFixed(2)}`, 6)}  ` +
      `${cell(pct(curve.tail, 1), 12)}`,
  );
  return { tier, curve, low, all, area };
});

console.log('\nS(глубина) — доля вылазок, ещё способных идти глубже');
console.log('─'.repeat(80));
const GRID = [0.1, 0.25, 0.5, 0.75, 0.9, 1];
console.log(`ярус  ${GRID.map((g) => cell(pct(g), 7)).join('')}`);
for (const { tier, curve } of rows) {
  console.log(`  ${tier}   ${GRID.map((g) => cell(pct(survivalAt(curve, g), 1), 7)).join('')}`);
}

console.log('\nЧто с этим делать');
console.log('─'.repeat(80));
for (const { tier, low, all, area } of rows) {
  if (low === null) {
    console.log(`  ярус ${tier}: ни одной гибели — ярус ничего не решает, кривой нет`);
    continue;
  }
  const spread = area / low - 1;
  const drift = Math.abs(area - all) / Math.max(1e-9, all);
  console.log(
    `  ярус ${tier}: истинная глубина между ${pct(low, 1)} и ${pct(area, 1)} ` +
      `(вилка ${pct(spread, 0)}); с avgDepthShare расходится на ${pct(drift, 0)}`,
  );
}
console.log(
  '\n  Вилка узкая — сегодняшних средних хватает, ветка закрывается.' +
    '\n  Вилка широкая — про ярус мы не знаем главного, и решать его цену по одному среднему нельзя.',
);
