/**
 * Замер классов (§11.7). Отвечает на два вопроса, которые документ ставит,
 * но сам проверить не может:
 *
 * 1. **Не вырожден ли выбор.** Если один класс лучший на всех ярусах, выбор
 *    героя — не решение, а подсказка, и экран отряда можно выкидывать.
 *    Проверяемое условие: у каждого класса есть ярус, где он первый по добыче.
 * 2. **Читается ли умение.** Если прогон с умением не отличается от прогона
 *    без него, умение — кнопка без последствий, и §11.7 прочитан неверно.
 *
 * Метод. Один и тот же список сидов проходят все три класса: сравнение
 * парное, поэтому разброс локаций вычитается, а не подмешивается в результат.
 * Политика одна на всех — `balanced`: разные политики мерили бы игрока,
 * а не класс.
 *
 * Запуск: npx tsx scripts/classes.ts
 * (в package.json не прописан намеренно: файл сейчас правят соседние сессии,
 *  и строка скрипта добавится вместе с их изменениями, а не поперёк них)
 */
import { mulberry32 } from '../src/core/rng';
import { POLICIES, playRaid } from '../src/sim/bot';
import { CLASS_ORDER, HERO_CLASSES, SKILLS, createHero, loadout } from '../src/sim/heroes';
import type { HeroClassId } from '../src/sim/heroes';
import { totalOf } from '../src/sim/resources';
import type { Tier } from '../src/sim/types';

const RUNS = 200;
const TIERS: readonly Tier[] = [0, 1, 2, 3];

/** Пары «ярус — здания» те же, что в калибровке §20.3: иначе классы мерились
 *  бы на разной экономике и числа нельзя было бы сравнить с BUILD_COST. */
const CAMP: Record<Tier, { kitchenLevel: number; storageLevel: number }> = {
  0: { kitchenLevel: 1, storageLevel: 1 },
  1: { kitchenLevel: 2, storageLevel: 2 },
  2: { kitchenLevel: 3, storageLevel: 3 },
  3: { kitchenLevel: 4, storageLevel: 4 },
};

interface Row {
  readonly cls: HeroClassId;
  readonly tier: Tier;
  readonly success: number;
  readonly carried: number;
  readonly depth: number;
  readonly seconds: number;
  readonly skillCarried: number;
  readonly skillSuccess: number;
  readonly skillDepth: number;
  /** Доля вылазок, где умение вообще сработало. */
  readonly skillFired: number;
}

const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

function measure(cls: HeroClassId, tier: Tier, useSkills: boolean): {
  success: number;
  carried: number;
  depth: number;
  seconds: number;
  fired: number;
} {
  const hero = createHero(cls, 0);
  const gear = loadout(hero);
  const carried: number[] = [];
  const depth: number[] = [];
  const seconds: number[] = [];
  let ok = 0;
  let fired = 0;

  for (let i = 0; i < RUNS; i++) {
    // Сид зависит от яруса и номера прогона, но не от класса: все трое
    // проходят одни и те же локации.
    const seed = 1_000_003 * (tier + 1) + i * 7919;
    const rng = mulberry32(seed ^ 0x5f3759df);
    const r = playRaid(
      { seed, tier, ...CAMP[tier], loadout: gear, useSkills },
      POLICIES.balanced,
      rng,
    );
    if (r.status === 'evacuated') {
      ok++;
      carried.push(totalOf(r.carried));
    }
    depth.push(r.locMaxBack > 0 ? r.maxBack / r.locMaxBack : 0);
    seconds.push(r.durationSec);
    if (r.skillUsed) fired++;
  }

  return {
    success: ok / RUNS,
    carried: mean(carried),
    depth: mean(depth),
    seconds: mean(seconds),
    fired: fired / RUNS,
  };
}

