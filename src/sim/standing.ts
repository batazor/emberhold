/**
 * Сила лагеря и таблица по ней (§30) — одно число, которым лагеря
 * сравниваются между собой.
 *
 * **Это не сила бойца из §22.11.** Там разбирался чужой метод «сила = HP×DMG»
 * и был отвергнут замером: у нас сила бойца — пара, а не число, потому что
 * урон зависит от того, кого бьют. Здесь другая величина и другой вопрос:
 * не «кто кого побьёт», а «сколько в лагерь вложено». Общего у них только
 * слово, и путать их нельзя — отсюда и разные имена файлов
 * (`scripts/power.ts` меряет ту, `scripts/standing.ts` — эту).
 *
 * **Сила измеряется, а не назначается**, и единица у неё уже есть: §20.3
 * выводит цену уровня из числа вылазок, за которые он окупается. Значит
 * и сила — это **вылазки, вложенные в лагерь**: сколько раз надо было
 * сходить, чтобы всё стоящее в лагере там оказалось.
 *
 * Приведение считается тем же путём, каким §20.3 назначал цены, только
 * назад: цена в ресурсах делится на ценность добычи того яруса, на который
 * игрок за ней ходит. На постройках это проверяемо до последнего знака —
 * `standing.rules.ts` сверяет вывод с `RAIDS_PER_LEVEL`, и расхождение больше
 * четверти вылазки валит сборку. Другой единицы у нас нет: секунда игрока
 * (`npm run fence`) меряет то же самое, но требует прогона вылазок и потому
 * в игре не считается.
 *
 * **Что входит в силу: то, что работает.** Здания, снаряжение, палатки
 * и сундуки — у каждого есть эффект, названный в его карточке. Стены
 * в силу не входят намеренно: `campWalls.ts` прямо говорит, что стена пока
 * не даёт ничего, и считать её силой значило бы обещать эффект, которого нет.
 *
 * **Людей сила не считает.** Человек не имущество, цены у него нет, и делить
 * жильца на вылазки — это не измерение, а выдумка. Сколько в лагере народу,
 * карточка говорит отдельной строкой, рядом с силой и не внутри неё.
 *
 * **Отряд сила тоже не считает.** Шкала общая с фракциями (§4), а у фракции
 * героев нет вовсе: сравнивать по тому, что есть у одной стороны, значит
 * сравнивать не по чему.
 */
import { TIER_HAUL, roundNice, tierForLevel } from './balance';
import { BUILDING_ORDER, BUILD_COST, MAX_LEVEL } from './camp';
import type { CampState } from './camp';
import { CHEST_COST } from './chests';
import { GEAR_COST, GEAR_ORDER, MAX_ITEM_LEVEL } from './gear';
import { LOOT_SHARE } from './resources';
import type { ResourceKind, Resources } from './resources';
import { TENT_COST } from './residents';
import { VALUE } from './trade';
import type { Tier } from './types';
import { CLANS, clanGrowth, clanState } from './world';

const TIERS: readonly Tier[] = [0, 1, 2, 3];

/**
 * Ценность кристалла — единственная, которой нет у торговца (§13.5: кристалл
 * не продаётся и не принимается). Выводится из таблицы добычи: на дне железо
 * падает долей 0,45, кристалл — 0,25, значит одна находка кристалла стоит
 * стольких же вскрытий, сколько 1,8 находки железа.
 *
 * Ярус взят самый глубокий: кристалл берут там, где его берут. На ярусе 2
 * тот же счёт даёт 84 — вдвое дороже, — и это не второе мнение о кристалле,
 * а цена мелкого яруса, на который за кристаллом не ходят.
 */
export const CRYSTAL_VALUE =
  (VALUE.iron ?? 0) * ((LOOT_SHARE[3].iron ?? 0) / (LOOT_SHARE[3].crystal ?? 1));

/** Линейка ценности для силы: курс торговца плюс выведенный кристалл. */
export const POWER_VALUE: Record<ResourceKind, number> = {
  stone: VALUE.stone ?? 0,
  wood: VALUE.wood ?? 0,
  iron: VALUE.iron ?? 0,
  crystal: CRYSTAL_VALUE,
  food: 0,
  meat: VALUE.meat ?? 0,
  pelt: VALUE.pelt ?? 0,
};

/** Ценность кучки ресурсов по этой линейке. */
export const worthOf = (part: Partial<Resources>): number =>
  (Object.entries(part) as [ResourceKind, number][]).reduce(
    (sum, [kind, n]) => sum + POWER_VALUE[kind] * n,
    0,
  );

