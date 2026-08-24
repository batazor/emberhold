/**
 * Пролог (§16.1): поляна, по которой герой бродит, пока не кончится провиант.
 *
 * Это не вылазка. Здесь нет ни противников, ни выхода: провиант перестаёт
 * быть бюджетом на дорогу назад (§11.1) и работает часами.
 *
 * Собирать здесь есть что: на поляне лежат бруски дерева, из которых потом
 * встаёт палатка. Это второе, чему кадр учит, — «здание стоит принесённого»,
 * и учит он этому до лагеря, а не после: лагерь, выросший из ничего, научил
 * бы обратному молчанием. Место палатки сначала выбирают, затем отдельным
 * действием достраивают её из двух брусков. Правило повторяет второй уровень:
 * ради него приходится ещё раз сходить за деревом.
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
import { BUILDING_ORDER, campArea, moveBuilding } from './camp';
import type { BuildingId, CampState } from './camp';
import { distanceField, idx } from './grid';
import { setSupply } from './raid';
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
 * за шестью брусками с возвратом к палатке обязан уложиться в это число без
 * единой секунды отдыха. Замер на 60 сидах: весь пролог 24,5–37,5 с, в среднем
 * 30,4; на нуле не остаётся никто, самому неудачному сиду до палатки хватает
 * с остатком 8, среднему — 18.
 *
 * Пятьдесят четыре, а не сто: запас обязан кончаться у того, кто ходил
 * не туда, иначе отдых у лагеря не случится ни разу и правилом не станет.
 * Было 40 при двух брусках и платном подборе, 50 — пока костёр стоял даром;
 * с его ценой жадному маршруту нужен шестой брусок, и на пятидесяти худший
 * сид доходил до палатки с четырьмя единицами вместо восьми. Поднят провиант,
 * а не темп отдыха: темп задан решением, и крутить его под маршрут значило бы
 * отменять цену промаха.
 */
export const GLADE_FOOD = 54;

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
 * Сколько уходит на костёр. Один брусок, а не ноль: бесплатное здание учит
 * ровно обратному тому, на чём стоит игра. Костёр стоял даром не по решению,
 * а потому, что Кухня и так построена с ур. 1 и ставился один меш, — и кадр
 * молча показывал, что второе здание ничего не стоит.
 *
 * Один, а не два: палатка и костёр вместе обязаны укладываться в сумку
 * (`GLADE_BAG`), иначе за лагерем пришлось бы ходить дважды и приглашение
 * «Разбить лагерь» врало бы о том, что дерева уже хватает.
 */
export const KITCHEN_WOOD = 1;

/** Полный лагерь пролога: палатка и костёр. Ровно сумка — с этим и зовут. */
export const CAMP_WOOD = TENT_WOOD + KITCHEN_WOOD;

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
 * Брусков на поляне. Шесть нужных (палатка, костёр и второй уровень жилья)
 * и два запасных: поляна не обязана вычищаться под ноль. Раньше их лежало
 * ровно два — столько, сколько стоила палатка, — и подсветка учила собирать
 * всё подряд просто потому, что «всё подряд» и было ценой.
 *
 * Стало восемь, когда костёр перестал быть бесплатным: запас в два бруска —
 * решение, а не остаток, и уменьшать его вслед за подорожавшим лагерем
 * значило бы менять правило кадра под арифметику. Разнос при этом измеряется
 * (`prologue.rules.ts`), а не обещается: восемь в том же кольце теснее семи.
 */
export const GLADE_LOGS = 8;

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
 * то же решение, что «вход и точка выхода — одно место» (§12.1) —
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
    // Валунов на поляне нет (§13.4): в первые три минуты жест ровно один,
    // и учит ему кольцо над бруском. Второй предмет, по которому надо
    // стучать, отнимал бы у кольца внимание ради камня, который в прологе
    // некуда потратить.
    stones: [],
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
    setSupply(state, Math.min(state.foodMax, state.food + REST_FOOD));
  }
  return left;
}

