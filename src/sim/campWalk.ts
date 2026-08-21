/**
 * Ходьба по лагерю (§16.1, §20.4). Лагерь — та самая поляна, на которой
 * в прологе поставили палатку, и ходить по нему игрок должен так же, как
 * ходил по ней: тапнул — герой пошёл, занятое обошёл, в стену упёрся.
 *
 * До этого файла лагерь был единственным местом игры, где герой стоял
 * приколотым к Жилью. Пока по лагерю не ходили, это ничего не значило;
 * стены сделали это ошибкой — стена, сквозь которую нельзя пройти, обязана
 * быть стеной для кого-то.
 *
 * Занятость клетки собирается из того, что в лагере стоит: здание держит
 * свои 2×2, стена и лестница — свои четыре клетки лагеря, кромка площади —
 * рамку. Второй копии этих правил нет: и здание, и стена отвечают за себя
 * там же, где они объявлены.
 *
 * Шаг и путь берутся у вылазки (`pathfinding.ts`) — те же волна и A*.
 * Ходьба, которая в лагере считается иначе, чем в вылазке, научила бы
 * игрока не тому, что его ждёт дальше.
 */
import { BUILDING_ORDER, campArea, type CampState } from './camp';
import { walkBlocked, wallSpotOf } from './campWalls';
import { topCenter, topWalkable, wallTop, type Level, type Portal, type WallTop } from './campTop';
import { CASTLE_CELL } from './castle';
import { findPath, nearestWalkable } from './pathfinding';
import { idx } from './grid';
import type { Cell } from './types';

export type { Level } from './campTop';

/**
 * Скорость героя по лагерю, клеток в секунду. Та же, что в вылазке: лагерь —
 * не другой мир, и ходьба в нём не имеет права ощущаться другой.
 */
export const CAMP_SPEED = 2.6;

/** Точка пути: клетка лагеря и ярус, на котором её проходят. */
export interface Step {
  readonly x: number;
  readonly z: number;
  readonly level: Level;
  /** Высота в клетках лагеря: 0 на земле, измеренный настил наверху. */
  readonly y: number;
}

/** Где стоит герой лагеря. */
export interface CampHero {
  x: number;
  z: number;
  /** На каком ярусе стоит. Наверх ведёт только лестница. */
  level: Level;
  /** Высота в клетках лагеря — её ставит шаг, рендер только читает. */
  y: number;
  /** Куда идёт: точки пути, ближайшая первой. */
  path: Step[];
  /** Куда смотрит, в радианах. */
  facing: number;
}

/**
 * Почему не пошёл. Строка, а не `false`: «наверх — по лестнице» игрок обязан
 * узнать, а молчащий отказ читается как поломка.
 */
export type MoveBlock = 'ok' | 'нет пути' | 'нет лестницы';

/** Проходимость лагеря целиком: земля и верх стены. Считается, не хранится. */
export interface CampNav {
  readonly area: number;
  readonly ground: Uint8Array;
  readonly top: WallTop;
}

export function campNav(camp: CampState): CampNav {
  const area = campArea(camp.levels.hq);
  const ground = campBlocked(camp);
  const walls = camp.walls;
  return {
    area,
    ground,
    top: wallTop(walls ?? { cells: [], towers: {}, gates: [], stairs: {} }, area, ground),
  };
}

/**
 * Занятые клетки лагеря. Считается от состояния, а не хранится: здание
 * переставляют, стену строят и сносят, и вторая копия занятости разошлась бы
 * с первой на первом же сносе.
 */
export function campBlocked(camp: CampState): Uint8Array {
  const area = campArea(camp.levels.hq);
  const blocked = new Uint8Array(area * area);

  for (const id of BUILDING_ORDER) {
    if (camp.levels[id] <= 0) continue;
    const p = camp.layout[id];
    for (let dz = 0; dz < 2; dz++) {
      for (let dx = 0; dx < 2; dx++) {
        const x = p.x + dx;
        const z = p.z + dz;
        if (x < 0 || z < 0 || x >= area || z >= area) continue;
        blocked[idx(area, x, z)] = 1;
      }
    }
  }

  const walls = camp.walls;
  if (walls != null) {
    for (let z = 0; z < area; z++) {
      // Ворота из занятости выпадают: клетка под аркой — проход, а не стена.
      for (let x = 0; x < area; x++) if (walkBlocked(walls, x, z)) blocked[idx(area, x, z)] = 1;
    }
  }
  return blocked;
}

/** Свободная клетка рядом с Жильём — оттуда герой начинает. */
export function campStart(camp: CampState): Cell {
  const area = campArea(camp.levels.hq);
  const blocked = campBlocked(camp);
  const near = nearestWalkable(area, blocked, {
    x: Math.min(area - 1, camp.layout.hq.x + 2),
    z: Math.min(area - 1, camp.layout.hq.z),
  });
  return near ?? { x: 0, z: 0 };
}

