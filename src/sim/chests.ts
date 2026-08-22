/**
 * Сундуки-хранилища лагеря.
 *
 * **Сундук — прибавка к рюкзаку, а не второй склад.** Кладовая лагеря
 * и так бездонна (`camp.resources`), и «вместимость» в игре ровно одна —
 * рюкзак вылазки. Каждый сундук поднимает её на плоские +30: снаряжённый
 * дома герой уносит больше, и число это видно в той же полосе HUD,
 * что и весь рюкзак.
 *
 * **Первый сундук бесплатный и ставится прологом** рядом с палаткой:
 * прибавка показывается в кадре, где игрок только что познакомился
 * с рюкзаком, а не объясняется в лагере задним числом. Дальше сундуки
 * строятся за дерево — тем же жестом, что палатка (`residents.ts`):
 * карточка вооружает палец, место выбирает игрок.
 *
 * **Цена черновая** — как у палатки, и по тем же двум связям: дешевле
 * второго уровня любого здания и платится деревом, которое бесконечно
 * по кромке (§13.3), — запереться навсегда стройка не может.
 *
 * Прибавка складывается с рюкзаком после классового множителя — как
 * снаряжение (`GearMods.capacity`) и карты сборов: сундук общий на лагерь,
 * и делать его крупнее у Бандита, чем у Лучника, было бы враньём про то,
 * чьи это сундуки.
 */
import { campArea } from './camp';
import type { CampState } from './camp';
import { spotTaken } from './residents';
import { canAfford, spend } from './resources';
import type { Resources } from './resources';

/** След сундука в клетках: предмет, а не здание. */
export const CHEST_FOOT = 1;

/** Прибавка к вместимости рюкзака за каждый сундук. */
export const CHEST_BONUS = 30;

/** Цена сундука. Черновая — см. шапку файла. */
export const CHEST_COST: Partial<Resources> = { wood: 2 };

/** Суммарная прибавка лагеря к рюкзаку: слагаемое формулы `createRaid`. */
export const chestBonus = (camp: CampState): number => camp.chests.length * CHEST_BONUS;

export type ChestBlock = 'ok' | 'resources' | 'area';

/** Почему сундук сейчас не поставить: причина, а не булево (§16.1). */
export function chestBlock(camp: CampState): ChestBlock {
  if (!canAfford(camp.resources, CHEST_COST)) return 'resources';
  if (chestSpot(camp) === null) return 'area';
  return 'ok';
}

export const CHEST_REASON: Record<Exclude<ChestBlock, 'ok'>, string> = {
  resources: 'Не хватает дерева',
  area: 'На площадке нет места',
};

/** Влезет ли сундук в эту клетку: в границах площадки и не на чужом следе. */
export function chestFits(camp: CampState, x: number, z: number): boolean {
  const area = campArea(camp.levels.hq);
  return x >= 0 && z >= 0 && x + CHEST_FOOT <= area && z + CHEST_FOOT <= area && !spotTaken(camp, x, z);
}

/**
 * Куда встанет сундук, если игрок место не выбрал: запасной путь и проверка
 * «место вообще есть». Ищется ближайшая свободная клетка к Складу — сундук
 * про хранение, и стоять ему у хранилища; пока Склада нет, якорем служит
 * Жильё: первый сундук пролога живёт у палатки.
 */
export function chestSpot(camp: CampState, near?: { x: number; z: number }): { x: number; z: number } | null {
  const area = campArea(camp.levels.hq);
  const home = near ?? (camp.levels.storage > 0 ? camp.layout.storage : camp.layout.hq);
  let best: { x: number; z: number } | null = null;
  let bestKey = Infinity;
  for (let z = 0; z + CHEST_FOOT <= area; z++) {
    for (let x = 0; x + CHEST_FOOT <= area; x++) {
      if (spotTaken(camp, x, z)) continue;
      const key = Math.hypot(x - home.x, z - home.z);
      if (key >= bestKey) continue;
      bestKey = key;
      best = { x, z };
    }
  }
  return best;
}

/**
 * Построить сундук. Мгновенно и без таймера — по правилу палатки
 * (`buildTent`): уровня у сундука нет, ждать нечего, слот стройки (§20.1)
 * не занимается.
 */
export function buildChest(camp: CampState, at?: { x: number; z: number }): { x: number; z: number } | null {
  if (chestBlock(camp) !== 'ok') return null;
  const spot = at === undefined ? chestSpot(camp) : chestFits(camp, at.x, at.z) ? at : null;
  if (spot === null) return null;
  spend(camp.resources, CHEST_COST);
  camp.chests.push(spot);
  return spot;
}

/**
 * Принять сундук пролога в лагерь. Бесплатно: цену пролог не называет —
 * первый сундук достаётся вместе с палаткой, как её кладовая.
 *
 * `at` — клетка в координатах площадки (глейдовая минус `origin`), уже
 * посчитанная снаружи тем же переносом, каким `adoptGladeLayout` перевозит
 * здания. Не влезла — сундук встаёт на ближайшую свободную клетку к Жилью:
 * потерять его молча нельзя, он держит +30 рюкзака.
 */
export function adoptChest(camp: CampState, at: { x: number; z: number }): void {
  const spot = chestFits(camp, at.x, at.z) ? at : chestSpot(camp, camp.layout.hq);
  if (spot !== null) camp.chests.push(spot);
}
