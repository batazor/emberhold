/**
 * Местность под картой региона (§4.2). Карта до сих пор рисовалась по чёрному:
 * два десятка кружков и паутина тракта висели в пустоте, и «регион» читался
 * как список точек, разложенный по экрану, а не как место, куда идут.
 *
 * Отсюда правило, которое здесь важнее любой красоты: **фон не несёт ни одного
 * канала**. У узла их шесть — форма, цвет кольца, толщина кольца, крест, флаг
 * клана, глиф события, — и артбук `world.html` («Цена канала») закрывает счёт
 * прямо: седьмого не будет. Если бы нагорье значило ярус, а река — дорогу,
 * игрок читал бы карту двумя способами разом и ошибался бы обоими. Поэтому
 * местность говорит ровно одно: здесь есть земля, и она разная.
 *
 * Из того же правила растут все ограничения ниже:
 *
 * - **Ничего не стоит на узле.** Ни река, ни пиктограмма не подходят к точке
 *   ближе `CLEAR`: значок у самого кольца прочитался бы как часть узла — то
 *   есть как седьмой канал, — а река под точкой сказала бы, что место
 *   затоплено, чего в игре нет.
 * - **Местность пересобирается вместе с регионом.** Тот же сид, тот же номер
 *   суток: завтра другой регион, и держать под ним вчерашние холмы значило бы
 *   обещать постоянную географию, которой §4.1 не хочет.
 * - **Ничего не тикает.** Как и весь мир (§4), это чистая функция: ни поля
 *   в сохранении, ни кадра расчёта.
 *
 * Здесь только геометрия — точки, высоты, линии. Цвет живёт в `ui/mapTerrain.ts`
 * рядом с остальной отрисовкой карты.
 */
import { SEED, hash } from './world';

/**
 * Сетка местности. Пятнадцать на десять — не подбор, а следствие размера:
 * карта в лагере занимает около 300×200 точек, ячейка выходит около двадцати
 * пикселей. Крупнее (пробовалось 12×8) земля слипается в пятна и читается
 * камуфляжем, мельче — грани становятся мельче узла и превращаются в шум.
 */
export const COLS = 15;
export const ROWS = 10;

/** Ступеней высоты. Пять полос — столько, сколько различимо на 30vh. */
export const BANDS = 5;

/**
 * Пропорция канваса (3:2): единица `y` короче единицы `x` ровно в полтора раза.
 * Без этого «не ближе 0,07» по вертикали означало бы полтора расстояния
 * по горизонтали, и зазор у точки был бы разным сверху и сбоку.
 */
const ASPECT = 2 / 3;

/**
 * Зазор у точки. У знака он больше, чем у русла, и это не вкус: знак —
 * такой же значок, как глиф события, и рядом с кольцом он читается как часть
 * узла, то есть как седьмой канал. Русло — линия, она проходит мимо и уходит,
 * и ей довольно не наезжать на внешнее кольцо выбора (два радиуса, `r * 2`
 * в `worldMap.ts`, — около 0,052 ширины).
 *
 * Меньший зазор у русла ещё и выполним: между двумя соседними точками бывает
 * коридор в 0,14 ширины, и река с зазором 0,075 в него не проходит вовсе —
 * замер показал это на первый же прогон.
 */
const MARK_CLEAR = 0.075;
const RIVER_CLEAR = 0.055;

/** Пиктограммы не жмутся друг к другу: две рядом читаются как одна большая. */
const MARK_GAP = 0.055;

/** Потолок числа пиктограмм. Больше — и фон начинает спорить с точками. */
const MARK_MAX = 22;

/** Доля ячеек, в которых пробуется пиктограмма (до отсева по зазорам). */
const MARK_SHARE = 0.22;

/** Что нарисовано на клочке земли. Три знака, и ни один ничего не значит. */
export type MarkKind = 'холм' | 'ель' | 'болото';

