/**
 * Содержание лагеря (§13.7) — сходится ли оно.
 *
 * Модель расходов вводит первый сток, который идёт **без участия игрока**:
 * жильцы едят, костры жгут дерево. У такого стока две крайности, и обе
 * убивают лагерь молча:
 *
 *   — содержание дешевле работы: расход не читается вовсе, и пища становится
 *     пятым числом в панели, которое никто не смотрит;
 *   — содержание дороже работы: приглашённый жилец не окупается, лагерь
 *     сваливается в голод, из которого нет выхода, а §13.1 запрещает даже
 *     соседнее состояние — «не могу пойти в вылазку».
 *
 * Прибор считает то, чего нельзя увидеть в коде: **баланс лагеря по составу
 * жильцов**. Приход и расход считаются одной линейкой — рабочим тактом
 * (`WORK_SECONDS`), — и на выходе три вещи: сколько ртов кормит один
 * добытчик, при каком составе лагерь ещё растёт, и за сколько отлучек
 * проедается запас.
 *
 * Чего он не делает: не ходит в вылазку. Вылазка сюда не входит вовсе,
 * и это правильно — пища не выпадает в находках (§13.7), а значит цикл
 * лагеря обязан сходиться сам по себе, без добычи.
 *
 * Запуск: npm run upkeep
 */
import { createCamp } from '../src/sim/camp';
import { WORK_CAP, WORK_SECONDS, buildTent, workDone } from '../src/sim/residents';
import type { ResidentJob } from '../src/sim/residents';
import {
  FIRE_WOOD,
  FOOD_PER_MOUTH,
  GUEST_FOOD,
  START_FOOD,
  payUpkeep,
  upkeepDue,
  workingAfter,
} from '../src/sim/upkeep';
import { PARITY } from '../src/sim/trade';
import type { CampState } from '../src/sim/camp';

/** Лагерь из `jobs`: у каждого своя крыша, кладовая полна. */
function campOf(jobs: readonly ResidentJob[], fires = 0): CampState {
  const camp = createCamp();
  camp.levels.hq = 6;
  camp.resources.wood = 999;
  jobs.forEach((job, i) => {
    camp.residents.push({ name: `Ж${i}`, look: 'поселенец', seed: i, answer: job, rest: false });
    buildTent(camp);
  });
  camp.fires = Array.from({ length: fires }, (_, i) => ({ x: i, z: 0 }));
  camp.resources.wood = 999;
  camp.resources.food = 999;
  return camp;
}

/** Приход за один такт по видам: что жильцы принесут, если все сыты. */
function income(camp: CampState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { kind, n } of workDone(camp, WORK_SECONDS)) out[kind] = (out[kind] ?? 0) + n;
  return out;
}

const num = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(2));

console.log('Содержание лагеря: сходится ли цикл жильцов\n');
console.log(
  `такт работы ${WORK_SECONDS / 60} мин, потолок отлучки ${WORK_CAP} такта, ` +
    `рот ест ${num(FOOD_PER_MOUTH)}, костёр жжёт ${num(FIRE_WOOD)}\n`,
);

/* ---------- 1. Баланс по составу ---------- */

console.log('══ 1. Баланс лагеря по составу ══\n');
console.log('состав                        рты   пища +/−   дерево +/−   камень +/−   растёт');

interface Row {
  readonly label: string;
  readonly food: number;
  readonly wood: number;
  readonly stone: number;
  readonly grows: boolean;
}

