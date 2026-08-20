import { idx, inBounds } from './grid';
import type { Cell } from './types';

const DIAGONAL = Math.SQRT2;

/**
 * A* по сетке с диагоналями, но без срезания углов: пройти между двумя
 * камнями по диагонали нельзя. Иначе «путь назад» из §11.1 считается по одной
 * длине, а герой идёт по другой, и провиант расходится с обещанным на экране.
 */
export function findPath(
  size: number,
  blocked: Uint8Array,
  start: Cell,
  goal: Cell,
): Cell[] {
  if (!inBounds(size, goal.x, goal.z) || blocked[idx(size, goal.x, goal.z)]) return [];

  const n = size * size;
  const gScore = new Float32Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const inOpen = new Uint8Array(n);
  const startI = idx(size, start.x, start.z);
  const goalI = idx(size, goal.x, goal.z);
  if (startI === goalI) return [];

  const heuristic = (x: number, z: number): number => Math.hypot(x - goal.x, z - goal.z);

  const open: number[] = [startI];
  gScore[startI] = 0;
  inOpen[startI] = 1;

  while (open.length > 0) {
    let bestAt = 0;
    let bestF = Infinity;
    for (let i = 0; i < open.length; i++) {
      const c = open[i]!;
      const f = gScore[c]! + heuristic(c % size, (c / size) | 0);
      if (f < bestF) {
        bestF = f;
        bestAt = i;
      }
    }
    const current = open.splice(bestAt, 1)[0]!;
    inOpen[current] = 0;
    if (current === goalI) break;

    const cx = current % size;
    const cz = (current / size) | 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (!inBounds(size, nx, nz)) continue;
        const ni = idx(size, nx, nz);
        if (blocked[ni]) continue;
        if (dx !== 0 && dz !== 0) {
          if (blocked[idx(size, cx + dx, cz)] || blocked[idx(size, cx, cz + dz)]) continue;
        }
        const tentative = gScore[current]! + (dx !== 0 && dz !== 0 ? DIAGONAL : 1);
        if (tentative < gScore[ni]!) {
          gScore[ni] = tentative;
          cameFrom[ni] = current;
          if (!inOpen[ni]) {
            open.push(ni);
            inOpen[ni] = 1;
          }
        }
      }
    }
  }

  if (cameFrom[goalI] === -1) return [];
  const out: Cell[] = [];
  for (let c = goalI; c !== -1 && c !== startI; c = cameFrom[c]!) {
    out.push({ x: c % size, z: (c / size) | 0 });
  }
  return out.reverse();
}

/** Ближайшая проходимая клетка к цели — тап в камень не должен молчать. */
export function nearestWalkable(size: number, blocked: Uint8Array, target: Cell): Cell | null {
  if (inBounds(size, target.x, target.z) && !blocked[idx(size, target.x, target.z)]) return target;
  let best: Cell | null = null;
  let bestDist = Infinity;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = target.x + dx;
      const z = target.z + dz;
      if (!inBounds(size, x, z) || blocked[idx(size, x, z)]) continue;
      const d = Math.hypot(dx, dz);
      if (d < bestDist) {
        bestDist = d;
        best = { x, z };
      }
    }
  }
  return best;
}
