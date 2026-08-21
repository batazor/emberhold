/**
 * Цена присутствия противника в настоящей вылазке (§22). Отвечает на вопрос,
 * от которого зависит состав врагов на всех ярусах: **сколько ран стоит
 * то, что этот тип вообще есть в локации.**
 *
 * Дуэль на этот вопрос не отвечает и отвечать не может. `WOUND_COST`
 * в `balance.ts` снят дуэлями и прямо помечен как негодный для модели:
 * обход врага — часть игры, и непреследующего мага обходят чаще всех.
 * Расхождение принципиальное — маг в дуэли стоил двух воинов, а в вылазке
 * 1,15, — и ошибку нашёл именно такой прогон, а не формула.
 *
 * Метод повторяет тот, которым сняты нынешние числа: по три врага одного
 * вида на локацию, шестьдесят забегов на точку, остальное убрано. Вычитается
 * фон — прогон вовсе без врагов, — потому что часть ран отнимает голод,
 * и без вычитания она осела бы на том, кто просто рядом стоял.
 *
 * Печатает результат в форме, готовой к вставке в `balance.ts`: это числа
 * для кода, а не отчёт для чтения.
 *
 * Запуск: npm run encounter
 */
import { POLICIES, playRaid } from '../src/sim/bot';
import { mulberry32 } from '../src/core/rng';
import { ENCOUNTER_WOUND } from '../src/sim/balance';
import { ENEMY_STATS } from '../src/sim/enemies';
import { generateLocation } from '../src/sim/generate';
import type { RaidOptions } from '../src/sim/raid';
import type { EnemyKind, RaidEnemyKind, Tier } from '../src/sim/types';

/** Забегов на точку. Столько же, сколько при съёме нынешних чисел. */
const RUNS = 60;
/** По скольку врагов одного вида ставим. Тоже как тогда. */
const PACK = 3;
/** Ярус, на котором меряем: середина кривой, где есть и дорога, и находки. */
const TIER: Tier = 2;
const CAMP = { kitchenLevel: 3, storageLevel: 3 };

/**
 * Локация яруса с подменённым составом врагов. Геометрия, находки и провиант
 * остаются теми же — меняется ровно одно, иначе сравнивать будет нечего.
 */
function withEnemies(seed: number, kinds: readonly EnemyKind[]): RaidOptions {
  const loc = generateLocation(seed, TIER, 1);
  const kept = loc.enemies.slice(0, kinds.length);
  const enemies = kept.map((e, i) => ({
    ...e,
    kind: kinds[i]!,
    hp: ENEMY_STATS[kinds[i]!].hp,
  }));
  return { ...CAMP, seed, tier: TIER, loc: { ...loc, enemies } };
}

/**
 * Игрок берётся у бота целиком, а не пишется здесь заново.
 *
 * Своя копия тут была, и она пережила ровно до пошагового боя: игрок,
 * не умеющий ходить в бою, вешает вылазку насмерть. Это второй раз, когда
 * дубликат модели игрока стоил прогона, — первым была карта опасности.
 * Модель одна, и живёт она там же, где политики.
 */
const play = (opts: RaidOptions): { wounds: number; ok: boolean } => {
  const r = playRaid(opts, POLICIES.cautious, mulberry32(opts.seed));
  return { wounds: r.woundsTaken, ok: r.status === 'evacuated' };
};

const KINDS = Object.keys(ENEMY_STATS) as EnemyKind[];
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

console.log(`Цена присутствия: ярус ${TIER}, по ${PACK} врага одного вида, ${RUNS} забегов\n`);

// Фон: те же локации без единого врага. Голод отнимает раны и без боя,
// и без вычитания фона они осели бы на том, кто просто рядом стоял.
const base = mean(
  Array.from({ length: RUNS }, (_, i) => play(withEnemies(1000 + i, [])).wounds),
);

