/**
 * Рутина жильцов лагеря: видимая работа, которая ничего не платит.
 *
 * До неё жильцы сидели у костра с инструментом в руке, и строка карточки
 * «носит дерево» оставалась строкой: носил он его только в невидимой
 * бухгалтерии отлучки (`residents.ts`). Рутина делает то, что уже записано,
 * видимым — и **ровно ничего больше**: она не добывает ни бруска и не тратит
 * ни секунды чужого времени. Экономика жильца целиком остаётся в `workDone`
 * с его потолком (§20.3, отставание от игрока минимум в сто раз), и любой
 * ресурс, появившийся из этого модуля, был бы второй зарплатой за ту же
 * работу. Поэтому здесь нет ни рюкзака, ни склада — только дорога, стоянки
 * и лицо, повёрнутое к делу.
 *
 * **Кадр — функция времени**, как обходы двора (`garrison.ts`): один маршрут
 * и одно `t` дают одно положение, сколько бы раз их ни спросили. На этом
 * держится и отладочная перемотка, и правило-тесты, которым не нужен рендер.
 *
 * **Кто работает — решает та же экономика.** Отдыхающий сидит у костра
 * (приказ «отдыхать» — это отложенный инструмент), безкрышный сидит тоже:
 * `workDone` не начисляет ему ничего, и жилец, бодро таскающий брёвна без
 * прибавки на складе, обещал бы то, чего не происходит. Рутина видна ровно
 * у тех, у кого идёт невидимая работа.
 *
 * **Куда ходят.** Носящий дерево — к кромке леса: она не кончается (§13.3),
 * и его дерево никогда не упадёт — рубка настоящая только у игрока. Носящий
 * камень — вдоль кромки: камень внизу (§13.4), на поляне его нет, и махать
 * киркой тут не по чему — он ходит с ношей, как и назван. Оба возвращаются
 * к костру: склада в кадре поляны нет, а огонь — то место, которое лагерь
 * читает домом.
 */
import { DWELLER_SPEED } from './garrison';
import { findPath } from './pathfinding';
import { keepApart } from './crowd';
import type { Body } from './crowd';
import { idx } from './grid';
import { mulberry32, randInt } from '../core/rng';
import type { Cell } from './types';
import type { Resident } from './residents';

/**
 * Стоянка у костра: сгрузил и перевёл дух. Короче рабочей — дом на этом
 * маршруте не цель, а разворот.
 */
export const UNLOAD_PAUSE = 4;

/**
 * Стоянка у дерева — столько носящий дерево машет топором. Двадцать секунд
 * против четырёх у костра: рутина обязана читаться работой с отлучками
 * домой, а не прогулкой с остановками, — та же пропорция, что у ремесленника
 * двора (`CRAFT_REST` против `DWELLER_STAND`).
 */
export const CHOP_PAUSE = 20;

/**
 * Стоянка носящего камень у кромки. Вдвое короче рубки: его работа — дорога
 * (он «ходит вниз»), и стоять ему положено меньше, чем ходить.
 */
export const LOOK_PAUSE = 8;

/** Врозь — минимум клеток между рабочими точками двух жильцов: у каждого
 *  своё дерево. Меньше двух — и двое рубят один ствол с двух сторон. */
const APART = 3;

/** Остановка маршрута: где, сколько, куда смотреть и работа ли это. */
interface Stop {
  /** Индекс вершины `path`. */
  readonly at: number;
  readonly pause: number;
  /** Куда смотреть, пока стоит; null — куда пришёл. */
  readonly facing: number | null;
  /** Рабочая стоянка: рендер играет труд, а не покой. */
  readonly working: boolean;
}

/** Маршрут одного жильца: замкнутая ломаная со стоянками, как `YardWalk`. */
export interface Chore {
  readonly path: readonly Cell[];
  readonly stops: readonly Stop[];
  /** Полный круг в секундах — ход плюс все стоянки. */
  readonly cycle: number;
  /** Сдвиг начала: жильцы вышли не строем, а кто когда. */
  readonly phase: number;
}

/** Где жилец на момент `t`: рендеру хватает этих пяти чисел. */
export interface ChoreFrame extends Body {
  readonly facing: number;
  readonly walking: boolean;
  readonly working: boolean;
}

/**
 * Площадка рутины. Маска проходимости приходит готовой — лес поляны вместе
 * со следами построек, — потому что «что стоит на площадке» знает сцена,
 * а не этот модуль: ему важно лишь, где пройти нельзя.
 */
export interface ChoreSite {
  readonly size: number;
  readonly blocked: Uint8Array;
  /** Клетка костра: дом маршрута. */
  readonly fire: Cell;
  readonly seed: number;
}

