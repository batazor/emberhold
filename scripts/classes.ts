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
 *
 * Политик три, и это принципиально. Класс, проигрывающий у осторожного бота,
 * может выигрывать у жадного — потому что обзор и скорость окупаются только
 * там, где заходят глубоко. Вердикт по одной политике мерил бы не класс,
 * а привычку игрока.
 *
 * Запуск: npx tsx scripts/classes.ts
 * (в package.json не прописан намеренно: файл сейчас правят соседние сессии,
 *  и строка скрипта добавится вместе с их изменениями, а не поперёк них)
 */
import { mulberry32 } from '../src/core/rng';
import { POLICIES, playRaid } from '../src/sim/bot';
import type { PolicyName } from '../src/sim/bot';
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

function measure(cls: HeroClassId, tier: Tier, useSkills: boolean, policy: PolicyName): {
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
      POLICIES[policy],
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

const POLICY_LIST: readonly PolicyName[] = ['cautious', 'balanced', 'greedy'];
const POLICY_NAME: Record<PolicyName, string> = {
  cautious: 'осторожный',
  balanced: 'средний',
  greedy: 'жадный',
  sloppy: 'небрежный',
};

function run(policy: PolicyName): Row[] {
const rows: Row[] = [];
for (const cls of CLASS_ORDER) {
  for (const tier of TIERS) {
    const plain = measure(cls, tier, false, policy);
    const withSkill = measure(cls, tier, true, policy);
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
return rows;
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const num = (x: number): string => x.toFixed(1);

/** Класс, который не первый нигде, вырожден ровно так же, как доминирующий, —
 *  только вниз: его просто не выберут. §11.7 обещает каждому свою нишу. */
function report(policy: PolicyName, rows: readonly Row[]): HeroClassId[] {
console.log(`\n══ ${POLICY_NAME[policy]} бот ══`);
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

const winners = new Set<HeroClassId>();
const line: string[] = [];
for (const tier of TIERS) {
  const here = rows.filter((r) => r.tier === tier);
  const best = here.reduce((a, b) => (b.carried > a.carried ? b : a));
  winners.add(best.cls);
  line.push(`ярус ${tier}: ${HERO_CLASSES[best.cls].name}`);
}
console.log(`  первые — ${line.join(' · ')}`);

const idle = CLASS_ORDER.filter((c) => !winners.has(c));
console.log(
  idle.length === 0
    ? '  ✓ у каждого класса есть свой ярус'
    : `  ⚠ не первый нигде: ${idle.map((c) => HERO_CLASSES[c].name).join(', ')}`,
);

console.log('  умения:');
for (const cls of CLASS_ORDER) {
  const mine = rows.filter((r) => r.cls === cls);
  const carriedGain = mean(mine.map((r) => r.skillCarried - r.carried));
  const depthGain = mean(mine.map((r) => r.skillDepth - r.depth));
  const successGain = mean(mine.map((r) => r.skillSuccess - r.success));
  const skill = SKILLS[HERO_CLASSES[cls].skill];
  const fired = mean(mine.map((r) => r.skillFired));
  console.log(
    `    ${HERO_CLASSES[cls].name.padEnd(10)} ${skill.name.padEnd(8)} ` +
      `сработало ${(fired * 100).toFixed(0)}% · ` +
      `добыча ${carriedGain >= 0 ? '+' : ''}${carriedGain.toFixed(2)} · ` +
      `глубина ${depthGain >= 0 ? '+' : ''}${(depthGain * 100).toFixed(1)} п.п. · ` +
      `успех ${successGain >= 0 ? '+' : ''}${(successGain * 100).toFixed(1)} п.п.`,
  );
}
return idle;
}

console.log(`Классы: ${RUNS} вылазок на ярус на политику, локации общие для всех классов`);

const idleEverywhere = new Set<HeroClassId>(CLASS_ORDER);
for (const policy of POLICY_LIST) {
  const idle = report(policy, run(policy));
  for (const cls of CLASS_ORDER) if (!idle.includes(cls)) idleEverywhere.delete(cls);
}

// Итог по всем политикам сразу: класс вырожден, только если он не находит
// себе ниши ни у осторожного, ни у среднего, ни у жадного игрока.
console.log(
  idleEverywhere.size === 0
    ? '\n✓ Не вырождено: каждый класс где-то первый — хотя бы при одной манере игры.'
    : `\n⚠ ВЫРОЖДЕНО ВНИЗ: ${[...idleEverywhere].map((c) => HERO_CLASSES[c].name).join(', ')} ` +
        '— не первый ни на одном ярусе ни при одной манере игры.',
);
