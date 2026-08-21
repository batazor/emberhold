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

/**
 * Проходит ли отрезок между двумя точками, не задевая занятых клеток (§11.3).
 *
 * Живёт здесь, а не в шаге вылазки, по двум причинам: она детерминирована,
 * как и всё в этом файле, и нужна не только бою — генератор и бот задают
 * тот же вопрос про ту же сетку.
 *
 * Обход накрывающий, а не «по главным клеткам»: отрезок считается задетым,
 * если пересекает клетку вообще, а не только если проходит через её центр.
 * Разница видна ровно там, где важнее всего, — на углу: дешёвый Брезенхэм
 * пропускает выстрел по диагонали между двумя камнями, и стрела уходит
 * сквозь стену, которую игрок видит своими глазами.
 */
export function hasLineOfSight(
  size: number,
  blocked: Uint8Array,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const a = { x: Math.round(ax), z: Math.round(az) };
  const b = { x: Math.round(bx), z: Math.round(bz) };

  // Концы упорядочены, и это не украшение. Обход разрешает ничьи —
  // шаги, где идти можно и вбок, и вперёд, — и разрешает их по-разному
  // с разных концов. Отсюда односторонняя видимость: противник стреляет
  // из-за камня, оставаясь недосягаемым, и это читается как несправедливость,
  // а не как укрытие (§17.3). Упорядочивание делает симметрию свойством
  // конструкции, а не совпадением, которое надо проверять.
  const flip = b.z < a.z || (b.z === a.z && b.x < a.x);
  const from = flip ? b : a;
  const to = flip ? a : b;

  let x = from.x;
  let z = from.z;
  const dx = Math.abs(to.x - x);
  const dz = Math.abs(to.z - z);
  const sx = x < to.x ? 1 : -1;
  const sz = z < to.z ? 1 : -1;
  let err = dx - dz;

  // Своя клетка и клетка цели не проверяются: стрелок стоит там, где стоит,
  // а цель под собой укрытием не считается.
  for (;;) {
    if (x === to.x && z === to.z) return true;
    const e2 = 2 * err;
    if (e2 > -dz && e2 < dx) {
      // Ровно по диагонали: проход есть, только если свободна хотя бы одна
      // из двух клеток, которые отрезок задевает углом. Иначе щель между
      // двумя камнями перестаёт быть щелью — а именно её игрок и видит.
      const side = inBounds(size, x + sx, z) && blocked[idx(size, x + sx, z)] === 0;
      const other = inBounds(size, x, z + sz) && blocked[idx(size, x, z + sz)] === 0;
      if (!side && !other) return false;
      err += dx - dz;
      x += sx;
      z += sz;
    } else if (e2 > -dz) {
      err -= dz;
      x += sx;
    } else {
      err += dx;
      z += sz;
    }
    if (!inBounds(size, x, z)) return false;
    if (x === to.x && z === to.z) return true;
    if (blocked[idx(size, x, z)]) return false;
  }
}
