/**
 * Цена ограды (§6.1.7) в секундах игрока.
 *
 * Вопрос, под который написан инструмент. У ограды четыре материала, и все
 * четыре загораживают одинаково: разница между ними — облик и ресурс,
 * которым платят. Значит **выбор материала обязан быть выбором облика,
 * а не выбором цены**: если один из четырёх дешевле остальных, три других
 * становятся украшением панели. А сравнивать цены в единицах ресурса нельзя —
 * камень и дерево добываются по-разному и стоят игроку разного времени.
 *
 * Поэтому здесь всё приводится к одной единице — **секунде игрока**, — и
 * приводится замером, а не оценкой:
 *
 * 1. Бот проходит вылазки яруса 0 и даёт две величины: сколько добычи
 *    выносит заход и сколько секунд он идёт. Отсюда — секунда за находку.
 * 2. Доля вида в находке берётся из таблицы добычи (§13): чтобы получить
 *    одну единицу камня, нужно вскрыть 1/долю контейнеров.
 * 3. У дерева есть второй источник — рубка (§13.3), и её цена измерена:
 *    десять замахов по 0,8 с. Цена дерева — меньшая из двух: игрок берёт
 *    дешёвое, а не то, что мы задумали.
 *
 * Дальше в тех же секундах меряются стена, улучшение здания и кандидаты
 * в цену ограды, и вывод инструмента отменяет любую оценку.
 *
 * Запуск: npm run fence
 */
import { playRaid, POLICIES } from '../src/sim/bot';
import { mulberry32 } from '../src/core/rng';
import { BUILD_COST, BUILD_SECONDS } from '../src/sim/camp';
import { WALL_COST, WALL_SECONDS } from '../src/sim/campWalls';
import { CHOP_SECONDS, CHOP_WOOD_AVG } from '../src/sim/logging';
import { LOOT_SHARE } from '../src/sim/resources';
import { emptyResources, type ResourceKind, type Resources } from '../src/sim/resources';
import { CLASS_ORDER, HERO_CLASSES, createHero, loadout } from '../src/sim/heroes';

const RUNS = 300;
/**
 * Кольцо при Жилье ур. 1 — восемь клеток: поле стены 3×3, периметр 8.
 * То же число, которым §6.1.6 выводило цену стены.
 */
const RING = 8;

const num = (x: number, d = 1): string => x.toFixed(d).padStart(7);

/* ---------- 1. что даёт заход и сколько он идёт ---------- */

/**
 * Кем меряем. Тем, кем игрок ходит, когда строит ограду, — а это первый
 * герой ростера (`createRoster`), то есть Рыцарь.
 *
 * Здесь стоял Лучник, и это тихо испортило весь инструмент: на ярусе 0
 * он доходит в считанных процентах забегов, и вся цена ресурса в секундах
 * выводилась из десятка везучих прогонов из трёхсот. Класс к вопросу
 * «сколько стоит ограда» отношения не имеет, поэтому и брать надо
 * не выразительный, а тот, который у игрока есть.
 */
const CLS = CLASS_ORDER[0]!;
const gear = loadout(createHero(CLS, 0));
const carried: Resources = emptyResources();
let seconds = 0;
let success = 0;
for (let i = 0; i < RUNS; i++) {
  const run = playRaid(
    {
      seed: 1000 + i,
      tier: 0,
      kitchenLevel: 1,
      storageLevel: 1,
      loadout: gear,
    },
    POLICIES.cautious,
    mulberry32(1000 + i),
  );
  if (run.status !== 'evacuated') continue;
  success++;
  seconds += run.durationSec;
  for (const kind of Object.keys(carried) as ResourceKind[]) carried[kind] += run.carried[kind];
}

const perRaid = (kind: ResourceKind): number => carried[kind] / Math.max(1, success);
const raidSeconds = seconds / Math.max(1, success);
const unitsPerRaid = (Object.keys(carried) as ResourceKind[]).reduce((s, k) => s + perRaid(k), 0);
/** Секунда за одну вскрытую находку — что бы из неё ни выпало. */
const perFind = raidSeconds / Math.max(1e-9, unitsPerRaid);

console.log(`Замер: ${RUNS} вылазок яруса 0, ${HERO_CLASSES[CLS].name}, бот-осторожный\n`);
console.log('Что даёт заход');
console.log('─'.repeat(64));
const share = success / RUNS;
console.log(
  `  успешных ${success} из ${RUNS} (${(share * 100).toFixed(0)}%) · ${num(raidSeconds)} с на заход`,
);
if (share < 0.5) {
  console.log(
    `  ⚠ ВЫБОРКА НЕГОДНАЯ: успешных меньше половины, и всё, что ниже,\n`
    + `    выведено из везучих коротких забегов, а не из игры. Числа\n`
    + `    читать нельзя, пока эта строка здесь.`,
  );
}
for (const kind of ['stone', 'wood'] as const) {
  console.log(`  ${kind === 'stone' ? 'камня' : 'дерева'} за заход ${num(perRaid(kind))}` +
    ` · доля в таблице добычи ${num(LOOT_SHARE[0][kind] ?? 0, 2)}`);
}
console.log(`  секунда за находку ${num(perFind)} с`);

/* ---------- 2. цена ресурса в секундах ---------- */

/**
 * Сколько секунд стоит единица ресурса. Чтобы взять единицу камня, надо
 * вскрыть 1/долю находок: остальные выпадут не камнем. У дерева есть второй
 * источник, и цена — меньшая из двух.
 */
