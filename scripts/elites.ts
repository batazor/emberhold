/**
 * Карта достижимого: какие ярусы наша модель вообще умеет делать.
 *
 * Вопрос, ради которого прибор написан, стоит в §11.3 и открыт с тех пор,
 * как там записано «сегодня правило не выполняется»: **провал обязан
 * приходить глубже середины локации, и глубина провала не может быть меньше
 * глубины возвращения.** Замер `npm run measure` говорит, что на нынешних
 * числах это не так. Чего он не говорит — существует ли вообще описание
 * яруса, при котором так становится, или модель §22 такого яруса построить
 * не может ни при каких ручках.
 *
 * Перебором это не выясняется: ручек семь, и сетка по пять значений на ручку
 * — это 78 тысяч прогонов, из которых интересны единицы. Оптимизатор тоже
 * не отвечает: он вернёт одну «лучшую» настройку и промолчит о том, чего
 * достичь нельзя.
 *
 * Метод взят готовый — **MAP-Elites** (Mouret & Clune): вместо одного
 * оптимума строится **архив** по осям, которые дизайнер понимает; каждая
 * ячейка держит лучшую найденную настройку со своим поведением. Алгоритм
 * так и называют освещающим: он показывает не вершину, а рельеф — какие
 * сочетания вообще достижимы. В играх им балансировали колоды Hearthstone
 * и генерировали уровни; здесь оси заданы прямо правилом §11.3.
 *
 * Оси архива:
 *   — доля успеха (по горизонтали);
 *   — глубина провала (по вертикали), та самая, про которую правило.
 *
 * Качество внутри ячейки — средний заход по всем вылазкам (§22.8): из двух
 * настроек с одинаковым поведением ценнее та, что даёт игроку больше.
 *
 * Что прибор отвечает и чего не отвечает. Он отвечает: заселена ли область,
 * где правило §11.3 выполняется, и какими числами. Он **не** назначает
 * ярусам новые числа: найденная настройка — кандидат, который дальше обязан
 * пройти `npm run measure` целиком, вместе с гарантиями §22.4 и лестницей
 * ярусов. Карта показывает, что возможно, а не что верно.
 *
 * Запуск: npm run elites
 */
import { mulberry32 } from '../src/core/rng';
import { TIER_SPEC } from '../src/sim/balance';
import { evaluateSpec } from './tierlab';
import type { TierSpec } from '../src/sim/balance';
import type { Tier } from '../src/sim/types';

/** Ярус, чей рельеф освещаем. Тот же, что у остальных приборов. */
const TIER: Tier = 2;
/** Забегов на настройку. Меньше, чем у `measure`: карта строится многими
 *  точками, и точность отдельной ячейки здесь дешевле разнообразия. */
const RUNS = 60;
/** Случайных настроек на старте и сколько потом мутаций. */
const SEEDS = 120;
const ITERATIONS = 900;
/** Делений по каждой оси архива. Десять — шаг в десять процентов:
 *  мельче ячейка, чем шум прибора при шестидесяти забегах, не имеет смысла. */
const BINS = 10;

const rng = mulberry32(20260824);
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

/* ---------- пространство настроек ---------- */

/**
 * Здесь ручек больше, чем в `npm run model`, и это разница вопросов.
 * Там мерилось, годятся ли оси §22 как ручки, и число находок было привязано
 * к размеру, потому что в игре оно привязано. Здесь ищется **достижимое**,
 * и связывать руки поиску нельзя: `npm run stop` прямо называет число находок
 * рычагом, которым можно вернуть решение в вылазку.
 */
interface Knob {
  readonly key: keyof TierSpec;
  readonly name: string;
  readonly lo: number;
  readonly hi: number;
  readonly whole?: boolean;
}

const KNOBS: readonly Knob[] = [
  { key: 'size', name: 'размер', lo: 8, hi: 22, whole: true },
  { key: 'containers', name: 'находок', lo: 3, hi: 12, whole: true },
  { key: 'generosity', name: 'щедрость', lo: 0.15, hi: 1 },
  { key: 'capacityRatio', name: 'рюкзак', lo: 0.8, hi: 2.4 },
  { key: 'woundBudget', name: 'бюджет ран', lo: 0.15, hi: 1.4 },
  { key: 'depthValue', name: 'цена глубины', lo: 1.2, hi: 4 },
  { key: 'risk', name: 'ставка', lo: 0, hi: 1 },
];

type Genes = readonly number[];