/**
 * Поляна в сейве (§16.1): размер и занятые клетки на момент конца пролога,
 * срубленное срублено. Лагерь рисует из них тот же лес, что видел игрок:
 * кадр конца пролога не меняется — меняется только подпись под ним.
 * Шестнадцатеричная строка, четыре клетки в символе: 24×24 — 144 символа.
 */
export interface GladeSnapshot {
  size: number;
  cells: string;
}

export function packGlade(loc: GameLocation): GladeSnapshot {
  let out = '';
  for (let i = 0; i < loc.size * loc.size; i += 4) {
    let n = 0;
    for (let b = 0; b < 4; b++) n |= (loc.blocked[i + b] ? 1 : 0) << b;
    out += n.toString(16);
  }
  return { size: loc.size, cells: out };
}

export function unpackGlade(g: GladeSnapshot): Uint8Array {
  const cells = new Uint8Array(g.size * g.size);
  for (let i = 0; i < cells.length; i += 4) {
    const n = parseInt(g.cells[i >> 2] ?? '0', 16);
    for (let b = 0; b < 4 && i + b < cells.length; b++) cells[i + b] = (n >> b) & 1;
  }
  return cells;
}

/** Почему сюда нельзя поставить здание. 'ok' — можно. */
export type SiteBlock = 'ok' | 'tree' | 'busy' | 'hero';

/**
 * Можно ли ставить здание на клетку. Возвращается причина, а не булево,
 * по той же причине, что и в лагере (`camp.ts`): игрок должен видеть, что
 * мешает, а не молчащий красный квадрат.
 *
 * `cell` — угловая клетка следа, и проверяется след 2×2 целиком: именно
 * эти четыре клетки станут занятыми в лагере (`campBlocked`, маска рутины),
 * и пятно выбора места показывает ровно их. Раньше проверялась одна угловая
 * клетка — здание вставало углом на чистое место, а тремя четвертями следа
 * на дерево, на чужой след или на героя.
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
  for (let dz = 0; dz < 2; dz++) {
    for (let dx = 0; dx < 2; dx++) {
      const x = cell.x + dx;
      const z = cell.z + dz;
      if (x < 0 || z < 0 || x >= size || z >= size) return 'tree';
      if (blocked[idx(size, x, z)]) return 'tree';
    }
  }
  // Чужие следы — тоже 2×2 от своей угловой клетки: пересечение — это
  // разница углов меньше следа по обеим осям.
  if (taken.some((t) => Math.abs(t.x - cell.x) < 2 && Math.abs(t.z - cell.z) < 2)) return 'busy';
  const hx = Math.round(hero.x);
  const hz = Math.round(hero.z);
  if (hx >= cell.x && hx < cell.x + 2 && hz >= cell.z && hz < cell.z + 2) return 'hero';
  return 'ok';
}

/**
 * Клетка под сундук (`chests.ts`) рядом со следом 2×2 палатки.
 *
 * Порядок обхода не случайный: сперва бока и перед (большой z — к камере),
 * задний ряд последним. Камера поляны не крутится, и «за палаткой» значит
 * «под свесом шатра, не видно никогда» — тот же довод, что у `behind`
 * в `residents.ts`. Спрятанная клетка всё равно лучше отказа: сундук
 * держит прибавку к рюкзаку, и потерять его молча нельзя.
 */
export function chestSiteNear(
  loc: GameLocation,
  taken: readonly Cell[],
  hero: Cell,
  cell: Cell,
): Cell | null {
  const ring: readonly [number, number][] = [
    [2, 1], [2, 0], [-1, 1], [-1, 0], // бока — видны всегда
    [0, 2], [1, 2], [2, 2], [-1, 2], // перед, к камере
    [0, -1], [1, -1], [2, -1], [-1, -1], // задний ряд — хуже отказа не бывает
  ];
  const { size, blocked } = loc;
  const hx = Math.round(hero.x);
  const hz = Math.round(hero.z);
  for (const [dx, dz] of ring) {
    const x = cell.x + dx;
    const z = cell.z + dz;
    if (x < 0 || z < 0 || x >= size || z >= size) continue;
    if (blocked[idx(size, x, z)]) continue;
    // Чужой след 2×2 накрывает клетку 1×1, когда та внутри квадрата [t, t+2).
    if (taken.some((t) => x >= t.x && x < t.x + 2 && z >= t.z && z < t.z + 2)) continue;
    if (x === hx && z === hz) continue;
    return { x, z };
  }
  return null;
}