const COMPOSITIONS: { label: string; jobs: ResidentJob[]; fires: number }[] = [
  { label: '1 носит дерево', jobs: ['строим'], fires: 0 },
  { label: '1 добывает пищу', jobs: ['кормим'], fires: 0 },
  { label: '1 пища + 1 дерево', jobs: ['кормим', 'строим'], fires: 0 },
  { label: '1 пища + 2 работы', jobs: ['кормим', 'строим', 'ходим'], fires: 0 },
  { label: '1 пища + 3 работы', jobs: ['кормим', 'строим', 'ходим', 'строим'], fires: 0 },
  { label: '2 пищи + 4 работы', jobs: ['кормим', 'кормим', 'строим', 'ходим', 'строим', 'ходим'], fires: 0 },
  { label: '1 пища + 2 работы, костёр', jobs: ['кормим', 'строим', 'ходим'], fires: 1 },
  { label: '1 пища + 2 работы, 3 костра', jobs: ['кормим', 'строим', 'ходим'], fires: 3 },
];

const rows: Row[] = COMPOSITIONS.map(({ label, jobs, fires }) => {
  const camp = campOf(jobs, fires);
  const got = income(camp);
  const due = upkeepDue(camp, WORK_SECONDS);
  const food = (got.food ?? 0) - due.food;
  const wood = (got.wood ?? 0) - due.wood;
  const stone = got.stone ?? 0;
  // Лагерь растёт, если и еда не в минусе, и хоть что-то остаётся на стройку:
  // сытый лагерь, весь доход которого уходит в костёр, стоит на месте.
  const grows = food >= 0 && wood + stone > 0;
  console.log(
    `${label.padEnd(28)}${String(jobs.length).padStart(5)}` +
      `${(food >= 0 ? '+' : '') + num(food)}`.padStart(11) +
      `${(wood >= 0 ? '+' : '') + num(wood)}`.padStart(13) +
      `${(stone >= 0 ? '+' : '') + num(stone)}`.padStart(13) +
      `${(grows ? 'да' : 'нет').padStart(9)}`,
  );
  return { label, food, wood, stone, grows };
});

/* ---------- 2. Сколько ртов кормит добытчик ---------- */

console.log('\n\n══ 2. Сколько ртов кормит один добытчик ══\n');
const perGatherer = Math.floor(1 / FOOD_PER_MOUTH);
console.log(`по числам: ${perGatherer} рта на добытчика (такт даёт 1 пищи, рот ест ${num(FOOD_PER_MOUTH)})`);
let feeds = 0;
for (let n = 1; n <= 12; n++) {
  const jobs: ResidentJob[] = ['кормим', ...Array.from({ length: n - 1 }, () => 'строим' as ResidentJob)];
  const camp = campOf(jobs);
  const got = income(camp);
  if ((got.food ?? 0) - upkeepDue(camp, WORK_SECONDS).food >= 0) feeds = n;
}
console.log(`по прогону: лагерь с одним добытчиком сыт до ${feeds} человек включительно`);
console.log(
  feeds === perGatherer
    ? '✓ Число совпало с расчётным: правило «один кормит троих» держится.'
    : `⚠ Прогон расходится с расчётом (${feeds} против ${perGatherer}): считают разное.`,
);

/* ---------- 3. Голод: как быстро и как больно ---------- */

console.log('\n\n══ 3. Голод ══\n');
console.log('запас пищи   отлучек до голода   работает после   всего жильцов');
for (const stock of [0, 1, 3, 6, 12]) {
  const jobs: ResidentJob[] = ['кормим', 'строим', 'ходим', 'строим'];
  const camp = campOf(jobs);
  camp.resources.food = stock;
  let away = 0;
  let report = payUpkeep(camp, WORK_SECONDS * WORK_CAP);
  while (report.hungry === 0 && away < 20) {
    away += 1;
    report = payUpkeep(camp, WORK_SECONDS * WORK_CAP);
  }
  console.log(
    `${String(stock).padStart(10)}${String(away).padStart(20)}` +
      `${String(workingAfter(camp, report.hungry)).padStart(17)}${String(jobs.length).padStart(15)}`,
  );
}
console.log(
  '\n  Голод не запирает вылазку (§13.1) — он только снимает жильцов с работы.\n' +
    '  Столбец «работает после» и есть вся цена забывчивости.',
);