const specOf = (g: Genes): TierSpec => {
  const spec: Record<string, number> = { ...TIER_SPEC[TIER] };
  KNOBS.forEach((k, i) => {
    const raw = k.lo + (k.hi - k.lo) * Math.min(1, Math.max(0, g[i]!));
    spec[k.key] = k.whole ? Math.round(raw) : raw;
  });
  return spec as unknown as TierSpec;
};

const random = (): Genes => KNOBS.map(() => rng());

/** Мутация: гауссов шум по каждой ручке. Сигма мелкая — архив заполняется
 *  соседями элиты, а не новыми случайными точками; в этом весь MAP-Elites. */
const mutate = (g: Genes): Genes =>
  g.map((v) => {
    const u = Math.max(1e-9, rng());
    const gauss = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
    return Math.min(1, Math.max(0, v + gauss * 0.12));
  });

/* ---------- архив ---------- */

interface Cell {
  readonly genes: Genes;
  readonly spec: TierSpec;
  readonly success: number;
  readonly failDepth: number;
  readonly okDepth: number;
  readonly haul: number;
  readonly fails: number;
}

const key = (a: number, b: number): string => `${a},${b}`;
const bin = (x: number): number => Math.min(BINS - 1, Math.max(0, Math.floor(x * BINS)));

const archive = new Map<string, Cell>();

function place(genes: Genes): Cell | null {
  const spec = specOf(genes);
  const got = evaluateSpec(TIER, spec, RUNS);
  // Настройка без единого провала о глубине провала ничего не говорит:
  // класть её в архив по величине, которой не измеряли, — врать карте.
  if (got.fails < 3) return null;
  const cell: Cell = {
    genes,
    spec,
    success: got.success,
    failDepth: got.failDepth,
    okDepth: got.okDepth,
    haul: got.haul,
    fails: got.fails,
  };
  const k = key(bin(got.success), bin(got.failDepth));
  const held = archive.get(k);
  if (held === undefined || cell.haul > held.haul) {
    archive.set(k, cell);
    return cell;
  }
  return null;
}

console.log('Карта достижимого: MAP-Elites по модели §22\n');
console.log(`ярус ${TIER}, ${RUNS} забегов на настройку, ${SEEDS} случайных + ${ITERATIONS} мутаций\n`);

for (let i = 0; i < SEEDS; i++) place(random());
const elites = (): Cell[] => [...archive.values()];
for (let i = 0; i < ITERATIONS; i++) {
  const pool = elites();
  if (pool.length === 0) break;
  place(mutate(pool[Math.floor(rng() * pool.length)]!.genes));
}

/* ---------- карта ---------- */

/**
 * Печатается плотность, а не числа: карта отвечает на вопрос «заселено ли»,
 * и в этом виде её видно целиком. Значок — средний заход в ячейке.
 */
console.log('══ Архив: строки — глубина провала, столбцы — доля успеха ══\n');
const mark = (c: Cell | undefined): string => {
  if (c === undefined) return ' ·';
  if (c.haul >= 18) return ' ▓';
  if (c.haul >= 12) return ' ▒';
  return ' ░';
};
for (let d = BINS - 1; d >= 0; d--) {
  const row = Array.from({ length: BINS }, (_, s) => mark(archive.get(key(s, d))));
  const label = `${(d * 10).toString().padStart(3)}–${((d + 1) * 10).toString().padStart(3)}%`;
  console.log(`${label} │${row.join('')}`);
  if (d === BINS / 2) console.log(`${' '.repeat(9)}├${'─'.repeat(BINS * 2)}  ← середина локации (§11.3)`);
}
console.log(`${' '.repeat(9)}└${'─'.repeat(BINS * 2)}`);
console.log(`${' '.repeat(10)}${Array.from({ length: BINS }, (_, s) => String(s * 10).padStart(2)).join('')}  доля успеха, %`);
console.log('\n  ░ заход < 12   ▒ 12–18   ▓ ≥ 18   · настройки не нашлось');

/* ---------- где живёт правило §11.3 ---------- */

/**
 * Область правила: провал глубже середины **и** не мельче возвращения.
 * Обе половины — из §11.3, и брать одну без другой нельзя: ярус, где павшие
 * глубоки только потому, что дошедшие ещё глубже, правило не выполняет.
 */
const legal = elites().filter((c) => c.failDepth > 0.5 && c.failDepth >= c.okDepth);
const current = evaluateSpec(TIER, TIER_SPEC[TIER], RUNS);

