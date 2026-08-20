/**
 * Пролог (§16.1): поляна, по которой герой бродит, пока не кончится провиант.
 *
 * Это не вылазка. Здесь нет ни противников, ни выхода: провиант перестаёт
 * быть бюджетом на дорогу назад (§11.1) и работает часами.
 *
 * Собирать здесь есть что: на поляне лежат бруски дерева, из которых потом
 * встаёт палатка. Это второе, чему кадр учит, — «здание стоит принесённого»,
 * и учит он этому до лагеря, а не после: лагерь, выросший из ничего, научил
 * бы обратному молчанием. Учит дважды: палатка встаёт из двух брусков,
 * а её второй уровень требует сходить за деревом ещё раз.
 *
 * Подбор здесь бесплатен, и провиант тратится только на шаги: часы и сумка
 * связаны не ценником, а дорогой — собранное видно в сумке, пройденное
 * в полосе провианта. Кончился провиант — отдыхают у лагеря (`restTick`).
 *
 * Возвращается обычная GameLocation, потому что ходьба, шаг и расход
 * провианта уже написаны в `raid.ts`: пролог отличается от вылазки
 * содержимым локации, а не правилами движения по ней.
 */
import { mulberry32 } from '../core/rng';
import { distanceField, idx } from './grid';
import type { Cell, Container, GameLocation, RaidState } from './types';

/**
 * Поляна больше любой вылазки (дно — 20×20): её не проходят, по ней бродят,
 * и упереться в кромку за отпущенный провиант нельзя.
 */
export const GLADE_SIZE = 24;

/**
 * Доля клеток под деревьями. Больше — чаща, в которой некуда идти; меньше —
 * пустое поле, на котором лес не читается вовсе.
 */
const TREE_SHARE = 0.16;

/**
 * Провиант пролога. Кухни в нём ещё нет, поэтому число своё, а не из §11.1:
 * это то, что герой унёс с собой.
 *
 * Здесь провиант — это шаги, и только шаги: подбор в прологе бесплатен
 * (`containerFood: 0` в `main.ts`). Платный подбор превращал промах в тупик,
 * а во втором акте промахнуться есть где — за деревом на палатку ур. 2
 * ходят второй раз, и цена ошибки должна быть дорогой, а не находкой.
 *
 * Сколько нужно — считает `prologue.rules.ts`, а не оценка: жадный маршрут
 * за пятью брусками с возвратом к палатке обязан уложиться в это число без
 * единой секунды отдыха. Замер на 60 сидах: весь пролог 20,9–36,2 с, в среднем
 * 28,2; на нуле не остаётся никто, самому неудачному сиду до палатки хватает
 * с остатком 6, среднему — 16.
 *
 * Пятьдесят, а не сто: запас обязан кончаться у того, кто ходил не туда,
 * иначе отдых у лагеря не случится ни разу и правилом не станет.
 * Было 40 при двух брусках и платном подборе.
 */
export const GLADE_FOOD = 50;

export const gladeFood = (): number => GLADE_FOOD;

/**
 * Сумка в прологе. Число своё, как и провиант: Склада ещё нет, а
 * `storageCapacity(0)` — это его нулевой уровень, то есть уже лагерная
 * экономика. Здесь сумка — то, с чем герой вышел из леса.
 */
export const GLADE_BAG = 3;

export const gladeCapacity = (): number => GLADE_BAG;

/** Сколько дерева уходит на палатку. */
export const TENT_WOOD = 2;

/**
 * Палатка ур. 2. Ровно сумка (`GLADE_BAG`): за улучшением ходят один раз
 * и приносят полный рюкзак — цену видно в полосе, а не в ценнике.
 *
 * Второй акт кадра существует затем, что первый учит «здание стоит
 * принесённого» один раз, а один раз читается как обряд постановки лагеря.
 * Второй раз читается как правило игры.
 */
export const UPGRADE_WOOD = 3;

/**
 * Брусков на поляне. Пять нужных (палатка и её второй уровень) и два
 * запасных: поляна не обязана вычищаться под ноль. Раньше их лежало ровно
 * два — столько, сколько стоила палатка, — и подсветка учила собирать всё
 * подряд просто потому, что «всё подряд» и было ценой.
 */
