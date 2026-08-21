/**
 * Замер отряда (§11.7). Отвечает на четыре вопроса, которые документ ставит,
 * но сам проверить не может. Каждый — с условием, которое его опровергает:
 * прибор обязан уметь сказать «нет», иначе он не прибор.
 *
 * 1. **Отряд лучше одиночки?** Если трое проходят не дальше одного, вся
 *    конструкция не окупает ни строчки кода. Если проходят настолько дальше,
 *    что провалов не остаётся, — вылазка перестала быть решением (§22.5).
 * 2. **Состав решает?** §11.9а обещает, что личный запас хода делает выбор
 *    «кого вести» настоящим. Если три состава дают одно и то же, обещание
 *    не выполнено, и запас можно возвращать в общий котёл.
 * 3. **Правило «в бой втягиваются только ближние» живое?** Если в бой всегда
 *    попадает весь отряд, правило — украшение, и цепочка ничего не значит.
 *    Если всегда один, цепочка слишком длинная и остальные не успевают.
 * 4. **Падение одного — событие или приговор?** §11.2 разрешил вылазке
 *    продолжаться после потери бойца. Если такого не случается никогда,
 *    правило мёртвое; если после первой же потери всё кончается — тоже.
 *
 * Замер идёт **отдельно от `npm run measure`** намеренно: тот меряет
 * одиночку и потому сравним с калибровкой §20.3. Смешать их значило бы
 * потерять базу сравнения ради одной таблицы.
 *
 * Запуск: npm run party
 */
import { mulberry32 } from '../src/core/rng';
import { POLICIES, playRaid } from '../src/sim/bot';
import { CLASS_ORDER, HERO_CLASSES, createHero, loadout } from '../src/sim/heroes';
import type { HeroClassId, HeroLoadout } from '../src/sim/heroes';
import { totalOf } from '../src/sim/resources';
import type { Tier } from '../src/sim/types';

const RUNS = 200;
const TIERS: readonly Tier[] = [1, 2, 3];

/** Те же пары «ярус — здания», что в калибровке §20.3. */
const CAMP: Record<Tier, { kitchenLevel: number; storageLevel: number }> = {
  0: { kitchenLevel: 1, storageLevel: 1 },
  1: { kitchenLevel: 2, storageLevel: 2 },
  2: { kitchenLevel: 3, storageLevel: 3 },
  3: { kitchenLevel: 4, storageLevel: 4 },
};

const who = (cls: HeroClassId): HeroLoadout => loadout(createHero(cls, 0));

interface Row {
  readonly ok: number;
  readonly haul: number;
  readonly depth: number;
  readonly standing: number;
  readonly fights: number;
  readonly joined: number;
  /** Доля вылазок, где кто-то пал, но вылазка продолжилась. */
  readonly lostOne: number;
}

/** Прогон состава. Сиды общие для всех составов: сравнение парное, поэтому
 *  разброс локаций вычитается, а не подмешивается в результат. */
