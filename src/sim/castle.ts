/**
 * Модель строительства стен и генератор замка на наборе Kenney Castle Kit
 * (§6.1.6). Головой не выдумано ничего: и сетка, и высоты, и то, какой
 * стороной деталь пускает соседа, сняты обмером — `npm run models --
 * --pack=castle` пишет их в каталог набора, а `castle.rules.ts` сверяет
 * с этим каталогом каждое число отсюда.
 *
 * **Модель стройки в одну фразу.** Стена — замкнутая цепь клеток, у каждой
 * ровно два соседа по цепи, и деталь выбирается тем, где эти соседи стоят:
 * напротив — прямая, рядом — угол. Поворот при этом не выбирается вовсе,
 * а выводится: у детали измерено, какие её рёбра открыты под соседа, и
 * поворот — единственная четверть, при которой открытые рёбра смотрят
 * на соседей. Отсюда следствие, ради которого модель и стоило записывать:
 * **новую деталь набора достаточно измерить, чтобы она встала в стройку** —
 * ни выбирать ей поворот, ни описывать её форму словами не нужно.
 *
 * Сетка модуля тоже измерена, а не назначена: клетка — единица, этаж — 1,01,
 * ход поверху — 1,18, верх стены — 1,31. Стена набора — не панель на ребре
 * клетки, а сплошной блок в клетку: по ней ходят поверху, и потому у неё
 * есть зубцы и есть проход.
 *
 * Файл живёт в `sim/`, а не в `render/`, намеренно: генератор — это числа,
 * а не картинка. Он не знает ни про three, ни про DOM, гоняется в Node
 * и проверяется правилами; страница артбука (`castleart.html`) берёт у него
 * список деталей и рисует его сама.
 */
import { mulberry32, randInt, type Rng } from '../core/rng';

/* ---------- сетка ---------- */

/** Клетка плана. */
export interface Spot {
  readonly x: number;
  readonly z: number;
}

/**
 * Направления в том же порядке, в каком обмер пишет открытые рёбра детали:
 * −x, +x, −z, +z. Порядок — контракт с `catalog.json`, и его стережёт правило.
 */
export const DIRS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Куда уезжает направление за одну четверть поворота вокруг вертикали.
 * Поворот на +90° переводит точку (x, z) в (z, −x), отсюда и таблица:
 * −x → +z → +x → −z → −x.
 */
const QUARTER: readonly number[] = [3, 2, 0, 1];

/** Направление после `turn` четвертей. */
export function turnDir(dir: number, turn: number): number {
  let at = dir;
  for (let i = 0; i < ((turn % 4) + 4) % 4; i++) at = QUARTER[at]!;
  return at;
}

/* ---------- деталь ---------- */

/**
 * Деталь набора в терминах стройки: имя модели и то, какие рёбра клетки она
 * оставляет открытыми. Оба поля — из каталога, оба сверяются правилом.
 */
export interface Part {
  readonly model: string;
  /** Открытые рёбра в порядке DIRS. */
  readonly open: readonly boolean[];
}

const part = (model: string, ...open: readonly number[]): Part => ({
  model,
  open: DIRS.map((_, i) => open.includes(i)),
});

/**
 * Прямые участки. Две детали на одну роль — не украшение: без чередования
 * стена выходит гребёнкой из одинаковых зубцов, и глаз читает её как текстуру,
 * а не как постройку.
 */
export const STRAIGHT: readonly Part[] = [part('wall', 2, 3), part('wall-pillar', 2, 3)];

/**
 * Углы. Три варианта, и один из них — угол с круглой башенкой; он занимает
 * полторы клетки, вылезая наружу, и это ровно то, для чего он нарисован.
 * Открытые рёбра у него другие, чем у простого угла, и поворот из-за этого
 * получается другим — но искать его всё равно не приходится, он выводится.
 */
export const CORNER: readonly Part[] = [
  part('wall-corner', 0, 3),
  part('wall-corner-slant', 0, 3),
  part('wall-corner-half-tower', 1, 3),
];

/** Лестница со двора на стену: ход у неё выходит одним ребром, −z. */
export const STAIRS = part('wall-narrow-stairs', 2);

/* ---------- высоты ---------- */

/**
 * Высоты набора в его же единицах. Все три измерены, ни одна не назначена:
 * этаж — высота яруса башни, ход — высота площадки под зубцами, верх — самая
 * высокая точка стены. Парапет — их разность, 0,13, и он тут не нужен: ярусы
 * складываются по этажу.
 */
export const FLOOR = 1.01;
export const WALK = 1.18;
export const WALL_TOP = 1.31;

/* ---------- поставленная деталь ---------- */

