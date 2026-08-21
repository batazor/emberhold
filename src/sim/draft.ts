/**
 * Драфт сборов (§19). Единственный карточный слой в игре: перед входом
 * в локацию игрок выбирает одну карту из трёх.
 *
 * Зачем он. §19 называет дыру дословно: **«вылазки одного яруса различаются
 * планировкой, но не тем, как в них играют»**. Событий локации четыре, и они
 * меняют условия, а не подход. Карта меняет подход — и потому фильтр у неё
 * тот же, что у зданий: **карта обязана менять решение «глубже или назад»**.
 *
 * Форма модуля списана с событий (`events.ts`), и это не совпадение: карта,
 * как и событие, сворачивается в числа один раз на входе. Вылазке незачем
 * знать про карты — ей нужны провиант, вместимость, обзор и ставка.
 *
 * Состояния модуль не держит: раздача выводится из сида, выбор живёт одну
 * вылазку и никуда не сохраняется (§19.1 — «карты не копятся и не покупаются»).
 *
 * Имена карт — рабочие подписи (§0.1): меняются правкой строки.
 */
import type { Rng } from '../core/rng';
import type { BuildingId, CampState } from './camp';
import type { Tier } from './types';

/**
 * §19.1 — «три карты, три разные оси». Осей семь, и это ограничение раздачи,
 * а не украшение: две карты одной оси превращают выбор в сравнение чисел
 * («+25 провианта» против «+40 провианта»), то есть в арифметику.
 */
export type DraftAxis = 'food' | 'road' | 'bag' | 'vision' | 'intel' | 'stake' | 'fight';

export const AXIS_NAME: Record<DraftAxis, string> = {
  food: 'провиант',
  road: 'дорога',
  bag: 'вместимость',
  vision: 'обзор',
  intel: 'сведения',
  stake: 'ставка',
  fight: 'бой',
};

export type DraftCardId =
  | 'ration'
  | 'fish'
  | 'campfire'
  | 'rope'
  | 'crate'
  | 'falsebottom'
  | 'bat'
  | 'pledge'
  | 'allin'
  | 'bandage'
  | 'whetstone';

/**
 * Что карта делает с вылазкой. Поля нейтральны по умолчанию (`NO_DRAFT`),
 * и это то же требование, что у событий: бот, калибровка §20.3 и золотой
 * мастер считают вылазку без карт, и любое протекание сюда делает прежние
 * замеры несравнимыми.
 */
export interface DraftEffect {
  /** Прибавка к запасу провианта. */
  readonly food: number;
  /** Прибавка к вместимости рюкзака. */
  readonly bag: number;
  /** Прибавка к радиусу обзора, может быть отрицательной. */
  readonly vision: number;
  /**
   * Прибавка к доле под угрозой — слагаемым, как у события (§11.2).
   * Не множителем: множитель занят кольцом (§14), и на нулевом ярусе,
   * где база ноль, он дал бы ноль.
   */
  readonly risk: number;
  /** Множитель добычи. Ложится поверх богатства и события. */
  readonly loot: number;
  /** Множитель пути назад. Меньше единицы — дорога домой короче. */
  readonly back: number;
  /**
   * Прибавка к очкам жизни бойца на эту вылазку (§11.3 — здоровье шкала,
   * а не раны). Названо очками, а не ранами, потому что ранами лагерь
   * считает возвращение, а вылазка — нет.
   */
  readonly hp: number;
  /** Цена стычки в провианте. `null` — как есть (§11.1). */
  readonly fightFood: number | null;
}

export const NO_DRAFT: DraftEffect = {
  food: 0,
  bag: 0,
  vision: 0,
  risk: 0,
  loot: 1,
  back: 1,
  hp: 0,
  fightFood: null,
};

export interface DraftCard {
  readonly id: DraftCardId;
  readonly axis: DraftAxis;
  readonly name: string;
  /** Что даёт — строка карточки. */
  readonly gives: string;
  /** Чем платит. Пустая строка — карта без цены. */
  readonly costs: string;
  /** Здание и его уровень, которые карту открывают. */
  readonly need: { readonly building: BuildingId; readonly level: number };
  /** С какого яруса карта появляется в раздаче. */
  readonly tier: Tier;
  /** Вес в раздаче: 10 — обычная, 6 — необычная, 3 — редкая. */
  readonly weight: number;
  /**
   * §19.1 — «не больше одной карты риска». Рука из трёх жадных карт вынуждает
   * жадность вместо того, чтобы её предлагать.
   */
  readonly risky: boolean;
  readonly effect: DraftEffect;
}