/**
 * Клетки, с которых достают до леса: проходимая рядом с занятой. Кромка
 * предпочтительнее нутра — её деревья не кончаются, и рубящий у кромки
 * не спорит с игроком за конкретный ствол, — поэтому кандидаты с рамки
 * идут первыми, а внутренние берутся только когда до рамки не добраться.
 */
function treeSpots(site: ChoreSite): { spot: Cell; tree: Cell }[] {
  const { size, blocked } = site;
  const rim: { spot: Cell; tree: Cell }[] = [];
  const inner: { spot: Cell; tree: Cell }[] = [];
  for (let z = 1; z < size - 1; z++) {
    for (let x = 1; x < size - 1; x++) {
      if (blocked[idx(size, x, z)]) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const tx = x + dx;
        const tz = z + dz;
        if (!blocked[idx(size, tx, tz)]) continue;
        const edge = tx <= 0 || tz <= 0 || tx >= size - 1 || tz >= size - 1;
        (edge ? rim : inner).push({ spot: { x, z }, tree: { x: tx, z: tz } });
        break;
      }
    }
  }
  return rim.length > 0 ? rim : inner;
}

/** Расстояние по прямой между клетками — для «врозь» и «поближе». */
const dist = (a: Cell, b: Cell): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Точка выхода: свободная клетка возле костра. У каждого своя — двое,
 * выходящие с одной, разводились бы телами каждый круг на одном месте.
 */
function baseSpot(site: ChoreSite, rng: () => number, taken: Cell[]): Cell | null {
  const { size, blocked, fire } = site;
  const ring: Cell[] = [];
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      const r = Math.hypot(dx, dz);
      if (r < 1.5 || r > 3.5) continue;
      const x = fire.x + dx;
      const z = fire.z + dz;
      if (x <= 0 || z <= 0 || x >= size - 1 || z >= size - 1) continue;
      if (blocked[idx(size, x, z)]) continue;
      if (taken.some((c) => dist(c, { x, z }) < 1.5)) continue;
      ring.push({ x, z });
    }
  }
  return ring.length === 0 ? null : ring[randInt(rng, ring.length)]!;
}