console.log('\n\n══ Область правила §11.3 ══\n');
console.log(
  `нынешний ярус ${TIER}: успех ${pct(current.success)}, провал на ${pct(current.failDepth)}, ` +
    `возврат на ${pct(current.okDepth)}, заход ${current.haul.toFixed(1)}`,
);
console.log(
  `правило сегодня: ${current.failDepth > 0.5 && current.failDepth >= current.okDepth ? 'выполняется' : 'НЕ выполняется'}\n`,
);

/**
 * Какая из двух половин правила связывает. Первую — «глубже середины» —
 * архив выполняет широко; вторую — «павшие не мельче дошедших» — почти
 * нигде, и это не свойство нынешних чисел, а свойство всего рельефа.
 */
const deep = elites().filter((c) => c.failDepth > 0.5);
const gaps = elites().map((c) => c.failDepth - c.okDepth).sort((a, b) => a - b);
const median = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)]! : 0;
console.log(
  `половина «глубже середины»: ${deep.length} ячеек из ${archive.size}\n` +
    `половина «павшие не мельче дошедших»: ${gaps.filter((g) => g >= 0).length} ячеек\n` +
    `разница «провал − возврат» по архиву: медиана ${(median * 100).toFixed(0)} п.п., ` +
    `лучшая ${(gaps[gaps.length - 1]! * 100).toFixed(0)} п.п.\n`,
);

if (legal.length === 0) {
  console.log(
    '⚠ Область правила пуста: ни одна из найденных настроек не даёт провала\n' +
      '  глубже середины при том, что павшие не мельче дошедших. Это не про\n' +
      '  числа яруса — это про модель: §22 такого яруса не строит ни при каких\n' +
      '  ручках, и чинить надо то, откуда берётся глубина провала (§11.3 —\n' +
      '  бой у входа), а не описание сложности.',
  );
} else {
  const best = legal.reduce((a, b) => (b.haul > a.haul ? b : a));
  const alive = legal.filter((c) => c.success >= 0.5);
  console.log(`✓ Область правила заселена: ${legal.length} ячеек из ${archive.size} найденных.`);
  console.log(`  из них с успехом не ниже половины: ${alive.length}\n`);
  console.log('лучшие по заходу настройки внутри области:\n');
  console.log('успех  провал  возврат  заход │ ' + KNOBS.map((k) => k.name.padStart(13)).join(''));
  for (const c of [...legal].sort((a, b) => b.haul - a.haul).slice(0, 6)) {
    const cells = KNOBS.map((k) => {
      const v = (c.spec as unknown as Record<string, number>)[k.key]!;
      return (k.whole ? String(v) : v.toFixed(2)).padStart(13);
    });
    console.log(
      `${pct(c.success).padStart(5)}${pct(c.failDepth).padStart(8)}${pct(c.okDepth).padStart(9)}` +
        `${c.haul.toFixed(1).padStart(7)} │ ` + cells.join(''),
    );
  }
  console.log(
    `\n  Лучший кандидат: успех ${pct(best.success)}, провал на ${pct(best.failDepth)},\n` +
      `  возврат на ${pct(best.okDepth)}, заход ${best.haul.toFixed(1)}.\n` +
      '  Это кандидат, а не решение: §22.4 и лестница ярусов проверяются\n' +
      '  отдельно (`npm run measure`), и карта об этом ничего не знает.',
  );
}

/* ---------- чего модель не умеет вовсе ---------- */

/**
 * Пустые ячейки — тоже ответ, и часто более важный: они показывают, каких
 * ярусов модель не строит. Печатается только сводка по успеху, потому что
 * именно по нему §22.6 строит лестницу.
 */
console.log('\n\n══ Чего модель не строит ══\n');
const bySuccess = Array.from({ length: BINS }, (_, s) =>
  elites().filter((c) => bin(c.success) === s),
);
const missing = bySuccess
  .map((cells, s) => ({ s, n: cells.length }))
  .filter((x) => x.n === 0)
  .map((x) => `${x.s * 10}–${(x.s + 1) * 10}%`);
console.log(
  missing.length === 0
    ? '✓ Любая доля успеха достижима: пустых столбцов нет.'
    : `⚠ Недостижимые доли успеха: ${missing.join(', ')}.\n` +
        '  Ярус с такой сложностью модель §22 построить не может — ни щедростью,\n' +
        '  ни бюджетом ран, ни ставкой.',
);