const card = (
  c: Omit<DraftCard, 'effect'> & { effect: Partial<DraftEffect> },
): DraftCard => ({ ...c, effect: { ...NO_DRAFT, ...c.effect } });

/**
 * Пул. §19.2 описывает восемнадцать карт; здесь одиннадцать, и семь
 * недостающих **не заведены намеренно**.
 *
 * Правило проекта — не обещать интерфейсом того, чего нет, — на карточный
 * слой распространяется в полной мере: карта в раздаче, эффект которой
 * не посчитан, хуже отсутствующей, потому что игрок за неё платит выбором.
 *
 * Отложены и почему:
 *
 * - **Обходная тропа**, **Скорый выход** — «первый возврат бесплатен»,
 *   «возвращение из любой точки». Обе требуют разового состояния внутри
 *   вылазки, которого у неё нет; свести их к множителю значит подменить
 *   механику числом.
 * - **Крепёж** — «вес добычи не замедляет». Вес и так не замедляет:
 *   `stepMul` двигают только события. Карта отменяла бы то, чего нет.
 * - **Чуткий слух**, **Соляная метка**, **Чутьё на жилу** — «видны сквозь
 *   стены», «комната отмечена», «кристалл отмечен». Всем троим нужна
 *   отметка на локации, а у контейнера нет даже поля видимости. Ось
 *   «сведения» поэтому в пуле пока пуста — это записанное состояние,
 *   а не упущение.
 * - **Западня** — «первый враг гибнет мгновенно». Бой в этом заходе
 *   не трогаем.
 *
 * Числа взяты из таблицы §19.2 дословно и заново не сочинены.
 */
export const DRAFT: Record<DraftCardId, DraftCard> = {
  ration: card({
    id: 'ration', axis: 'food', name: 'Двойной паёк',
    gives: '+25 провианта', costs: '',
    need: { building: 'kitchen', level: 2 }, tier: 0, weight: 10, risky: false,
    effect: { food: 25 },
  }),
  fish: card({
    id: 'fish', axis: 'food', name: 'Солёная рыба',
    gives: '+40 провианта', costs: 'обзор −1',
    need: { building: 'kitchen', level: 4 }, tier: 1, weight: 6, risky: false,
    effect: { food: 40, vision: -1 },
  }),
  campfire: card({
    id: 'campfire', axis: 'food', name: 'Костровой набор',
    gives: 'привал: +20 провианта', costs: '',
    need: { building: 'kitchen', level: 5 }, tier: 2, weight: 3, risky: false,
    effect: { food: 20 },
  }),
  rope: card({
    id: 'rope', axis: 'road', name: 'Верёвка',
    gives: 'путь назад −25%', costs: '',
    need: { building: 'hq', level: 2 }, tier: 0, weight: 10, risky: false,
    effect: { back: 0.75 },
  }),
  crate: card({
    id: 'crate', axis: 'bag', name: 'Пустой короб',
    gives: '+3 вместимости', costs: 'ставка +15%',
    need: { building: 'storage', level: 2 }, tier: 1, weight: 10, risky: true,
    effect: { bag: 3, risk: 0.15 },
  }),
  falsebottom: card({
    id: 'falsebottom', axis: 'bag', name: 'Двойное дно',
    gives: '+5 вместимости', costs: 'провиант −15',
    need: { building: 'storage', level: 4 }, tier: 2, weight: 6, risky: false,
    effect: { bag: 5, food: -15 },
  }),
  bat: card({
    id: 'bat', axis: 'vision', name: 'Нетопырь',
    gives: 'обзор +2', costs: 'провиант −10',
    need: { building: 'forge', level: 2 }, tier: 1, weight: 10, risky: false,
    effect: { vision: 2, food: -10 },
  }),
  pledge: card({
    id: 'pledge', axis: 'stake', name: 'Заклад',
    gives: 'ставка −20%', costs: 'добыча −10%',
    need: { building: 'infirmary', level: 2 }, tier: 1, weight: 10, risky: false,
    effect: { risk: -0.2, loot: 0.9 },
  }),
  allin: card({
    id: 'allin', axis: 'stake', name: 'Ва-банк',
    gives: 'добыча +40%', costs: 'ставка +25%',
    need: { building: 'yard', level: 3 }, tier: 2, weight: 3, risky: true,
    effect: { loot: 1.4, risk: 0.25 },
  }),
  bandage: card({
    id: 'bandage', axis: 'fight', name: 'Повязки',
    gives: '+4 очка жизни', costs: '',
    need: { building: 'infirmary', level: 3 }, tier: 0, weight: 10, risky: false,
    effect: { hp: 4 },
  }),
  whetstone: card({
    id: 'whetstone', axis: 'fight', name: 'Точило',
    gives: 'стычка стоит 2 провианта вместо 3', costs: '',
    need: { building: 'forge', level: 3 }, tier: 1, weight: 6, risky: false,
    effect: { fightFood: 2 },
  }),
};