/**
 * Ценность добычи одной успешной вылазки яруса. `TIER_HAUL` измерен
 * (`npm run measure`), состав берётся из той же таблицы, по которой генератор
 * раскладывает находки, — то есть ровно то, чем §20.3 назначал цены.
 */
export const raidWorth = (tier: Tier): number =>
  TIER_HAUL[tier] *
  (Object.entries(LOOT_SHARE[tier]) as [ResourceKind, number][]).reduce(
    (sum, [kind, share]) => sum + POWER_VALUE[kind] * share,
    0,
  );

/**
 * Самый мелкий ярус, на котором эту цену вообще можно собрать: ресурс, который
 * на ярусе не падает, там не добывается ни за сколько заходов.
 */
const dropTier = (cost: Partial<Resources>): Tier =>
  TIERS.find((t) =>
    (Object.keys(cost) as ResourceKind[]).every((kind) => (LOOT_SHARE[t][kind] ?? 0) > 0),
  ) ?? 3;

/**
 * Ярус, которым платят за вещь уровня `level`. Два условия, и оба обязательны:
 * игрок ходит туда, куда его пустила Кухня (`tierForLevel`, §22), но железа
 * на нулевом ярусе нет ни при какой Кухне (`dropTier`). Старшее из двух —
 * и есть тот заход, которым цена собирается.
 */
const payTier = (level: number, cost: Partial<Resources>): Tier =>
  Math.max(tierForLevel(level), dropTier(cost)) as Tier;

/** Цена в вылазках: ценность, делённая на то, что вылазка приносит. */
export const raidsFor = (level: number, cost: Partial<Resources>): number =>
  worthOf(cost) / raidWorth(payTier(level, cost));

/**
 * Цена одной ступени здания в вылазках. До потолка Жилья она выводится
 * из таблицы цен, выше потолка таблицы нет вовсе — и там ступень
 * продолжается **последним измеренным шагом**.
 *
 * Это единственная выдумка §30, и другой у неё быть не может: за потолком
 * лагеря никто не строил, мерить нечего. Шаг взят у последней пары ступеней,
 * а не выбран: он и есть то, чем цена росла там, где её ещё считали.
 * Нужен он ровно фракциям — их возраст обгоняет потолок лагеря, — и это
 * же место, куда придётся вернуться, когда потолок поднимут.
 */
export function levelRaids(level: number): number {
  if (level <= 0) return 0;
  if (level <= MAX_LEVEL) return raidsFor(level, BUILD_COST[level] ?? {});
  const last = raidsFor(MAX_LEVEL, BUILD_COST[MAX_LEVEL] ?? {});
  const step = last - raidsFor(MAX_LEVEL - 1, BUILD_COST[MAX_LEVEL - 1] ?? {});
  return last + step * (level - MAX_LEVEL);
}

/**
 * Сколько вылазок вложено в здание уровня `level` — все ступени вместе.
 * Дробный уровень считается вставкой между соседними ступенями: у фракции
 * уровень дробный (`clanGrowth`), и округлять его до целого здесь значило бы
 * округлить дважды (§20.3.3).
 */
export function buildingRaids(level: number): number {
  const whole = Math.floor(Math.max(0, level));
  let sum = 0;
  for (let l = 1; l <= whole; l++) sum += levelRaids(l);
  return sum + (level - whole) * levelRaids(whole + 1);
}

/** То же для одного слота снаряжения (§14). */
export function gearRaids(level: number): number {
  let sum = 0;
  for (let l = 1; l <= Math.min(level, MAX_ITEM_LEVEL); l++) sum += raidsFor(l, GEAR_COST[l] ?? {});
  return sum;
}

/**
 * Сила лагеря. Число округляется слоем §20.3.3: игрок читает его в таблице
 * и на карточке, а не в модели, — а внутри сравнения идут по неокруглённому
 * (`rawPower`), иначе два соседних лагеря слипались бы в один.
 */
export function rawPower(camp: CampState): number {
  let sum = 0;
  for (const id of BUILDING_ORDER) sum += buildingRaids(Math.min(MAX_LEVEL, camp.levels[id]));
  for (const slot of GEAR_ORDER) sum += gearRaids(camp.gear[slot]);
  // Палатка и сундук — постройки без уровня: цена одна, ярус берётся тот же,
  // что у первой ступени зданий, потому что платят их тем же деревом.
  sum += camp.tents.length * raidsFor(1, TENT_COST);
  sum += camp.chests.length * raidsFor(1, CHEST_COST);
  return sum;
}

export const campPower = (camp: CampState): number => roundNice(rawPower(camp));

