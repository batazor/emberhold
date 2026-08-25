/**
 * §9 — телеметрия. Меряем ровно то, что перечислено в документе, и ни одного
 * поля сверх: лишние события ничего не решают, а разбирать их придётся.
 *
 * Ключевой вопрос данных: **уходят домой ли игроки слишком рано.** Если да —
 * риск провала не окупается, и напряжение выродилось в осторожность.
 *
 * Сервера в v0 нет, поэтому события копятся локально кольцевым буфером.
 * Формат сразу такой, чтобы его можно было отправлять как есть.
 */
import type { BuildingId } from './camp';
import type { ConsumableId } from './consumables';
import type { DraftCardId } from './draft';
import type { HeroClassId, SkillId } from './heroes';
import type { OnbStep } from './onboarding';
import type { RaidCause } from './raid';
import type { EnemyKind, Tier } from './types';

export type ExitPoint = 'raid' | 'camp' | 'return';

/**
 * Где показали предложение. К трём экранам выхода добавился магазин: он
 * четвёртое место, и в отличие от них он не место ухода, а место витрины.
 */
export type OfferPlace = ExitPoint | 'store';

/**
 * §22.19 — что мешает нажать «Получить» прямо сейчас. Статья про FTPUE
 * называет главной причиной несостоявшегося первого платежа не цену,
 * а невозможность: «хотел, но не смог». У нас витрина мала (пять наборов),
 * поэтому паралича выбора числом позиций тут быть не может; зато есть два
 * гейта — вход в облако и наличие клана, — и без этого поля они неотличимы
 * от «посмотрел и передумал».
 */
export type OfferGate = 'none' | 'sign-in' | 'create-clan';

