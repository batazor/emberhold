/**
 * Замер левой руки (§14.2). Отвечает на утверждение, которое раздел делает,
 * но сам проверить не может: **ни один вариант не лучше другого во всём.**
 *
 * §14.2 объявляет левую руку единственным местом, где за слот спорят вещи,
 * а не слот со слотом, и единственным, который игрок пересматривает перед
 * каждым ярусом. Оба утверждения проверяемы, и до сих пор не проверялись:
 * щит был недостижим из игры вовсе.
 *
 * Условие непорочности то же, что у классов (`npm run classes`): **у каждой
 * сборки есть ярус, где она первая.** Если фонарь не первый нигде, его можно
 * удалять; если щит не первый нигде — удалять щит, и §14.2 не состоялась.
 *
 * Лук в споре не участвует: он забирает руку целиком (§14.2), то есть это
 * не выбор внутри слота, а выбор класса. Стрелок меряется `npm run ammo`.
 *
 * Запуск: npm run hands
 */
import { POLICIES, playRaid } from '../src/sim/bot';
import type { PolicyName } from '../src/sim/bot';
import { mulberry32 } from '../src/core/rng';
import { OFFHAND, emptyGear } from '../src/sim/gear';
import type { Offhand } from '../src/sim/gear';
import { CLASS_ORDER, HERO_CLASSES, createHero, loadout } from '../src/sim/heroes';
import type { HeroClassId } from '../src/sim/heroes';
import { totalOf } from '../src/sim/resources';
import type { Tier } from '../src/sim/types';

const RUNS = 200;
const TIERS: readonly Tier[] = [0, 1, 2, 3];
const HANDS: readonly Offhand[] = ['torch', 'shield'];
/** Уровень предмета в левой руке. Средний: на первом спорить не о чем. */
const LEVEL = 3;

/** Те же пары «ярус — здания», что в калибровке §20.3: иначе сборки мерились
 *  бы на разной экономике, и числа нельзя было бы сравнить. */
const CAMP: Record<Tier, { kitchenLevel: number; storageLevel: number }> = {
  0: { kitchenLevel: 1, storageLevel: 1 },
  1: { kitchenLevel: 2, storageLevel: 2 },
  2: { kitchenLevel: 3, storageLevel: 3 },
  3: { kitchenLevel: 4, storageLevel: 4 },
};

interface Row {
  readonly haul: number;
  readonly ok: number;
  readonly depth: number;
}

/**
 * Сборка на ярусе. Сиды общие для всех сборок: сравнение парное, поэтому
 * разброс локаций вычитается, а не подмешивается в результат.
 */
function measure(cls: HeroClassId, hand: Offhand, tier: Tier, policy: PolicyName): Row {
  const gear = { ...emptyGear(), torch: LEVEL, armor: LEVEL, weapon: LEVEL };
  const rng = mulberry32(1);
  const seeds = Array.from({ length: RUNS }, () => Math.floor(rng() * 1e9));

  let haul = 0;
  let ok = 0;
  let depth = 0;
  for (const seed of seeds) {
    const r = playRaid({
      ...CAMP[tier], seed, tier,
      loadout: loadout(createHero(cls, 0)),
      gear,
      offhand: hand,
    }, POLICIES[policy], mulberry32(seed));
    haul += totalOf(r.carried);
    depth += r.locMaxBack > 0 ? r.maxBack / r.locMaxBack : 0;
    if (r.status === 'evacuated') ok += 1;
  }
  return { haul: haul / RUNS, ok: ok / RUNS, depth: depth / RUNS };
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const NAME: Record<Offhand, string> = { torch: OFFHAND.torch.name, shield: OFFHAND.shield.name };

console.log(`Левая рука: ${RUNS} вылазок на сборку, снаряжение ур. ${LEVEL}\n`);

let anyDegenerate = false;
for (const policy of ['cautious', 'greedy'] as PolicyName[]) {
  console.log(`══ бот ${policy === 'cautious' ? 'осторожный' : 'жадный'} ══`);
  for (const cls of CLASS_ORDER) {
    if (HERO_CLASSES[cls].ranged) continue; // лук забирает руку целиком (§14.2)
    console.log(`  ${HERO_CLASSES[cls].name}`);
    const first: Record<Offhand, number> = { torch: 0, shield: 0 };
    for (const tier of TIERS) {
      const rows = HANDS.map((h) => ({ h, ...measure(cls, h, tier, policy) }));
      const best = rows.reduce((a, b) => (a.haul >= b.haul ? a : b));
      first[best.h] += 1;
      console.log(
        `    ярус ${tier}: ` +
          rows.map((r) =>
            `${NAME[r.h]} ${r.haul.toFixed(1)}/${pct(r.ok)}${r.h === best.h ? ' ←' : '  '}`,
          ).join(' · '),
      );
    }
    const dead = HANDS.filter((h) => first[h] === 0);
    if (dead.length > 0) {
      anyDegenerate = true;
      console.log(`    ⚠ не первый нигде: ${dead.map((h) => NAME[h]).join(', ')}`);
    }
  }
  console.log('');
}

console.log(
  anyDegenerate
    ? '⚠ §14.2 НЕ СОСТОЯЛАСЬ: есть вариант, который не выигрывает нигде.\n' +
        '  «Ни один не лучше» — обещание раздела, и оно обязано быть измеренным.\n' +
        '  Проигрывающий вариант либо чинится ценой, либо удаляется.'
    : '✓ У каждой сборки есть ярус, где она первая: выбор существует.',
);
console.log('  (добыча / успех; ← — лучшая сборка яруса)');
