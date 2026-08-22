/**
 * Сессия из двадцати вылазок через настоящий игровой цикл и настоящую
 * телеметрию: вылазка → экран возврата → стройка → следующая вылазка,
 * с перерывами между сессиями, чтобы таймеры и возвраты были настоящими.
 *
 * Вылазку отрабатывает бот (политика balanced), решения лагеря — те же,
 * что предлагает игроку экран возврата.
 *
 * Живёт в sim/, а не в scripts/, по двум причинам: её типы проверяются
 * вместе с игрой, и она — источник золотого мастера (npm run verify),
 * а не отчёт для чтения. Печатью занимается scripts/play.ts.
 */
import { mulberry32 } from '../core/rng';
import { CLASS_ORDER, addXp, autoSpend, createHero, loadout, raidXp } from './heroes';
import { POLICIES, playRaid } from './bot';
import {
  BUILDING_ORDER,
  BUILD_SECONDS,
  completeIfDue,
  craftGear,
  createCamp,
  startUpgrade,
  stash,
  storeFree,
  suggestGear,
  suggestUpgrade,
  tierBlock,
  upgradeBlock,
} from './camp';
import { buildChest, chestBlock } from './chests';
import type { BuildingId, CampState } from './camp';
import { CONSUMABLES, buyConsumable, cheapestAffordable } from './consumables';
import { GEAR } from './gear';
import type { GearSlot } from './gear';
import type { Resources } from './resources';
import { events, setEvents, summarize, track } from './telemetry';
import type { Summary } from './telemetry';
import type { Tier } from './types';

/**
 * §20.1.2 — прогон без Мастерской: `NOFORGE=1 npm run play`. Переключатель нужен,
 * чтобы «второй сток помог» было измеримым, а не заявленным, и переживёт
 * Мастерскую: тем же способом меряется любой следующий сток без таймера (§21).
 *
 * Золотой мастер (npm run verify) снимается всегда с Мастерскойй: мастер обязан
 * описывать игру, а не её отладочный режим.
 */
const FORGE = process.env['NOFORGE'] !== '1';
/** §21 — то же самое для расходников: `NOCONSUM=1 npm run play`. Два стока
 *  надо уметь мерить порознь, иначе вклад каждого виден только суммой. */
const CONSUM = process.env['NOCONSUM'] !== '1';

export const RAIDS = 20;
export const RAIDS_PER_SESSION = 5;
/** Пауза в лагере между вылазками и перерыв между сессиями, секунды. */
const CAMP_PAUSE = 40;
const AWAY = [0, 35 * 60, 3 * 3600, 11 * 3600];

/** Почему экран возврата не смог предложить покупку — §20.1 живёт этим. */
export type NoOfferReason = 'слот занят' | 'потолок Жилья' | 'нет ресурсов';

export interface RaidRow {
  readonly n: number;
  readonly tier: Tier;
  /** §22.6 — уровень героя на входе в вылазку: по нему `npm run levels`
   *  сверяет темп опыта с лестницей `TIER_HERO_LEVEL`. */
  readonly heroLevel: number;
  readonly evacuated: boolean;
  readonly carried: number;
  readonly lost: number;
  readonly durationSec: number;
  readonly depthShare: number;
  readonly offer: BuildingId | null;
  /** §20.1 — что предложила Мастерская, когда стройка была недоступна. */
  readonly gearOffer: GearSlot | null;
  readonly started: string;
}

export interface SessionResult {
  readonly seed: number;
  readonly rows: readonly RaidRow[];
  readonly summary: Summary;
  readonly noOffer: Readonly<Record<NoOfferReason, number>>;
  readonly levels: Readonly<Record<BuildingId, number>>;
  readonly resources: Resources;
  readonly elapsedHours: number;
}

/** Самый глубокий открытый ярус: игрок идёт туда, где дороже. */
function bestTier(camp: CampState): Tier {
  let best: Tier = 0;
  for (const t of [1, 2, 3] as Tier[]) if (tierBlock(camp, t) === 'ok') best = t;
  return best;
}

