/**
 * Вещи страницы персонажа — **макет, а не механика игры.**
 *
 * Это первое место проекта, где вещь существует предметом: у неё есть имя,
 * род и место, откуда её взяли. В симуляции такого нет и не будет, пока
 * решение не записано: §14 говорит «слот и есть инвентарь», а `sim/gear.ts`
 * хранит пять слотов числами уровней, один комплект на лагерь. Здесь заведён
 * второй, черновой словарь — ровно чтобы посмотреть на экран руками до того,
 * как переписывать раздел.
 *
 * Отсюда три правила этого файла, и все три — про честность:
 *
 * 1. **Ни одной формулы.** Строка `effect` — подпись, а не расчёт. Числа
 *    игры считает `gearMods()`, и подделывать её здесь значило бы завести
 *    вторую арифметику снаряжения, которая разойдётся с первой молча.
 * 2. **Ничего не сохраняется.** Раскладка живёт, пока открыт экран
 *    (`index.ts` держит её полем), и умирает с закрытием. Записать её
 *    в сейв — это уже решение о предметах, а не прототип.
 * 3. **Имена рабочие** (§0.1): «Каска», «Заплечный короб» — подписи
 *    интерфейса, не лор и не решения о мире.
 *
 * Что макет проверяет и ради чего заведён: раскладка «кукла слева, сумка
 * справа» и правило «слот принимает своё». Свободных слотов два, а не
 * четыре, и это тоже часть вопроса — сколько их открывать и чем.
 */

import type { IconName } from '../../render/iconView';

/** Род вещи. Совпадает с родом слота; `свободное` встаёт в любой свободный. */
export type ItemKind = 'голова' | 'тело' | 'руки' | 'ноги' | 'свободное';
export type ItemPicture = 'helmet' | 'quilted-jacket' | 'boots' | 'calm-ring' | 'tincture';

export interface MockItem {
  readonly id: string;
  readonly name: string;
  readonly kind: ItemKind;
  /** Что вещь даёт. Подпись, а не расчёт: числа игры живут в `sim/gear.ts`. */
  readonly effect: string;
  /** Чем платит. Пустой цены не бывает — §14 держится на компромиссе. */
  readonly cost: string;
  /**
   * Модель набора, которой вещь рисуется значком в клетке и предметом
   * в руке фигуры (`render/iconView.ts`). Подставлять похожую модель нельзя —
   * похожая читалась бы как «вот эта самая».
   */
  readonly icon?: IconName;
  /**
   * PNG-значок для вещей без своей модели в наборах. Здесь только имя
   * картинки, а сам файл подключает UI: правила этого макета гоняются в Node.
   */
  readonly picture?: ItemPicture;
  /** Вещь ложится в руку фигуры: правую или левую (§14.2). */
  readonly hand?: 'правая' | 'левая';
}

export const ITEMS: readonly MockItem[] = [
  { id: 'каска', name: 'Каска', kind: 'голова', effect: 'HP +1', cost: 'Обзор −1: край поля закрыт',
    picture: 'helmet' },
  { id: 'куртка', name: 'Стёганая куртка', kind: 'тело', effect: 'HP +1', cost: 'Шаг дороже на 15%',
    picture: 'quilted-jacket' },
  { id: 'кайло', name: 'Кайло', kind: 'руки', effect: 'Атака +3', cost: 'Тяжёлое: рюкзак −1',
    icon: 'кайло', hand: 'правая' },
  { id: 'топор', name: 'Топор', kind: 'руки', effect: 'Атака +2', cost: 'Рубит, но не долбит камень',
    icon: 'топор', hand: 'правая' },
  { id: 'клинок', name: 'Клинок', kind: 'руки', effect: 'Атака +4', cost: 'Тяжёлый: рюкзак −1',
    icon: 'клинок', hand: 'правая' },
  { id: 'щит', name: 'Щит', kind: 'руки', effect: 'Заслон · Защита +4.8', cost: 'Левая рука занята: фонаря не будет',
    icon: 'щит', hand: 'левая' },
  { id: 'сапоги', name: 'Сапоги', kind: 'ноги', effect: 'Шаг дешевле на 10%', cost: 'Шумные: угроза быстрее',
    picture: 'boots' },
  { id: 'фонарь', name: 'Рудничный фонарь', kind: 'свободное', effect: 'Обзор +1', cost: 'Занимает левую руку',
    icon: 'фонарь', hand: 'левая' },
  { id: 'короб', name: 'Заплечный короб', kind: 'свободное', effect: 'Рюкзак +2', cost: 'В бою не даёт ничего',
    icon: 'короб' },
  { id: 'кольцо', name: 'Спокойная рука', kind: 'свободное', effect: 'Под угрозой меньше на 20%',
    cost: 'Аффикс задан ковкой', picture: 'calm-ring' },
  { id: 'настой', name: 'Настой', kind: 'свободное', effect: 'Снимает одну рану', cost: 'Одноразовый',
    picture: 'tincture' },
];

export const ITEM = new Map(ITEMS.map((it) => [it.id, it]));

/**
 * Слоты куклы. Классическая раскладка: голова, тело, руки, ноги — и сверх
 * неё свободные, которые игрок занимает чем хочет.
 *
 * Свободных сейчас два, а по замыслу их от одного до четырёх, и открывать
 * их должны навыки. Навыков у существ игра пока не считает (§11.7 — у героя
 * четыре характеристики, у жильца нет и их), поэтому число здесь постоянное
 * и помечено черновым: вывести его из навыка значило бы выдумать навык.
 */
