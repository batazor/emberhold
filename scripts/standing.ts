/**
 * Замер силы и таблицы лагерей (§30).
 *
 * Сила — это вылазки, вложенные в лагерь (`sim/standing.ts`), и прибор отвечает
 * на три вопроса, которых глазом не решить:
 *
 *  - **сходится ли перевод**: цена уровня, посчитанная назад из ресурсов,
 *    обязана совпасть с той лестницей вылазок, из которой §20.3 её выводил.
 *    Разойдись они — сила перестанет быть измерением;
 *  - **что показывает шкала**: сколько силы у лагеря на каждой ступени роста,
 *    от свежего до полного, — чтобы число в таблице читалось, а не пугало;
 *  - **есть ли у таблицы смысл**: мир старше игрока (§4) и растёт без
 *    остановки, а потолок лагеря конечен. Значит существует день, после
 *    которого первое место недостижимо никаким лагерем. Прибор его называет.
 *
 * Запуск: npm run standing
 */
import { RAIDS_PER_LEVEL } from '../src/sim/balance';
import { BUILDING_ORDER, BUILD_COST, MAX_LEVEL, createCamp } from '../src/sim/camp';
import { GEAR_ORDER, MAX_ITEM_LEVEL } from '../src/sim/gear';
import { RESOURCE_NAME } from '../src/sim/resources';
import type { ResourceKind } from '../src/sim/resources';
import { CLANS, WORLD_EPOCH, clanGrowth } from '../src/sim/world';
import {
  POWER_VALUE,
  campPower,
  clanPower,
  levelRaids,
  raidWorth,
  raidsFor,
  rawPower,
  standings,
  yourPlace,
} from '../src/sim/standing';
import type { CampState } from '../src/sim/camp';
import type { Tier } from '../src/sim/types';

const num = (x: number, d = 1): string => x.toFixed(d).padStart(7);
const DAY = 24 * 3600;

/* ---------- 1. линейка ---------- */

console.log('Линейка ценности: сколько стоит единица ресурса');
console.log('─'.repeat(64));
for (const kind of Object.keys(POWER_VALUE) as ResourceKind[]) {
  console.log(
    `  ${RESOURCE_NAME[kind].padEnd(9)} ${num(POWER_VALUE[kind])}` +
      (kind === 'crystal' ? '   — выведена из таблицы добычи, у торговца её нет' : '   — курс торговца'),
  );
}

console.log('\nЧто приносит одна вылазка, в той же линейке');
console.log('─'.repeat(64));
for (const tier of [0, 1, 2, 3] as Tier[]) {
  console.log(`  ярус ${tier}   ${num(raidWorth(tier))}`);
}

/* ---------- 2. сходится ли перевод ---------- */

console.log('\nЦена уровня: назначено §20.3 против посчитанного назад');
console.log('─'.repeat(64));
let worst = 0;
for (const [level, raids] of Object.entries(RAIDS_PER_LEVEL)) {
  const back = raidsFor(Number(level), BUILD_COST[Number(level)] ?? {});
  worst = Math.max(worst, Math.abs(back - raids));
  console.log(`  ур. ${level}   назначено ${num(raids)} вылазок   назад ${num(back, 2)}`);
}
console.log(
  `  наибольшее расхождение ${worst.toFixed(2)} вылазки — ` +
    (worst <= 0.35 ? 'перевод сходится' : 'ПЕРЕВОД РАЗОШЁЛСЯ, сила больше не измерение'),
);
console.log(`  ступень за потолком: ${levelRaids(MAX_LEVEL + 1).toFixed(2)} вылазки (продолжение шагом)`);

/* ---------- 3. шкала: что сколько стоит ---------- */

/** Лагерь на ступени роста: все здания и всё снаряжение на уровне `l`. */
function campAt(l: number): CampState {
  const camp = createCamp();
  for (const id of BUILDING_ORDER) camp.levels[id] = Math.min(MAX_LEVEL, l);
  for (const slot of GEAR_ORDER) camp.gear[slot] = Math.max(0, Math.min(MAX_ITEM_LEVEL, l));
  return camp;
}

console.log('\nШкала: сила лагеря на ступенях роста');
console.log('─'.repeat(64));
console.log(`  свежий (пролог)          ${num(rawPower(createCamp()), 2)}`);
for (let l = 1; l <= MAX_LEVEL; l++) {
  console.log(`  всё на ур. ${l}             ${num(rawPower(campAt(l)), 2)}   показано ${campPower(campAt(l))}`);
}

/* ---------- 4. таблица по дням мира ---------- */

const full = campAt(MAX_LEVEL);

console.log('\nТаблица лагерей по возрасту мира (полный лагерь против фракций)');
console.log('─'.repeat(64));
for (const day of [1, 3, 7, 30, 100, 365]) {
  const t = WORLD_EPOCH + day * DAY;
  const rows = standings(full, t, null);
  const place = yourPlace(rows);
  console.log(
    `  день ${String(day).padStart(3)}   ` +
      rows
        .map((r) => `${r.you ? '⟨вы⟩' : r.who.split(' ')[0]} ${r.power}`)
        .join(' · ') +
      `   место ${place} из ${rows.length}`,
  );
}

/* ---------- 5. до какого дня таблица остаётся целью ---------- */

/**
 * День, после которого первое место недостижимо. Считается по слабейшей
 * фракции: пока полный лагерь обгоняет хотя бы её, вершина ещё существует.
 */
const ceiling = rawPower(full);
let lastLead = 0;
for (let day = 1; day <= 3650; day++) {
  const t = WORLD_EPOCH + day * DAY;
  const weakest = Math.min(...CLANS.map((_, k) => clanPower(clanGrowth(k, t))));
  if (ceiling > weakest) lastLead = day;
}

console.log('\nМеста в таблице: до какого дня мира их можно занять');
console.log('─'.repeat(64));
console.log(`  потолок лагеря           ${num(ceiling, 1)} вылазок вложений`);
console.log(`  последний день, когда полный лагерь обгоняет хоть одну фракцию: ${lastLead}`);
console.log(
  lastLead < 30
    ? '  ⚠ ТАБЛИЦА ПЕРЕСТАЁТ БЫТЬ ЦЕЛЬЮ БЫСТРЕЕ МЕСЯЦА: чинится это потолком\n' +
      '    Жилья или законом роста фракции, а не силой (§30).'
    : '  Дальше этого дня первое место недостижимо: потолок лагеря конечен,\n' +
      '  а мир растёт. Это свойство §4, а не силы, — и чинить его придётся там.',
);
