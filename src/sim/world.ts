/**
 * Мир: карта локаций (§4). Вход в вылазку идёт отсюда, а не из списка ярусов:
 * список кнопок сравнивать не с чем, а карта существует ровно затем, чтобы
 * у похода была причина выбирать место (`world.html`, часть I).
 *
 * Модель — из артбука `world.html` и §4: **ничего не тикает.** Раскладка
 * точек, кланы и богатство локации — чистые функции от сида и часов;
 * в сохранении живут только дельты игрока (куда ходил и когда).
 *
 * **Регион пересобирается каждый день.** Точки, их число и ярусы выпадают
 * заново: постоянного соотношения нет, и день на день не приходится. Отсюда
 * же причина открыть карту утром — вчерашняя расстановка ничего не говорит
 * о сегодняшней.
 *
 * Кухня карту запирает по ярусам (`tierBlock` в `camp.ts`, таблица §22):
 * запас провианта — это и есть максимальная глубина захода, и точка, до дна
 * которой не хватает еды, обещала бы то, чего не может. Прежде здесь стояло
 * обратное — «Кухня на карту не влияет вовсе», — и держалось это на том, что
 * гейт был написан и ни разу не позван. Карта при этом остаётся видна целиком:
 * запертая точка называет причину, а не исчезает.
 *
 * Сети в v0 нет, и это ничего здесь не меняет: та же функция считается на
 * клиенте, а когда появится сервер (§6), он повторит её и сверит результат.
 */
import { mulberry32 } from '../core/rng';
import { EVENT_WINDOW_SHIFTS, eventFor, isGentle } from './events';
import type { EventId } from './events';
import type { Tier } from './types';

/**
 * Сид региона. Один на игру: карта у всех одна, как и требует §4.
 *
 * Наружу он выставлен ради местности (`terrain.ts`): холмы и реки обязаны
 * расти из того же сида, что и раздача точек. Со своим сидом они разошлись бы
 * с картой молча — регион пересобрался бы, а земля под ним осталась вчерашней.
 */
export const SEED = 20260820;

/**
 * Начало отсчёта мира — 20 августа 2026. От него растут кланы: мир был
 * до запуска, и лагерь игрока не его центр.
 */
export const WORLD_EPOCH = 1787184000;

/** Смена: клан переезжает раз в 40 минут (быстрее сессии, медленнее суток). */
export const SHIFT_SEC = 40 * 60;
export const DAY_SEC = 24 * 60 * 60;
/** Ровно 36 смен в сутках — день начинается на границе смены, а не поперёк. */
export const SHIFTS_PER_DAY = DAY_SEC / SHIFT_SEC;

/** Окно богатства: 9 смен по 40 минут = 6 часов. */
export const RICH_WINDOW = 9;
/** Три захода — и локация выработана. */
export const RICH_MAX = 3;
/** Восстановление: +1 за 2 часа, то есть +1/3 за смену. */
export const RICH_REST = 1 / 3;

/**
 * Множитель добычи по богатству. Выработанная локация — **не запрет, а плохая
 * сделка** (`world.html`, часть III): запрет вынуждает ждать вне игры, плохая
 * сделка оставляет решение игроку.
 *
 * Крайние значения из артбука (0 из 3 → ×0,4; 3 из 3 → ×1,0), середина —
 * ровная лестница между ними. Все четыре числа подлежат замеру.
 */
export const RICH_LOOT: readonly number[] = [0.4, 0.6, 0.8, 1];

export const lootMul = (rich: number): number =>
  RICH_LOOT[Math.max(0, Math.min(RICH_MAX, Math.round(rich)))]!;

/**
 * Фракции (§4, §10.3). Названы фракциями, а не игроками: поддельный ник
 * раскрывается на второй день, а фракция остаётся частью мира и тогда,
 * когда придут живые игроки. Имена рабочие (§0.1).
 */
export interface Clan {
  readonly name: string;
  readonly color: string;
}

export const CLANS: readonly Clan[] = [
  { name: 'Вольная Артель', color: '#7DA163' },
  { name: 'Пепельный Обоз', color: '#D2662F' },
  { name: 'Тихие Копатели', color: '#5B7C8A' },
  { name: 'Клан Отвала', color: '#C9A227' },
];

