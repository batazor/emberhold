import type { ConsumableId } from './consumables';
import type { Resources } from './resources';
import { canAfford, emptyResources, spend } from './resources';
import { modelKitchenFood, TIER_KITCHEN_GATE as GATE } from './balance';
import type { Tier } from './types';

/** Прототип v0 (§7): три здания. Кузница, Лазарет и Плац — после петли. */
export type BuildingId = 'hq' | 'kitchen' | 'storage';

export const BUILDING_ORDER: readonly BuildingId[] = ['hq', 'kitchen', 'storage'];

export const MAX_LEVEL = 6;

export interface BuildingDef {
  readonly id: BuildingId;
  readonly name: string;
  /** §2: каждое здание обязано отвечать на вопрос «что я смогу в вылазке». */
  readonly effect: (level: number) => string;
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

/** §20.4 — площадь растёт со Штабом: 6×6 на ур. 1 … 10×10 на ур. 5. */
export const campArea = (hqLevel: number): number => Math.min(10, 5 + hqLevel);

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  hq: {
    id: 'hq',
    name: 'Штаб',
    effect: (l) => `Потолок уровня зданий ${l} · площадь ${campArea(l)}×${campArea(l)}`,
  },
  kitchen: {
    id: 'kitchen',
    name: 'Кухня',
    effect: (l) => `Провиант ${kitchenFood(l)} — это максимальная глубина захода`,
  },
  storage: {
    id: 'storage',
    name: 'Склад',
    effect: (l) => `Рюкзак ${storageCapacity(l)} — столько добычи можно вынести`,
  },
};

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
 * | 0    | 100%  |  6,4   | соль 4,5 · дерево 2,0                    |
 * | 1    |  88%  |  7,6   | соль 3,9 · дерево 2,1 · железо 1,6       |
 * | 2    |  73%  | 15,9   | соль 5,8 · дерево 2,2 · железо 6,1 · кристалл 1,8 |
 * | 3    |  79%  | 22,4   | соль 6,8 · железо 9,9 · кристалл 5,7     |
 *
 * Темп: ур. 2 — полторы вылазки яруса 1, ур. 3 — две, ур. 4 — три вылазки
 * яруса 2, ур. 5 — пять, ур. 6 — семь вылазок яруса 3 (последняя ступень
 * экстраполирована, таблица документа заканчивается на пятой).
 */
export const BUILD_COST: Record<number, Partial<Resources>> = {
  2: { salt: 7, wood: 4 },
  3: { salt: 8, wood: 4, iron: 3 },
  4: { salt: 14, wood: 5, iron: 15 },
  5: { salt: 23, wood: 9, iron: 24, crystal: 7 },
  6: { salt: 48, iron: 70, crystal: 40 },
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
  levels: Record<BuildingId, number>;
  layout: Record<BuildingId, { x: number; z: number }>;
  resources: Resources;
  /** §20.1 — один слот. Это и делает вопрос «что дальше» настоящим выбором. */
  construction: Construction | null;
  /** Расходники, купленные к следующей вылазке (§21). Сгорают на выходе:
   *  между вылазками не переносятся, поэтому копить нечего. */
  loadout: ConsumableId[];
  raids: number;
}

export function createCamp(): CampState {
  return {
    levels: { hq: 1, kitchen: 1, storage: 1 },
    // След здания 2×2, площадь при Штабе ур. 1 — 6×6, поэтому левый
    // верхний угол не может быть правее 4 (§20.4).
    layout: { hq: { x: 1, z: 1 }, kitchen: { x: 4, z: 1 }, storage: { x: 1, z: 4 } },
    resources: emptyResources(),
    construction: null,
    loadout: [],
    raids: 0,
  };
}

export type UpgradeBlock =
  | 'ok'
  | 'max'
  | 'hq-cap'
  | 'slot-busy'
  | 'resources';

/**
 * Почему улучшение недоступно. Возвращается причина, а не булево: игрок должен
 * видеть «Штаб не пускает», а не молчащую серую кнопку.
 */
export function upgradeBlock(camp: CampState, id: BuildingId): UpgradeBlock {
  const level = camp.levels[id];
  if (level >= MAX_LEVEL) return 'max';
  // §20.4 — единственный настоящий ограничитель: никакое здание не может
  // превысить уровень Штаба.
  if (id !== 'hq' && level + 1 > camp.levels.hq) return 'hq-cap';
  if (camp.construction !== null) return 'slot-busy';
  if (!canAfford(camp.resources, BUILD_COST[level + 1] ?? {})) return 'resources';
  return 'ok';
}

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
 * §20.5 — 2 соли за минуту, ×1.5 за каждый час: дёшево для коротких таймеров,
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
  if (camp.resources.salt < cost) return false;
  camp.resources.salt -= cost;
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
 * (снаряжение в Кузнице), но Кузницы в v0 нет — см. README.
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

/** camp.html: жителей два плюс по одному на каждые четыре уровня, потолок десять. */
export function villagerCount(camp: CampState): number {
  const sum = BUILDING_ORDER.reduce((acc, id) => acc + camp.levels[id], 0);
  return Math.min(10, 2 + Math.floor(sum / 4));
}

/** §20.4 — перестановка бесплатна и мгновенна: планировка выразительная,
 *  а не механическая. Занятость клетки проверяется, площадь — по Штабу. */
export function moveBuilding(camp: CampState, id: BuildingId, x: number, z: number): boolean {
  const area = campArea(camp.levels.hq);
  if (x < 0 || z < 0 || x + 2 > area || z + 2 > area) return false;
  for (const other of BUILDING_ORDER) {
    if (other === id) continue;
    const p = camp.layout[other];
    if (Math.abs(p.x - x) < 2 && Math.abs(p.z - z) < 2) return false;
  }
  camp.layout[id] = { x, z };
  return true;
}
