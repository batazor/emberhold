import type { ConsumableId } from './consumables';
import type { Sortie } from './sortie';
import type { Resources } from './resources';
import { canAfford, emptyResources, spend } from './resources';
import { modelKitchenFood, TIER_KITCHEN_GATE as GATE } from './balance';
import { GEAR, GEAR_COST, GEAR_ORDER, MAX_ITEM_LEVEL, bowQuiver, emptyGear } from './gear';
import type { GearSlot, GearState, Offhand } from './gear';
import { healPerWound, trainPerLevel } from './heroes';
import type { Tier } from './types';
import type { Visit } from './world';
import { emptyWalls, type CampWalls } from './campWalls';
import { STONES, scatterStones, type Stone } from './stones';

/**
 * Шесть зданий §2. Мастерская пришла первой сверх среза §7, потому что
 * закрывала дыру в петле возврата (§20.1); Лазарет и Плац — следом, и оба
 * оперируют расписанием отряда, а не вылазкой.
 *
 * Порядок §16: Мастерская (Жильё 2) → Лазарет (3) → Плац (4). Он выведен
 * из кривой ввода, а не из удобства: Лазарет вводится после первого ранения,
 * Плац — на второй-третий день, когда простой отряда уже заметен.
 */
import type { Resident } from './residents';

export type BuildingId = 'hq' | 'kitchen' | 'storage' | 'forge' | 'infirmary' | 'yard';

export const BUILDING_ORDER: readonly BuildingId[] = [
  'hq', 'kitchen', 'storage', 'forge', 'infirmary', 'yard',
];

export const MAX_LEVEL = 6;

export interface BuildingDef {
  readonly id: BuildingId;
  readonly name: string;
  /** §2: каждое здание обязано отвечать на вопрос «что я смогу в вылазке». */
  readonly effect: (level: number) => string;
  /**
   * Уровень Жилья, с которого здание вообще существует. У первых трёх — 1:
   * они стоят в лагере с начала игры. Мастерская появляется на втором, как
   * велит кривая §16 («2–3 сессия — Мастерская, первое снаряжение»):
   * раньше игроку нечем ковать, и она была бы пустой комнатой.
   */
  readonly unlockHq: number;
}

/**
 * Кривая Кухни выведена моделью (§22), а не назначена: ярус k открывается
 * Кухней k+1, и запас на этом уровне обязан совпасть с модельным для яруса.
 * Отсюда 49 / 76 / 103 / 130 — прямая с шагом 27.
 */
export const kitchenFood = (level: number): number => modelKitchenFood(level);

/** Вместимость Склада. §11.5 отменила формулы построек, число не назначено;
 *  подобрано так, чтобы пример «12 из 19» из §11.2 приходился на Склад ур. 2. */
export const storageCapacity = (level: number): number => 11 + 4 * level;

/** §20.4 — площадь растёт с Жильём: 6×6 на ур. 1 … 10×10 на ур. 5. */
export const campArea = (hqLevel: number): number => Math.min(10, 5 + hqLevel);

