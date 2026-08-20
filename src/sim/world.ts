/**
 * Мир: карта локаций (§4, §5). Вход в вылазку идёт отсюда, а не из списка
 * ярусов: список кнопок сравнивать не с чем, а карта существует ровно затем,
 * чтобы у похода была причина выбирать место (`world.html`, часть I).
 *
 * Модель — та, что уже отработана в артбуке `world.html` и записана в §4:
 * **кланы не тикают.** Состояние клана и богатство локации — чистые функции
 * от сида и часов; в сохранении живут только дельты игрока (куда ходил и
 * когда). Фонового процесса нет, истории нет, прыжок на пятый день стоит
 * столько же, сколько шаг на минуту вперёд.
 *
 * Сети в v0 нет, и это ничего здесь не меняет: та же функция считается на
 * клиенте, а когда появится сервер (§6), он повторит её и сверит результат.
 *
 * Числа истощения — предложение `world.html`, а не решение DESIGN.md.
 * Проверяются условием из `world.rules.ts`, а не рассуждением.
 */
import { mulberry32 } from '../core/rng';
import type { Tier } from './types';

/** Сид региона. Один на игру: карта у всех одна, как и требует §4. */
const SEED = 20260820;

/**
 * Начало отсчёта мира — 20 августа 2026. Кланы растут от него, а не от
 * установки игры: мир был до запуска, и лагерь игрока не его центр.
 */
export const WORLD_EPOCH = 1787184000;

export const WORLD_NODES = 20;
/** Лагерь игрока — такой же узел карты, только в него не ходят. */
export const CAMP_NODE = 7;

/** Смена: клан переезжает раз в 40 минут (быстрее сессии, медленнее суток). */
export const SHIFT_SEC = 40 * 60;
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
 * Крайние значения взяты из артбука (0 из 3 → ×0,4; 3 из 3 → ×1,0),
 * середина — ровная лестница между ними. Все четыре числа подлежат замеру.
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

/** Имена узлов — рабочие подписи по местности, а не лор (§0.1). */
const NAMES: readonly string[] = [
  'Низина',
  'Обвал у брода',
  'Сухое русло',
  'Распадок',
  'Крайние ямы',
  'Гарь',
  'Осыпь',
  'Лагерь',
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
];

/**
 * Сколько узлов в каждом кольце. Ровные пятёрки отменил замер: Кухня ур. 1
 * открывает только нулевой ярус, и при пяти узлах любая сессия оставляла
 * меньше трёх богатых локаций — то есть карта первого дня учила ждать.
 * Семь — минимум, при котором условие держится (`world.rules.ts`).
 */
const TIER_RING: readonly number[] = [7, 5, 4, 3];

export interface WorldNode {
  readonly id: number;
  readonly name: string;
  /** Доли экрана: карта — один экран без скролла и тумана войны. */
  readonly x: number;
  readonly y: number;
  readonly tier: Tier;
}