export const createCampHero = (camp: CampState): CampHero => ({
  ...campStart(camp),
  level: 'земля',
  y: 0,
  path: [],
  facing: 0,
});

/**
 * Длина ноги маршрута в клетках. `null` — ноги нет.
 *
 * `findPath` возвращает пустой список и когда пути нет, и когда идти никуда
 * не надо: старт совпал с целью. Для одного вызова разницы нет, для весов
 * графа она решает всё — иначе «я уже стою в подножии» неотличимо
 * от «сюда не дойти».
 */
function legOf(size: number, blocked: Uint8Array, from: Cell, to: Cell): Cell[] | null {
  if (from.x === to.x && from.z === to.z) return [];
  const path = findPath(size, blocked, from, to);
  return path.length === 0 ? null : path;
}

/** Узел маршрутного графа: точка и ярус, на котором она стоит. */
interface Hop {
  readonly at: Cell;
  readonly level: Level;
}

const hopKey = (hop: Hop): string => `${hop.level}:${hop.at.x}:${hop.at.z}`;

/**
 * Маршрут по двум ярусам. Ноги внутри яруса считает тот же `findPath`, что
 * и вылазка, — его не трогают ни строкой: он стоит под правилом детерминизма
 * и держит петлю, которую стережёт золотой мастер. Между ногами лежат
 * лестницы, и по этому маленькому графу (узлов десяток) идёт Дейкстра.
 *
 * Полный граф, а не «через одну лестницу»: сокращение обрывается на честном
 * случае «двор — стена — другой двор — другая стена», а такой отказ молчит.
 */
function route(nav: CampNav, from: Hop, to: Hop): Step[] | null {
  const nodes: Hop[] = [from, to];
  for (const portal of nav.top.portals) {
    nodes.push({ at: portal.foot, level: 'земля' });
    nodes.push({ at: topCenter(portal.landing), level: 'верх' });
  }

  const legs = (a: Hop, b: Hop): Cell[] | null => {
    if (a.level !== b.level) return null;
    if (a.level === 'земля') return legOf(nav.area, nav.ground, a.at, b.at);
    return legOf(
      nav.top.grid,
      nav.top.blocked,
      wallSpotOf(a.at.x, a.at.z),
      wallSpotOf(b.at.x, b.at.z),
    );
  };

  /** Подъём и спуск: лестница связывает подножие с площадкой и обратно. */
  const portalOf = (a: Hop, b: Hop): Portal | null => {
    for (const p of nav.top.portals) {
      const foot = hopKey({ at: p.foot, level: 'земля' });
      const land = hopKey({ at: topCenter(p.landing), level: 'верх' });
      if ((hopKey(a) === foot && hopKey(b) === land) || (hopKey(a) === land && hopKey(b) === foot)) {
        return p;
      }
    }
    return null;
  };

  const best = new Map<string, number>([[hopKey(from), 0]]);
  const prev = new Map<string, { hop: Hop; steps: Step[] }>();
  const seen = new Set<string>();

  for (;;) {
    let cur: Hop | null = null;
    let curCost = Infinity;
    for (const node of nodes) {
      const key = hopKey(node);
      const cost = best.get(key);
      if (cost === undefined || seen.has(key)) continue;
      if (cost < curCost) {
        curCost = cost;
        cur = node;
      }
    }
    if (cur === null) break;
    seen.add(hopKey(cur));
    if (hopKey(cur) === hopKey(to)) break;

    for (const next of nodes) {
      if (hopKey(next) === hopKey(cur)) continue;
      let steps: Step[] | null = null;
      let cost = 0;

      const leg = legs(cur, next);
      if (leg !== null) {
        cost = leg.length;
        steps = leg.map((c) => cur!.level === 'земля'
          ? { x: c.x, z: c.z, level: 'земля' as Level, y: 0 }
          : { ...topCenter(c), level: 'верх' as Level, y: nav.top.deck[idx(nav.top.grid, c.x, c.z)]! });
      } else {
        const portal = portalOf(cur, next);
        if (portal !== null) {
          // Подъём стоит как переход через клетку лестницы: две клетки лагеря.
          cost = CASTLE_CELL;
          const up = next.level === 'верх';
          steps = [
            { ...topCenter(portal.stairs), level: up ? 'верх' : 'земля', y: up ? portal.rise : 0 },
            { ...next.at, level: next.level, y: up ? portal.rise : 0 },
          ];
        }
      }
      if (steps === null) continue;

      const key = hopKey(next);
      const total = curCost + cost;
      if (total >= (best.get(key) ?? Infinity)) continue;
      best.set(key, total);
      prev.set(key, { hop: cur, steps });
    }
  }

  if (!best.has(hopKey(to))) return null;
  const out: Step[] = [];
  let at = to;
  while (hopKey(at) !== hopKey(from)) {
    const back = prev.get(hopKey(at));
    if (back === undefined) return null;
    out.unshift(...back.steps);
    at = back.hop;
  }
  return out;
}