/** Во что вкладываться: Кухня и Склад меняют вылазку, Жильё — только потолок. */
function chooseUpgrade(camp: CampState): BuildingId | null {
  // Мастерская бесплатна и мгновенна (§20.3): её ставят сразу, как Жильё позволит.
  if (FORGE && camp.levels.forge === 0 && upgradeBlock(camp, 'forge') === 'ok') return 'forge';
  for (const id of ['kitchen', 'storage'] as BuildingId[]) {
    if (upgradeBlock(camp, id) === 'ok') return id;
  }
  const capped = (['kitchen', 'storage'] as BuildingId[]).some(
    (id) => upgradeBlock(camp, id) === 'hq-cap',
  );
  if (capped && upgradeBlock(camp, 'hq') === 'ok') return 'hq';
  return null;
}

export function playSession(seed: number): SessionResult {
  const camp = createCamp();
  const rng = mulberry32(seed);
  setEvents([]);

  /**
   * §22.6 — герой петли растёт, как в игре: опыт за вылазку, очки — в
   * характеристики авто-тратой. Вечный новичок был честен, пока не росли
   * противники; с их ростом он мерил бы встречу, которой в игре нет.
   */
  const hero = createHero(CLASS_ORDER[0]!, 0);
  /** §22.6б — петля взрослит ярусы, как игра: смягчённый вход — её часть. */
  const tierRaids: Record<Tier, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

  let now = 0;
  let watermark = 0;
  const rows: RaidRow[] = [];
  const noOffer: Record<NoOfferReason, number> = {
    'слот занят': 0,
    'потолок Жилья': 0,
    'нет ресурсов': 0,
  };

  for (let n = 1; n <= RAIDS; n++) {
    // Начало сессии: перерыв, за который могла достроиться стройка.
    if ((n - 1) % RAIDS_PER_SESSION === 0) {
      const away = AWAY[Math.floor((n - 1) / RAIDS_PER_SESSION)] ?? 0;
      now += away;
      track({
        t: 'session_start',
        at: now,
        awaySec: watermark > 0 ? now - watermark : 0,
        timerLeftSec:
          camp.construction === null ? null : Math.max(0, camp.construction.endsAt - now),
      });
      const done = completeIfDue(camp, now);
      if (done !== null) {
        track({ t: 'build_done', at: now, building: done, level: camp.levels[done] });
      }
    }

    const tier = bestTier(camp);
    const heroLevel = hero.level;
    const raid = playRaid(
      {
        seed: (rng() * 1e9) | 0,
        tier,
        kitchenLevel: camp.levels.kitchen,
        storageLevel: camp.levels.storage,
        loadout: loadout(hero),
        visit: tierRaids[tier],
        gear: camp.gear,
        offhand: camp.offhand,
        arrows: camp.arrows,
        consumables: camp.loadout,
      },
      POLICIES.balanced,
      rng,
    );
    addXp(hero, raidXp(raid.carriedTotal, tier, raid.status === 'evacuated'));
    autoSpend(hero);
    tierRaids[tier] += 1;
    // §21 — купленное ушло в вылазку и не возвращается: сгорает независимо
    // от того, пригодилось или нет. Копить нечего.
    camp.loadout = [];

    track({ t: 'raid_start', at: now, tier, food: 0, capacity: 0 });
    now += raid.durationSec;
    track({
      t: 'raid_end',
      at: now,
      tier,
      failed: raid.status !== 'evacuated',
      maxBack: raid.maxBack,
      locMaxBack: raid.locMaxBack,
      carried: raid.carriedTotal,
      lost: raid.lost,
      steps: raid.steps,
      foodLeft: raid.foodLeft,
      durationSec: Math.round(raid.durationSec),
      cause: raid.cause,
      lastHitBy: raid.lastHitBy,
      damageTaken: raid.damageTaken,
      fights: raid.fights,
      kills: raid.kills,
    });
    for (const id of raid.fired) track({ t: 'consumable', at: now, id, phase: 'fire' });
    // Кладовая конечна (§13.6): бот складывает добычу тем же входом, что
    // игрок, и с тем же поведением у потолка — сначала строит сундук,
    // когда место кончается, как построил бы игрок за два дерева.
    if (storeFree(camp) < raid.carriedTotal && chestBlock(camp) === 'ok') buildChest(camp);
    stash(camp, raid.carried);
    camp.raids += 1;

    // Экран возврата: что он предложил и что игрок выбрал. Предложений два
    // вида — стройка по таймеру и ковка без него (§20.1). Второе существует
    // ровно затем, чтобы первое могло быть занято.
    const raw = suggestUpgrade(camp);
    // Без Мастерской её нельзя и предлагать: бесплатная непостроенная Мастерская
    // висела бы в предложениях вечно и завышала базовый замер.
    const offer = !FORGE && raw === 'forge' ? null : raw;
    // Порядок трёх веток тот же, что на экране возврата: постройка,
    // расходник, ковка (см. returnScreen.ts).
    const consumOffer =
      offer === null && CONSUM ? cheapestAffordable(camp.resources, camp.loadout) : null;
    const gearOffer = offer === null && consumOffer === null && FORGE ? suggestGear(camp) : null;
    if (offer === null && consumOffer === null && gearOffer === null) {
      const reason: NoOfferReason =
        camp.construction !== null
          ? 'слот занят'
          : BUILDING_ORDER.every((id) => upgradeBlock(camp, id) === 'hq-cap')
            ? 'потолок Жилья'
            : 'нет ресурсов';
      noOffer[reason] += 1;
    }
    const plan = chooseUpgrade(camp);
    track({
      t: 'return_screen',
      at: now,
      canBuy: offer !== null || consumOffer !== null || gearOffer !== null,
      chose: plan !== null ? 'build' : gearOffer !== null ? 'craft' : consumOffer !== null ? 'build' : 'raid',
    });

    let started = '—';
    if (plan !== null && startUpgrade(camp, plan, now)) {
      const toLevel = camp.levels[plan] + 1;
      track({ t: 'build_start', at: now, building: plan, toLevel, seconds: BUILD_SECONDS[toLevel] ?? 0 });
      started = `${plan} → ${toLevel}`;
    } else if (consumOffer !== null && buyConsumable(camp, consumOffer)) {
      track({ t: 'consumable', at: now, id: consumOffer, phase: 'buy' });
      started = CONSUMABLES[consumOffer].name;
    } else if (gearOffer !== null && craftGear(camp, gearOffer)) {
      const level = camp.gear[gearOffer];
      track({ t: 'craft', at: now, slot: gearOffer, toLevel: level });
      started = `${GEAR[gearOffer].name} → ${level}`;
    }

    rows.push({
      n,
      tier,
      heroLevel,
      evacuated: raid.status === 'evacuated',
      carried: raid.carriedTotal,
      lost: raid.lost,
      durationSec: raid.durationSec,
      depthShare: raid.maxBack / Math.max(1, raid.locMaxBack),
      offer,
      /** Ковка — тоже предложение, и в отчёте она обязана быть видна. */
      gearOffer,
      started,
    });

    now += CAMP_PAUSE;
    const done = completeIfDue(camp, now);
    if (done !== null) {
      track({ t: 'build_done', at: now, building: done, level: camp.levels[done] });
    }

    // Уход из игры фиксируется в конце сессии.
    if (n % RAIDS_PER_SESSION === 0) {
      track({ t: 'exit', at: now, where: n % 2 === 0 ? 'camp' : 'return' });
      watermark = now;
    }
  }

  return {
    seed,
    rows,
    summary: summarize(events()),
    noOffer,
    levels: { ...camp.levels },
    resources: { ...camp.resources },
    elapsedHours: now / 3600,
  };
}