/** Чем кончилась попытка оплаты. Совпадает с `CheckoutResult` платформы. */
export type CheckoutOutcome = 'paid' | 'cancelled' | 'failed' | 'pending' | 'redirected';

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
      /**
       * §9 — почему кончилась. Раньше причину знал только замерный скрипт,
       * то есть §22.6 проверялся ботом и никем больше.
       */
      cause: RaidCause;
      /** Кто добил. null — вылазка кончилась не боем. */
      lastHitBy: EnemyKind | null;
      /**
       * §9 — бой пишется итогом, а не событием на удар: буфер кольцевой,
       * и событие на стычку вымыло бы начало сессии за несколько десятков
       * вылазок, то есть сломало бы метрики §20 ради метрик §11.
       */
      damageTaken: number;
      fights: number;
      kills: number;
      /** Агрегаты защиты: одна запись на вылазку, не на удар. */
      guardTurns?: number;
      guardPrevented?: number;
      shieldPushes?: number;
      intercepts?: number;
      dodges?: number;
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
  /**
   * §19 — какую карту сборов взяли. Вопрос у события один: не вырождается ли
   * выбор в привычку. Раздача правилами §19.1 разнообразна по построению,
   * а вот берут ли игроки всегда одно и то же — покажет только это.
   */
  | { t: 'draft'; at: number; card: DraftCardId }
  /** §11.8 — работает ли ротация: сменил героя или подождал лечения. */
  | { t: 'hero_pick'; at: number; cls: HeroClassId; level: number; rotated: boolean }
  | { t: 'heal_start'; at: number; cls: HeroClassId; wounds: number; seconds: number }
  | { t: 'train_start'; at: number; cls: HeroClassId; level: number }
  /**
   * §9 — где игрок ушёл и сколько к тому моменту шла сессия. `sec` заведено
   * под длину сессии (§22.18): своей у нас не было вовсе, а чужая — та,
   * что считает аналитика по клику, — меряет вкладку, а не игру.
   *
   * Событие пишется на **уход вкладки в фон**, а не на её закрытие: события
   * выгрузки на мобильных не гарантированы. Отсюда и чтение `sec`: это
   * не «длина сессии» готовым числом, а «докуда сессия дошла к этому уходу»,
   * и длиной становится наибольшее за сессию. Переключение вкладки туда-сюда
   * даёт несколько таких отметок, и это честнее, чем одна: игра не знает,
   * вернутся ли, — а максимум знает и без неё.
   */
  | { t: 'exit'; at: number; where: ExitPoint; sec: number }
  /** §21.5 — берут ли все три и уходит ли камень. */
  | { t: 'consumable'; at: number; id: ConsumableId; phase: 'buy' | 'fire' }
  /**
   * §13.5 — ходят ли к торговцу вообще и не обгоняет ли лавка глубину.
   * Курс намеренно плохой, и обмен, случающийся чаще вылазки на ярус 1,
   * означает, что он всё-таки щедр.
   */
  | { t: 'trade'; at: number; offer: 'deal'; worth: number; ask: number }
  /**
   * §26 — отряд, ушедший без игрока. Вопрос у события ровно один и он же
   * главный риск механики: **не вытесняет ли отправка ручную вылазку.**
   * Отправок больше, чем заходов, означает, что игрок перестал играть
   * в игру, и тогда режется доля добычи, а не добавляется удобство.
   */
  | { t: 'sortie'; at: number; tier: Tier; failed: boolean; carried: number; seconds: number }
  /**
   * Кадры онбординга. Метрика раскадровки — доля дошедших до первой
   * возвращения, цель не ниже 85%: всё, что ниже, значит, что мы теряем людей
   * до того, как они увидели саму игру. Вторая цифра — доля тех, кто пошёл
   * за приманкой вместо немедленного выхода.
   */
  | { t: 'onboarding'; at: number; step: OnbStep }
  /**
   * §21.4 — труба заведена до магазина по прямому требованию того же
   * раздела: «важно лишь, чтобы появление позже не потребовало переделки».
   * Проверку она прошла: магазин оформления (§29) появился и пишет
   * в готовую форму, а не в свою. Единственное, что пришлось добавить, —
   * поля под чужой метод §22.19, и они названы там же поимённо.
   *
   * Прежняя оговорка «за деньги — не в прототипе» снята не здесь: её снял
   * сам магазин, где стоят Stripe и Telegram Stars. Расходники §21.4
   * по-прежнему за камень, и это по-прежнему решение.
   *
   * Полей ровно столько, сколько есть у любой покупки независимо от того,
   * чем окажется монетизация: **что купили, почём и в какой валюте**.
   * Того, что покупка даёт, здесь нет намеренно. Соблазн записать это поле
   * велик — §20.5 говорит, что камень и деньги останутся разными входами
   * в один расчёт, — но сказано это про **ускорение**, где камень назван
   * валютой лишь потому, что к концу дня он в избытке (§13). Камень —
   * такой же ресурс, как провиант, и превращать его в «то, что дают
   * за деньги» значило бы принять решение о монетизации здесь, в схеме
   * записи. Такого решения нет, и принимать его телеметрии не по чину:
   * что именно даёт покупка, назовёт `sku`.
   *
   * Цена — в минорных единицах и целым: копейки и центы складываются без
   * потерь, а `0.1 + 0.2` — нет. Валюта названа рядом, потому что складывать
   * разные валюты нельзя, и молчаливое сложение выглядело бы исправным.
   */
  | {
      t: 'offer';
      at: number;
      sku: string;
      priceMinor: number;
      currency: string;
      /** Где показали. Экраны выхода плюс магазин: других мест нет. */
      where: OfferPlace;
      /** §22.19 — что мешает нажать «Получить». */
      gate: OfferGate;
      /**
       * §22.19 — уровень главного здания на момент показа. Это наш ответ
       * на «конверсию по уровням»: чужой метод требует найти параметр, при
       * котором первый платёж случается чаще, а вывести уровень задним
       * числом из истории событий можно только запросом по всей жизни
       * игрока — и то лишь там, где стройка вообще попала в буфер.
       * Знаменатель конверсии живёт на `offer`, поэтому поле стоит и здесь,
       * и на покупке: иначе делить будет не на что.
       */
      hq: number;
    }
  /**
   * §22.19 — попытка оплаты. Событие заведено ровно затем, чтобы отделить
   * «не захотел» от «не смог»: без него `offer → purchase` схлопывает
   * передумавшего и того, у кого оплата не прошла, в одну потерю, а чинятся
   * они противоположным. `redirected` — не исход, а уход со страницы:
   * ответ придёт возвратом с `?checkout=success`, и до тех пор мы не знаем
   * ничего.
   */
  | {
      t: 'checkout';
      at: number;
      sku: string;
      priceMinor: number;
      currency: string;
      result: CheckoutOutcome;
    }
  | { t: 'purchase'; at: number; sku: string; priceMinor: number; currency: string; hq: number };