/** Якорь площадки одним правилом: нет якоря — нулевой (старый сейв, отладка). */
export const campOrigin = (camp: Pick<CampState, 'origin'>): { x: number; z: number } =>
  camp.origin ?? { x: 0, z: 0 };

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  hq: {
    id: 'hq',
    name: 'Жильё',
    effect: (l) => `Потолок уровня зданий ${l} · площадь ${campArea(l)}×${campArea(l)}`,
    unlockHq: 1,
  },
  kitchen: {
    id: 'kitchen',
    name: 'Кухня',
    effect: (l) => `Провиант ${kitchenFood(l)} — это максимальная глубина захода`,
    unlockHq: 1,
  },
  storage: {
    id: 'storage',
    name: 'Склад',
    effect: (l) => `Рюкзак ${storageCapacity(l)} — столько добычи можно вынести`,
    unlockHq: 1,
  },
  forge: {
    id: 'forge',
    name: 'Мастерская',
    effect: (l) =>
      l <= 0
        ? 'Снаряжение без таймера: ковка и улучшение'
        : `Снаряжение до ур. ${itemCap(l)} — ковка и улучшение без таймера`,
    unlockHq: 2,
  },
  infirmary: {
    id: 'infirmary',
    name: 'Лазарет',
    effect: (l) =>
      l <= 0
        ? `Лечение быстрее: сейчас ${minutes(healPerWound(0))} за рану`
        : `Лечение ${minutes(healPerWound(l))} за рану — столько отряд простаивает`,
    unlockHq: 3,
  },
  yard: {
    id: 'yard',
    name: 'Плац',
    effect: (l) =>
      l <= 0
        ? 'Тренировка запасных без вылазок'
        : `Уровень за ${minutes(trainPerLevel(l))} — запасной догоняет отряд`,
    unlockHq: 4,
  },
};

