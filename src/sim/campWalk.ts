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
import { walkBlocked } from './campWalls';
import { findPath, nearestWalkable } from './pathfinding';
import { idx } from './grid';
import type { Cell } from './types';

/**
 * Скорость героя по лагерю, клеток в секунду. Та же, что в вылазке: лагерь —
 * не другой мир, и ходьба в нём не имеет права ощущаться другой.
 */
export const CAMP_SPEED = 2.6;

/** Где стоит герой лагеря. */
export interface CampHero {
  x: number;
  z: number;
  /** Куда идёт: клетки пути, ближайшая первой. */
  path: Cell[];
  /** Куда смотрит, в радианах. */
  facing: number;
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
  path: [],
  facing: 0,
});

/**
 * Отправить героя в клетку. Возвращает `false`, если идти некуда: тап мимо
 * площади или в место, из которого нет пути. Отказ молчит — в лагере тап
 * по земле и так значит «закрыть лист», и звук отказа звучал бы на каждом
 * промахе мимо здания.
 */
export function commandCampMove(camp: CampState, hero: CampHero, target: Cell): boolean {
  const area = campArea(camp.levels.hq);
  const blocked = campBlocked(camp);
  const goal = nearestWalkable(area, blocked, {
    x: Math.round(target.x),
    z: Math.round(target.z),
  });
  if (goal === null) return false;
  const path = findPath(area, blocked, { x: Math.round(hero.x), z: Math.round(hero.z) }, goal);
  if (path === null || path.length === 0) return false;
  hero.path = path;
  return true;
}

/**
 * Шаг ходьбы. Герой идёт к первой клетке пути, дошёл — берёт следующую.
 * Считается временем, а не кадрами: лагерь рисуется с той же частотой,
 * что и вылазка, но зависеть от неё ходьба не должна.
 */
export function stepCampHero(camp: CampState, hero: CampHero, dt: number): void {
  let left = CAMP_SPEED * dt;
  while (left > 0 && hero.path.length > 0) {
    const next = hero.path[0]!;
    const dx = next.x - hero.x;
    const dz = next.z - hero.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) {
      hero.path.shift();
      continue;
    }
    hero.facing = Math.atan2(dx, dz);
    if (dist <= left) {
      hero.x = next.x;
      hero.z = next.z;
      left -= dist;
      hero.path.shift();
      continue;
    }
    hero.x += (dx / dist) * left;
    hero.z += (dz / dist) * left;
    left = 0;
  }

  // Стену могли построить под ногами: герой не проваливается в неё,
  // а выходит на ближайшую свободную клетку.
  const area = campArea(camp.levels.hq);
  const blocked = campBlocked(camp);
  const at = { x: Math.round(hero.x), z: Math.round(hero.z) };
  if (at.x < 0 || at.z < 0 || at.x >= area || at.z >= area || blocked[idx(area, at.x, at.z)]) {
    const out = nearestWalkable(area, blocked, at);
    if (out !== null) {
      hero.x = out.x;
      hero.z = out.z;
      hero.path = [];
    }
  }
}