/**
 * Отправить героя в клетку выбранного яруса. Отказ называет причину: «нет
 * лестницы» отличается от «нет пути» тем, что чинится стройкой, а не обходом.
 */
export function commandCampMove(
  camp: CampState,
  hero: CampHero,
  target: Cell,
  level: Level = 'земля',
): MoveBlock {
  const nav = campNav(camp);
  const from: Hop = { at: { x: Math.round(hero.x), z: Math.round(hero.z) }, level: hero.level };

  if (level === 'верх') {
    const spot = wallSpotOf(Math.round(target.x), Math.round(target.z));
    if (!topWalkable(nav.top, spot)) return 'нет пути';
    if (nav.top.portals.length === 0) return 'нет лестницы';
    const steps = route(nav, from, { at: topCenter(spot), level: 'верх' });
    if (steps === null) return hero.level === 'земля' ? 'нет лестницы' : 'нет пути';
    hero.path = steps;
    return 'ok';
  }

  const goal = nearestWalkable(nav.area, nav.ground, {
    x: Math.round(target.x),
    z: Math.round(target.z),
  });
  if (goal === null) return 'нет пути';
  const steps = route(nav, from, { at: goal, level: 'земля' });
  if (steps === null) return 'нет пути';
  hero.path = steps;
  return 'ok';
}

/**
 * Шаг ходьбы. Герой идёт к первой точке пути, дошёл — берёт следующую.
 * Считается временем, а не кадрами: лагерь рисуется с той же частотой,
 * что и вылазка, но зависеть от неё ходьба не должна.
 *
 * Ярус и высота приходят из пути, а не выводятся здесь: где герой поднялся,
 * решил маршрут, и второй копии этого решения быть не должно.
 */
export function stepCampHero(camp: CampState, hero: CampHero, dt: number): void {
  let left = CAMP_SPEED * dt;
  while (left > 0 && hero.path.length > 0) {
    const next = hero.path[0]!;
    const dx = next.x - hero.x;
    const dz = next.z - hero.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) {
      hero.level = next.level;
      hero.y = next.y;
      hero.path.shift();
      continue;
    }
    hero.facing = Math.atan2(dx, dz);
    // Ярус меняется в начале отрезка, а не по прибытии: идя на лестницу,
    // герой уже поднимается, и считать его в этот момент стоящим на земле
    // значит проверять его проходимость по клетке, которую он перешагивает.
    hero.level = next.level;
    if (dist <= left) {
      hero.x = next.x;
      hero.z = next.z;
      hero.level = next.level;
      hero.y = next.y;
      left -= dist;
      hero.path.shift();
      continue;
    }
    const part = left / dist;
    hero.x += dx * part;
    hero.z += dz * part;
    // Подъём идёт вместе с шагом: иначе герой въезжал бы на стену боком.
    hero.y += (next.y - hero.y) * part;
    left = 0;
  }

  // Проверка «под ногами больше ничего нет» делается только у стоящего.
  // На ходу герой перешагивает клетки, которые не место, — клетку лестницы
  // на подъёме, — и мерить его проходимость посреди отрезка значит спорить
  // с маршрутом, который эти клетки уже учёл.
  if (hero.path.length > 0) return;

  const nav = campNav(camp);
  if (hero.level === 'верх') {
    // Стену могли снести под ногами. Герой падает на землю, а не висит:
    // висящий герой читается как поломка, а спуск ниоткуда — как телепорт.
    const spot = wallSpotOf(Math.floor(hero.x), Math.floor(hero.z));
    if (!topWalkable(nav.top, spot)) {
      const out = nearestWalkable(nav.area, nav.ground, {
        x: Math.round(hero.x),
        z: Math.round(hero.z),
      });
      if (out !== null) {
        hero.x = out.x;
        hero.z = out.z;
      }
      hero.level = 'земля';
      hero.y = 0;
      hero.path = [];
    }
    return;
  }

  // На земле — то же, что и раньше: стену могли построить под ногами.
  const at = { x: Math.round(hero.x), z: Math.round(hero.z) };
  if (at.x < 0 || at.z < 0 || at.x >= nav.area || at.z >= nav.area
    || nav.ground[idx(nav.area, at.x, at.z)]) {
    const out = nearestWalkable(nav.area, nav.ground, at);
    if (out !== null) {
      hero.x = out.x;
      hero.z = out.z;
      hero.path = [];
    }
  }
  hero.y = 0;
}