const raidPrice = (kind: ResourceKind): number => perFind / Math.max(1e-9, LOOT_SHARE[0][kind] ?? 0);
const chopPrice = CHOP_SECONDS / CHOP_WOOD_AVG;
const price: Record<'stone' | 'wood', number> = {
  stone: raidPrice('stone'),
  wood: Math.min(raidPrice('wood'), chopPrice),
};

console.log('\nЦена единицы ресурса в секундах игрока');
console.log('─'.repeat(64));
console.log(`  камень  ${num(price.stone)} с   — только вылазкой`);
console.log(
  `  дерево  ${num(price.wood)} с   — вылазкой ${num(raidPrice('wood'))}` +
    ` против рубки ${num(chopPrice)}; берётся дешёвое`,
);
console.log(`  дерево дороже камня в ${(price.wood / price.stone).toFixed(2)} раза`);

/* ---------- 3. в тех же секундах — то, что игрок уже покупает ---------- */

const costSeconds = (cost: Partial<Resources>): number =>
  (cost.stone ?? 0) * price.stone + (cost.wood ?? 0) * price.wood;

const upgrade = costSeconds(BUILD_COST[2]!);
const wallRing = RING * WALL_COST['стена'] * price.stone;

console.log('\nЧто уже стоит игроку — в тех же секундах');
console.log('─'.repeat(64));
console.log(
  `  улучшение Жилья до ур. 2   ${num(upgrade)} с ресурсов` +
    ` + ${num(BUILD_SECONDS[2]! / 60)} мин таймера`,
);
console.log(
  `  кольцо стены (${RING} кл.)        ${num(wallRing)} с ресурсов` +
    ` + ${num((RING * WALL_SECONDS['стена']) / 60)} мин таймера`,
);
console.log(
  `  кольцо стены к улучшению: ${(wallRing / upgrade).toFixed(2)} — ` +
    (Math.abs(wallRing / upgrade - 1) < 0.35
      ? '§6.1.6 держится'
      : 'в единицах ресурса они равны, в секундах — нет'),
);

/* ---------- 4. кандидаты в цену ограды ---------- */

console.log('\nКандидаты в цену клетки ограды');
console.log('─'.repeat(64));
console.log('  дерево/клетку  камень/клетку   кольцо: дощатая · каменная   разброс   к стене');
const CANDIDATES: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, 2],
  [0.5, 1],
  [0.5, 0.5],
  [0.25, 0.5],
];
for (const [wood, stone] of CANDIDATES) {
  const ringWood = Math.ceil(RING * wood) * price.wood;
  const ringStone = Math.ceil(RING * stone) * price.stone;
  const spread = Math.abs(ringWood - ringStone) / Math.max(ringWood, ringStone);
  const toWall = Math.max(ringWood, ringStone) / wallRing;
  console.log(
    `  ${num(wood, 2)}        ${num(stone, 2)}         ${num(ringWood)} · ${num(ringStone)} с` +
      `      ${num(spread * 100, 0)}%     ${num(toWall, 2)}` +
      (spread <= 0.15 && toWall < 1 ? '  ←' : ''),
  );
}
console.log('\n  ← — материалы стоят одинаково (разброс ≤ 15%) и кольцо дешевле стенного');

/* ---------- 5. время идёт за ценой ---------- */

/**
 * §6.1.6 связало цену и время у стены одной меркой: кольцо стоит примерно
 * как улучшение и строится примерно столько же. Ограда наследует связь —
 * значит её таймер относится к стенному так же, как её цена к стенной.
 * Округление до пятёрки: таймер читают глазами, а не парсером.
 */
const pick = CANDIDATES.find(([wood, stone]) => {
  const rw = Math.ceil(RING * wood) * price.wood;
  const rs = Math.ceil(RING * stone) * price.stone;
  return Math.abs(rw - rs) / Math.max(rw, rs) <= 0.15 && Math.max(rw, rs) / wallRing < 1;
});
if (pick !== undefined) {
  const ring = Math.max(Math.ceil(RING * pick[0]) * price.wood, Math.ceil(RING * pick[1]) * price.stone);
  const share = ring / wallRing;
  const raw = WALL_SECONDS['стена'] * share;
  console.log('\nВремя идёт за ценой');
  console.log('─'.repeat(64));
  console.log(
    `  клетка стены ${WALL_SECONDS['стена']} с × ${share.toFixed(2)} = ${raw.toFixed(1)} с` +
      ` → ${Math.round(raw / 5) * 5} с на клетку ограды`,
  );
}

/* ---------- 5. потолок рубки ---------- */

/**
 * Дощатая ограда — единственная стройка, которую можно оплатить, не сходив
 * в вылазку. Значит кольцо обязано нарубаться за один заход в лагерь: §0
 * отводит лагерю 30 секунд — 2 минуты, и кольцо, которое не укладывается,
 * превращает ограду в ожидание у дерева.
 */
const CAMP_VISIT = 120;
console.log('\nПотолок рубки: кольцо дощатой ограды нарубается за');
console.log('─'.repeat(64));
for (const wood of [0.25, 0.5, 1, 2]) {
  const chop = Math.ceil(RING * wood) * chopPrice;
  console.log(
    `  ${num(wood, 2)} дерева/клетку → ${num(chop)} с` +
      (chop <= CAMP_VISIT ? '  ← укладывается в заход в лагерь' : '  — дольше захода в лагерь'),
  );
}