/** Сид + идентификаторы → 32 бита. Тот же FNV, что в артбуке. */
function hash(...parts: readonly number[]): number {
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

/**
 * Раскладка узлов и ярусы. Положение — из сида, а не из файла карты;
 * ярус — от удалённости от лагеря, потому что «дальше» обязано значить
 * «дороже» без единой подписи.
 */
export const NODES: readonly WorldNode[] = (() => {
  const rng = mulberry32(hash(SEED, 1));
  const spots: { x: number; y: number }[] = [];
  for (let i = 0; i < WORLD_NODES; i++) {
    const col = i % 5;
    const row = (i / 5) | 0;
    spots.push({
      x: 0.11 + col * 0.195 + (rng() - 0.5) * 0.07,
      y: 0.15 + row * 0.235 + (rng() - 0.5) * 0.07,
    });
  }
  const camp = spots[CAMP_NODE]!;
  const dist = spots.map((s) => Math.hypot(s.x - camp.x, (s.y - camp.y) * 0.8));
  // Ярус — по месту в порядке удалённости, а не по доле от самой дальней
  // точки: доля зависит от того, как легли точки, и первый же прогон отдал
  // регион вовсе без нулевого яруса — то есть без места для первой вылазки.
  const order = dist.map((d, i) => ({ d, i })).sort((a, b) => a.d - b.d);
  const tiers = new Array<Tier>(WORLD_NODES).fill(0);
  let rank = 0;
  for (const { i } of order) {
    if (i === CAMP_NODE) continue;
    let tier: Tier = 0;
    let edge = 0;
    for (let k = 0; k < TIER_RING.length; k++) {
      edge += TIER_RING[k]!;
      if (rank < edge) {
        tier = k as Tier;
        break;
      }
      tier = Math.min(3, k + 1) as Tier;
    }
    tiers[i] = tier;
    rank++;
  }
  return spots.map((s, i) => ({
    id: i,
    name: NAMES[i] ?? `Локация ${i}`,
    x: s.x,
    y: s.y,
    tier: tiers[i]!,
  }));
})();

/** Локации, в которые ходят: лагерь из списка выпадает. */
export const RAID_NODES: readonly WorldNode[] = NODES.filter((n) => n.id !== CAMP_NODE);

/**
 * Сид локации. Место имеет форму: один и тот же узел собирается одной и той
 * же пещерой, иначе карта сравнивает не места, а ярлыки, и «сходить сюда ещё
 * раз» перестаёт быть решением.
 */
export const nodeSeed = (node: number): number => hash(SEED, node, 3);

export const nodeOf = (id: number): WorldNode => NODES[id] ?? NODES[0]!;

/** Дельта игрока: единственное, что попадает в сохранение. */
export interface Visit {
  readonly node: number;
  /** Номер смены, а не секунда: богатство считается сменами. */
  readonly shift: number;
}

export const shiftAt = (t: number): number => Math.floor(t / SHIFT_SEC);

export interface ClanState {
  readonly level: number;
  readonly nodes: readonly number[];
}

/**
 * Состояние клана в момент наблюдения. Ни таймера, ни записи: характер
 * клана — из сида, уровень — из прошедших часов, занятые узлы — из номера
 * смены.
 */
export function clanState(id: number, t: number): ClanState {
  const rng = mulberry32(hash(SEED, id));
  const pace = 0.7 + rng() * 0.6; // характер: медленный / жадный
  const age = Math.max(0, t - WORLD_EPOCH);
  const level = 1 + Math.floor(Math.log2(1 + (age / (90 * 60)) * pace));
  // Артбук предлагал «одну-две локации», и замер это отменил: вторая
  // локация у каждого клана — это 8 занятых узлов из 19 в каждой смене,
  // то есть 42% региона. При такой занятости условие «три богатых локации
  // всегда доступны» рушится от одной обычной сессии (`world.rules.ts`).
  // Клан держит одну — вторая вернётся, когда регион вырастет.
  const slots = 1;
  const rr = mulberry32(hash(SEED, id, shiftAt(t)));
  const nodes: number[] = [];
  // Узлов больше, чем слотов у всех кланов вместе, — цикл конечен.
  while (nodes.length < slots) {
    const n = Math.floor(rr() * WORLD_NODES);
    if (n !== CAMP_NODE && !nodes.includes(n)) nodes.push(n);
  }
  return { level, nodes };
}

export interface NodeState {
  /** 0…3 — сколько заходов в локации ещё осталось. */
  readonly rich: number;
  /** Клан, который работает здесь прямо сейчас; null — никого. */
  readonly clan: number | null;
  /** Смен до следующего восстановления; 0 — восстанавливать нечего. */
  readonly restShifts: number;
}

/**
 * Весь регион в момент t. Богатство тратит любое посещение — чужое или
 * своё, — и восстанавливается покоем: конкуренция без единого удара по
 * чужому лагерю.
 */
export function worldAt(t: number, visits: readonly Visit[] = []): NodeState[] {
  const now = shiftAt(t);
  const used: boolean[][] = [];
  for (let i = 0; i < WORLD_NODES; i++) used.push(new Array<boolean>(RICH_WINDOW).fill(false));

  const clan = new Array<number | null>(WORLD_NODES).fill(null);
  for (let k = 0; k < CLANS.length; k++) {
    for (let s = 0; s < RICH_WINDOW; s++) {
      const at = (now - s) * SHIFT_SEC;
      for (const node of clanState(k, at).nodes) {
        used[node]![s] = true;
        if (s === 0 && clan[node] === null) clan[node] = k;
      }
    }
  }
  for (const visit of visits) {
    const s = now - visit.shift;
    if (s >= 0 && s < RICH_WINDOW) used[visit.node]![s] = true;
  }

  const out: NodeState[] = [];
  for (let i = 0; i < WORLD_NODES; i++) {
    // От старой смены к новой: −1 за заход, +1/3 за смену покоя.
    let v = RICH_MAX;
    for (let s = RICH_WINDOW - 1; s >= 0; s--) {
      v += used[i]![s] ? -1 : RICH_REST;
      v = Math.max(0, Math.min(RICH_MAX, v));
    }
    const rich = Math.round(v);
    // Сколько смен покоя до следующего целого — цифра, которую игрок
    // читает как «через сколько сюда снова стоит идти».
    const restShifts = rich >= RICH_MAX ? 0 : Math.max(1, Math.ceil((rich + 1 - v) / RICH_REST));
    out.push({ rich, clan: clan[i], restShifts });
  }
  return out;
}

/**
 * Сохранённые дельты старше окна на богатство не влияют — они выбрасываются
 * при записи. Это единственная чистка: сохранение обязано оставаться
 * ограниченным по размеру, сколько бы игрок ни играл.
 */
export const liveVisits = (visits: readonly Visit[], t: number): Visit[] =>
  visits.filter((v) => shiftAt(t) - v.shift < RICH_WINDOW);
