/**
 * Сколько игрок увидит из суток лагеря.
 *
 * Вопрос, на который отвечает прибор: **какой длины должны быть сутки, чтобы
 * их было видно.** Он единственный в этом решении, который нельзя взять
 * на вкус, потому что стороны тянут в разные концы. Сутки длиннее сессии —
 * и время суток превращается в лотерею при входе: игрок не видит, как день
 * сменяется ночью, он просто застаёт то одно, то другое. Сутки короче
 * сессии — и небо мигает: за два захода солнце всходит трижды, а это уже
 * не сутки, а маяк.
 *
 * Меряется поэтому не «красиво ли», а три доли:
 *   1. в какой фазе игрок **застаёт** лагерь, придя в него;
 *   2. как часто он **захватывает перелом** — рассвет или закат — за визит;
 *   3. сколько суток проходит **между** визитами: если больше одних,
 *      то лагерь прожил их без свидетеля, и жильцы «легли спать»
 *      в пустом кадре.
 *
 * Сессия взята двухминутной — та же, из которой §20.2 выводит лестницу
 * таймеров. Перерыв между заходами — тот же порядок, что у таймеров: игра
 * рассчитана на несколько заходов в день.
 *
 * Запуск: npx tsx scripts/shift.ts
 */
import { CAMP_DAY, CAMP_NIGHT, SHIFT_SEC, nightAt, phaseAt } from '../src/sim/world';

/** Длина сессии в секундах (§20.2: «игра с двухминутными сессиями»). */
const SESSION = 2 * 60;

/** Перерывы между заходами, по которым считается «сколько прошло без меня». */
const GAPS: readonly { readonly name: string; readonly sec: number }[] = [
  { name: 'подряд', sec: 5 * 60 },
  { name: 'через час', sec: 60 * 60 },
  { name: 'вечером', sec: 6 * 60 * 60 },
  { name: 'назавтра', sec: 24 * 60 * 60 },
];

/**
 * Фазы прибор не описывает, а спрашивает у игры (`world.phaseAt`). Своя
 * таблица долей тут уже стояла и была списана с раздела — то самое, что
 * §22.8 запретил: прибор, у которого своя копия величины, однажды меряет
 * не игру, а себя.
 *
 * Доля круга переводится в секунды смены: раскладка фаз у всех кандидатов
 * одна, разной остаётся только длина суток — а её прибор и выбирает.
 */
const PHASES = ['день', 'закат', 'ночь', 'рассвет'] as const;
const phaseOf = (share: number): string => phaseAt((((share % 1) + 1) % 1) * SHIFT_SEC);

/** Ломает ли визит длиной `SESSION`, начатый в доле `u`, границу фазы. */
function catchesTurn(period: number, u: number): boolean {
  return phaseOf(u) !== phaseOf(u + SESSION / period);
}

/** Кандидаты в длину суток. Смена мира стоит первой: свои часы заводить
 *  незачем, если чужие уже идут. */
const PERIODS: readonly { readonly name: string; readonly sec: number }[] = [
  { name: 'смена мира', sec: SHIFT_SEC },
  { name: 'полсмены', sec: SHIFT_SEC / 2 },
  { name: 'треть смены', sec: SHIFT_SEC / 3 },
  { name: 'четверть смены', sec: SHIFT_SEC / 4 },
  { name: 'десятая смены', sec: SHIFT_SEC / 10 },
];

/** Шагов по кругу при замере. Достаточно мелко, чтобы доли не дрожали. */
const STEPS = 20000;

console.log(`Смена мира — ${SHIFT_SEC / 60} мин (world.ts SHIFT_SEC), сессия — ${SESSION / 60} мин.\n`);

const head = ['сутки'.padEnd(15), 'мин'.padStart(5), ...PHASES.map((p) => p.padStart(8)), 'перелом'.padStart(9)];
console.log(head.join(''));

for (const period of PERIODS) {
  const seen = new Map<string, number>(PHASES.map((p) => [p, 0]));
  let turns = 0;
  for (let i = 0; i < STEPS; i++) {
    const u = i / STEPS;
    seen.set(phaseOf(u), (seen.get(phaseOf(u)) ?? 0) + 1);
    if (catchesTurn(period.sec, u)) turns++;
  }
  const cells = PHASES.map((p) => `${Math.round(((seen.get(p) ?? 0) / STEPS) * 100)}%`.padStart(8));
  console.log([
    period.name.padEnd(15),
    `${Math.round(period.sec / 60)}`.padStart(5),
    ...cells,
    `${Math.round((turns / STEPS) * 100)}%`.padStart(9),
  ].join(''));
}

console.log('\nСколько суток лагерь прожил без свидетеля:\n');
console.log(['сутки'.padEnd(15), ...GAPS.map((g) => g.name.padStart(12))].join(''));
for (const period of PERIODS) {
  const cells = GAPS.map((g) => {
    const n = g.sec / period.sec;
    return (n < 10 ? n.toFixed(1) : String(Math.round(n))).padStart(12);
  });
  console.log([period.name.padEnd(15), ...cells].join(''));
}

/**
 * Кривая света принятых суток — уже не выбор длины, а проверка того,
 * что выбрано. Печатается вместе с яркостью солнца, потому что «ночь 0,8»
 * само по себе ничего не говорит: у света своя формула (`render/scene.ts`),
 * и на глаз из доли темноты она не выводится.
 */
console.log('\nСвет принятых суток (смена мира):\n');
console.log(['доля'.padStart(6), 'мин'.padStart(6), 'фаза'.padStart(9), 'тьма'.padStart(7), 'солнце'.padStart(8)].join(''));
for (let i = 0; i <= 20; i++) {
  const u = i / 20;
  const t = u * SHIFT_SEC;
  const night = nightAt(t);
  // Та же формула, что в render/scene.ts: солнце = 0.05 + день × 1.75.
  const sun = 0.05 + (1 - night) * 1.75;
  console.log([
    u.toFixed(2).padStart(6),
    (t / 60).toFixed(1).padStart(6),
    phaseAt(t).padStart(9),
    night.toFixed(2).padStart(7),
    sun.toFixed(2).padStart(8),
  ].join(''));
}
console.log(`\nразмах: ${CAMP_DAY} … ${CAMP_NIGHT}`);

/**
 * Вердикта прибор не выносит: он печатает доли, а решение — какой из них
 * платить — остаётся за разделом. Но одно он показывает без спора: доля
 * «перелома» падает вместе с длиной суток не плавно, а обрывом, и ниже
 * какого-то порога закат перестаёт существовать для игрока вовсе.
 */