export interface Vertex {
  readonly x: number;
  readonly y: number;
  /** Высота, приведённая к 0…1 по всей сетке дня. */
  readonly h: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Mark extends Point {
  readonly kind: MarkKind;
  /** Размер в долях ширины карты: знак едет вместе с картой, а не с экраном. */
  readonly size: number;
}

export interface Terrain {
  readonly day: number;
  readonly cols: number;
  readonly rows: number;
  /** Вершины сетки, `(cols + 1) × (rows + 1)`, построчно сверху вниз. */
  readonly grid: readonly Vertex[];
  readonly rivers: readonly (readonly Point[])[];
  readonly marks: readonly Mark[];
}

/** Полоса высоты: 0 — мокрая низина, `BANDS - 1` — голый камень наверху. */
export const bandOf = (h: number): number =>
  Math.max(0, Math.min(BANDS - 1, Math.floor(h * BANDS)));

/** Расстояние в долях **ширины**: по вертикали единица короче (см. `ASPECT`). */
const dist = (a: Point, b: Point): number =>
  Math.hypot(a.x - b.x, (a.y - b.y) * ASPECT);

/** Случайное 0…1 из решётки: тот же FNV, что раздаёт точки региона. */
const lattice = (day: number, salt: number, i: number, j: number): number =>
  (hash(SEED, day, salt, i, j) >>> 8) / 16777216;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Шум значений: билинейная решётка со сглаженным весом. */
function noise(day: number, salt: number, freq: number, x: number, y: number): number {
  const u = x * freq;
  const v = y * freq;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = smooth(u - i);
  const fv = smooth(v - j);
  const a = lattice(day, salt, i, j);
  const b = lattice(day, salt, i + 1, j);
  const c = lattice(day, salt, i, j + 1);
  const d = lattice(day, salt, i + 1, j + 1);
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
}

/**
 * Высота до приведения. Три октавы плюс уклон к низу экрана — и уклон здесь
 * не для красоты: лагерь стоит внизу (`CAMP_SPOT`), и вода, текущая к нему,
 * объясняет, почему лагерь стоит именно там. Ровный шум дал бы реки,
 * упирающиеся в любую сторону, — и лагерь оказывался бы то в болоте,
 * то на гребне.
 */
function raw(day: number, x: number, y: number): number {
  return (
    0.55 * noise(day, 11, 3, x, y) +
    0.3 * noise(day, 12, 6, x, y) +
    0.15 * noise(day, 13, 11, x, y) -
    0.3 * y
  );
}

/** Индекс вершины сетки. */
const at = (i: number, j: number): number => j * (COLS + 1) + i;

/**
 * Местность дня. `spots` — всё, что на карте уже занято: точки региона и
 * лагерь. Передаются снаружи, а не берутся из `regionAt`, ровно затем, чтобы
 * тем же кодом рисовался артбук `world.html`: у страницы своя раскладка
 * из двадцати точек, и местность, обходящая чужие узлы, обходила бы её
 * собственные мимо.
 */
export function terrainAt(day: number, spots: readonly Point[]): Terrain {
  /* ---------- сетка ---------- */

  // Дрожание вершин — чтобы грани не сложились в клетчатое одеяло. На краю
  // его нет: сдвинутая наружу кромка открыла бы под картой чёрную полосу.
  const grid: Vertex[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  const rough: number[] = [];
  for (let j = 0; j <= ROWS; j++) {
    for (let i = 0; i <= COLS; i++) {
      const edgeX = i === 0 || i === COLS;
      const edgeY = j === 0 || j === ROWS;
      const jx = edgeX ? 0 : (lattice(day, 21, i, j) - 0.5) * 0.7;
      const jy = edgeY ? 0 : (lattice(day, 22, i, j) - 0.5) * 0.7;
      const x = (i + jx) / COLS;
      const y = (j + jy) / ROWS;
      const h = raw(day, x, y);
      rough.push(h);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
      grid.push({ x, y, h: 0 });
    }
  }
  // Приведение к 0…1 по дню, а не по абсолютной шкале: иначе день, которому
  // шум выпал ровным, был бы одноцветным пятном без единой грани.
  const span = hi - lo || 1;
  for (let k = 0; k < grid.length; k++) {
    grid[k] = { x: grid[k]!.x, y: grid[k]!.y, h: (rough[k]! - lo) / span };
  }

  /* ---------- реки ---------- */

  const rivers: Point[][] = [];
  const count = 1 + (hash(SEED, day, 31) % 2);
  for (let k = 0; k < count; k++) {
    const river = flow(day, k, grid, spots);
    if (river.length >= 3) rivers.push(river);
  }

  /* ---------- пиктограммы ---------- */

  const marks: Mark[] = [];
  for (let j = 0; j < ROWS && marks.length < MARK_MAX; j++) {
    for (let i = 0; i < COLS && marks.length < MARK_MAX; i++) {
      if (lattice(day, 41, i, j) >= MARK_SHARE) continue;
      const x = (i + 0.2 + lattice(day, 42, i, j) * 0.6) / COLS;
      const y = (j + 0.2 + lattice(day, 43, i, j) * 0.6) / ROWS;
      const p = { x, y };
      if (spots.some((s) => dist(p, s) < MARK_CLEAR)) continue;
      if (marks.some((m) => dist(p, m) < MARK_GAP)) continue;

      const band = bandOf((raw(day, x, y) - lo) / span);
      const wet = rivers.some((r) => r.some((q) => dist(p, q) < 0.085));
      // Болото лежит у воды, ель на склоне, холм наверху. Это не смысл,
      // а согласие знака с землёй под ним: ель, стоящая в реке, читалась бы
      // как ошибка, а ошибку игрок начинает разгадывать.
      let kind: MarkKind;
      if (band <= 1) {
        if (!wet) continue; // сухая низина остаётся пустой: пусто — тоже вид
        kind = 'болото';
      } else if (band === 2) kind = 'ель';
      else kind = 'холм';

      marks.push({ kind, x, y, size: kind === 'холм' ? 0.02 : 0.014 });
    }
  }

  return { day, cols: COLS, rows: ROWS, grid, rivers, marks };
}

/**
 * Река: с высокой вершины вниз, по строке за шаг, каждый раз в самого низкого
 * из трёх соседей снизу. Русло всегда спускается к нижней кромке — туда же,
 * куда уклон местности, и туда же, где стоит лагерь.
 *
 * **Шаг обязан спускаться.** Свободный обход по восьми соседям, стоявший здесь
 * сперва, давал воде ходить вбок и назад, и на четвёртый день она свернулась
 * в узел посреди карты — не река, а росчерк. Заперев шаг на строку вниз,
 * узел получить нельзя вовсе: русло не может пересечь само себя.
 */
function flow(
  day: number,
  k: number,
  grid: readonly Vertex[],
  spots: readonly Point[],
): Point[] {
  // Исток — самая высокая из шести случайных вершин верхней половины карты.
  let si = 1;
  let sj = 0;
  let best = -1;
  for (let n = 0; n < 6; n++) {
    // Не с боковой кромки: оттуда русло цепляется за край и идёт по нему.
    const i = 1 + (hash(SEED, day, k, n, 51) % (COLS - 1));
    const j = hash(SEED, day, k, n, 52) % Math.max(1, Math.floor(ROWS / 2));
    const h = grid[at(i, j)]!.h;
    if (h > best) {
      best = h;
      si = i;
      sj = j;
    }
  }

  const path: Point[] = [];
  let i = si;
  for (let j = sj; j <= ROWS; j++) {
    const v = grid[at(i, j)]!;
    path.push({ x: v.x, y: v.y });
    if (j === ROWS) break;
    let ni = i;
    let low = Infinity;
    for (let di = -1; di <= 1; di++) {
      const x = i + di;
      if (x < 0 || x > COLS) continue;
      const h = grid[at(x, j + 1)]!.h;
      if (h < low) {
        low = h;
        ni = x;
      }
    }
    i = ni;
  }

  // Узлы сильнее рельефа: точка, оказавшаяся под руслом, теряет разом кольцо,
  // крест и флаг — то есть перестаёт быть читаемой.
  return path.map((p) => aside(p, spots));
}

/**
 * Отвести точку русла от занятых мест. Обход ищется перебором по кругу,
 * а не отталкиванием по лучу, и на то две причины, обе найдены замером.
 *
 * Первая: лагерь стоит на `y = 0.9`, зазор считается в долях ширины, и по
 * высоте это `0,08` — радиальный сдвиг увёл бы русло за нижнюю кромку,
 * а обрезка по краю вернула бы его обратно под лагерь.
 *
 * Вторая: точка бывает зажата между двумя узлами, и «оттолкнуться от
 * ближнего» тогда значит въехать в дальнего — так и качается, пока не
 * кончатся проходы. Перебор выбирает место по худшему соседу, а не
 * по ближайшему, и потому сходится.
 */
function aside(p: Point, spots: readonly Point[]): Point {
  let out = p;
  for (let pass = 0; pass < 8; pass++) {
    const near = (q: Point): number => {
      let min = Infinity;
      for (const s of spots) min = Math.min(min, dist(q, s));
      return min;
    };
    let worst: Point | null = null;
    let worstD = RIVER_CLEAR;
    for (const s of spots) {
      const d = dist(out, s);
      if (d < worstD) {
        worstD = d;
        worst = s;
      }
    }
    if (worst === null) break;

    // Двенадцать мест по кольцу вокруг мешающей точки: берётся то, где
    // до ближайшего узла дальше всего, а при равенстве — ближе к исходному
    // руслу, чтобы река не прыгала через полкарты ради зазора.
    const R = RIVER_CLEAR + 0.003;
    let best: Point | null = null;
    let bestScore = near(out);
    let bestShift = Infinity;
    for (let n = 0; n < 12; n++) {
      const a = (n / 12) * Math.PI * 2;
      const q = { x: worst.x + Math.cos(a) * R, y: worst.y + (Math.sin(a) * R) / ASPECT };
      if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) continue;
      const score = near(q);
      const shift = dist(q, out);
      if (score > bestScore + 1e-6 || (score > bestScore - 1e-6 && shift < bestShift)) {
        best = q;
        bestScore = score;
        bestShift = shift;
      }
    }
    if (best === null) break; // лучше уже не станет — русло остаётся как есть
    out = best;
  }
  return out;
}