export interface Piece {
  readonly model: string;
  readonly x: number;
  readonly z: number;
  /** Ярус в единицах набора. */
  readonly y: number;
  /** Четверти поворота вокруг вертикали, 0..3. */
  readonly turn: number;
  /** Зачем деталь стоит: стена, угол, ворота, башня, лестница, знамя. */
  readonly role: Role;
}

export type Role = 'стена' | 'угол' | 'ворота' | 'башня' | 'лестница' | 'знамя' | 'двор';

export interface Castle {
  readonly seed: number;
  readonly width: number;
  readonly depth: number;
  /** Стены в порядке обхода: соседи по списку — соседи по сетке. */
  readonly ring: readonly Spot[];
  readonly yard: readonly Spot[];
  readonly gate: Spot;
  /** Углы, которым достался угол с башенкой. */
  readonly towers: readonly Spot[];
  readonly pieces: readonly Piece[];
}

/**
 * Поворот, при котором открытые рёбра детали смотрят ровно на соседей.
 * Возвращает −1, если такой четверти нет: деталь не той формы, и это
 * не повод её вертеть — это повод её не ставить.
 */
export function fitTurn(open: readonly boolean[], want: readonly number[]): number {
  for (let turn = 0; turn < 4; turn++) {
    let ok = true;
    for (let dir = 0; dir < 4; dir++) {
      const opened = open[dir] === true;
      if (opened !== want.includes(turnDir(dir, turn))) {
        ok = false;
        break;
      }
    }
    if (ok) return turn;
  }
  return -1;
}

/* ---------- план ---------- */

const at = (w: number, x: number, z: number): number => z * w + x;

/**
 * Стены — клетки участка, у которых есть сосед снаружи **по восьми**
 * направлениям, а не по четырём. Разница не косметическая: у плана
 * с вырезанным углом внутренний угол стены соприкасается с наружным
 * по диагонали, и по четырём направлениям цепь там рвётся.
 */
function wallMask(w: number, d: number, inside: Uint8Array): Uint8Array {
  const wall = new Uint8Array(w * d);
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      if (!inside[at(w, x, z)]) continue;
      let edge = false;
      for (let dz = -1; dz <= 1 && !edge; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= d || !inside[at(w, nx, nz)]) {
            edge = true;
            break;
          }
        }
      }
      if (edge) wall[at(w, x, z)] = 1;
    }
  }
  return wall;
}

/** Соседи клетки по цепи стен. */
function ringNeighbors(w: number, d: number, wall: Uint8Array, x: number, z: number): number[] {
  const out: number[] = [];
  for (let dir = 0; dir < 4; dir++) {
    const nx = x + DIRS[dir]![0];
    const nz = z + DIRS[dir]![1];
    if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
    if (wall[at(w, nx, nz)]) out.push(dir);
  }
  return out;
}

/**
 * Цепь замкнута и проста: у каждой клетки стены ровно два соседа, и обход
 * из любой клетки возвращается в неё, обойдя все. Проверяется здесь же,
 * потому что вырез угла способен разорвать цепь, и тогда вырез отменяется,
 * а не чинится.
 */
function walkRing(w: number, d: number, wall: Uint8Array): Spot[] | null {
  const cells: Spot[] = [];
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) if (wall[at(w, x, z)]) cells.push({ x, z });
  }
  if (cells.length < 8) return null;
  for (const c of cells) {
    if (ringNeighbors(w, d, wall, c.x, c.z).length !== 2) return null;
  }

  const ring: Spot[] = [cells[0]!];
  const seen = new Set<number>([at(w, cells[0]!.x, cells[0]!.z)]);
  for (;;) {
    const cur = ring[ring.length - 1]!;
    let moved = false;
    for (const dir of ringNeighbors(w, d, wall, cur.x, cur.z)) {
      const nx = cur.x + DIRS[dir]![0];
      const nz = cur.z + DIRS[dir]![1];
      if (seen.has(at(w, nx, nz))) continue;
      ring.push({ x: nx, z: nz });
      seen.add(at(w, nx, nz));
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return ring.length === cells.length ? ring : null;
}

/** Клетки участка, которые не стена, — двор. */
function yardOf(w: number, d: number, inside: Uint8Array, wall: Uint8Array): Spot[] {
  const out: Spot[] = [];
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) if (inside[at(w, x, z)] && !wall[at(w, x, z)]) out.push({ x, z });
  }
  return out;
}