/** Минуты строкой для ценников зданий: «6 мин», «1 ч 30 мин». */
const minutes = (sec: number): string => {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} мин` : m % 60 === 0 ? `${m / 60} ч` : `${(m / 60) | 0} ч ${m % 60} мин`;
};

/**
 * §14 — предмет не может быть лучше Мастерской, которая его делает.
 * Потолок предметов (5) ниже потолка зданий (6) намеренно: шестой уровень
 * Мастерской не даёт нового качества, он даёт запас на следующий этап.
 */
export const itemCap = (forgeLevel: number): number =>
  Math.max(0, Math.min(MAX_ITEM_LEVEL, forgeLevel));

/** §20.2 — времена назначены вручную, каждая ступень целится в поведение. */
export const BUILD_SECONDS: Record<number, number> = {
  2: 3 * 60,
  3: 12 * 60,
  4: 45 * 60,
  5: 3 * 3600,
  6: 8 * 3600,
};

/**
 * §20.3 — стоимость, откалиброванная замером (`npm run measure`).
 *
 * Метод. Бот проходит 300 вылазок на ярус: идёт к ближайшему контейнеру, до
 * которого хватает провианта с учётом дороги назад, обходит замеченных
 * противников, на одной ране уходит. Из добычи успешной вылазки по §11.5
 * выводится цена (добыча ≈ 70% стоимости следующего улучшения), темп взят
 * из таблицы §20.3, раскладка по видам — пропорционально тому, что ярус
 * роняет, с ограничениями §13: дерево держит ранние уровни, железо идёт
 * с третьего, кристалл — с пятого.
 *
 * Замер после починки боя (ночь, пары «ярус — здания» по кривой §16):
 *
 * | ярус | успех | добыча | состав                                   |
 * |------|-------|--------|------------------------------------------|
 * | 0    | 100%  |  6,4   | камень 4,5 · дерево 2,0                    |
 * | 1    |  88%  |  7,6   | камень 3,9 · дерево 2,1 · железо 1,6       |
 * | 2    |  73%  | 15,9   | камень 5,8 · дерево 2,2 · железо 6,1 · кристалл 1,8 |
 * | 3    |  79%  | 22,4   | камень 6,8 · железо 9,9 · кристалл 5,7     |
 *
 * Темп: ур. 2 — полторы вылазки яруса 1, ур. 3 — две, ур. 4 — три вылазки
 * яруса 2, ур. 5 — пять, ур. 6 — семь вылазок яруса 3 (последняя ступень
 * экстраполирована, таблица документа заканчивается на пятой).
 */
export const BUILD_COST: Record<number, Partial<Resources>> = {
  /*
   * Первый уровень платит одна Мастерская: остальные три здания стоят в лагере
   * с самого начала и на него не выходят никогда. Поэтому ключ `1` — не ступень
   * общей кривой, а цена третьего акта пролога (§16.1): жильё выросло до ур. 2,
   * Мастерская открылась, и камня на поляне нет.
   *
   * Двойка измерена, а не назначена (`npm run measure`, блок «Цена Мастерской»):
   * это самая высокая цена, которую покрывают четыре первых вылазки из пяти.
   * Выше девяноста процентов не поднимает никакая цена — в каждой десятой
   * вылазке оба ближних контейнера выпадают деревом. Кому не хватило, тот идёт
   * во вторую вылазку: это первый настоящий отказ по цене, и он обязан быть.
   *
   * Таймера у первого уровня по-прежнему нет (§20.2): ждать игрок ещё
   * не научился, а платить пролог его уже научил.
   */
  1: { stone: 2 },
  2: { stone: 7, wood: 4 },
  3: { stone: 8, wood: 4, iron: 3 },
  4: { stone: 14, wood: 5, iron: 15 },
  5: { stone: 23, wood: 9, iron: 24, crystal: 7 },
  6: { stone: 48, iron: 70, crystal: 40 },
};

/**
 * Ярус открывается уровнем Кухни. Таблица выведена моделью: запас провианта
 * обязан лежать между «до дна и обратно» и «полным обходом» (§12.2),
 * и уровень Кухни — единственное, что этим управляет.
 */
export { TIER_KITCHEN_GATE } from './balance';

export type TierBlock = 'ok' | 'kitchen';

/** Причина, а не булево: игрок должен видеть, чего именно не хватает. */
export function tierBlock(camp: CampState, tier: Tier): TierBlock {
  return camp.levels.kitchen >= GATE[tier] ? 'ok' : 'kitchen';
}

export interface Construction {
  readonly building: BuildingId;
  readonly toLevel: number;
  readonly startedAt: number;
  readonly endsAt: number;
}

export interface CampState {
  /** Уровень 0 = здания ещё нет в лагере. Такое возможно только у Мастерской. */
  levels: Record<BuildingId, number>;
  layout: Record<BuildingId, { x: number; z: number }>;
  /**
   * Якорь площадки на поляне пролога (§16.1): клетка поляны, в которой стоит
   * клетка (0,0) площади. Лагерь стоит там, где игрок разбил палатку, а не
   * в отдельном месте: перенос в свой мир читался бы как второй лагерь.
   * Поле необязательное: старые сейвы и отладочные сцены живут в нулевом
   * якоре — их площадка сама себе координаты.
   */
  origin?: { x: number; z: number };
  /**
   * Поляна, на которой встал лагерь (§16.1): занятые клетки на момент конца
   * пролога, срубленное срублено. Лагерь рисует из них тот же лес, что видел
   * игрок в прологе, — сцена не меняется, меняется подпись кадра.
   * Необязательна: старые сейвы и отладочные сцены живут с лесом-кольцом.
   */
  glade?: { size: number; cells: string };
  /**
   * Сделки с торговцем (§13.5): отношения меряются руками, а не словами —
   * каждая снимает часть наценки (`trade.ts`). Необязательное: старые сейвы
   * начинают незнакомыми.
   */
  trades?: number;
  resources: Resources;
  /** §20.1 — один слот. Это и делает вопрос «что дальше» настоящим выбором. */
  construction: Construction | null;
  /** §14 — снаряжение живёт в лагере, а не в вылазке: при провале не теряется. */
  gear: GearState;
  /** Приглашённые жильцы (`residents.ts`). Герой в список не входит: он
   *  живёт в Жилье, и считать его дважды значило бы завести ему вторую
   *  палатку. */
  residents: Resident[];
  /** Палатки сверх Жилья. Уровня у них нет — только место 2×2 и место
   *  для одного человека. */
  tents: { x: number; z: number }[];
  /**
   * §14.2 — что в левой руке. Поле лагеря, а не шестой слот GearState:
   * уровень предмета куётся, а рука перекладывается — бесплатно, мгновенно
   * и перед каждым выходом. Втиснуть его в GearState значило бы поправить
   * все циклы по слотам ради величины, которая слотом не является.
   */
  offhand: Offhand;
  /**
   * §14.3 — стрелы в лагере. Покупаются и подбираются, поэтому это запас,
   * а не расходник §21: расходник сгорает на выходе, а стрелы возвращаются
   * с тем, кто вернулся. Приберечь их всё равно нельзя — тратит их бой,
   * который автоматичен (§11.3), а кнопки выстрела нет нигде.
   */
  arrows: number;
  /** Расходники, купленные к следующей вылазке (§21). Сгорают на выходе:
   *  между вылазками не переносятся, поэтому копить нечего. */
  loadout: ConsumableId[];
  raids: number;
  /**
   * Куда и когда ходил игрок (§4). Единственное, что мир хранит: всё
   * остальное — кланы, богатство, раскладка — выводится из сида и часов.
   */
  visits: Visit[];
  /**
   * Стены лагеря (§6.1.6). Хранятся клетками, а не деталями: деталь — вывод
   * конструктора, и второй источник правды тут ни к чему. Поле необязательное:
   * сохранения, сделанные до стройки стен, обязаны открываться.
   */
  walls?: CampWalls;
  /**
   * Отряд, ушедший без игрока (§25). Один билет на лагерь — тот же слот,
   * что у стройки (§20.1): два похода разом превратили бы лагерь в очередь
   * заданий. Поле необязательное, версия сейва ради него не поднята —
   * сохранения, сделанные до отправок, обязаны открываться.
   */
  sortie?: Sortie | null;
  /**
   * Валуны на площадке (§13.4). Разбитые из списка не выпадают, а помечаются
   * — сохранение пишет остаток, и разобранный лагерь после перезагрузки
   * остаётся разобранным.
   */
  stones: Stone[];
}

/**
 * Раскладка, с которой лагерь начинается. След здания 2×2, площадь при Жилье
 * ур. 1 — 6×6, поэтому левый верхний угол не может быть правее 4 (§20.4).
 * Мастерская появляется вместе с Жильём ур. 2, когда площадь уже 7×7.
 *
 * Отдельной константой она стала ради валунов: их кладут мимо зданий,
 * и вторая копия начальных мест разошлась бы с первой молча.
 */
/**
 * Третий столбец (x = 6) появляется вместе с Лазаретом: до Жилья ур. 3
 * площадка 6×6…7×7 его не вмещает, а раньше третьего уровня ни Лазарета,
 * ни Плаца не существует. Переставить их игрок волен свободно (§20.4).
 */
const START_LAYOUT: Record<BuildingId, { x: number; z: number }> = {
  hq: { x: 1, z: 1 },
  kitchen: { x: 4, z: 1 },
  storage: { x: 1, z: 4 },
  forge: { x: 4, z: 4 },
  infirmary: { x: 6, z: 1 },
  yard: { x: 6, z: 4 },
};

/**
 * Валуны лагеря. Раскладка одна на всех и не зависит ни от чего: лагерь
 * у всех начинается одинаковым — с той же планировкой и теми же уровнями,
 * — и камни на нём такая же часть стартовой площадки, как след Жилья.
 *
 * Разбрасываются они по **самой большой** площадке, а не по нынешней:
 * площадь растёт с Жильём (§20.4), и валун за нынешней кромкой — это
 * не ошибка, а камень, до которого лагерь ещё не дорос. Первые три уровня
 * он лежит в лесу вокруг, и это ровно то, что видно глазом.
 *
 * Следы зданий исключены: тап по зданию открывает его карточку, и валун
 * под Жильём был бы камнем, по которому нельзя ударить.
 */
export function campStones(): Stone[] {
  const area = campArea(MAX_LEVEL);
  const under = (x: number, z: number): boolean =>
    BUILDING_ORDER.some((id) => {
      const p = START_LAYOUT[id];
      return x >= p.x && z >= p.z && x < p.x + 2 && z < p.z + 2;
    });
  // Сид назван, а не выведен: выводить его не из чего — лагерь один
  // и у всех одинаковый.
  return scatterStones(0x5ca3, area, new Uint8Array(area * area), STONES.camp, (x, z) => !under(x, z));
}

export function createCamp(): CampState {
  return {
    levels: { hq: 1, kitchen: 1, storage: 1, forge: 0, infirmary: 0, yard: 0 },
    layout: {
      hq: { ...START_LAYOUT.hq },
      kitchen: { ...START_LAYOUT.kitchen },
      storage: { ...START_LAYOUT.storage },
      forge: { ...START_LAYOUT.forge },
      infirmary: { ...START_LAYOUT.infirmary },
      yard: { ...START_LAYOUT.yard },
    },
    resources: emptyResources(),
    construction: null,
    gear: emptyGear(),
    residents: [],
    tents: [],
    // Умолчание — фонарь: так левая рука вела себя до §14.2, и ни один
    // прежний прогон от появления поля не сдвинулся ни на число.
    offhand: 'torch',
    /**
     * §14.3 — колчан заводится полным, а не пустым. Пустой запирал сам себя:
     * пачка стоит железа, железо падает с яруса 1, ярус 1 отпирает Кухня ур. 2,
     * а до неё Лучник — класс, доступный сразу после пролога (`HERO_HQ_GATE`), —
     * выходил без единой стрелы. Подбор в вылазке этого не чинил: он упирается
     * в `arrows < arrowsMax`, а вместимость от пустого запаса не зависит.
     *
     * Дальше запас держит себя сам: что не выстрелили — возвращается, контейнеры
     * досыпают, железо докупает. Стартовая пачка нужна только чтобы петля
     * началась.
     */
    arrows: bowQuiver(0),
    loadout: [],
    raids: 0,
    visits: [],
    walls: emptyWalls(),
    stones: campStones(),
  };
}

/** Здание существует в лагере: построено или хотя бы доступно к постройке. */
export const isUnlocked = (camp: CampState, id: BuildingId): boolean =>
  camp.levels.hq >= BUILDINGS[id].unlockHq;

/** Здания, которые сейчас стоят на земле. Уровень 0 — это пустое место. */
export const builtBuildings = (camp: CampState): BuildingId[] =>
  BUILDING_ORDER.filter((id) => camp.levels[id] > 0);

export type UpgradeBlock =
  | 'ok'
  | 'max'
  | 'locked'
  | 'hq-cap'
  | 'slot-busy'
  | 'resources';

/**
 * Почему улучшение недоступно. Возвращается причина, а не булево: игрок должен
 * видеть «Жильё не пускает», а не молчащую серую кнопку.
 */
export function upgradeBlock(camp: CampState, id: BuildingId): UpgradeBlock {
  const level = camp.levels[id];
  if (level >= MAX_LEVEL) return 'max';
  // Здание, которого ещё нет: причина «нужен Жильё ур. N», а не пустое место.
  if (!isUnlocked(camp, id)) return 'locked';
  // §20.4 — единственный настоящий ограничитель: никакое здание не может
  // превысить уровень Жилья.
  if (id !== 'hq' && level + 1 > camp.levels.hq) return 'hq-cap';
  // Слот один на лагерь, и стена в нём — такая же стройка, как улучшение
  // (§20.1, §6.1.6). Стена и здание впервые спорят за одно и то же, и это
  // ровно тот вопрос «что дальше», ради которого слот и один.
  if (camp.construction !== null || camp.walls?.work != null) return 'slot-busy';
  if (!canAfford(camp.resources, BUILD_COST[level + 1] ?? {})) return 'resources';
  return 'ok';
}

/**
 * Слова причины — здесь же, рядом с причиной (§23.3). Разнесённые по файлам,
 * они расходятся: панель говорила «Жильё не пускает выше», а полоса про то же
 * самое — «выше Жилья нельзя».
 *
 * `ok` в таблице нет намеренно: строка отказа существует только там, где есть
 * отказ, и звать таблицу с `ok` неоткуда — причина известна до строки.
 *
 * `locked` называет ур. 2 числом, потому что это единственный `unlockHq`
 * выше единицы во всём списке зданий. Появится второй — число уйдёт отсюда
 * к зданию.
 */
export const UPGRADE_REASON: Record<Exclude<UpgradeBlock, 'ok'>, string> = {
  max: 'Максимальный уровень',
  locked: 'Нужно Жильё ур. 2',
  'hq-cap': 'Жильё не пускает выше',
  'slot-busy': 'Слот занят другой стройкой',
  resources: 'Не хватает ресурсов',
};

export function startUpgrade(camp: CampState, id: BuildingId, now: number): boolean {
  if (upgradeBlock(camp, id) !== 'ok') return false;
  const toLevel = camp.levels[id] + 1;
  spend(camp.resources, BUILD_COST[toLevel] ?? {});
  const seconds = BUILD_SECONDS[toLevel] ?? 0;
  camp.construction = { building: id, toLevel, startedAt: now, endsAt: now + seconds };
  // Ур. 1 мгновенный (§20.2) — здание вырастает на глазах в онбординге.
  if (seconds === 0) completeIfDue(camp, now);
  return true;
}

export function completeIfDue(camp: CampState, now: number): BuildingId | null {
  const c = camp.construction;
  if (c === null || now < c.endsAt) return null;
  camp.levels[c.building] = c.toLevel;
  camp.construction = null;
  return c.building;
}

/**
 * §20.5 — бесплатное окно: min(5 минут, 25% таймера).
 *
 * Плоские «последние пять минут» сталкивались с §20.2: стройка второго
 * уровня идёт ровно три минуты и целиком лежала внутри окна, поэтому первый
 * таймер игры — тот, на котором игрок должен впервые почувствовать
 * ожидание, — пропускался даром с первой секунды. Доля от таймера чинит
 * это, ничего не меняя для длинных: у трёхчасовой и восьмичасовой стройки
 * 25% всё равно упираются в потолок пяти минут.
 */
export const freeWindow = (totalSeconds: number): number =>
  Math.min(5 * 60, totalSeconds * 0.25);

/**
 * §20.5 — 2 камня за минуту, ×1.5 за каждый час: дёшево для коротких таймеров,
 * дорого для длинных. Ускорять ночную стройку невыгодно.
 */
export function speedupCost(remainingSeconds: number, totalSeconds: number): number {
  if (remainingSeconds <= freeWindow(totalSeconds)) return 0;
  const minutes = Math.ceil(remainingSeconds / 60);
  const hours = Math.floor(remainingSeconds / 3600);
  return Math.ceil(2 * minutes * Math.pow(1.5, hours));
}

export function speedup(camp: CampState, now: number): boolean {
  const c = camp.construction;
  if (c === null) return false;
  const cost = speedupCost(c.endsAt - now, c.endsAt - c.startedAt);
  if (camp.resources.stone < cost) return false;
  camp.resources.stone -= cost;
  camp.construction = { ...c, endsAt: now };
  completeIfDue(camp, now);
  return true;
}

/**
 * Что предложить на экране возврата (§20.1: главная кнопка — трата, а не
 * повтор). Берём самое дешёвое доступное улучшение: дорогое читается как
 * «мне это не по карману» и подмену главного действия не выполняет.
 *
 * null означает, что покупки нет — слот занят или не хватает ресурсов.
 * В документе на этот случай предусмотрен второй сток без таймера
 * (снаряжение в Мастерской), но Мастерской в v0 нет — см. README.
 */
export function suggestUpgrade(camp: CampState): BuildingId | null {
  let best: BuildingId | null = null;
  let bestCost = Infinity;
  for (const id of BUILDING_ORDER) {
    if (upgradeBlock(camp, id) !== 'ok') continue;
    const cost = BUILD_COST[camp.levels[id] + 1] ?? {};
    const total = Object.values(cost).reduce((a, b) => a + b, 0);
    if (total < bestCost) {
      bestCost = total;
      best = id;
    }
  }
  return best;
}

/* ---------- §14: Мастерская и снаряжение ---------- */

export type GearBlock = 'ok' | 'no-forge' | 'max' | 'forge-cap' | 'resources';

/**
 * Почему ковка недоступна — по тем же правилам, что и стройка: причина, а не
 * серая кнопка. Слот стройки здесь не участвует вовсе, и это весь смысл
 * Мастерской: §20.1 требует стока, который работает, пока идёт таймер.
 */
export function gearBlock(camp: CampState, slot: GearSlot): GearBlock {
  if (camp.levels.forge <= 0) return 'no-forge';
  const next = camp.gear[slot] + 1;
  if (next > MAX_ITEM_LEVEL) return 'max';
  // §14 — Мастерская улучшает, а не рандомит: качество ограничено ею самой.
  if (next > itemCap(camp.levels.forge)) return 'forge-cap';
  if (!canAfford(camp.resources, GEAR_COST[next] ?? {})) return 'resources';
  return 'ok';
}

/** Слова причины ковки — рядом с причиной (§23.3). */
export const GEAR_REASON: Record<Exclude<GearBlock, 'ok'>, string> = {
  'no-forge': 'Нужна Мастерская',
  max: 'Лучше не бывает',
  'forge-cap': 'Мастерская не тянет выше',
  resources: 'Не хватает железа',
};

/**
 * Ковка и улучшение — одно действие: пустой слот получает ур. 1, занятый
 * растёт на уровень. Разделять их не на чем — предмет в слоте один,
 * и «выковать второй» означало бы инвентарь, которого §14 не просит.
 *
 * Действие мгновенное. Это не поблажка, а условие задачи: сток, который сам
 * встаёт в очередь за таймером, не заменяет постройку на экране возврата.
 */
export function craftGear(camp: CampState, slot: GearSlot): boolean {
  if (gearBlock(camp, slot) !== 'ok') return false;
  const next = camp.gear[slot] + 1;
  spend(camp.resources, GEAR_COST[next] ?? {});
  camp.gear[slot] = next;
  return true;
}

/**
 * Что предложить в Мастерской — самое дешёвое доступное. Правило то же, что
 * у suggestUpgrade: дорогое предложение читается как «мне это не по карману»
 * и подмену главного действия не выполняет.
 */
export function suggestGear(camp: CampState): GearSlot | null {
  let best: GearSlot | null = null;
  let bestCost = Infinity;
  for (const slot of GEAR_ORDER) {
    if (gearBlock(camp, slot) !== 'ok') continue;
    const cost = GEAR_COST[camp.gear[slot] + 1] ?? {};
    const total = Object.values(cost).reduce((a, b) => a + b, 0);
    if (total < bestCost) {
      bestCost = total;
      best = slot;
    }
  }
  return best;
}

/** Как называется то, что предлагает Мастерская: «Выковать» пустому слоту,
 *  «Улучшить» — занятому. Игрок должен понимать это до нажатия. */
/**
 * §14.3 — цена пачки стрел. Железо, а не камень: камень уходит в ускорения
 * (§20.5) и расходники (§21), и третий сток на нём превратил бы экран
 * возврата в торговый автомат, от которого предостерегает §21.3.
 */
export const ARROW_PACK = 4;
export const ARROW_PACK_COST: Partial<Resources> = { iron: 1 };

/** Влезет ли ещё пачка и есть ли на неё железо. */
export function canBuyArrows(camp: CampState, cap: number): boolean {
  return camp.arrows < cap && canAfford(camp.resources, ARROW_PACK_COST);
}

/**
 * Купить пачку. Запас не выше вместимости колчана: сверх неё стрелы
 * не влезут в вылазку, и продавать их значило бы продавать пустоту.
 */
export function buyArrows(camp: CampState, cap: number): boolean {
  if (!canBuyArrows(camp, cap)) return false;
  spend(camp.resources, ARROW_PACK_COST);
  camp.arrows = Math.min(cap, camp.arrows + ARROW_PACK);
  return true;
}

/**
 * §14.2 — переложить предмет в левой руке. Не ковка: уровень тот же, цены нет,
 * таймера нет. Это выбор перед выходом, и он обязан быть бесплатным — иначе
 * игрок перестанет его пересматривать, а весь смысл слота в пересмотре.
 */
export function setOffhand(camp: CampState, offhand: Offhand): boolean {
  if (camp.offhand === offhand) return false;
  camp.offhand = offhand;
  return true;
}

export function gearAction(camp: CampState, slot: GearSlot): string {
  return camp.gear[slot] <= 0 ? `Выковать: ${GEAR[slot].name}` : `Улучшить: ${GEAR[slot].name}`;
}

/** Доля до следующей ступени снаряжения — по самому дефицитному ресурсу. */
export function gearProgress(camp: CampState, slot: GearSlot): number {
  const cost = GEAR_COST[camp.gear[slot] + 1];
  if (cost === undefined) return 1;
  let worst = 1;
  for (const [kind, amount] of Object.entries(cost) as [keyof Resources, number][]) {
    if (amount <= 0) continue;
    worst = Math.min(worst, camp.resources[kind] / amount);
  }
  return Math.max(0, Math.min(1, worst));
}

/**
 * Насколько игрок близок к следующему улучшению, 0..1 — по самому дефицитному
 * ресурсу. §20.3 целится в «добыча одной вылазки ≈ 70% стоимости следующего
 * улучшения», и эта доля показывает, попадаем ли мы туда.
 */
export function upgradeProgress(camp: CampState, id: BuildingId): number {
  const cost = BUILD_COST[camp.levels[id] + 1];
  if (cost === undefined) return 1;
  let worst = 1;
  for (const [kind, amount] of Object.entries(cost) as [keyof Resources, number][]) {
    if (amount <= 0) continue;
    worst = Math.min(worst, camp.resources[kind] / amount);
  }
  return Math.max(0, Math.min(1, worst));
}

/** camp.html: жителей два плюс по одному на каждые четыре уровня, потолок десять.
 *  Непостроенное здание уровня не имеет и жителей не добавляет. */
export function villagerCount(camp: CampState): number {
  const sum = BUILDING_ORDER.reduce((acc, id) => acc + Math.max(0, camp.levels[id]), 0);
  return Math.min(10, 2 + Math.floor(sum / 4));
}

/** §20.4 — перестановка бесплатна и мгновенна: планировка выразительная,
 *  а не механическая. Занятость клетки проверяется, площадь — по Жилью. */
export function moveBuilding(camp: CampState, id: BuildingId, x: number, z: number): boolean {
  const area = campArea(camp.levels.hq);
  if (x < 0 || z < 0 || x + 2 > area || z + 2 > area) return false;
  for (const other of BUILDING_ORDER) {
    if (other === id) continue;
    // Непостроенное здание не занимает место: пустой участок не должен
    // мешать переставлять соседей.
    if (camp.levels[other] <= 0) continue;
    const p = camp.layout[other];
    if (Math.abs(p.x - x) < 2 && Math.abs(p.z - z) < 2) return false;
  }
  // Стена зданию не мешает: она закрывает путь игроку, а планировка лагеря
  // остаётся свободной — §20.4 требует от неё выразительности, а не логистики.
  camp.layout[id] = { x, z };
  return true;
}