function run(party: readonly HeroClassId[], tier: Tier): Row {
  const rng = mulberry32(1);
  const seeds = Array.from({ length: RUNS }, () => Math.floor(rng() * 1e9));

  let ok = 0;
  let haul = 0;
  let depth = 0;
  let standing = 0;
  let fights = 0;
  let joined = 0;
  let lostOne = 0;

  for (const seed of seeds) {
    const r = playRaid({
      ...CAMP[tier], seed, tier,
      loadout: who(party[0]!),
      followers: party.slice(1).map(who),
    }, POLICIES.cautious, mulberry32(seed));

    haul += totalOf(r.carried);
    depth += r.locMaxBack > 0 ? r.maxBack / r.locMaxBack : 0;
    standing += r.standing;
    fights += r.fights;
    joined += r.joined;
    if (r.status === 'evacuated') {
      ok += 1;
      if (r.standing < party.length) lostOne += 1;
    }
  }

  const n = RUNS;
  return {
    ok: ok / n,
    haul: haul / n,
    depth: depth / n,
    standing: standing / n,
    fights: fights / n,
    joined: fights === 0 ? 0 : joined / fights,
    lostOne: lostOne / n,
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const num = (x: number, k = 1): string => x.toFixed(k).replace('.', ',');
const name = (c: HeroClassId): string => HERO_CLASSES[c].name;

/** Составы: одиночка, двое и трое — и три разных тройки, чтобы вопрос
 *  «решает ли состав» не сводился к «решает ли число». */
const SQUADS: readonly (readonly HeroClassId[])[] = [
  ['knight'],
  ['archer'],
  ['knight', 'archer'],
  [...CLASS_ORDER],
  ['knight', 'knight', 'knight'],
  ['archer', 'archer', 'archer'],
];

console.log(`Отряд: ${RUNS} вылазок на состав на ярус, осторожный бот\n`);
console.log('ярус  состав                       успех  добыча  глубина  выжило  стычек  в бою  потеряли');

const byTier = new Map<Tier, Row[]>();
for (const tier of TIERS) {
  const rows: Row[] = [];
  for (const squad of SQUADS) {
    const r = run(squad, tier);
    rows.push(r);
    console.log(
      `${String(tier).padStart(4)}  ${squad.map(name).join('+').padEnd(28)}` +
        `${pct(r.ok).padStart(6)}${num(r.haul).padStart(8)}${pct(r.depth).padStart(9)}` +
        `${num(r.standing, 2).padStart(8)}${num(r.fights).padStart(8)}` +
        `${num(r.joined, 2).padStart(7)}${pct(r.lostOne).padStart(10)}`,
    );
  }
  byTier.set(tier, rows);
  console.log('');
}

/* ---------- вердикты ---------- */

console.log('══ что из этого следует ══\n');

const solo = (rows: Row[]): Row => rows[0]!;
const trio = (rows: Row[]): Row => rows[3]!;

// 1. Отряд лучше одиночки?
{
  const gains = TIERS.map((t) => trio(byTier.get(t)!).haul - solo(byTier.get(t)!).haul);
  const best = Math.max(...gains);
  console.log(
    best <= 0.5
      ? '⚠ ОТРЯД НЕ ОКУПАЕТСЯ: трое выносят не больше одного ни на одном ярусе.'
      : `✓ Отряд выносит больше: до +${num(best)} добычи против одиночки.`,
  );
  const noFails = TIERS.every((t) => trio(byTier.get(t)!).ok >= 0.97);
  if (noFails) {
    console.log('⚠ И провалов у тройки почти нет: вылазка перестала быть решением (§22.5).');
  }
}

// 2. Состав решает?
{
  const spread = TIERS.map((t) => {
    const rows = byTier.get(t)!;
    const threes = [rows[3]!, rows[4]!, rows[5]!].map((r) => r.haul);
    return Math.max(...threes) - Math.min(...threes);
  });
  const worst = Math.max(...spread);
  console.log(
    worst <= 0.5
      ? '⚠ СОСТАВ НЕ РЕШАЕТ: три разные тройки дают одно и то же. §11.9а обещает\n' +
          '  обратное — личный запас хода должен разводить составы по дальности.'
      : `✓ Состав решает: между тройками до ${num(worst)} добычи разницы.`,
  );
}

// 3. Живо ли «втягиваются только ближние»?
{
  const joined = TIERS.map((t) => trio(byTier.get(t)!).joined);
  const lo = Math.min(...joined);
  const hi = Math.max(...joined);
  console.log(
    hi >= 2.9
      ? '⚠ В БОЙ ВСЕГДА ПОПАДАЮТ ВСЕ: правило «только ближние» — украшение,\n' +
          '  и цепочка ничего не значит.'
      : lo <= 1.05
        ? '⚠ В БОЙ ПОПАДАЕТ ОДИН: цепочка слишком длинная, остальные не успевают.'
        : `✓ В бой втягивается ${num(lo, 2)}–${num(hi, 2)} бойца из трёх: правило живое.`,
  );
}

// 4. Падение одного — событие или приговор?
{
  const lost = TIERS.map((t) => trio(byTier.get(t)!).lostOne);
  const hi = Math.max(...lost);
  console.log(
    hi <= 0.02
      ? '⚠ ПОТЕРЯ БОЙЦА НЕ СЛУЧАЕТСЯ: §11.2 разрешил вылазке продолжаться\n' +
          '  после потери, и правило пока мёртвое.'
      : `✓ Вылазка переживает потерю бойца: до ${pct(hi)} успешных возвратов неполным составом.`,
  );
}

console.log(
  '\n  (в бою — среднее число своих бойцов на стычку; потеряли — доля успешных\n' +
    '   вылазок, вернувшихся неполным составом)',
);
