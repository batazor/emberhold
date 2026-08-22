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
import { SHIFT_SEC } from '../src/sim/world';

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
 * Фазы суток долями круга. Сумерки нарочно широкие: перелом — единственная
 * фаза, которую **смотрят**, а не застают, и узкий закат игрок не поймает
 * никогда.
 */
const PHASES: readonly { readonly name: string; readonly from: number; readonly to: number }[] = [
  { name: 'день', from: 0.0, to: 0.42 },
  { name: 'закат', from: 0.42, to: 0.55 },
  { name: 'ночь', from: 0.55, to: 0.87 },
  { name: 'рассвет', from: 0.87, to: 1.0 },
];

const phaseAt = (share: number): string => {
  const u = ((share % 1) + 1) % 1;
  return PHASES.find((p) => u >= p.from && u < p.to)?.name ?? 'день';
};

/** Ломает ли визит длиной `SESSION`, начатый в доле `u`, границу фазы. */
function catchesTurn(period: number, u: number): boolean {
  const start = phaseAt(u);
  const end = phaseAt(u + SESSION / period);
  return start !== end;
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

const head = ['сутки'.padEnd(15), 'мин'.padStart(5), ...PHASES.map((p) => p.name.padStart(8)), 'перелом'.padStart(9)];
console.log(head.join(''));

for (const period of PERIODS) {
  const seen = new Map<string, number>(PHASES.map((p) => [p.name, 0]));
  let turns = 0;
  for (let i = 0; i < STEPS; i++) {
    const u = i / STEPS;
    seen.set(phaseAt(u), seen.get(phaseAt(u))! + 1);
    if (catchesTurn(period.sec, u)) turns++;
  }
  const cells = PHASES.map((p) => `${Math.round((seen.get(p.name)! / STEPS) * 100)}%`.padStart(8));
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
 * Вердикта прибор не выносит: он печатает доли, а решение — какой из них
 * платить — остаётся за разделом. Но одно он показывает без спора: доля
 * «перелома» падает вместе с длиной суток не плавно, а обрывом, и ниже
 * какого-то порога закат перестаёт существовать для игрока вовсе.
 */