/** Подписи по местности — рабочие, а не лор (§0.1). Раздаются на день. */
const NAMES: readonly string[] = [
  'Низина',
  'Обвал у брода',
  'Сухое русло',
  'Распадок',
  'Крайние ямы',
  'Гарь',
  'Осыпь',
  'Кривой отвал',
  'Провал',
  'Просевший тракт',
  'Мокрый карьер',
  'Чёрный шурф',
  'Дальняя штольня',
  'Каменный мешок',
  'Ржавый ключ',
  'Второе дно',
  'Белая пустошь',
  'Глухая штольня',
  'Волчья яма',
  'Старый спуск',
  'Косой лог',
  'Битый камень',
  'Тихий брод',
  'Овражья пасть',
  'Гнилой мост',
  'Слепой поворот',
  'Верхний забой',
  'Мёрзлый склон',
  'Пустая выработка',
  'Сыпучий борт',
  'Заваленный ход',
  'Клин',
];

/** Сколько точек бывает на карте: день на день не приходится. */
const NODES_MIN = 16;
const NODES_MAX = 22;

/**
 * Сетка раздачи мест: из её клеток и выбираются точки дня.
 *
 * Размер посчитан, а не выбран: клетка отдаётся ровно одной точке, и колода
 * обязана вместить самый людный день — двадцать две вылазки плюс прогулочные
 * точки, которых бывает до шести. Прежние 6×4 = 24 клетки вмещали двадцать
 * две вылазки, замок и кладбище **впритык**, и лишняя точка при этом
 * не падала с ошибкой, а молча пропадала: `cells[nodes.length]` возвращал
 * `undefined`, и блок ничего не делал.
 *
 * 7×5 = 35 клеток. Соседние клетки расходятся на 0,14 по x при разбросе
 * ±0,03 — минимум остаётся около 0,08 при пороге 0,05, который стережёт
 * `world.rules.ts`.
 */
const GRID_X = 7;
const GRID_Y = 5;

/**
 * Что это за место. Вылазка — то, ради чего карта и заведена (§4). Замок
 * (§6.1.6) — постройка, по которой пока только ходят: ни добычи, ни
 * противников там нет, и ярус у него ничего не значит. Кладбище (§6.1.7) —
 * то же самое место-прогулка, но населённое: добычи там нет, а привидения
 * есть.
 */
export type NodeKind = 'вылазка' | 'замок' | 'кладбище';

/**
 * Свойства вида узла — одной таблицей, а не россыпью проверок `kind === …`.
 *
 * Их накопилось семь на три вида, в двух файлах, и ни одну компилятор не ловил:
 * `NodeKind` нигде не стоял в исчерпывающей позиции. Кладбище приехало третьим
 * и половину проверок не задело — событие ему считалось как вылазке, хотя
 * карточка про событие молчит, а в `entryBlock` оно проходило по совпадению,
 * потому что `tier: 0`.
 *
 * `Record<NodeKind, …>` это чинит раз и навсегда: следующий вид узла не
 * соберётся, пока не будет описан здесь.
 */
export interface KindTraits {
  /** Прогулка: ни добычи, ни ставки, ни богатства — ходить можно, рисковать нечем. */
  readonly walk: boolean;
  /** Бывает ли здесь событие (§11.6). Модифицировать прогулке нечего. */
  readonly events: boolean;
  /** Запирает ли ярус Кухней (§22). У прогулки яруса нет. */
  readonly gated: boolean;
  /** Годится ли как цель «ещё вылазка» и как запасной вход при перезапуске. */
  readonly raidable: boolean;
}

/**
 * Сколько прогулочных точек бывает в день. Разброс, а не число: постоянного
 * соотношения на карте нет нигде, и заводить его здесь значило бы сделать
 * из карты расписание — ровно то, чего §4 избегает у ярусов.
 */
const STROLL: readonly {
  readonly kind: NodeKind;
  readonly label: string;
  readonly min: number;
  readonly max: number;
}[] = [
  { kind: 'замок', label: 'Замок', min: 1, max: 3 },
  { kind: 'кладбище', label: 'Кладбище', min: 1, max: 3 },
];

