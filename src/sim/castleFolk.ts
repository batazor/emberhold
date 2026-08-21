/**
 * Жители замка (§6.1.6). Замок до сих пор был постройкой, по которой только
 * ходят: ни добычи, ни противников, ни кого бы то ни было ещё. Кладбище своё
 * население получило раньше (§6.1.7) и показало, чем населённое место
 * отличается от пустого, — замок получает своё здесь.
 *
 * Три решения, на которых всё держится.
 *
 * 1. **Житель — не противник.** У `Enemy` есть раны, замах и откат, и всякий,
 *    кто попадёт в `loc.enemies`, будет разбужен сближением и вступит в бой
 *    (`raid.ts`). Замок — прогулка, драться в нём не с кем, поэтому житель
 *    живёт отдельным списком на площадке, рядом с деревьями и воротами,
 *    а `GameLocation` о нём не знает вовсе. Общая с вылазкой запись не должна
 *    носить в себе то, чего в вылазке не бывает.
 *
 * 2. **Житель не занимает клетку.** Он движется, а занятая движущаяся клетка
 *    заставила бы пересчитывать путь героя посреди хода — и «путь назад»
 *    (§11.1) перестал бы быть числом, которому можно верить. Разойтись
 *    с жителем можно ровно так же, как с привидением: пройдя сквозь.
 *
 * 3. **Маршрут считается один раз, при генерации.** В шаге случайности нет
 *    и быть не может — это стережёт `npm run arch` (§6, воспроизводимость).
 *    Точки обхода выпадают по сиду, соединяются тем же `findPath`, которым
 *    ходит герой, кольцо замыкается — дальше житель просто идёт по списку,
 *    и один сид даёт один и тот же замок с теми же жителями весь день (§4).
 *
 * Торговли и заданий здесь нет: житель ничего не продаёт и ничего
 * не поручает. Это объявленное состояние, а не забытый шаг.
 */
import { mulberry32, randInt, type Rng } from '../core/rng';
import { CASTLE_CELL, type Castle, type Spot } from './castle';
import { idx } from './grid';
import { findPath } from './pathfinding';
import type { Cell } from './types';

/**
 * Облик жителя. Три модели набора KayKit Adventurers (§6.1.4), и различает
 * их снаряжение, а не порода — то же правило, по которому различаются
 * скелеты (§15).
 *
 * ВРЕМЕННОЕ, §0.1: это рабочие подписи к моделям набора, а не имена мира.
 * Лора за ними нет, менять их можно свободно и не обсуждая.
 */
export type FolkLook = 'рыцарь' | 'маг' | 'плут';

export const FOLK_LOOKS: readonly FolkLook[] = ['рыцарь', 'маг', 'плут'];

/**
 * Шаг жителя — заметно медленнее героя (1,67 тайла/с, §17.4). Он никуда
 * не идёт: он живёт здесь. Житель, шагающий вровень с героем, читался бы
 * как догоняющий, а догонять в замке некому и незачем.
 */
export const FOLK_SPEED = 0.85;

/** Сколько житель стоит на углу обхода. Ровно затем, чтобы стоящего было
 *  видно стоящим: обход без остановок — конвейер, а не жизнь двора. */
export const FOLK_PAUSE = 2.4;

/** Свободных клеток двора на одного жителя. Как и привидения на кладбище,
 *  жители считаются плотностью, а не числом: двор замка выпадает разный. */
const FOLK_TILES = 34;
const FOLK_MIN = 2;
const FOLK_MAX = 5;

/** Углов у обхода. Два дали бы хождение по отрезку туда-обратно, четыре
 *  на малом дворе не находят места друг от друга. */
const CORNERS = 3;

export interface Folk {
  readonly id: number;
  readonly look: FolkLook;
  /** Замкнутый обход по клеткам локации. Пустой — житель стоит на месте. */
  readonly route: readonly Cell[];
  /** Индексы точек обхода, на которых житель останавливается постоять. */
  readonly stops: readonly number[];
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  facing: number;
  /** К какой точке обхода идём. */
  at: number;
  /** Сколько секунд ещё стоять. 0 — идёт. */
  wait: number;
}

/** Клетки двора в клетках локации: клетка плана — `CASTLE_CELL` клеток. */
function yardTiles(castle: Castle, at: Spot, size: number, blocked: Uint8Array): Cell[] {
  const out: Cell[] = [];
  for (const spot of castle.yard) {
    const base = { x: at.x + spot.x * CASTLE_CELL, z: at.z + spot.z * CASTLE_CELL };
    for (let dz = 0; dz < CASTLE_CELL; dz++) {
      for (let dx = 0; dx < CASTLE_CELL; dx++) {
        const x = base.x + dx;
        const z = base.z + dz;
        if (x < 0 || z < 0 || x >= size || z >= size) continue;
        if (blocked[idx(size, x, z)] === 0) out.push({ x, z });
      }
    }
  }
  return out;
}

