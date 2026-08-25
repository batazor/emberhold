/**
 * §26 — вылазка, которую играет не игрок.
 *
 * Отряд уходит в выбранное на карте место сам, идёт по таймеру и возвращается
 * строкой. Играет за него бот (`bot.ts`) — тот самый, которым меряется баланс
 * (§22): своего второго игрока здесь нет и не будет, иначе игра начала бы
 * считать вылазку двумя разными способами.
 *
 * **Это плохая сделка, и так задумано.** §1 говорит прямо: возвращение —
 * единственная механика, ради которой стоит ходить руками, и всё, что делает
 * ручную вылазку необязательной, отменяет игру. Поэтому отправка:
 *
 * - **отдаёт долю добычи** (`SORTIE_LOOT`) — то же «не запрет, а плохая
 *   сделка», которым §4 гасит выработанную локацию;
 * - **не пускает глубже** `SORTIE_MAX_TIER` — глубина остаётся ручной;
 * - **стоит времени, а не риска**: минуты ожидания вместо минут внимания,
 *   и это второй сток времени, а не второй источник добычи.
 *
 * Проверяется всё это не обещанием, а замером: `sortie.rules.ts` требует,
 * чтобы добыча за минуту у отправки была строго ниже, чем у ручного захода,
 * и на любом ярусе, куда отправка вообще ходит.
 *
 * **Бросок делается на выходе, а не на возвращении.** Билет запоминает
 * лагерь и место такими, какими они были в момент отправки, и вылазка потом
 * считается ими. Иначе улучшенный за время пути Склад задним числом менял бы
 * поход, который уже состоялся. Хранится при этом **вход, а не итог**:
 * сохранение обязано состоять из полей, которые может проверить сервер
 * (§6), а проверить он может только то, что умеет пересчитать сам.
 */
import { POLICIES, playRaid } from './bot';
import type { BotRaid } from './bot';
import { mulberry32 } from '../core/rng';
import type { EventId } from './events';
import type { GearState, Offhand } from './gear';
import { heroFullHp, loadout, woundsFrom } from './heroes';
import type { HeroState, Roster } from './heroes';
import type { Resources } from './resources';
import type { Tier } from './types';

/** Глубже отряд без игрока не ходит. Ярусы 2–3 остаются ручными (§1). */
export const SORTIE_MAX_TIER = 1;

/**
 * Какая доля добычи доезжает до склада. Число первой итерации, как и всё
 * в §11: оно обязано быть меньше единицы по построению, а насколько именно —
 * покажет замер доли ручных вылазок (§9).
 */
export const SORTIE_LOOT = 0.6;

/**
 * Сколько идёт поход, по ярусам. Минуты, а не часы: ожидание здесь работает
 * поводом вернуться (§2), а не стеной. Ярусы глубже `SORTIE_MAX_TIER`
 * в таблице отсутствуют намеренно — их нет в механике.
 */
export const SORTIE_SECONDS: readonly number[] = [12 * 60, 20 * 60];

/**
 * Лагерь и место на момент выхода. Всё, чем вылазка считается, и ничего
 * сверх: каждое поле читает `playRaid`, и каждое сервер умеет повторить.
 */
export interface SortieInput {
  readonly kitchen: number;
  readonly storage: number;
  /** §4 — множитель богатства места, взятый на выходе. */
  readonly loot: number;
  /** §11.6 — событие места, объявленное до входа. */
  readonly event: EventId | null;
  readonly gear: GearState;
  readonly offhand: Offhand;
  readonly arrows: number;
  /** Необязательны для билетов из старых сохранений. */
  readonly quiverBonus?: number;
  readonly scouting?: number;
  readonly foodBonus?: number;
  readonly capacityBonus?: number;
  readonly containerFood?: number;
}

/** Билет отряда: один на лагерь, как слот стройки (§20.1). */
export interface Sortie {
  readonly node: number;
  readonly tier: Tier;
  readonly seed: number;
  /** `hero.id`, а не индекс: ростер пересортировывается по готовности. */
  readonly hero: number;
  readonly startedAt: number;
  readonly endsAt: number;
  readonly at: SortieInput;
}

/** Почему отправить нельзя. Причина, а не молчащая кнопка (§23.3). */
export type SortieBlock = 'ok' | 'slot' | 'tier' | 'hero';

export const SORTIE_REASON: Record<Exclude<SortieBlock, 'ok'>, string> = {
  slot: 'Отряд уже в пути',
  // «Без вас отряд не идёт глубже» — так это звучало, пока перепись голоса
  // не посчитала строку обращением к игроку: §23.2 требует от отказа
  // безличности, он про мир, а не про того, кто нажал.
  tier: 'Глубже Яруса 1 отряд один не ходит',
  hero: 'Идти некому — все заняты',
};

export function sortieBlock(
  sortie: Sortie | null | undefined,
  roster: Roster,
  tier: Tier,
): SortieBlock {
  if (sortie != null) return 'slot';
  if (tier > SORTIE_MAX_TIER) return 'tier';
  if (freeHero(roster) === null) return 'hero';
  return 'ok';
}

/**
 * Кого отправить. Тот же порядок, что у ручного выхода: первый готовый.
 * Раненый не идёт — без игрока он и подавно не вернётся.
 */