/**
 * Перенос раскладки поляны в лагерь. Клетки не пересчитываются: где игрок
 * разбил палатку, там она и стоит — площадь лагеря (§20.4) подъезжает под
 * постройки якорем (`camp.origin`), а не постройки под площадь. Прежний
 * пересчёт долями (24 → 7) сохранял взаимное расположение, но уносил лагерь
 * в другое место, и открывшийся кадр читался как чужой — тестовый — лагерь.
 *
 * Якорь ищется так, чтобы площадь накрыла все следы 2×2 и осталась в кромке
 * поляны. Если поставленное разнесено шире площади, площадь держит палатку
 * (первое здание порядка), а не влезшее отходит на ближайшее свободное место
 * внутри — расползаться есть куда.
 */
export function adoptGladeLayout(
  camp: CampState,
  gladeSize: number,
  order: readonly BuildingId[],
  pitched: readonly Cell[],
): void {
  if (pitched.length === 0) return;
  const area = campArea(camp.levels.hq);
  const anchor = (axis: 'x' | 'z'): number => {
    const values = pitched.map((c) => c[axis]);
    // Окно якорей, из которых площадь видит все следы целиком.
    let lo = Math.max(...values) + 2 - area;
    let hi = Math.min(...values);
    // Окна нет — площадь держит палатку: остальным найдётся место внутри.
    if (lo > hi) {
      lo = pitched[0]![axis] + 2 - area;
      hi = pitched[0]![axis];
    }
    // Середина окна: стройке потом расти во все стороны, а не упираться в край.
    const mid = Math.round((lo + hi) / 2);
    return Math.max(0, Math.min(gladeSize - area, Math.max(lo, Math.min(hi, mid))));
  };
  const origin = { x: anchor('x'), z: anchor('z') };
  camp.origin = origin;

  const spiral = (place: (x: number, z: number) => boolean, x: number, z: number): void => {
    for (let r = 1; r <= area; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (place(x + dx, z + dz)) return;
        }
      }
    }
  };

  // Сначала — выбранное игроком, клетка в клетку и без суда moveBuilding:
  // чужие следы здесь — раскладка по умолчанию, и она не может отменять
  // выбор игрока. Кто примят площадью — подвинется следом.
  const placed: { x: number; z: number }[] = [];
  const freeOfPlaced = (x: number, z: number): boolean =>
    placed.every((p) => Math.abs(p.x - x) >= 2 || Math.abs(p.z - z) >= 2);
  order.forEach((id, i) => {
    const cell = pitched[i];
    if (cell === undefined) return;
    const put = (x: number, z: number): boolean => {
      if (x < 0 || z < 0 || x + 2 > area || z + 2 > area || !freeOfPlaced(x, z)) return false;
      camp.layout[id] = { x, z };
      placed.push({ x, z });
      return true;
    };
    const x = cell.x - origin.x;
    const z = cell.z - origin.z;
    if (put(x, z)) return;
    // Не влезло (разнесено шире площади или встык к палатке) — ближайшее
    // свободное место от края площади, а не от точки за её пределами:
    // спираль вокруг далёкой клетки не пересекает площадь вовсе.
    const cx = Math.max(0, Math.min(area - 2, x));
    const cz = Math.max(0, Math.min(area - 2, z));
    if (!put(cx, cz)) spiral(put, cx, cz);
  });

  // Теперь построенное вне порядка: раскладка по умолчанию уступает место
  // выбранному. moveBuilding сам знает и про площадь, и про чужие следы —
  // стоящий на своём и никому не мешающий остаётся, остальные отходят.
  for (const other of BUILDING_ORDER) {
    if (order.includes(other) || camp.levels[other] <= 0) continue;
    const p = camp.layout[other];
    if (moveBuilding(camp, other, p.x, p.z)) continue;
    spiral((x, z) => moveBuilding(camp, other, x, z), p.x, p.z);
  }
}
