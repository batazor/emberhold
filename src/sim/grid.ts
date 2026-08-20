import type { Cell } from './types';

export const idx = (size: number, x: number, z: number): number => z * size + x;
export const inBounds = (size: number, x: number, z: number): boolean =>
  x >= 0 && z >= 0 && x < size && z < size;

export const NEIGHBORS_4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Поле расстояний в шагах от точки от blocked-сетки, волновым обходом.
 * Считается один раз на локацию: «путь назад» пересчитывается на каждом шаге
 * героя (§11.1), и делать это полноценным поиском пути было бы расточительно.
 * -1 означает «недостижимо».
 */
export function distanceField(size: number, blocked: Uint8Array, from: Cell): Int32Array {
  const dist = new Int32Array(size * size).fill(-1);
  const queue = new Int32Array(size * size);
  let head = 0;
  let tail = 0;

  const start = idx(size, from.x, from.z);
  dist[start] = 0;
  queue[tail++] = start;

  while (head < tail) {
    const cur = queue[head++]!;
    const cx = cur % size;
    const cz = (cur / size) | 0;
    for (const [dx, dz] of NEIGHBORS_4) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!inBounds(size, nx, nz)) continue;
      const ni = idx(size, nx, nz);
      if (blocked[ni] || dist[ni] !== -1) continue;
      dist[ni] = dist[cur]! + 1;
      queue[tail++] = ni;
    }
  }
  return dist;
}