const rows: Row[] = [];
for (const cls of CLASS_ORDER) {
  for (const tier of TIERS) {
    const plain = measure(cls, tier, false);
    const withSkill = measure(cls, tier, true);
    rows.push({
      cls,
      tier,
      success: plain.success,
      carried: plain.carried,
      depth: plain.depth,
      seconds: plain.seconds,
      skillCarried: withSkill.carried,
      skillSuccess: withSkill.success,
      skillDepth: withSkill.depth,
      skillFired: withSkill.fired,
    });
  }
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const num = (x: number): string => x.toFixed(1);

console.log(`Классы: ${RUNS} вылазок на ярус, политика balanced, локации общие\n`);
console.log('ярус  класс      успех  добыча  глубина  сек   | с умением: добыча  успех');
for (const tier of TIERS) {
  for (const cls of CLASS_ORDER) {
    const r = rows.find((x) => x.cls === cls && x.tier === tier);
    if (r === undefined) continue;
    const name = HERO_CLASSES[cls].name.padEnd(10);
    console.log(
      `  ${tier}   ${name} ${pct(r.success).padStart(5)}  ${num(r.carried).padStart(6)}  ` +
        `${pct(r.depth).padStart(7)}  ${num(r.seconds).padStart(4)}  |` +
        `            ${num(r.skillCarried).padStart(6)}  ${pct(r.skillSuccess).padStart(5)}`,
    );
  }
}

/* ---------- вырожденность ---------- */

console.log('\nКто первый по добыче на каждом ярусе');
const winners = new Set<HeroClassId>();
for (const tier of TIERS) {
  const here = rows.filter((r) => r.tier === tier);
  const best = here.reduce((a, b) => (b.carried > a.carried ? b : a));
  winners.add(best.cls);
  const second = here
    .filter((r) => r.cls !== best.cls)
    .reduce((a, b) => (b.carried > a.carried ? b : a));
  const gap = second.carried > 0 ? (best.carried / second.carried - 1) * 100 : 0;
  console.log(
    `  ярус ${tier}: ${HERO_CLASSES[best.cls].name} (+${gap.toFixed(0)}% ко второму — ` +
      `${HERO_CLASSES[second.cls].name})`,
  );
}

// Критерий строже, чем «победители разные»: класс, который не первый нигде,
// не выбирают никогда, и он вырожден ровно так же, как доминирующий, —
// только вниз. §11.7 обещает каждому свою нишу, и обещание проверяется здесь.
const idle = CLASS_ORDER.filter((c) => !winners.has(c));
console.log(
  idle.length === 0
    ? '\n✓ Не вырождено: у каждого класса есть ярус, где он первый.'
    : `\n⚠ ВЫРОЖДЕНО ВНИЗ: ${idle.map((c) => HERO_CLASSES[c].name).join(', ')} ` +
        '— не первый ни на одном ярусе, значит его не выберут никогда.',
);

/* ---------- читаются ли умения ---------- */

console.log('\nЧто меняет умение');
for (const cls of CLASS_ORDER) {
  const mine = rows.filter((r) => r.cls === cls);
  const carriedGain = mean(mine.map((r) => r.skillCarried - r.carried));
  const depthGain = mean(mine.map((r) => r.skillDepth - r.depth));
  const successGain = mean(mine.map((r) => r.skillSuccess - r.success));
  const skill = SKILLS[HERO_CLASSES[cls].skill];
  const fired = mean(mine.map((r) => r.skillFired));
  console.log(
    `  ${HERO_CLASSES[cls].name.padEnd(10)} ${skill.name.padEnd(8)} ` +
      `сработало ${(fired * 100).toFixed(0)}% вылазок · ` +
      `добыча ${carriedGain >= 0 ? '+' : ''}${carriedGain.toFixed(2)} · ` +
      `глубина ${depthGain >= 0 ? '+' : ''}${(depthGain * 100).toFixed(1)} п.п. · ` +
      `успех ${successGain >= 0 ? '+' : ''}${(successGain * 100).toFixed(1)} п.п.`,
  );
}