/** Ломаная из отрезков `findPath` с длиной; null — какой-то ноги не нашлось. */
function ringOf(
  site: ChoreSite,
  corners: readonly Cell[],
): { path: Cell[]; ends: number[]; length: number } | null {
  const path: Cell[] = [{ ...corners[0]! }];
  const ends: number[] = [];
  for (let c = 0; c < corners.length; c++) {
    const leg = findPath(site.size, site.blocked, corners[c]!, corners[(c + 1) % corners.length]!);
    if (leg.length === 0) return null;
    path.push(...leg.map((s) => ({ x: s.x, z: s.z })));
    ends.push(path.length - 1);
  }
  // Кольцо кончается, где началось: последняя клетка совпадает с первой.
  path.pop();
  let length = 0;
  for (let k = 0; k < path.length; k++) {
    const a = path[k]!;
    const b = path[(k + 1) % path.length]!;
    length += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return { path, ends: ends.map((v) => v % path.length), length };
}

/** Куда смотреть из `from` на `to` — в радианах игры (atan2 по x/z). */
const faceTo = (from: Cell, to: Cell): number => Math.atan2(to.x - from.x, to.z - from.z);

/**
 * Маршруты жильцов. По одному на каждого, в порядке списка; null — этот
 * сидит у костра: отдыхает, без крыши или до его дела не дойти.
 *
 * `roofed` приходит снаружи по той же причине, что маска: кто под крышей,
 * считает жильё (`residents.ts`), и вторая копия этого счёта разошлась бы
 * с первой молча.
 */
export function choresOf(
  site: ChoreSite,
  residents: readonly Resident[],
  roofed: (i: number) => boolean,
): (Chore | null)[] {
  const spots = treeSpots(site);
  const takenWork: Cell[] = [];
  const takenBase: Cell[] = [];

  return residents.map((r, i) => {
    if (r.rest || !roofed(i)) return null;
    // Сид маршрута — сид лица: тот же человек ходит той же дорогой,
    // и после перезахода в лагерь его не подменяет двойник с другой тропой.
    const rng = mulberry32((r.seed ^ site.seed ^ 0xc40e) | 0);
    const base = baseSpot(site, rng, takenBase);
    if (base === null) return null;

    // Рабочие точки: ближние к дому предпочтительнее — носильщик ходит
    // по делу, а не через всю поляну, — но выбор качается сидом, чтобы
    // двое не вставали к одному дереву. «Врозь» отпускается, когда точек
    // мало: пусть двое рубят рядом, чем один сидит без дела.
    const near = [...spots].sort((a, b) => dist(a.spot, base) - dist(b.spot, base));
    const pool = near.slice(0, Math.max(8, near.length / 4));
    const pickSpot = (away: readonly Cell[], tries: number): { spot: Cell; tree: Cell } | null => {
      for (let k = 0; k < tries; k++) {
        const cand = pool[randInt(rng, pool.length)];
        if (cand === undefined) return null;
        if (away.every((c) => dist(c, cand.spot) >= APART)) return cand;
      }
      return pool[randInt(rng, pool.length)] ?? null;
    };

    let built: Chore | null = null;
    if (r.answer === 'строим') {
      const work = pickSpot(takenWork, 24);
      if (work !== null) {
        const ring = ringOf(site, [base, work.spot]);
        if (ring !== null) {
          const [toWork, home] = ring.ends;
          built = {
            path: ring.path,
            stops: [
              // У дерева — работа лицом к стволу; дома — передышка лицом к огню.
              { at: toWork!, pause: CHOP_PAUSE, facing: faceTo(work.spot, work.tree), working: true },
              { at: home!, pause: UNLOAD_PAUSE, facing: faceTo(base, site.fire), working: false },
            ],
            cycle: ring.length / DWELLER_SPEED + CHOP_PAUSE + UNLOAD_PAUSE,
            phase: 0,
          };
          takenWork.push(work.spot);
        }
      }
    } else {
      // Носящий камень: два угла кромки и дом. Смотрит со стоянки в лес —
      // туда, где его дорога вниз; кирка остаётся на плече.
      const first = pickSpot(takenWork, 24);
      const second = first === null ? null : pickSpot([...takenWork, first.spot], 24);
      if (first !== null && second !== null) {
        const ring = ringOf(site, [base, first.spot, second.spot]);
        if (ring !== null) {
          const [toFirst, toSecond, home] = ring.ends;
          built = {
            path: ring.path,
            stops: [
              { at: toFirst!, pause: LOOK_PAUSE, facing: faceTo(first.spot, first.tree), working: false },
              { at: toSecond!, pause: LOOK_PAUSE, facing: faceTo(second.spot, second.tree), working: false },
              { at: home!, pause: UNLOAD_PAUSE, facing: faceTo(base, site.fire), working: false },
            ],
            cycle: ring.length / DWELLER_SPEED + LOOK_PAUSE * 2 + UNLOAD_PAUSE,
            phase: 0,
          };
          takenWork.push(first.spot, second.spot);
        }
      }
    }
    if (built === null) return null;
    takenBase.push(base);
    // Фаза своя у каждого: вышедшие строем читались бы конвейером, а не
    // жизнью, — то же решение, что фаза шага у гарнизона.
    return { ...built, phase: rng() * built.cycle };
  });
}

/**
 * Где жилец на момент `t`. Устройство — `walkYard` до буквы: остаток времени
 * в круге съедается отрезками хода и стоянками, и первый недоеденный отрезок
 * называет положение.
 */
export function choreAt(c: Chore, t: number): ChoreFrame {
  let left = c.cycle <= 0 ? 0 : (((t + c.phase) % c.cycle) + c.cycle) % c.cycle;
  for (let i = 0; i < c.path.length; i++) {
    const from = c.path[i]!;
    const to = c.path[(i + 1) % c.path.length]!;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const span = Math.hypot(dx, dz);
    const walk = span / DWELLER_SPEED;
    const facing = Math.atan2(dx, dz);
    if (left < walk) {
      const share = span === 0 ? 0 : left / walk;
      return {
        x: from.x + dx * share,
        z: from.z + dz * share,
        facing,
        walking: true,
        working: false,
      };
    }
    left -= walk;
    const next = (i + 1) % c.path.length;
    const stop = c.stops.find((s) => s.at === next);
    if (stop !== undefined) {
      if (left < stop.pause) {
        return {
          x: to.x,
          z: to.z,
          facing: stop.facing ?? facing,
          walking: false,
          working: stop.working,
        };
      }
      left -= stop.pause;
    }
  }
  // Сюда не приходят: сумма отрезков и стоянок и есть цикл. Но вернуть
  // дом честнее, чем ничего.
  const home = c.path[0]!;
  return { x: home.x, z: home.z, facing: 0, walking: false, working: false };
}

/**
 * Кадр рутины целиком: все идущие разом, разведённые телами. Сидящие
 * и герой приходят снаружи неподвижными точками — идущий обходит их,
 * а не толкает: у сидящего нет ног, чтобы отойти в ответ.
 */
export function choresAt(
  chores: readonly (Chore | null)[],
  t: number,
  pinned: readonly Body[],
  free?: (x: number, z: number) => boolean,
): (ChoreFrame | null)[] {
  const frames = chores.map((c) => (c === null ? null : choreAt(c, t)));
  const moving: ChoreFrame[] = frames.filter((f): f is ChoreFrame => f !== null);
  const bodies: Body[] = [...moving, ...pinned.map((p) => ({ x: p.x, z: p.z }))];
  const fixed = (i: number): boolean => i >= moving.length;
  keepApart(bodies, free === undefined ? { fixed } : { fixed, free });
  return frames;
}
