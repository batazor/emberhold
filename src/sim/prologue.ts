/**
 * Пролог: поляна, по которой герой бродит, пока не кончится провиант.
 *
 * Это не вылазка. Здесь нет ни противников, ни контейнеров, ни выхода:
 * провиант перестаёт быть бюджетом на дорогу назад (§11.1) и работает
 * часами — единственной механикой, которую кадр обязан показать до того,
 * как игрок впервые увидит лагерь.
 *
 * Возвращается обычная GameLocation, потому что ходьба, шаг и расход
 * провианта уже написаны в `raid.ts`: пролог отличается от вылазки
 * содержимым локации, а не правилами движения по ней.
 */
import { mulberry32 } from '../core/rng';
import { kitchenFood } from './camp';
import { distanceField, idx } from './grid';
import type { Cell, GameLocation } from './types';

/** Поляна крупнее нулевого яруса (8×8): по ней бродят, а не проходят её. */
export const GLADE_SIZE = 16;

/**
 * Доля клеток под деревьями. Больше — чаща, в которой некуда идти; меньше —
 * пустое поле, на котором лес не читается вовсе.
 */
const TREE_SHARE = 0.16;

/**
 * Провиант пролога. Взят равным Кухне ур. 1, а не назначен заново: тогда
 * прогулку меряет та же линейка, что и вылазку (§11.1), и её длина выводится,
 * а не придумывается — 50 шагов при 1,67 клетки в секунду это около
 * тридцати секунд ходьбы (§17.4).
 */
export const gladeFood = (): number => kitchenFood(1);

/**
 * Поляна по сиду. Кромка — сплошной лес: уйти с поляны нельзя, и это
 * то же решение, что «вход и точка эвакуации — одно место» (§12.1) —
 * кадр обязан кончаться провиантом, а не краем карты.
 */
export function generateGlade(seed: number): GameLocation {
  const size = GLADE_SIZE;
  const rng = mulberry32(seed ^ 0x1a2b3c4d);
  const blocked = new Uint8Array(size * size);
  const start: Cell = { x: size >> 1, z: size >> 1 };

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      if (x === 0 || z === 0 || x === size - 1 || z === size - 1) {
        blocked[idx(size, x, z)] = 1;
        continue;
      }
      // Круг под ногами чист: первый тап обязан сработать в любую сторону.
      if (Math.max(Math.abs(x - start.x), Math.abs(z - start.z)) <= 1) continue;
      if (rng() < TREE_SHARE) blocked[idx(size, x, z)] = 1;
    }
  }

  // Отрезанный лесом угол — тоже лес. Иначе тап по нему оставляет героя
  // стоять на месте, и единственный жест кадра читается как поломка.
  const reach = distanceField(size, blocked, start);
  for (let i = 0; i < size * size; i++) if (reach[i] === -1) blocked[i] = 1;

  return {
    seed,
    tier: 0,
    size,
    blocked,
    evac: start,
    containers: [],
    enemies: [],
    backSteps: distanceField(size, blocked, start),
  };
}