export const GLADE_LOGS = 7;

/**
 * Кольцо, в котором лежат бруски: дальше — прогулка вместо подбора, ближе —
 * подбор без прогулки. Границы в шагах от старта.
 */
const LOG_NEAR = 4;
const LOG_FAR = 7;

/**
 * Отдых у лагеря. Провиант возвращается порциями, а не струйкой: цифра
 * в полосе обязана дёргаться заметно, иначе ожидание читается как зависание.
 *
 * Темп сознательно медленнее ходьбы (шаг стоит 1, а герой идёт 1,67 клетки
 * в секунду): отдых — не второй источник провианта, а цена шагов, сделанных
 * не туда. Кто идёт по делу, не ждёт вовсе — это и меряет `prologue.rules.ts`.
 */
export const REST_FOOD = 3;
export const REST_EVERY = 10;

/**
 * Насколько близко к зданию нужно стоять, чтобы отдыхать. Две клетки, а не
 * одна: на телефоне точность тапа кончается раньше, чем терпение, и «встал
 * не туда» не должно читаться как «отдых сломался».
 */
export const REST_REACH = 2;

/**
 * Поляна по сиду. Кромка — сплошной лес: уйти с поляны нельзя, и это
 * то же решение, что «вход и точка эвакуации — одно место» (§12.1) —
 * кадр обязан кончаться провиантом, а не краем карты.
 */
export function generateGlade(seed: number): GameLocation {
  const size = GLADE_SIZE;
  const rng = mulberry32(seed ^ 0x1a2b3c4d);
  const blocked = new Uint8Array(size * size);
  const start: Cell = { x: size >> 1, z: size >> 1 };

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      if (x === 0 || z === 0 || x === size - 1 || z === size - 1) {
        blocked[idx(size, x, z)] = 1;
        continue;
      }
      // Круг под ногами чист: первый тап обязан сработать в любую сторону.
      if (Math.max(Math.abs(x - start.x), Math.abs(z - start.z)) <= 1) continue;
      if (rng() < TREE_SHARE) blocked[idx(size, x, z)] = 1;
    }
  }

  // Отрезанный лесом угол — тоже лес. Иначе тап по нему оставляет героя
  // стоять на месте, и единственный жест кадра читается как поломка.
  const reach = distanceField(size, blocked, start);
  for (let i = 0; i < size * size; i++) if (reach[i] === -1) blocked[i] = 1;

  return {
    seed,
    tier: 0,
    size,
    blocked,
    evac: start,
    containers: gladeLogs(size, reach, rng),
    enemies: [],
    backSteps: distanceField(size, blocked, start),
  };
}

/**
 * Бруски на поляне. Кладутся не где попало, а в кольцо `LOG_NEAR..LOG_FAR`
 * шагов от старта: до первого нужно дойти, а не наступить на него, и все семь
 * обязаны уложиться в провиант — это меряется в `prologue.rules.ts`,
 * а не обещается здесь.
 *
 * Раскладка жадная: первый брусок случайный, каждый следующий — тот, что
 * дальше всех от уже положенных. Семь брусков так расходятся по кольцу сами,
 * и разнос между ними становится измеряемым свойством, а не обещанием;
 * два бруска рядом читались бы как одна находка, и прогулки между ними
 * не случилось бы.
 */
function gladeLogs(size: number, reach: Int32Array, rng: () => number): Container[] {
  const ring: number[] = [];
  for (let i = 0; i < size * size; i++) {
    const d = reach[i]!;
    if (d >= LOG_NEAR && d <= LOG_FAR) ring.push(i);
  }
  if (ring.length === 0) return [];

  const cellOf = (i: number): Cell => ({ x: i % size, z: (i / size) | 0 });
  const cells: number[] = [ring[Math.floor(rng() * ring.length)]!];
  while (cells.length < GLADE_LOGS && cells.length < ring.length) {
    let best = -1;
    let bestGap = -1;
    for (const i of ring) {
      if (cells.includes(i)) continue;
      const c = cellOf(i);
      let gap = Infinity;
      for (const j of cells) {
        const p = cellOf(j);
        gap = Math.min(gap, Math.hypot(c.x - p.x, c.z - p.z));
      }
      if (gap > bestGap) { bestGap = gap; best = i; }
    }
    if (best === -1) break;
    cells.push(best);
  }

  return cells.map((i, n) => ({
    id: n,
    x: i % size,
    z: (i / size) | 0,
    // По одному бруску в находке: сумка на три и палатка за два — числа,
    // которые игрок должен сосчитать глазами, а не прочитать в полосе.
    amount: 1,
    kind: 'wood' as const,
    opened: false,
  }));
}