export function freeHero(roster: Roster): HeroState | null {
  return roster.heroes.find((h) => h.status === 'ready' && h.wounds === 0) ?? null;
}

export const sortieSeconds = (tier: Tier): number => SORTIE_SECONDS[tier] ?? 0;

/**
 * Билет на выход. Занять героя и списать богатство места — работа зовущего:
 * тут чистая сборка, чтобы её можно было проверить без лагеря.
 */
export function ticketOf(
  node: number,
  tier: Tier,
  seed: number,
  hero: HeroState,
  input: SortieInput,
  now: number,
): Sortie {
  return {
    node,
    tier,
    seed,
    hero: hero.id,
    startedAt: now,
    endsAt: now + sortieSeconds(tier),
    at: input,
  };
}

export const sortieDue = (sortie: Sortie | null | undefined, now: number): boolean =>
  sortie != null && now >= sortie.endsAt;

/**
 * Что случилось в походе. Чистая функция от билета и героя: пересчитывается
 * когда угодно и где угодно и всегда даёт то же самое — на этом держится
 * и проверка сервером (§6), и разбор бага по сохранению.
 *
 * Манера — осторожная. Отряд без игрока не рискует: жадный бот уходит
 * с полным рюкзаком и без запаса провианта, а цену такого решения принимает
 * игрок, которого в этом походе нет.
 */
export function sortieRaid(sortie: Sortie, hero: HeroState): BotRaid {
  const { at } = sortie;
  return playRaid(
    {
      seed: sortie.seed,
      tier: sortie.tier,
      lootMul: at.loot,
      event: at.event,
      kitchenLevel: at.kitchen,
      storageLevel: at.storage,
      loadout: loadout(hero),
      gear: at.gear,
      offhand: at.offhand,
      arrows: at.arrows,
      ...(at.quiverBonus === undefined ? {} : { quiverBonus: at.quiverBonus }),
      ...(at.scouting === undefined ? {} : { scouting: at.scouting }),
      ...(at.foodBonus === undefined ? {} : { foodBonus: at.foodBonus }),
      ...(at.capacityBonus === undefined ? {} : { capacityBonus: at.capacityBonus }),
      ...(at.containerFood === undefined ? {} : { containerFood: at.containerFood }),
      // Спокойная отправка пользуется тем же мягким входом, что первые
      // ручные заходы. Опасное событие снимает страховку заранее и именно
      // этим остаётся объявленной ценой места, а не скрытым броском яруса.
      visit: at.event === null ? 0 : Infinity,
    },
    POLICIES.cautious,
    mulberry32(sortie.seed),
  );
}

/** Три исхода, различимые словами. Больше их у похода и нет. */
export type ReportId = 'lost' | 'hurt' | 'back';

/**
 * Слова отчёта. Канал «событие» (§23.2): строка полосы, прошедшее время,
 * без адресата. Чисел в ней нет намеренно — добыча видна в кладовой,
 * а числом день назовёт хроника (§25).
 */
export const SORTIE_TEXT: Record<ReportId, string> = {
  lost: 'Отряд не дошёл домой',
  hurt: 'Отряд вернулся с ранами',
  back: 'Отряд вернулся',
};

export interface Report {
  readonly id: ReportId;
  readonly text: string;
  /** Что доехало до склада — уже с учётом доли отправки. */
  readonly carried: Resources;
  readonly total: number;
  readonly failed: boolean;
  /** Здоровье ведущего на конец похода — им лагерь считает раны (§3). */
  readonly hpLeft: number;
  /** Сколько ран увезёт ведущий. Той же шкалой, что и после ручной вылазки. */
  readonly wounds: number;
  /** §14.3 — сколько стрел израсходовано: колчан берётся из лагеря, и то,
   *  что выстрелено, из лагеря уходит — как и после ручной вылазки. */
  readonly arrowsSpent: number;
}

/** Доля отправки: тот же приём, что у выработанной локации, — режем добычу. */
const share = (r: Resources): Resources => ({
  stone: Math.floor(r.stone * SORTIE_LOOT),
  wood: Math.floor(r.wood * SORTIE_LOOT),
  iron: Math.floor(r.iron * SORTIE_LOOT),
  crystal: Math.floor(r.crystal * SORTIE_LOOT),
  food: 0,
});

export function reportOf(sortie: Sortie, hero: HeroState): Report {
  const raid = sortieRaid(sortie, hero);
  const carried = share(raid.carried);
  const total = carried.stone + carried.wood + carried.iron + carried.crystal;
  const failed = raid.status !== 'evacuated';
  // Раны считаются той же функцией, что и после ручной вылазки
  // (`woundsFrom`). Своя формула здесь была бы второй шкалой ран, и разошлись
  // бы они молча: первая версия звала раненым любого, кто получил хоть одно
  // очко урона, — на Подступах это шестьдесят походов из шестидесяти,
  // при том что лагерь у всех шестидесяти писал «ран нет».
  const hpLeft = failed ? 0 : Math.max(0, heroFullHp(hero.cls) - raid.damageTaken);
  const wounds = woundsFrom(hero.cls, hpLeft);
  const id: ReportId = failed ? 'lost' : wounds > 0 ? 'hurt' : 'back';
  return { id, text: SORTIE_TEXT[id], carried, total, failed, hpLeft, wounds, arrowsSpent: raid.arrowsSpent };
}
