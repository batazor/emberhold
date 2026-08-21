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
 * Запуск: npm run classes
 */
import { mulberry32 } from '../src/core/rng';
import { POLICIES, playRaid } from '../src/sim/bot';
import type { PolicyName } from '../src/sim/bot';
import { emptyGear } from '../src/sim/gear';
import type { GearState } from '../src/sim/gear';
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

/**
 * С каким снаряжением сравнивать классы.
 *
 * Голыми руками сравнивать нельзя, и это не вкус, а гейты игры. Лучник
 * открывается Жильём ур. 2 (`HERO_HQ_GATE`) — ровно тем же уровнем, каким
 * открывается Мастерская (`unlockHq`). Голорукого Лучника в игре не бывает
 * никогда: к моменту, когда он появляется, ковка уже доступна. Бандит ждёт
 * четвёртого уровня и тем более выходит одетым.
 *
 * Прибор же ставил всем троим ноль — то есть мерил положение одного Рыцаря
 * и раздавал его вывод остальным. Отсюда и «вырождено вниз»: класс, чей
 * колчан платится в Мастерской, сравнивали до Мастерской.
 *
 * Ноль оставлен и меряется: он есть у Рыцаря, и на нём видно, чего стоит
 * первая вылазка. Но вердикт снимается по всем уровням сразу.
 */
const GEAR_LEVELS: readonly number[] = [0, 3];

const gearAt = (level: number): GearState => {
  const g = emptyGear();
  for (const slot of Object.keys(g) as (keyof GearState)[]) g[slot] = level;
  return g;
};

function measure(cls: HeroClassId, tier: Tier, useSkills: boolean, policy: PolicyName, gearLevel: number): {
  success: number;
  carried: number;
  depth: number;
  seconds: number;
  fired: number;
} {
  const hero = createHero(cls, 0);
  const kit = loadout(hero);
  const gear = gearAt(gearLevel);
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
      { seed, tier, ...CAMP[tier], loadout: kit, gear, useSkills },
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

function run(policy: PolicyName, gearLevel: number): Row[] {
const rows: Row[] = [];
for (const cls of CLASS_ORDER) {
  for (const tier of TIERS) {
    const plain = measure(cls, tier, false, policy, gearLevel);
    const withSkill = measure(cls, tier, true, policy, gearLevel);
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

/**
 * По чему считать первого.
 *
 * Здесь стояла одна добыча, и критерий был унаследован от прежней тройки —
 * Следопыта, Ратника и Носильщика, — которая, как прямо пишет §11.7,
 * «различалась рюкзаком, обзором и ранами». Для неё добыча была честной осью.
 *
 * Нынешняя тройка различается тем, **как они дерутся** — это первая строка
 * §11.7, — и одной добычей её мерить нельзя: у Лучника рюкзак −25%, у Бандита
 * +30%, и выиграть у него по добыче Лучник не может арифметически, при любом
 * балансе. Прибор объявлял вырожденным класс, чью ось он не мерил.
 *
 * Оси взяты из той же таблицы §11.7, и это ровно три колонки, которые скрипт
 * и так печатает: **сколько вынес** (Бандит), **дошёл ли** (Рыцарь — «четыре
 * раны прощают больше») и **как глубоко зашёл** (Лучник — «обзор, дистанция»).
 * Класс не вырожден, если он первый хотя бы по одной.
 */
const AXES: readonly { readonly name: string; readonly of: (r: Row) => number }[] = [
  { name: 'добыча', of: (r) => r.carried },
  { name: 'успех', of: (r) => r.success },
  { name: 'глубина', of: (r) => r.depth },
];

const winners = new Set<HeroClassId>();
const line: string[] = [];
for (const tier of TIERS) {
  const here = rows.filter((r) => r.tier === tier);
  if (here.length === 0) continue;
  const per: string[] = [];
  for (const axis of AXES) {
    const best = here.reduce((a, b) => (axis.of(b) > axis.of(a) ? b : a));
    winners.add(best.cls);
    per.push(`${axis.name} ${HERO_CLASSES[best.cls].name}`);
  }
  line.push(`ярус ${tier}: ${per.join(', ')}`);
}
for (const l of line) console.log(`  первые — ${l}`);

const idle = CLASS_ORDER.filter((c) => !winners.has(c));
console.log(
  idle.length === 0
    ? '  ✓ у каждого класса есть своя ось'
    : `  ⚠ не первый ни по одной оси: ${idle.map((c) => HERO_CLASSES[c].name).join(', ')}`,
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
for (const level of GEAR_LEVELS) {
  console.log(
    `\n${'='.repeat(72)}\nСНАРЯЖЕНИЕ УР. ${level === 0 ? '— (пусто, положение первой вылазки)' : level}`,
  );
  for (const policy of POLICY_LIST) {
    const idle = report(policy, run(policy, level));
    for (const cls of CLASS_ORDER) if (!idle.includes(cls)) idleEverywhere.delete(cls);
  }
}

/**
 * Итог по всем политикам и всем уровням снаряжения сразу.
 *
 * Уровни здесь не для полноты. Лучник открывается Жильём ур. 2, тем же
 * уровнем открывается Мастерская: голорукого Лучника в игре не бывает,
 * и вырожденность, найденная только на нулевом снаряжении, — вырожденность
 * положения, которого нет.
 */
console.log(
  idleEverywhere.size === 0
    ? '\n✓ Не вырождено: каждый класс где-то первый — хотя бы при одной манере игры\n'
      + '  и одном уровне снаряжения.'
    : `\n⚠ ВЫРОЖДЕНО ВНИЗ: ${[...idleEverywhere].map((c) => HERO_CLASSES[c].name).join(', ')} ` +
        '— не первый ни по одной оси\n  ни на одном ярусе, ни при одной манере игры, '
        + 'ни на одном уровне снаряжения.',
);
