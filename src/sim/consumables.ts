/**
 * Расходники — второй сток без таймера (§21, `consumables.html`).
 *
 * §0.1 — `name` здесь рабочее: подпись для интерфейса, а не решение и не лор.
 * Меняется правкой строки, без обсуждения; читает его только интерфейс.
 *
 * Существуют ради §20.1: экран возврата держится на правиле «покупка доступна
 * в 60–80% возвратов», а один слот стройки закрыт на три-десять вылазок подряд.
 *
 * §19.1 возражала против расходников: «их берегут для лучшего момента, который
 * не наступает никогда». Ответ конструкцией, а не обещанием — три правила,
 * каждое отражено в типах ниже:
 *
 *   1. Покупается перед входом, сгорает на выходе. Не переносится.
 *   2. Срабатывает сам. Функции «использовать» нет ни в одном модуле.
 *   3. Не больше двух за вылазку.
 */
import type { CampState } from './camp';
import { canAfford, spend } from './resources';
import type { Resources } from './resources';

export type ConsumableId = 'bandage' | 'ration' | 'smoke';

export interface ConsumableDef {
  readonly id: ConsumableId;
  readonly name: string;
  /** Когда срабатывает — текстом для лагеря: игрок обязан знать правило заранее. */
  readonly trigger: string;
  readonly effect: string;
  readonly price: Partial<Resources>;
}

/**
 * Три штуки закрывают три причины провала из телеметрии: бой, провиант,
 * свалка. Четвёртый добавляется, когда замер покажет четвёртую причину.
 *
 * Цены подняты дважды, оба раза замером. На 4–6 солях экран предлагал покупку
 * в 85–90% возвратов, то есть превращался в торговый автомат, от которого
 * предостерегает §21.3. На 6–8 столько же выходило уже вместе с Мастерскойй:
 * два стока складываются, и коридор §20.1 надо держать их суммой, а не
 * каждым по отдельности. При 8–10 золотой мастер даёт 79%.
 */
export const CONSUMABLES: Record<ConsumableId, ConsumableDef> = {
  bandage: {
    id: 'bandage',
    name: 'Повязка',
    trigger: 'осталась одна рана',
    effect: 'возвращает одну рану',
    price: { stone: 10 },
  },
  ration: {
    id: 'ration',
    name: 'Дорожный паёк',
    trigger: 'провиант дошёл до нуля',
    effect: 'даёт 15 провианта',
    price: { stone: 8 },
  },
  smoke: {
    id: 'smoke',
    name: 'Дымовая шашка',
    trigger: 'проснулись двое и больше',
    effect: 'разрывает контакт',
    price: { stone: 9, iron: 1 },
  },
};

export const CONSUMABLE_ORDER: readonly ConsumableId[] = ['ration', 'smoke', 'bandage'];

/** §21.1 — два слота. Купить всё нельзя, значит покупка остаётся выбором. */
export const CONSUMABLE_SLOTS = 2;

export const RATION_FOOD = 15;
/** Сколько проснувшихся противников считается свалкой. */
export const SMOKE_THRESHOLD = 2;

/** Взятое в вылазку. Пустой слот — это отсутствие элемента, а не null. */
export type Loadout = readonly ConsumableId[];

export const priceOf = (id: ConsumableId): Partial<Resources> => CONSUMABLES[id].price;

export const totalPrice = (id: ConsumableId): number =>
  Object.values(CONSUMABLES[id].price).reduce((a, b) => a + b, 0);

/** Самый дешёвый из тех, что по карману. Нужен экрану возврата (§20.1). */
export function cheapestAffordable(have: Resources, taken: Loadout): ConsumableId | null {
  if (taken.length >= CONSUMABLE_SLOTS) return null;
  let best: ConsumableId | null = null;
  let bestPrice = Infinity;
  for (const id of CONSUMABLE_ORDER) {
    const price = CONSUMABLES[id].price;
    const ok = (Object.entries(price) as [keyof Resources, number][]).every(
      ([kind, amount]) => have[kind] >= amount,
    );
    if (!ok) continue;
    const total = totalPrice(id);
    if (total < bestPrice) {
      bestPrice = total;
      best = id;
    }
  }
  return best;
}

/**
 * Покупка. Ровно один вход в систему: «использовать» функции нет и не будет —
 * см. §21.1, автосрабатывание есть условие существования расходников.
 */
export type BuyBlock = 'ok' | 'slots' | 'resources';

/**
 * Почему расходник сейчас не купить. Причина, а не булево, — по тому же
 * правилу, что у стройки и палатки (§16.1, §23.3). Заведена она затем, что
 * покупка возвращала одно «нет» на два разных случая, и полоса называла оба
 * сразу: «не хватает или слоты заняты» — то есть не называла ни одного.
 *
 * Слоты стоят первыми: полный набор — это не бедность, а решение, принятое
 * раньше, и предлагать за него доплатить бессмысленно.
 */
export function buyBlock(camp: CampState, id: ConsumableId): BuyBlock {
  if (camp.loadout.length >= CONSUMABLE_SLOTS) return 'slots';
  if (!canAfford(camp.resources, CONSUMABLES[id].price)) return 'resources';
  return 'ok';
}

/** Слова причины — рядом с причиной (§23.3). */
export const BUY_REASON: Record<Exclude<BuyBlock, 'ok'>, string> = {
  slots: 'Все слоты заняты',
  resources: 'Не хватает ресурсов',
};

export function buyConsumable(camp: CampState, id: ConsumableId): boolean {
  if (buyBlock(camp, id) !== 'ok') return false;
  spend(camp.resources, CONSUMABLES[id].price);
  camp.loadout.push(id);
  return true;
}

/** Передумал до входа — деньги возвращаются целиком. Наказывать не за что. */
export function refundConsumable(camp: CampState, at: number): boolean {
  const id = camp.loadout[at];
  if (id === undefined) return false;
  camp.loadout.splice(at, 1);
  for (const [kind, amount] of Object.entries(CONSUMABLES[id].price) as [keyof Resources, number][]) {
    camp.resources[kind] += amount;
  }
  return true;
}