/**
 * Двор односвязен: из любой его клетки достижима любая другая, не выходя
 * из двора. Проверка не косметическая — она ловит **перемычку**: два выреза
 * с одной стороны способны оставить между собой полосу шириной в клетку,
 * и тогда вся полоса становится стеной, а двор распадается надвое. Кольцо
 * при этом остаётся честным кольцом, и по нему такой замок не отличить
 * от нормального.
 */
function yardWhole(w: number, yard: readonly Spot[]): boolean {
  if (yard.length === 0) return false;
  const inYard = new Set(yard.map((s) => at(w, s.x, s.z)));
  const seen = new Set<number>([at(w, yard[0]!.x, yard[0]!.z)]);
  const queue: Spot[] = [yard[0]!];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const [dx, dz] of DIRS) {
      const key = at(w, cur.x + dx, cur.z + dz);
      if (!inYard.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push({ x: cur.x + dx, z: cur.z + dz });
    }
  }
  return seen.size === yard.length;
}

/**
 * Участок: прямоугольник, у которого сид вырезает до двух углов. Вырез —
 * единственный источник непрямых планов, и он же единственное место, где
 * генератор умеет отказаться: если после выреза цепь стен перестаёт быть
 * цепью или двор распадается надвое, вырез просто не применяется.
 */
function plan(
  rng: Rng,
  w: number,
  d: number,
): { inside: Uint8Array; wall: Uint8Array; ring: Spot[]; yard: Spot[] } {
  const inside = new Uint8Array(w * d).fill(1);
  let wall = wallMask(w, d, inside);
  let ring = walkRing(w, d, wall)!;
  let yard = yardOf(w, d, inside, wall);

  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const;
  const cuts = randInt(rng, 3);
  const used = new Set<number>();
  for (let i = 0; i < cuts; i++) {
    const which = randInt(rng, 4);
    if (used.has(which)) continue;
    used.add(which);
    const cw = 2 + randInt(rng, 2);
    const cd = 2 + randInt(rng, 2);
    // Вырез не имеет права съесть сторону целиком: три клетки прямого участка —
    // это минимум, на котором стена ещё читается стеной, а не углом.
    if (w - cw < 3 || d - cd < 3) continue;
    const [fx, fz] = corners[which]!;
    const next = Uint8Array.from(inside);
    for (let z = 0; z < cd; z++) {
      for (let x = 0; x < cw; x++) {
        next[at(w, fx ? w - 1 - x : x, fz ? d - 1 - z : z)] = 0;
      }
    }
    const nextWall = wallMask(w, d, next);
    const nextRing = walkRing(w, d, nextWall);
    if (nextRing === null) continue;
    const nextYard = yardOf(w, d, next, nextWall);
    if (!yardWhole(w, nextYard)) continue;
    inside.set(next);
    wall = nextWall;
    ring = nextRing;
    yard = nextYard;
  }
  return { inside, wall, ring, yard };
}

/* ---------- сборка ---------- */

/**
 * Замок по сиду. Один и тот же сид даёт один и тот же список деталей —
 * на этом держится и правило, и страница артбука, которая показывает
 * не «пример», а конкретный номер.
 */