/**
 * Куда показать точку тапа в прологе — на ближайший несобранный брусок.
 * Раньше здесь бралась клетка в трёх шагах просто затем, чтобы жесту было
 * куда показать; теперь показывать есть на что, и кольцо ведёт к делу.
 *
 * Когда бруски кончились, кадр ещё не кончился: остаток провианта дохаживают
 * свободно, и подсказка возвращается к прежнему поведению.
 */
export function firstGladeCell(loc: GameLocation, from: Cell): Cell | null {
  const dist = distanceField(loc.size, loc.blocked, {
    x: Math.round(from.x),
    z: Math.round(from.z),
  });
  let best: Cell | null = null;
  let bestDist = Infinity;
  for (const c of loc.containers) {
    if (c.opened) continue;
    const d = dist[idx(loc.size, c.x, c.z)]!;
    if (d < 0 || d >= bestDist) continue;
    bestDist = d;
    best = { x: c.x, z: c.z };
  }
  if (best !== null) return best;

  for (let z = 0; z < loc.size; z++) {
    for (let x = 0; x < loc.size; x++) {
      if (dist[idx(loc.size, x, z)] === 3) return { x, z };
    }
  }
  return null;
}

/**
 * Стоит ли герой у лагеря. Расстояние Чебышёва до ближайшего поставленного
 * здания: лагерь из палатки и костра — не точка, а место, и «у костра»
 * должно значить то же, что «у палатки».
 */
export function nearCamp(pitched: readonly Cell[], hero: Cell): boolean {
  return pitched.some(
    (c) =>
      Math.max(Math.abs(Math.round(hero.x) - c.x), Math.abs(Math.round(hero.z) - c.z)) <=
      REST_REACH,
  );
}

/**
 * Отдых у лагеря: секунды копятся, провиант приходит порциями по `REST_FOOD`.
 * Копилка возвращается наружу, а не хранится в состоянии вылазки: отдыхают
 * только в прологе, и `RaidState` о нём знать не обязан — как не знает
 * ни о палатке, ни о поляне.
 *
 * Отошёл от лагеря — вызывающий обнуляет копилку: недостоянные секунды
 * не должны догонять героя в лесу.
 */
export function restTick(acc: number, dt: number, state: RaidState): number {
  let left = acc + dt;
  while (left >= REST_EVERY) {
    left -= REST_EVERY;
    state.food = Math.min(state.foodMax, state.food + REST_FOOD);
  }
  return left;
}

/** Почему сюда нельзя поставить здание. 'ok' — можно. */
export type SiteBlock = 'ok' | 'tree' | 'busy' | 'hero';

/**
 * Можно ли ставить здание на клетку. Возвращается причина, а не булево,
 * по той же причине, что и в лагере (`camp.ts`): игрок должен видеть, что
 * мешает, а не молчащий красный квадрат.
 *
 * Расстояния до героя в правиле нет намеренно: лагерь ставится там, где
 * игрок решил остаться, и «слишком далеко» здесь ничего не защищает.
 */
export function siteBlock(
  loc: GameLocation,
  taken: readonly Cell[],
  hero: Cell,
  cell: Cell,
): SiteBlock {
  const { size, blocked } = loc;
  if (cell.x < 0 || cell.z < 0 || cell.x >= size || cell.z >= size) return 'tree';
  if (blocked[idx(size, cell.x, cell.z)]) return 'tree';
  if (taken.some((t) => t.x === cell.x && t.z === cell.z)) return 'busy';
  if (Math.round(hero.x) === cell.x && Math.round(hero.z) === cell.z) return 'hero';
  return 'ok';
}
