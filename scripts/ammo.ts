/**
 * Замер колчана (§14.3). Отвечает на два вопроса, и второй важнее.
 *
 * **Первый: колчан — решение или бухгалтерия.** Если он не пустеет никогда,
 * стрелы ничего не решают и колчан можно выкинуть. Если пустеет почти
 * всегда, Лучник — это ближник с задержкой, и лук ничего не даёт.
 *
 * **Второй: не нарушен ли §21.1.** Раздел запрещает инвентарь прямым текстом:
 * «пока предмет лежит в сумке, у игрока есть решение „не сейчас", и оно
 * всегда выигрывает». §14.3 отменил §21.4 и разрешил стрелам подбираться —
 * значит обязан доказать, что беречь их не выгодно. Доказательство здесь
 * и никакое иное: два прогона, в одном стрелы возвращаются с героем,
 * в другом сгорают на выходе. Если перенос даёт добычу выше, «приберечь»
 * стало выгодным, и §21.1 нарушена не мнением, а числом.
 *
 * Запуск: npm run ammo
 */
import { POLICIES, playRaid } from '../src/sim/bot';
import { mulberry32 } from '../src/core/rng';
import { emptyGear } from '../src/sim/gear';
import { createHero, loadout } from '../src/sim/heroes';
import type { RaidOptions } from '../src/sim/raid';
import { totalOf } from '../src/sim/resources';
import type { Tier } from '../src/sim/types';

const RUNS = 200;
const TIERS: readonly Tier[] = [1, 2, 3];
const CAMP: Record<Tier, { kitchenLevel: number; storageLevel: number }> = {
  0: { kitchenLevel: 1, storageLevel: 1 },
  1: { kitchenLevel: 2, storageLevel: 2 },
  2: { kitchenLevel: 3, storageLevel: 3 },
  3: { kitchenLevel: 4, storageLevel: 4 },
};

interface Run {
  readonly spent: number;
  readonly left: number;
  readonly max: number;
  readonly dry: number;
  readonly haul: number;
  readonly ok: boolean;
  /** Доля вылазки, на которой колчан опустел; null — не опустел. */
  readonly dryAt: number | null;
}

/**
 * Игрок берётся у бота целиком. Своя копия здесь была и пережила ровно
 * до пошагового боя: игрок, не умеющий ходить в бою, вешает вылазку.
 */
function play(opts: RaidOptions): Run {
  const r = playRaid(opts, POLICIES.cautious, mulberry32(opts.seed));
  return {
    spent: r.arrowsSpent,
    left: r.arrowsLeft,
    max: r.arrowsSpent + r.arrowsLeft,
    dry: r.dryFights,
    haul: totalOf(r.carried),
    ok: r.status === 'evacuated',
    // Глубина опустошения колчана из итога не выводится, и врать ею нельзя:
    // прибор показывает то, что меряет, а не то, что удобно.
    dryAt: r.arrowsLeft === 0 && r.arrowsSpent > 0 ? 1 : null,
  };
}

/** Лучник со снаряжением уровня `level`: колчан растёт от оружия (§14.3). */
const archer = (seed: number, tier: Tier, level: number, arrows?: number): RaidOptions => {
  const gear = emptyGear();
  gear.weapon = level;
  return {
    ...CAMP[tier], seed, tier,
    loadout: loadout(createHero('archer', 0)),
    gear,
    ...(arrows === undefined ? {} : { arrows }),
  };
};

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

console.log(`Колчан: ${RUNS} вылазок Лучником на ярус\n`);
console.log('ярус  оружие  колчан  потрачено  осталось  опустел  на глубине  сухих стычек  успех');
for (const tier of TIERS) {
  for (const level of [0, 3, 5]) {
    const runs = Array.from({ length: RUNS }, (_, i) => play(archer(i, tier, level)));
    const empty = runs.filter((r) => r.dryAt !== null);
    console.log(
      `${String(tier).padStart(4)}${String(level).padStart(8)}${String(runs[0]!.max).padStart(8)}` +
        `${mean(runs.map((r) => r.spent)).toFixed(1).padStart(11)}` +
        `${mean(runs.map((r) => r.left)).toFixed(1).padStart(10)}` +
        `${pct(empty.length / runs.length).padStart(9)}` +
        `${(empty.length === 0 ? '—' : pct(mean(empty.map((r) => r.dryAt!)))).padStart(12)}` +
        `${mean(runs.map((r) => r.dry)).toFixed(1).padStart(14)}` +
        `${pct(runs.filter((r) => r.ok).length / runs.length).padStart(7)}`,
    );
  }
}

/**
 * Аудит §21.1. «Перенос» — стрелы возвращаются с героем и копятся, как оно
 * и сделано; «сгорание» — колчан выдаётся полным каждый раз и обнуляется
 * на выходе. Если перенос выгоднее, беречь стало выгодным.
 *
 * Копление моделируется прямо: колчан на входе — то, что осталось от прошлой
 * вылазки плюс подобранное, без покупок. Сгорание — всегда полный колчан.
 */
console.log('\n══ аудит §21.1: выгодно ли беречь стрелы ══');
const LEVEL = 3;
for (const tier of TIERS) {
  let carried = 0;
  const kept: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = play(archer(i, tier, LEVEL, carried));
    carried = r.ok ? r.left : 0;
    kept.push(r.haul);
  }
  const burned = Array.from({ length: RUNS }, (_, i) => play(archer(i, tier, LEVEL)).haul);
  const d = mean(kept) - mean(burned);
  console.log(
    `ярус ${tier}: с переносом ${mean(kept).toFixed(2)} · со сгоранием ${mean(burned).toFixed(2)}` +
      ` · разница ${d >= 0 ? '+' : ''}${d.toFixed(2)}`,
  );
}
console.log(
  '\n  Разница около нуля — беречь не выгодно, и §21.1 не нарушена.\n' +
    '  Заметный плюс у переноса — «приберечь» стало выигрышной стратегией,\n' +
    '  и тогда стрелы обязаны сгорать на выходе, как расходники §21.',
);