/**
 * Маска двора: всё, что не двор, для обхода закрыто. Считать обход по всей
 * локации нельзя — ворота проезжие, и кратчайший путь между двумя углами
 * двора имеет полное право выйти наружу и вернуться. Житель, гуляющий по
 * лесу вокруг замка, — не житель замка.
 */
function yardMask(size: number, blocked: Uint8Array, tiles: readonly Cell[]): Uint8Array {
  const mask = new Uint8Array(size * size).fill(1);
  for (const t of tiles) mask[idx(size, t.x, t.z)] = blocked[idx(size, t.x, t.z)]!;
  return mask;
}

/**
 * Обход одного жителя: несколько точек двора, соединённых путём героя.
 * Возвращает пустой список, если двор не даёт замкнуть кольцо — тогда
 * житель просто стоит, и это честнее, чем поставить его в стену.
 */
function routeThrough(
  size: number,
  blocked: Uint8Array,
  corners: readonly Cell[],
): { route: Cell[]; stops: number[] } {
  const route: Cell[] = [];
  const stops: number[] = [];
  for (let i = 0; i < corners.length; i++) {
    const from = corners[i]!;
    const to = corners[(i + 1) % corners.length]!;
    const leg = findPath(size, blocked, from, to);
    if (leg.length === 0) return { route: [], stops: [] };
    route.push(...leg);
    // Угол — последняя клетка отрезка: дошёл до неё, значит обход повернул.
    stops.push(route.length - 1);
  }
  return { route, stops };
}

/**
 * Жители замка по сиду. Сид тот же, что у площадки: замок и его обитатели —
 * одно место, и разводить их по разным сидам значило бы, что двор может
 * смениться, оставив людей на прежних местах.
 */
export function createFolk(
  seed: number,
  castle: Castle,
  at: Spot,
  size: number,
  blocked: Uint8Array,
): Folk[] {
  const rng: Rng = mulberry32(seed ^ 0x5f0c);
  const tiles = yardTiles(castle, at, size, blocked);
  if (tiles.length === 0) return [];

  const count = Math.max(FOLK_MIN, Math.min(FOLK_MAX, Math.round(tiles.length / FOLK_TILES)));
  const mask = yardMask(size, blocked, tiles);
  const folk: Folk[] = [];
  const lookShift = randInt(rng, FOLK_LOOKS.length);

  for (let i = 0; i < count; i++) {
    // Углы обхода: берутся врозь, чтобы обход был кругом, а не топтанием.
    // Порог половинный от стороны двора — на тесном дворе он недостижим,
    // и тогда берётся что нашлось: пусть житель ходит мало, чем не ходит.
    const corners: Cell[] = [];
    const apart = Math.max(2, Math.round(Math.sqrt(tiles.length) / 2));
    for (let c = 0; c < CORNERS; c++) {
      let pick: Cell | null = null;
      for (let tries = 0; tries < 24 && pick === null; tries++) {
        const cand = tiles[randInt(rng, tiles.length)]!;
        if (corners.every((s) => Math.hypot(s.x - cand.x, s.z - cand.z) >= apart)) pick = cand;
      }
      corners.push(pick ?? tiles[randInt(rng, tiles.length)]!);
    }

    const { route, stops } = routeThrough(size, mask, corners);
    const start = corners[0]!;
    folk.push({
      id: i,
      look: FOLK_LOOKS[(i + lookShift) % FOLK_LOOKS.length]!,
      route,
      stops,
      x: start.x,
      z: start.z,
      prevX: start.x,
      prevZ: start.z,
      facing: 0,
      at: 0,
      wait: 0,
    });
  }
  return folk;
}

/**
 * Шаг жителей. Считается тем же способом, что шаг героя (`raid.ts`)
 * и шаг персонажа в лагере (`campWalk.ts`): бюджет расстояния на кадр
 * тратится по отрезкам маршрута. Случайности здесь нет — весь выбор
 * сделан при генерации.
 */
export function stepFolk(folk: readonly Folk[], dt: number): void {
  for (const f of folk) {
    f.prevX = f.x;
    f.prevZ = f.z;
    if (f.route.length === 0) continue;
    if (f.wait > 0) {
      f.wait = Math.max(0, f.wait - dt);
      continue;
    }

    let budget = FOLK_SPEED * dt;
    // Предохранитель от обхода из совпадающих клеток: за кадр житель
    // не может пройти больше собственного маршрута.
    let guard = f.route.length + 1;
    while (budget > 0 && guard-- > 0) {
      const node = f.route[f.at]!;
      const dx = node.x - f.x;
      const dz = node.z - f.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= 1e-6) {
        f.at = (f.at + 1) % f.route.length;
        continue;
      }
      f.facing = Math.atan2(dx, dz);
      const move = Math.min(dist, budget);
      f.x += (dx / dist) * move;
      f.z += (dz / dist) * move;
      budget -= move;
      if (move < dist - 1e-6) break;
      f.x = node.x;
      f.z = node.z;
      const arrived = f.at;
      f.at = (f.at + 1) % f.route.length;
      if (f.stops.includes(arrived)) {
        f.wait = FOLK_PAUSE;
        break;
      }
    }
  }
}