export function generateCastle(seed: number): Castle {
  const rng = mulberry32(seed);
  const width = 6 + randInt(rng, 4);
  const depth = 6 + randInt(rng, 4);
  const { wall, ring, yard } = plan(rng, width, depth);

  const pieces: Piece[] = [];
  const towers: Spot[] = [];
  const kind = new Map<number, 'прямая' | 'угол'>();

  for (const spot of ring) {
    const want = ringNeighbors(width, depth, wall, spot.x, spot.z);
    const straight = want.length === 2 && DIRS[want[0]!]![0] === -DIRS[want[1]!]![0]
      && DIRS[want[0]!]![1] === -DIRS[want[1]!]![1];
    kind.set(at(width, spot.x, spot.z), straight ? 'прямая' : 'угол');

    // Прямая через каждые несколько клеток берёт контрфорс, угол — башенку.
    // Оба выбора делает сид, но ни один не решает поворот.
    const bag = straight ? STRAIGHT : CORNER;
    const choice = straight
      ? bag[rng() < 0.28 ? 1 : 0]!
      : bag[randInt(rng, bag.length)]!;
    const turn = fitTurn(choice.open, want);
    if (turn < 0) continue;
    if (choice.model === 'wall-corner-half-tower') towers.push(spot);
    pieces.push({
      model: choice.model,
      x: spot.x,
      z: spot.z,
      y: 0,
      turn,
      role: straight ? 'стена' : 'угол',
    });
  }

  /* ---------- ворота ---------- */

  // Ворота встают только там, где стена прямая и соседи её тоже прямые:
  // арка в углу упёрлась бы в поворот хода.
  const open = ring.filter((s, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length]!;
    const next = ring[(i + 1) % ring.length]!;
    return [s, prev, next].every((c) => kind.get(at(width, c.x, c.z)) === 'прямая');
  });
  const gate = open.length > 0 ? open[randInt(rng, open.length)]! : ring[0]!;
  const gateDirs = ringNeighbors(width, depth, wall, gate.x, gate.z);
  // Створка перекрывает проезд, а он идёт поперёк стены: если стена тянется
  // вдоль z, ехать через неё можно только вдоль x.
  const alongZ = gateDirs.includes(2);
  for (let i = pieces.length - 1; i >= 0; i--) {
    if (pieces[i]!.x === gate.x && pieces[i]!.z === gate.z) pieces.splice(i, 1);
  }
  pieces.push({ model: 'tower-square-arch', x: gate.x, z: gate.z, y: 0, turn: 0, role: 'ворота' });
  pieces.push({ model: 'gate', x: gate.x, z: gate.z, y: 0, turn: alongZ ? 0 : 1, role: 'ворота' });
  pieces.push({ model: 'tower-square-top', x: gate.x, z: gate.z, y: FLOOR, turn: 0, role: 'ворота' });

  /* ---------- двор ---------- */

  // Двор мостится плитой набора — двумя треугольниками на клетку. Без неё
  // замок висит в пустоте: стены есть, а земли под ними нет, и кадр читается
  // не постройкой, а набором деталей.
  for (const spot of yard) {
    pieces.push({ model: 'ground', x: spot.x, z: spot.z, y: 0, turn: 0, role: 'двор' });
  }

  // Лестница: клетка двора у прямой стены, ход выходит к этой стене.
  const landings = yard.filter((s) =>
    DIRS.some((dir) => {
      const nx = s.x + dir[0];
      const nz = s.z + dir[1];
      return (
        nx >= 0 && nz >= 0 && nx < width && nz < depth
        && wall[at(width, nx, nz)]
        && kind.get(at(width, nx, nz)) === 'прямая'
        && !(nx === gate.x && nz === gate.z)
      );
    }),
  );
  if (landings.length > 0) {
    const spot = landings[randInt(rng, landings.length)]!;
    const toWall = DIRS.findIndex((dir) => {
      const nx = spot.x + dir[0];
      const nz = spot.z + dir[1];
      return nx >= 0 && nz >= 0 && nx < width && nz < depth && wall[at(width, nx, nz)];
    });
    const turn = fitTurn(STAIRS.open, [toWall]);
    if (turn >= 0) {
      pieces.push({ model: STAIRS.model, x: spot.x, z: spot.z, y: 0, turn, role: 'лестница' });
    }
  }

  /* ---------- донжон ---------- */

  // Башня во дворе, а не в кольце: башня глухая со всех сторон — это измерено, —
  // и, встав в кольцо, она разорвала бы ход поверху.
  const keep = yard.length > 0
    ? yard.reduce((best, s) => {
      const score = (c: Spot): number => Math.abs(c.x - (width - 1) / 2) + Math.abs(c.z - (depth - 1) / 2);
      return score(s) < score(best) ? s : best;
    }, yard[0]!)
    : null;
  if (keep !== null) {
    const floors = 2 + randInt(rng, 2);
    const body = ['tower-square-mid', 'tower-square-mid-windows', 'tower-square-mid-door'];
    pieces.push({ model: 'tower-square-base', x: keep.x, z: keep.z, y: 0, turn: 0, role: 'башня' });
    for (let i = 1; i < floors; i++) {
      pieces.push({
        model: body[randInt(rng, body.length)]!,
        x: keep.x,
        z: keep.z,
        y: FLOOR * i,
        turn: randInt(rng, 4),
        role: 'башня',
      });
    }
    const roof = ['tower-square-top-roof', 'tower-square-top-roof-high', 'tower-square-top-roof-rounded'];
    pieces.push({
      model: roof[randInt(rng, roof.length)]!,
      x: keep.x,
      z: keep.z,
      y: FLOOR * floors,
      turn: 0,
      role: 'башня',
    });
    pieces.push({
      model: 'flag',
      x: keep.x,
      z: keep.z,
      y: FLOOR * floors,
      turn: randInt(rng, 4),
      role: 'знамя',
    });
  }

  // Знамёна на угловых башенках — на высоте верха стены, а не крыши: у угла
  // с башенкой крыши нет вовсе.
  for (const spot of towers) {
    pieces.push({ model: 'flag-pennant', x: spot.x, z: spot.z, y: WALL_TOP, turn: 0, role: 'знамя' });
  }

  return { seed, width, depth, ring, yard, gate, towers, pieces };
}