const KEY = 'emberhold/telemetry';
const LIMIT = 500;

let buffer: TelemetryEvent[] = [];

/**
 * Куда события уходят кроме буфера. Ставит `main.ts` — он один живёт
 * в браузере и один имеет право знать про сеть (`core/analytics.ts`).
 *
 * Регистрация, а не импорт: `sim/` гоняется в Node, и притянутая сюда
 * браузерная библиотека сломала бы `npm run measure`, `play` и правила.
 * В Node сток просто никто не ставит — телеметрия остаётся тем же чистым
 * кольцевым буфером, каким была.
 */
let sink: ((event: TelemetryEvent) => void) | null = null;

export function setTelemetrySink(next: ((event: TelemetryEvent) => void) | null): void {
  sink = next;
}

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
  try {
    sink?.(event);
  } catch {
    // И сети может не быть — по той же причине.
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
   *  ответ на «уходят домой ли слишком рано». */
  readonly avgDepthShare: number;
  readonly avgCarried: number;
  readonly avgLost: number;
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
  readonly avgDamageTaken: number;
  readonly avgFights: number;
  readonly avgGuardTurns: number;
  readonly avgGuardPrevented: number;
  readonly avgShieldPushes: number;
  readonly avgIntercepts: number;
  readonly avgDodges: number;
  /** Кто добивает чаще: атрибуция без неё ничего не говорит о том, что чинить. */
  readonly fatalBy: Readonly<Record<string, number>>;
  /** §26 — отправок на одну ручную вылазку. Больше единицы значит, что игру
   *  играет бот, а не игрок. */
  readonly sortiePerRaid: number;
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

  const fails = ends.filter((e) => e.failed);
  const fatalBy: Record<string, number> = {};
  for (const e of fails) {
    if (e.lastHitBy === null) continue;
    fatalBy[e.lastHitBy] = (fatalBy[e.lastHitBy] ?? 0) + 1;
  }

  return {
    raids: ends.length,
    failRate: ends.length === 0 ? 0 : ends.filter((e) => e.failed).length / ends.length,
    avgDepthShare: mean(ends.map((e) => (e.locMaxBack > 0 ? e.maxBack / e.locMaxBack : 0))),
    avgCarried: mean(ends.map((e) => e.carried)),
    avgLost: mean(ends.map((e) => e.lost)),
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
    avgDamageTaken: mean(ends.map((e) => e.damageTaken)),
    avgFights: mean(ends.map((e) => e.fights)),
    avgGuardTurns: mean(ends.map((e) => e.guardTurns ?? 0)),
    avgGuardPrevented: mean(ends.map((e) => e.guardPrevented ?? 0)),
    avgShieldPushes: mean(ends.map((e) => e.shieldPushes ?? 0)),
    avgIntercepts: mean(ends.map((e) => e.intercepts ?? 0)),
    avgDodges: mean(ends.map((e) => e.dodges ?? 0)),
    fatalBy,
    sortiePerRaid:
      ends.length === 0 ? 0 : list.filter((e) => e.t === 'sortie').length / ends.length,
  };
}