console.log(`вид            ран за вылазку   сверх фона   один из ${PACK}   успех`);
for (const kind of KINDS) {
  const pack: EnemyKind[] = Array.from({ length: PACK }, () => kind);
  const runs = Array.from({ length: RUNS }, (_, i) => play(withEnemies(1000 + i, pack)));
  const w = mean(runs.map((r) => r.wounds));
  const per = Math.max(0, (w - base) / PACK);
  console.log(
    `${ENEMY_STATS[kind].name.padEnd(14)}${w.toFixed(2).padStart(14)}` +
      `${(w - base).toFixed(2).padStart(13)}${per.toFixed(2).padStart(14)}` +
      `${((runs.filter((r) => r.ok).length / RUNS) * 100).toFixed(0).padStart(8)}%`,
  );
}
console.log(`фон (без врагов)${base.toFixed(2).padStart(12)}\n`);
console.log(
  `  Это цена одного в тройке, а не предельная. Пиннуется предельная —\n`
  + `  прогон с одним врагом, ещё не тронутый насыщением, — и её печатает\n`
  + `  блок в самом низу, после таблицы по числу.\n`,
);

/**
 * Линейна ли цена по числу. Модель §22 набирает состав, складывая цену
 * присутствия штука за штукой, — то есть предполагает, что пятеро стоят
 * впятеро дороже одного. Для ближнего это близко к правде: встреча с ним
 * либо случается, либо нет. Для стрелка — нет, и вот почему: спрятаться
 * от одного просто, от пятерых негде, потому что их зоны обстрела
 * перекрываются, а укрытие в локации одно.
 *
 * Если цена растёт быстрее числа, складывать её нельзя, и на стрелков
 * нужен потолок. Число потолка берётся отсюда, а не назначается.
 */
console.log('\nЦена по числу: где она перестаёт складываться\n');

/**
 * ВАЖНО про метрику. «Ран за вылазку» упирается в потолок ран героя:
 * мёртвый больше не получает. Поэтому чем смертельнее локация, тем дешевле
 * она выглядит — прибор насыщается ровно там, где интереснее всего, и
 * складывать такую цену за пределами насыщения нельзя.
 *
 * Не насыщается доля провалов, поэтому она печатается рядом. Цену по ранам
 * читаем, пока успех высок; как только он валится, читать надо провалы.
 */
/** Предельная цена: колонка «один». Её и пиннует `balance.ts`. */
const marginal: Record<string, number> = {};

for (const kind of KINDS) {
  const perWound: string[] = [];
  const perFail: string[] = [];
  for (const n of [1, 2, 3, 4, 5]) {
    const pack: EnemyKind[] = Array.from({ length: n }, () => kind);
    const runs = Array.from({ length: RUNS }, (_, i) => play(withEnemies(1000 + i, pack)));
    const per = (mean(runs.map((r) => r.wounds)) - base) / n;
    if (n === 1) marginal[kind] = Math.max(0, per);
    perWound.push(per.toFixed(2).padStart(9));
    perFail.push(`${((runs.filter((r) => !r.ok).length / RUNS) * 100).toFixed(0)}%`.padStart(9));
  }
  console.log(`${ENEMY_STATS[kind].name.padEnd(14)}${perWound.join('')}   ран на одного`);
  console.log(`${''.padEnd(14)}${perFail.join('')}   провалов`);
}
console.log('\n  штук:' + [1, 2, 3, 4, 5].map((n) => String(n).padStart(9)).join(''));

/**
 * Готовое к вставке. Три вещи, каждая из которых уже стоила прогона:
 *
 * 1. **Печатается предельная цена**, а не цена одного в тройке. `balance.ts`
 *    называет пиннуемую величину предельной прямым текстом, а блок печатал
 *    колонку тройки — две разные величины под одним именем.
 * 2. **Тип `RaidEnemyKind`, а не `EnemyKind`.** Привидение в ярусах не
 *    спавнится (§6.1.7) и в бюджет ран не входит; вставленный как есть блок
 *    с ним просто не собирался.
 * 3. **Ключи берутся у самого `ENCOUNTER_WOUND`**, а не у `ENEMY_STATS`:
 *    блок обязан заполнять ровно то, что заполняет, — и новый вид в бюджете
 *    появится здесь сам.
 */
console.log('\n\nГотовое к вставке в src/sim/balance.ts (предельная цена):\n');
console.log('export const ENCOUNTER_WOUND: Record<RaidEnemyKind, number> = {');
for (const kind of Object.keys(ENCOUNTER_WOUND) as RaidEnemyKind[]) {
  console.log(`  ${kind}: ${(marginal[kind] ?? 0).toFixed(2)},`);
}
console.log('};');
