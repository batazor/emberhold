/**
 * Детерминированный ГПСЧ. DESIGN §6: на нём держатся генерация локаций,
 * ленивая симуляция ботов и воспроизведение багов, поэтому Math.random
 * в симуляции запрещён.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Целое в [0, n). */
export const randInt = (rng: Rng, n: number): number => Math.floor(rng() * n) % n;

/** Случайный элемент непустого массива. */
export const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[randInt(rng, xs.length)]!;
