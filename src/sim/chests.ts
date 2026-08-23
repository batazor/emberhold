/**
 * Сундуки и кладовая лагеря (§13.6).
 *
 * **Кладовая конечна.** У неё общий счёт — сумма всех ресурсов против
 * вместимости, как у рюкзака, — и базовое значение, которое прокачивается
 * сундуками: плоские +30 за каждый. Тап по сундуку в сцене открывает
 * кладовую — сундук и есть её лицо.
 *
 * **Потолок стоит на поступлениях, а не на запасе.** Добыча, работа
 * жильцов, подарки и обмен проходят через `stash` и режутся о свободное
 * место; уже лежащее не пропадает никогда. Отсюда два следствия. Возвраты
 * своих денег — снос стены, отмена расходника — не режутся: это не приток,
 * а возврат того, что уже вмещалось. И сейв, собранный до потолка, ничего
 * не теряет при чтении: перебор доживает до первой траты.
 *
 * **Первый сундук бесплатный и ставится прологом** рядом с палаткой.
 * Дальше сундуки строятся за дерево — тем же жестом, что палатка
 * (`residents.ts`): карточка вооружает палец, место выбирает игрок.
 *
 * **Цена черновая** — как у палатки, и по тем же двум связям: дешевле
 * второго уровня любого здания и платится деревом, которое бесконечно
 * по кромке (§13.3), — запереться навсегда стройка не может.
 */
import { campArea } from './camp';
import type { CampState } from './camp';
import { spotTaken } from './residents';
import { canAfford, spend } from './resources';
import type { Resources } from './resources';

/**
 * Счёт кладовой живёт в `camp.ts`: его читают и жильцы (`collectWork`),
 * которых этот файл сам импортирует ради занятости клеток, — второй дом
 * для тех же функций завёл бы цикл. Здесь остаётся их лицо: сундук —
 * это то, чем кладовая стоит в сцене и чем прокачивается.
 */
export { CHEST_BONUS, STORE_BASE, overflowOf, stash, storeCapacity, storeFree, storeUsed } from './camp';

/** След сундука в клетках: предмет, а не здание. */
export const CHEST_FOOT = 1;

/** Цена сундука. Черновая — см. шапку файла. */
export const CHEST_COST: Partial<Resources> = { wood: 2 };

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