export const KIND: Record<NodeKind, KindTraits> = {
  'вылазка': { walk: false, events: true, gated: true, raidable: true },
  'замок': { walk: true, events: false, gated: false, raidable: false },
  'кладбище': { walk: true, events: false, gated: false, raidable: false },
};

export interface WorldNode {
  readonly id: number;
  readonly name: string;
  /** Доли экрана: карта — один экран без скролла и тумана войны. */
  readonly x: number;
  readonly y: number;
  readonly tier: Tier;
  readonly kind: NodeKind;
}

export interface Region {
  readonly day: number;
  readonly nodes: readonly WorldNode[];
  /** Лагерь стоит на своём месте и в раздаче не участвует. */
  readonly camp: { readonly x: number; readonly y: number };
}

/**
 * Сид + идентификаторы → 32 бита. Тот же FNV, что в артбуке. Выставлен
 * наружу по той же причине, что и `SEED`: местность считается из него же.
 */
export function hash(...parts: readonly number[]): number {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const x = part | 0;
    for (let b = 0; b < 4; b++) {
      h ^= (x >>> (b * 8)) & 255;
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h >>> 0;
}

export const dayAt = (t: number): number => Math.floor(t / DAY_SEC);
export const shiftAt = (t: number): number => Math.floor(t / SHIFT_SEC);
/** Первая смена суток: с неё начинается и день, и отсчёт богатства. */
export const dayStartShift = (day: number): number => day * SHIFTS_PER_DAY;

/** Лагерь: место постоянное, оно не переезжает вместе с картой. */
const CAMP_SPOT = { x: 0.5, y: 0.9 };

/** Регион последнего спрошенного дня. Раздача стоит одинаково, а карта
 *  перерисовывается кадрами — считать её каждый кадр незачем. */
let cached: Region | null = null;

/**
 * Регион на день. Точки, их число и ярусы выпадают заново — постоянного
 * соотношения ярусов нет намеренно: день, в котором рядом только третий
 * ярус, обязан быть возможен, иначе карта снова станет расписанием.
 */
export function regionAt(day: number): Region {
  if (cached !== null && cached.day === day) return cached;
  const rng = mulberry32(hash(SEED, day, 1));
  const count = NODES_MIN + Math.floor(rng() * (NODES_MAX - NODES_MIN + 1));

  // Клетки сетки перемешиваются и разбираются по одной: две точки не
  // садятся в одно место, а раздача при этом остаётся случайной.
  const cells: number[] = [];
  for (let i = 0; i < GRID_X * GRID_Y; i++) cells.push(i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = cells[i]!;
    cells[i] = cells[j]!;
    cells[j] = swap;
  }

  const names = [...NAMES];
  const nodes: WorldNode[] = [];
  for (let i = 0; i < Math.min(count, cells.length); i++) {
    const cell = cells[i]!;
    const col = cell % GRID_X;
    const row = (cell / GRID_X) | 0;
    const x = (col + 0.5) / GRID_X + (rng() - 0.5) / GRID_X / 2.2;
    // Нижняя полоса оставлена лагерю: точка поверх лагеря сделала бы
    // нечитаемыми обе.
    const y = 0.08 + ((row + 0.5) / GRID_Y) * 0.76 + (rng() - 0.5) / GRID_Y / 2.6;
    const name = names.splice(Math.floor(rng() * names.length), 1)[0] ?? `Место ${i}`;
    nodes.push({ id: i, name, x, y, tier: Math.floor(rng() * 4) as Tier, kind: 'вылазка' });
  }

  /**
   * Прогулочные точки дня — замок (§6.1.6) и кладбище (§6.1.7). Их несколько,
   * и сколько именно, решает раздача, а не таблица расписания: день, в котором
   * рядом три замка и одно кладбище, обязан быть возможен ровно так же, как
   * день, где рядом только третий ярус.
   *
   * Правило, ради которого эти точки писались, остаётся дословно: **они
   * добавляются сверх раздачи вылазок, а не вместо одной из них**. Ярусы,
   * богатство и весь счёт §4 обязаны остаться такими же, какими были до них.
   * Клетка берётся следующей из той же перетасованной колоды — значит, ни
   * поверх вылазки, ни друг поверх друга они не сядут никогда.
   *
   * Имя — та же рабочая подпись местности (§0.1), в кавычках: склонять её
   * было бы враньём про язык мира, которого нет.
   */
  for (const spec of STROLL) {
    const count = spec.min + Math.floor(rng() * (spec.max - spec.min + 1));
    for (let i = 0; i < count; i++) {
      const cell = cells[nodes.length];
      if (cell === undefined) break;
      const col = cell % GRID_X;
      const row = (cell / GRID_X) | 0;
      const where = names.splice(Math.floor(rng() * names.length), 1)[0] ?? 'Пустошь';
      nodes.push({
        id: nodes.length,
        name: `${spec.label} «${where}»`,
        x: (col + 0.5) / GRID_X + (rng() - 0.5) / GRID_X / 2.2,
        y: 0.08 + ((row + 0.5) / GRID_Y) * 0.76 + (rng() - 0.5) / GRID_Y / 2.6,
        tier: 0,
        kind: spec.kind,
      });
    }
  }

  cached = { day, nodes, camp: CAMP_SPOT };
  return cached;
}

/**
 * Сид локации. Место держит форму сутки: в течение дня одна и та же точка
 * собирается одной и той же пещерой — иначе «сходить сюда ещё раз»
 * перестаёт быть решением. Завтра этого региона уже нет, и сида тоже.
 */
export const nodeSeed = (day: number, node: number): number => hash(SEED, day, node, 3);

/**
 * Что происходит на точке сейчас (§11.6). Считается так же, как клан и
 * богатство, — из сида и номера окна, без единого поля в сохранении.
 *
 * Окно, а не смена: событие обязано пережить сессию, иначе решение «схожу
 * туда» превращается в гонку с таймером, чего `world.html` прямо не хочет
 * («окно события — часы, а не минуты»). И обязано смениться внутри суток,
 * иначе карта снова расписание.
 *
 * Замок событий не носит: §6.1.6 обещает там прогулку без добычи
 * и противников, а модифицировать нечего.
 */
export function eventAt(day: number, node: number, t: number): EventId | null {
  const window = Math.floor(shiftAt(t) / EVENT_WINDOW_SHIFTS);
  return eventFor(hash(SEED, day, node, window, 4));
}

/** Дельта игрока: единственное, что попадает в сохранение. */
export interface Visit {
  readonly node: number;
  /** Номер смены, а не секунда: богатство считается сменами. */
  readonly shift: number;
}

export interface ClanState {
  readonly level: number;
  readonly nodes: readonly number[];
}

/**
 * Состояние клана в момент наблюдения. Ни таймера, ни записи: характер
 * клана — из сида, уровень — из прошедших часов, занятая точка — из номера
 * смены.
 */
export function clanState(id: number, t: number): ClanState {
  const rng = mulberry32(hash(SEED, id));
  const pace = 0.7 + rng() * 0.6; // характер: медленный / жадный
  const age = Math.max(0, t - WORLD_EPOCH);
  const level = 1 + Math.floor(Math.log2(1 + (age / (90 * 60)) * pace));
  const region = regionAt(dayAt(t));
  if (region.nodes.length === 0) return { level, nodes: [] };
  // Артбук предлагал «одну-две локации», и замер это отменил: вторая
  // локация у каждого клана занимает почти половину региона, и условие
  // «три богатых локации всегда доступны» рушится от одной сессии
  // (`world.rules.ts`). Клан держит одну.
  const rr = mulberry32(hash(SEED, id, shiftAt(t)));
  return { level, nodes: [Math.floor(rr() * region.nodes.length)] };
}

export interface NodeState {
  /** 0…3 — сколько заходов в локации ещё осталось. */
  readonly rich: number;
  /** Клан, который работает здесь прямо сейчас; null — никого. */
  readonly clan: number | null;
  /** Смен до следующего восстановления; 0 — восстанавливать нечего. */
  readonly restShifts: number;
  /** Что здесь сегодня (§11.6); null — обычный день, и таких большинство. */
  readonly event: EventId | null;
}

/**
 * Весь регион в момент t. Богатство тратит любое посещение — чужое или
 * своё, — и восстанавливается покоем: конкуренция без единого удара по
 * чужому лагерю.
 *
 * Окно упирается в начало суток: за границей дня стоял другой регион,
 * и его заходы к сегодняшним точкам отношения не имеют.
 */
export function worldAt(t: number, visits: readonly Visit[] = []): NodeState[] {
  const day = dayAt(t);
  const region = regionAt(day);
  const now = shiftAt(t);
  const window = Math.max(1, Math.min(RICH_WINDOW, now - dayStartShift(day) + 1));

  const used: boolean[][] = region.nodes.map(() => new Array<boolean>(window).fill(false));
  const clan = new Array<number | null>(region.nodes.length).fill(null);
  for (let k = 0; k < CLANS.length; k++) {
    for (let s = 0; s < window; s++) {
      for (const node of clanState(k, (now - s) * SHIFT_SEC).nodes) {
        if (used[node] === undefined) continue;
        used[node]![s] = true;
        if (s === 0 && clan[node] === null) clan[node] = k;
      }
    }
  }
  for (const visit of visits) {
    const s = now - visit.shift;
    if (s >= 0 && s < window && used[visit.node] !== undefined) used[visit.node]![s] = true;
  }

  return region.nodes.map((_, i) => {
    // От старой смены к новой: −1 за заход, +1/3 за смену покоя.
    let v = RICH_MAX;
    for (let s = window - 1; s >= 0; s--) {
      v += used[i]![s] ? -1 : RICH_REST;
      v = Math.max(0, Math.min(RICH_MAX, v));
    }
    const rich = Math.round(v);
    // Сколько смен покоя до следующего целого — цифра, которую игрок
    // читает как «через сколько сюда снова стоит идти».
    const restShifts = rich >= RICH_MAX ? 0 : Math.max(1, Math.ceil((rich + 1 - v) / RICH_REST));
    const node = region.nodes[i]!;
    const event = KIND[node.kind].events ? eventAt(day, node.id, t) : null;
    return { rich, clan: clan[i]!, restShifts, event };
  });
}

/**
 * Куда пускают первую вылазку (§16.2). Ровно одна точка: игрок на кадре `move`
 * не видел ни боя, ни ран, и «выбирай из двадцати» здесь не выбор, а рулетка.
 *
 * **Ранжирование, а не фильтр**, и это найдено замером: на 60 днях нашёлся
 * день, где идеального входа — нулевой ярус, полное богатство, никакого
 * клана — не существует вовсе. Фильтр в такой день вернул бы ничего и запер
 * игрока в лагере с единственной кнопкой, которая ничего не открывает.
 * Поэтому места сортируются, и первое место занимает лучшее из имеющихся.
 *
 * Порядок ключей — это порядок того, чем на первой вылазке можно пожертвовать:
 * ярусом нельзя (он и есть ставка, §11.2), богатством можно, компанией клана
 * тоже, а мягкое событие — приятный довесок, а не условие.
 */
export function firstRaidNode(day: number, t: number): number | null {
  const region = regionAt(day);
  const world = worldAt(t, []);
  const raids = region.nodes.filter((n) => KIND[n.kind].raidable);
  if (raids.length === 0) return null;
  const rank = (n: WorldNode): number => {
    const state = world[region.nodes.indexOf(n)];
    return (
      n.tier * 1000 -
      (state?.rich ?? 0) * 10 +
      (state?.clan === null ? 0 : 5) -
      (isGentle(state?.event ?? null) ? 1 : 0)
    );
  };
  return [...raids].sort((a, b) => rank(a) - rank(b))[0]!.id;
}

/**
 * Заходы прошлых суток не относятся ни к одной сегодняшней точке — регион
 * пересобран. Чистка при записи держит сохранение ограниченным по размеру,
 * сколько бы игрок ни играл.
 */
export const liveVisits = (visits: readonly Visit[], t: number): Visit[] =>
  visits.filter((v) => v.shift >= dayStartShift(dayAt(t)) && shiftAt(t) - v.shift < RICH_WINDOW);