export type SlotKind = ItemKind;

export interface DollSlot {
  readonly id: string;
  /** Подпись слота на экране. */
  readonly name: string;
  readonly kind: SlotKind;
}

/** Сколько свободных слотов открыто. Черновое число: см. комментарий выше. */
export const FREE_SLOTS = 2;

/** Потолок свободных слотов — сколько их станет, когда появятся навыки. */
export const MAX_FREE_SLOTS = 4;

export const SLOTS: readonly DollSlot[] = [
  { id: 'голова', name: 'Шлем', kind: 'голова' },
  { id: 'тело', name: 'Одежда', kind: 'тело' },
  { id: 'руки', name: 'Руки', kind: 'руки' },
  { id: 'ноги', name: 'Ноги', kind: 'ноги' },
  ...Array.from({ length: FREE_SLOTS }, (_, i) => ({
    id: `свободный${i + 1}`,
    name: 'Свободный',
    kind: 'свободное' as const,
  })),
];

/**
 * Клеток в сумке. Их не меньше, чем вещей: снять с себя можно всё сразу,
 * и «снял — потерял» из-за тесноты было бы не решением игрока, а осечкой
 * макета. Правило сторожит это счётом (`character.rules.ts`).
 */
export const BAG_CELLS = 12;

/**
 * Что вещь кладёт в руки фигуры. Правая — то, чем бьют, левая — щит
 * и фонарь: тот самый спор §14.2, только показанный на человеке.
 */
export function inHands(pack: PackState): { right: IconName | null; left: IconName | null } {
  let right: IconName | null = null;
  let left: IconName | null = null;
  for (const id of pack.worn.values()) {
    const item = id === null ? undefined : ITEM.get(id);
    if (item?.icon === undefined || item.hand === undefined) continue;
    if (item.hand === 'правая') right = item.icon;
    else left = item.icon;
  }
  return { right, left };
}

export interface PackState {
  /** Что надето: id слота → id вещи. */
  readonly worn: Map<string, string | null>;
  /** Сумка. Дырки — пустые клетки: вещь не переезжает, когда рядом сняли. */
  readonly bag: (string | null)[];
}

/** Раскладка, с которой экран открывается: часть вещей надета, часть в сумке. */
export function startPack(): PackState {
  const worn = new Map<string, string | null>(SLOTS.map((s) => [s.id, null]));
  worn.set('голова', 'каска');
  worn.set('тело', 'куртка');
  worn.set('руки', 'кайло');
  worn.set('свободный1', 'фонарь');
  const bag: (string | null)[] = Array.from({ length: BAG_CELLS }, () => null);
  ['сапоги', 'щит', 'короб', 'кольцо', 'настой', 'топор', 'клинок'].forEach((id, i) => {
    bag[i] = id;
  });
  return { worn, bag };
}

/** Встаёт ли вещь в этот слот. Свободный принимает что угодно. */
export function fits(slot: DollSlot, item: MockItem): boolean {
  return slot.kind === 'свободное' || slot.kind === item.kind;
}

/** Первый слот, куда вещь встанет: сперва пустой, иначе занятый своего рода. */
export function slotFor(pack: PackState, item: MockItem): DollSlot | null {
  const free = SLOTS.find((s) => fits(s, item) && pack.worn.get(s.id) == null);
  return free ?? SLOTS.find((s) => fits(s, item)) ?? null;
}

/**
 * Надеть вещь в слот. Занятый слот меняется местами с тем, что несут:
 * снятое уходит в сумку, а не пропадает.
 *
 * `false` — вещь слоту не подходит или снятому некуда деться: промах ничего
 * не ломает, вещь остаётся там, где была.
 */
export function equip(pack: PackState, itemId: string, slotId: string): boolean {
  const slot = SLOTS.find((s) => s.id === slotId);
  const item = ITEM.get(itemId);
  if (slot === undefined || item === undefined || !fits(slot, item)) return false;
  const out = pack.worn.get(slot.id) ?? null;
  // Вещь уже в этом слоте: делать нечего. Без этой строки обмен «снятое
  // в сумку» отправлял туда её же — и вещь раздваивалась.
  if (out === itemId) return true;
  const at = pack.bag.indexOf(itemId);
  // Снятому нужно место в сумке — и клетка, из которой вещь берут, годится:
  // обмен «надетое ↔ несомое» не требует свободной клетки сверх неё.
  if (out !== null && at < 0 && !pack.bag.includes(null)) return false;
  if (at >= 0) pack.bag[at] = null;
  // Вещь может быть надета в другом слоте: перекладывание не размножает её.
  for (const [id, worn] of pack.worn) if (id !== slot.id && worn === itemId) pack.worn.set(id, null);
  pack.worn.set(slot.id, itemId);
  if (out !== null) {
    const cell = at >= 0 ? at : pack.bag.indexOf(null);
    pack.bag[cell] = out;
  }
  return true;
}

/** Снять вещь в сумку. `false` — в сумке нет места, вещь остаётся надетой. */
export function unequip(pack: PackState, slotId: string): boolean {
  const worn = pack.worn.get(slotId) ?? null;
  if (worn === null) return false;
  const cell = pack.bag.indexOf(null);
  if (cell < 0) return false;
  pack.bag[cell] = worn;
  pack.worn.set(slotId, null);
  return true;
}