/**
 * Сила фракции (§4). Лагеря у неё нет — есть возраст, и читается он как
 * лагерь того же уровня: все шесть зданий на нём. Другого перевода быть
 * не может, потому что сравнивать надо по тому, что есть у обеих сторон,
 * а есть у них только лагерь.
 *
 * Считается по неокруглённому росту (`clanGrowth`), а не по целому уровню:
 * на третий день мира все четыре фракции стоят на шестом, и таблица
 * показала бы четыре одинаковые строки.
 */
export const clanRaids = (growth: number): number =>
  BUILDING_ORDER.length * buildingRaids(growth);

export const clanPower = (growth: number): number => roundNice(clanRaids(growth));

/**
 * Строка таблицы лагерей (§4 — «таблица развития лагерей»). Одна форма
 * на своих и на фракции: таблица, в которой игрок описан не теми полями,
 * что соседи, — это две таблицы рядом, а не сравнение.
 */
export interface Standing {
  /** Кто: имя фракции или имя своего клана, если он заведён (§30). */
  readonly who: string;
  /**
   * Чья это строка. Три вида, и путать их нельзя: фракция — часть мира (§4),
   * сосед — живой игрок (§30.7), «вы» — ровно одна строка на таблицу.
   * Отдельным полем, а не булевым `you`: у соседа и фракции разное всё —
   * от цвета до того, что про них вообще известно.
   */
  readonly kind: 'фракция' | 'сосед' | 'вы';
  readonly power: number;
  readonly level: number;
  readonly color: string;
  /** Сколько человек: у фракции неизвестно (null), у себя — жильцы и герой. */
  readonly folk: number | null;
}

/** Цвет своей строки: золото лагеря, тот же, каким карта рисует палатку. */
export const OWN_COLOR = '#c8a24a';

/**
 * Цвет живого соседа — один на всех, и это решение, а не заглушка. Цвет
 * во фракциях значит «какая именно»; у соседей значить ему нечего: они
 * не четыре знакомых флага, а сколько-то незнакомых людей. Различает их
 * имя клана, а не оттенок.
 *
 * Взят холодный светлый — единственный не занятый ни богатством (красный —
 * зелёный), ни замком (золото), ни ярмаркой (фиолетовый).
 */
export const LIVE_COLOR = '#9fb6d8';

/** Лагерь живого соседа: ровно то, что он показывает другим (§30.7). */
export interface LiveCamp {
  readonly id: string;
  readonly clan: string | null;
  readonly power: number;
  readonly level: number;
  readonly folk: number;
}

/** Имя лагеря без клана. Не заглушка, а повод его завести (§30.4). */
export const NO_CLAN = 'Лагерь без имени';

/**
 * Уровень лагеря игрока — Жильё: §20.4 оставляет роль потолка одному ему,
 * и второй лестницы уровней в лагере нет.
 */
export const campLevel = (camp: CampState): number => camp.levels.hq;

/**
 * Таблица по силе. Сортировка идёт по неокруглённому числу: округление —
 * последний слой между моделью и экраном (§20.3.3), и решать порядок оно
 * не имеет права.
 */
export function standings(
  camp: CampState,
  t: number,
  own: string | null,
  live: readonly LiveCamp[] = [],
): Standing[] {
  const rows: { readonly raw: number; readonly row: Standing }[] = CLANS.map((clan, id) => {
    const growth = clanGrowth(id, t);
    const level = clanState(id, t).level;
    return {
      raw: clanRaids(growth),
      row: {
        who: clan.name,
        kind: 'фракция',
        power: clanPower(growth),
        level,
        color: clan.color,
        folk: null,
      },
    };
  });
  rows.push({
    raw: rawPower(camp),
    row: {
      who: own ?? 'Ваш лагерь',
      kind: 'вы',
      power: campPower(camp),
      level: campLevel(camp),
      color: OWN_COLOR,
      folk: 1 + camp.residents.length,
    },
  });
  for (const neighbour of live) {
    rows.push({
      // Сила соседа приходит уже посчитанной: считал её его лагерь тем же
      // правилом, что и наш свой. Пересчитать её нечем — состава чужого
      // лагеря у нас нет и не будет до серверной симуляции (§10.5).
      raw: neighbour.power,
      row: {
        who: neighbour.clan ?? NO_CLAN,
        kind: 'сосед',
        power: neighbour.power,
        level: neighbour.level,
        color: LIVE_COLOR,
        folk: neighbour.folk,
      },
    });
  }
  return rows.sort((a, b) => b.raw - a.raw).map((r) => r.row);
}

/** Место игрока в таблице, считая с единицы. */
export const yourPlace = (rows: readonly Standing[]): number =>
  rows.findIndex((r) => r.kind === 'вы') + 1;