export const DRAFT_ORDER: readonly DraftCardId[] = Object.keys(DRAFT) as DraftCardId[];

/** Сколько карт в раздаче (§19 — «одну из трёх»). */
export const HAND_SIZE = 3;

/** Открыта ли карта нынешним лагерем и ярусом захода. */
export function isOpen(cardId: DraftCardId, camp: CampState, tier: Tier): boolean {
  const c = DRAFT[cardId];
  return tier >= c.tier && camp.levels[c.need.building] >= c.need.level;
}

/** Весь доступный пул — то, из чего вообще может собраться рука. */
export const openCards = (camp: CampState, tier: Tier): DraftCardId[] =>
  DRAFT_ORDER.filter((id) => isOpen(id, camp, tier));

/** Взвешенный выбор одного из списка. */
function pick(ids: readonly DraftCardId[], rng: Rng): DraftCardId | null {
  const total = ids.reduce((sum, id) => sum + DRAFT[id].weight, 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const id of ids) {
    roll -= DRAFT[id].weight;
    if (roll <= 0) return id;
  }
  return ids[ids.length - 1] ?? null;
}

/**
 * Раздача. Оба правила §19.1 держатся здесь и нигде больше:
 * **три разные оси** и **не больше одной карты риска**.
 *
 * Переброса нет (§19.1): функция вызывается один раз на заход, и результат
 * от сида. Если правила не дают собрать трёх — рука выходит короче, и это
 * честнее, чем нарушить их ради длины: две карты на двух осях всё ещё выбор,
 * а две карты одной оси — уже арифметика.
 */
export function deal(camp: CampState, tier: Tier, rng: Rng): DraftCardId[] {
  const hand: DraftCardId[] = [];
  const usedAxes = new Set<DraftAxis>();
  let riskyTaken = false;

  for (let i = 0; i < HAND_SIZE; i++) {
    const pool = openCards(camp, tier).filter((id) => {
      const c = DRAFT[id];
      if (usedAxes.has(c.axis)) return false;
      if (c.risky && riskyTaken) return false;
      return true;
    });
    const got = pick(pool, rng);
    if (got === null) break;
    hand.push(got);
    usedAxes.add(DRAFT[got].axis);
    if (DRAFT[got].risky) riskyTaken = true;
  }
  return hand;
}

/**
 * §19.4 — драфт не включается в первой сессии: онбординг уже вводит шесть
 * механик, седьмая на том же отрезке не запомнится. Условие взято не по
 * счётчику сессий, которого в игре нет, а по пулу: **выбор из двух на одной
 * оси не выбор**, поэтому экран встаёт тогда, когда рука вправду собирается
 * из трёх разных осей.
 */
export function draftReady(camp: CampState, tier: Tier): boolean {
  const axes = new Set(openCards(camp, tier).map((id) => DRAFT[id].axis));
  return axes.size >= HAND_SIZE;
}

/** Эффект выбранной карты. `null` — игрок вошёл без драфта. */
export const effectOfCard = (id: DraftCardId | null): DraftEffect =>
  id === null ? NO_DRAFT : DRAFT[id].effect;