/**
 * Стартовый запас отдельной строкой: он и заведён затем, чтобы игрок успел
 * познакомиться с содержанием прежде, чем оно возьмёт своё. Считается
 * на два рта — второй жилец приходит раньше, чем запас кончится.
 */
console.log('\n  Стартовый запас против двух ртов:');
{
  const camp = campOf(['ходим', 'строим']);
  camp.resources.food = START_FOOD;
  let away = 0;
  while (payUpkeep(camp, WORK_SECONDS * WORK_CAP).hungry === 0 && away < 100) away += 1;
  const guest = campOf(['ходим']);
  guest.resources.food = 0;
  console.log(
    `  запас ${START_FOOD} держит ${away} отлучек по потолку — это примерно двое суток игры;\n` +
      `  приглашённый добавляет к нему узелок ${GUEST_FOOD} (ещё ${Math.floor(
        GUEST_FOOD / (2 * WORK_CAP * FOOD_PER_MOUTH),
      )} отлучки на двоих).`,
  );
}

/* ---------- 4. Лавка как страховка ---------- */

/**
 * Обмен (§13.5) — второй источник пищи и единственный, доступный игроку
 * напрямую. Он обязан быть страховкой, а не заменой добытчику: если камнем
 * прокормить лагерь дешевле, чем человеком, приказ «Добывать пищу»
 * перестаёт быть выбором.
 */
console.log('\n\n══ 4. Лавка против добытчика ══\n');
const offer = PARITY['food-stone'];
const stonePerFood =
  (offer.give.stone ?? 0) / Math.max(1, offer.take.food ?? 1);
const camp = campOf(['ходим']);
const stonePerTick = income(camp).stone ?? 0;
const mouthsFed = stonePerTick / (stonePerFood * FOOD_PER_MOUTH);
console.log(`курс лавки: ${offer.give.stone} камня за ${offer.take.food} пищи (${num(stonePerFood)} камня за единицу)`);
console.log(`камнетёс приносит ${num(stonePerTick)} камня за такт — это ${num(mouthsFed)} рта, если всё проесть`);
console.log(
  mouthsFed < perGatherer
    ? `✓ Лавка проигрывает добытчику: ${num(mouthsFed)} рта против ${perGatherer}.\n` +
        '  Приказ «Добывать пищу» остаётся выбором, а обмен — страховкой.'
    : `⚠ Лавка обогнала добытчика: ${num(mouthsFed)} рта против ${perGatherer}.\n` +
        '  Тогда добытчик не нужен, и весь выбор между людьми отменяется курсом.',
);

/* ---------- вердикт ---------- */

console.log('\n\n══ Вердикт ══\n');
const stalled = rows.filter((r) => !r.grows).map((r) => r.label);
const starving = rows.filter((r) => r.food < 0).map((r) => r.label);
console.log(
  starving.length === 0
    ? '✓ Ни один разумный состав не голодает.'
    : `Голодают: ${starving.join(', ')} — и это правильно, если в составе нет добытчика.`,
);
console.log(
  stalled.length < rows.length
    ? `✓ Лагерь растёт при ${rows.length - stalled.length} составах из ${rows.length}:\n` +
        '  содержание берёт своё, но не съедает стройку целиком.'
    : '⚠ Ни один состав не растёт: содержание съедает весь приход, и лагерь\n' +
        '  замер. Числа §13.7 надо снижать.',
);
const fires3 = rows.find((r) => r.label.includes('3 костра'));
if (fires3 !== undefined) {
  console.log(
    fires3.wood >= 0
      ? `✓ Три костра лагерь тянет: дерева остаётся ${num(fires3.wood)} за такт.`
      : `⚠ Три костра лагерь не тянет: дерева не хватает на ${num(-fires3.wood)} за такт —\n` +
          '  костры гаснут по очереди, и это видно игроку, а не только прибору.',
  );
}
