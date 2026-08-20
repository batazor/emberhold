/**
 * §9 — телеметрия. Меряем ровно то, что перечислено в документе, и ни одного
 * поля сверх: лишние события ничего не решают, а разбирать их придётся.
 *
 * Ключевой вопрос данных: **эвакуируются ли игроки слишком рано.** Если да —
 * риск провала не окупается, и напряжение выродилось в осторожность.
 *
 * Сервера в v0 нет, поэтому события копятся локально кольцевым буфером.
 * Формат сразу такой, чтобы его можно было отправлять как есть.
 */
import type { BuildingId } from './camp';
import type { ConsumableId } from './consumables';
import type { HeroClassId, SkillId } from './heroes';
import type { Tier } from './types';

export type ExitPoint = 'raid' | 'camp' | 'return';

export type TelemetryEvent =
  | { t: 'session_start'; at: number; awaySec: number; timerLeftSec: number | null }
  | { t: 'raid_start'; at: number; tier: Tier; food: number; capacity: number }
  | {
      t: 'raid_end';
      at: number;
      tier: Tier;
      failed: boolean;
      /** Дальше всего от выхода, куда игрок заходил, в шагах. */
      maxBack: number;
      /** Самая дальняя точка локации — с ней maxBack превращается в долю. */
      locMaxBack: number;
      carried: number;
      lost: number;
      steps: number;
      foodLeft: number;
      durationSec: number;
    }
  /** §20.1 — главная кнопка экрана возврата: трата или повтор. */
  | {
      t: 'return_screen';
      at: number;
      canBuy: boolean;
      /** §20.1 — трата бывает двух видов: стройка по таймеру и ковка без него. */
      chose: 'build' | 'craft' | 'raid' | 'camp';
    }
  | { t: 'craft'; at: number; slot: string; toLevel: number }
  | { t: 'build_start'; at: number; building: BuildingId; toLevel: number; seconds: number }
  | { t: 'build_done'; at: number; building: BuildingId; level: number }
  | { t: 'speedup'; at: number; building: BuildingId; cost: number; leftSec: number }
  /**
   * §11.7 — доля вылазок, где умение применено. Ниже половины означает, что
   * умение непонятно или бесполезно; это и есть его единственная проверка.
   */
  | { t: 'skill'; at: number; skill: SkillId; tier: Tier }
  /** §11.8 — работает ли ротация: сменил героя или подождал лечения. */
  | { t: 'hero_pick'; at: number; cls: HeroClassId; level: number; rotated: boolean }
  | { t: 'heal_start'; at: number; cls: HeroClassId; wounds: number; seconds: number }
  | { t: 'train_start'; at: number; cls: HeroClassId; level: number }
  | { t: 'exit'; at: number; where: ExitPoint }
  /** §21.5 — берут ли все три и уходит ли соль. */
  | { t: 'consumable'; at: number; id: ConsumableId; phase: 'buy' | 'fire' };

const KEY = 'new-world/telemetry';
const LIMIT = 500;

let buffer: TelemetryEvent[] = [];

export function loadTelemetry(): void {
  try {
    const raw = localStorage.getItem(KEY);
    buffer = raw === null ? [] : (JSON.parse(raw) as TelemetryEvent[]);
    if (!Array.isArray(buffer)) buffer = [];
  } catch {
    buffer = [];
  }
}

export function track(event: TelemetryEvent): void {
  buffer.push(event);
  if (buffer.length > LIMIT) buffer = buffer.slice(-LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(buffer));
  } catch {
    // Хранилища может не быть — телеметрия не имеет права ломать игру.
  }
}

export const events = (): readonly TelemetryEvent[] => buffer;

export function clearTelemetry(): void {
  buffer = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* см. track() */
  }
}

/** Только для проверок: подсунуть события без localStorage. */
export function setEvents(next: TelemetryEvent[]): void {
  buffer = next;
}

export interface Summary {
  readonly raids: number;
  readonly failRate: number;
  /** Средняя доля локации, которую игрок прошёл до разворота. Это и есть
   *  ответ на «эвакуируются ли слишком рано». */
  readonly avgDepthShare: number;
  readonly avgCarried: number;
  readonly avgLost: number;
  readonly avgFoodLeft: number;
  /** §20.1 — доля возвратов, где покупка была доступна. Цель 60–80%. */
  readonly buyOfferRate: number;
  readonly buyTakeRate: number;
  readonly firstBuilding: BuildingId | null;
  readonly medianReturnMin: number | null;
  readonly exits: Readonly<Record<ExitPoint, number>>;
  /** §21.5 — сколько куплено каждого вида и сколько из них сработало. */
  readonly bought: Readonly<Record<string, number>>;
  readonly fired: Readonly<Record<string, number>>;
  readonly boughtTotal: number;
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

export function summarize(list: readonly TelemetryEvent[]): Summary {
  const ends = list.filter((e): e is Extract<TelemetryEvent, { t: 'raid_end' }> => e.t === 'raid_end');
  const returns = list.filter(
    (e): e is Extract<TelemetryEvent, { t: 'return_screen' }> => e.t === 'return_screen',
  );
  const builds = list.filter(
    (e): e is Extract<TelemetryEvent, { t: 'build_start' }> => e.t === 'build_start',
  );
  const starts = list.filter(
    (e): e is Extract<TelemetryEvent, { t: 'session_start' }> => e.t === 'session_start',
  );

  const exits: Record<ExitPoint, number> = { raid: 0, camp: 0, return: 0 };
  for (const e of list) if (e.t === 'exit') exits[e.where] += 1;

  const bought: Record<string, number> = {};
  const fired: Record<string, number> = {};
  let boughtTotal = 0;
  for (const e of list) {
    if (e.t !== 'consumable') continue;
    const box = e.phase === 'buy' ? bought : fired;
    box[e.id] = (box[e.id] ?? 0) + 1;
    if (e.phase === 'buy') boughtTotal += 1;
  }

  const offered = returns.filter((r) => r.canBuy);

  return {
    raids: ends.length,
    failRate: ends.length === 0 ? 0 : ends.filter((e) => e.failed).length / ends.length,
    avgDepthShare: mean(ends.map((e) => (e.locMaxBack > 0 ? e.maxBack / e.locMaxBack : 0))),
    avgCarried: mean(ends.map((e) => e.carried)),
    avgLost: mean(ends.map((e) => e.lost)),
    avgFoodLeft: mean(ends.map((e) => e.foodLeft)),
    buyOfferRate: returns.length === 0 ? 0 : offered.length / returns.length,
    // Взятая покупка — и стройка, и ковка: §20.1 меряет, потратил ли игрок,
    // а не то, во что именно. Разделение видно по событию craft.
    buyTakeRate:
      offered.length === 0
        ? 0
        : offered.filter((r) => r.chose === 'build' || r.chose === 'craft').length / offered.length,
    firstBuilding: builds[0]?.building ?? null,
    // Время возвращения меряется только там, где таймер реально шёл: заходы
    // без незавершённой стройки к этому вопросу отношения не имеют.
    medianReturnMin: median(
      starts.filter((s) => s.timerLeftSec !== null).map((s) => s.awaySec / 60),
    ),
    exits,
    bought,
    fired,
    boughtTotal,
  };
}
