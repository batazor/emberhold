import type { BuildingId, CampState } from './camp';
import { BUILDING_ORDER, campArea, campStones, createCamp } from './camp';
import { adoptChest } from './chests';
import { DWELLER_LOOK_KINDS } from './garrison';
import type { DwellerLook } from './garrison';
import { prunePicks } from './berries';
import { pruneBought } from './trade';
import type { PickLog } from './berries';
import { RESIDENT_CRAFTS, RESIDENT_JOBS, RESIDENT_SCHEDULE_ORDER, residentUuid } from './residents';
import type { ResidentCraft, ResidentJob, ResidentScheduleId } from './residents';
import { GEAR_ORDER, MAX_ITEM_LEVEL } from './gear';
import type { GearSlot } from './gear';
import {
  CLASS_ORDER,
  HERO_CLASSES,
  LEGACY_CLASS,
  MAX_HERO_LEVEL,
  MAX_SKILL_LEVEL,
  createRoster,
  syncRoster,
} from './heroes';
import type { HeroState, Roster, Stats } from './heroes';
import { CONSUMABLES, CONSUMABLE_SLOTS } from './consumables';
import { ONB_ORDER, RENAMED_STEPS, restartStep } from './onboarding';
import type { OnbStep } from './onboarding';
import { RESOURCE_KINDS, emptyResources } from './resources';
import { liveVisits } from './world';
import type { Resources } from './resources';
import type { Tier } from './types';
import {
  FARM_FOOD_GOAL,
  FARM_DEFAULT_CROP,
  FARM_PLOT_COUNT,
  FARM_STARTING_PLOT_COUNT,
  FARM_STORY_DAYS,
  FARM_STRUCTURE_IDS,
  emptyFarmStory,
  emptyFarmPlots,
  isFarmCropId,
} from './farm';
import type { FarmCaretaker, FarmStoryState, FarmStructureId } from './farm';
import { CLAN_BUILDING_ORDER, startingClanResources } from './clan';
import type { ClanBuildingKind } from './clan';
import { validSignposts } from './signposts';

/**
 * §6: состояние — единый сериализуемый объект, версионированный, localStorage.
 * Серверной валидации в v0 нет, но структура сразу пригодна к переносу:
 * ни одного поля, которое нельзя проверить на сервере.
 */
const KEY = 'emberhold/save';
/**
 * Ключ до переименования игры. Читается, пока не перезаписан: игра сменила
 * имя — это не повод отнимать у игрока лагерь. Первое же сохранение ляжет
 * под новый ключ, старый останется мусором в хранилище и никому не мешает.
 */
const LEGACY_KEY = 'new-world/save';
const VERSION = 1;

interface SaveV1 {
  version: 1;
  savedAt: number;
  /** Монотонная отметка времени — с ней клок не сбрасывается переводом часов. */
  watermark: number;
  levels: Record<BuildingId, number>;
  layout: Record<BuildingId, { x: number; z: number }>;
  resources: Resources & {
    /** Легаси: до переименования камень звался солью. Пишется только чтением. */
    salt?: number;
  };
  construction: CampState['construction'];
  /** Якорь площадки на поляне (§16.1). Необязателен: сейв до якоря
   *  открывается, его лагерь стоит в нулевом. */
  origin?: { x: number; z: number };
  /** Поляна пролога (§16.1). Необязательна: сейв без неё рисует лес-кольцо. */
  glade?: { size: number; cells: string };
  /** Сделки с торговцем (§13.5). Необязательно: без поля лавка незнакома. */
  trades?: number;
  /** §20.5 — монеты. Необязательно: сейв без поля начинает с нуля, потому
   *  что до введения валюты монет не существовало. */
  coins?: number;
  /** §20.5 — сутки последнего начисления за вход. Без поля — начислится
   *  первым же входом. */
  coinDay?: number;
  /** Колесо призов: день последней прокрутки. Необязательно: без поля —
   *  не крутили. */
  wheelDay?: number;
  /** Ларцы без редкого бонуса подряд. Необязательно для старых сохранений. */
  supplyPity?: number;
  /**
   * Подарок за вход (§29): день последнего взятого и сколько взято всего.
   * Необязательно — сейв, записанный до подарков, открывается с непочатой
   * первой неделей.
   */
  daily?: { day: number; taken: number };
  /** Обещанный гость (§29.2): сажает его сцена лагеря, а не панель. */
  guest?: boolean;
  loadout?: CampState['loadout'];
  raids: number;
  /** §22.6б — заходы по ярусам. Необязательное: старый сейв открывается
   *  со свежими ярусами, и смягчённый вход повторяется один раз — это
   *  дешевле, чем выводить зрелость из суммарного счётчика вслепую. */
  tierRaids?: number[];
  /**
   * Стены лагеря (§6.1.6). Поле необязательное, версия сейва ради него
   * не поднята — тем же приёмом, что отряд и снаряжение: сейв, записанный
   * до стройки стен, обязан открываться. Без этого поля всё построенное
   * пропадало при перезагрузке, а стройка стоит камня и времени.
   */
  walls?: CampState['walls'];
  /**
   * Отряд в пути (§26). Хранится **вход, а не итог**: сервер (§6) обязан
   * уметь пересчитать поход сам, а итог он не проверит ничем. Поле
   * необязательное — сейв, записанный до отправок, обязан открываться.
   */
  sortie?: CampState['sortie'];
  /**
   * Отряд (§11.8). Поле необязательное, и версия сейва ради него не поднята:
   * сохранение этапов 1–4 обязано открываться — иначе на каждом этапе игрок
   * терял бы лагерь, а мы — возможность сравнить замеры до и после.
   */
  heroes?: {
    active: number;
    list: {
      cls: string;
      level: number;
      xp: number;
      /** §11.7 — купленные уровни характеристик. Нет в старом сейве —
       *  выводятся из прежнего авто-роста класса (см. readRoster). */
      spent?: Partial<Record<string, number>>;
      /** Нераспределённые очки характеристик. */
      sp?: number;
      /** Уровень классового умения и нераспределённые очки навыка. */
      sl?: number;
      skp?: number;
      wounds: number;
      status: string;
      busyUntil: number | null;
    }[];
  };
  /**
   * Снаряжение (§14). Тоже необязательное поле и по той же причине, что отряд:
   * сейв прежних этапов обязан открываться, иначе игрок теряет лагерь на
   * каждом шаге разработки, а мы — возможность сравнить замеры до и после.
   */
  gear?: Partial<Record<GearSlot, number>>;
  /** §14.2 — левая рука. Необязательное: сейв прежних этапов обязан
   *  открываться, и отсутствие поля читается фонарём. */
  offhand?: 'torch' | 'shield';
  /** §14.3 — запас стрел в лагере. Отсутствие читается нулём. */
  arrows?: number;
  /**
   * Кадр онбординга (`onboarding.html`). Тоже необязательное поле: сейв,
   * записанный до онбординга, принадлежит игроку, который уже играл, —
   * его нельзя возвращать в первые три минуты. Отсутствие поля читается
   * как «пройдено», а не как «начать заново».
   */
  onb?: OnbStep;
  /**
   * Дельты мира (§4): куда игрок ходил и когда. Единственное, что хранится
   * от карты — кланы и богатство считаются функцией от сида и часов. Поле
   * необязательное по той же причине, что отряд и снаряжение: сейв прежних
   * этапов обязан открываться.
   */
  visits?: { n: number; s: number }[];
  /**
   * Валуны лагеря (§13.4) — те, что ещё целы. Поле необязательное и по той же
   * причине, что отряд и стены: сейв прежних этапов обязан открываться.
   * Отсутствие поля читается как «камни ещё не тронуты», а не «камней нет»:
   * игрок, начавший до этой механики, увидит на площадке ровно то же, что
   * начавший после, — иначе валуны достались бы только новым лагерям.
   */
  stones?: { x: number; z: number }[];
  /**
   * Жильцы и палатки под них (`residents.ts`). Поля необязательные по той же
   * причине, что отряд, стены и валуны: сейв прежних этапов обязан
   * открываться. Отсутствие читается пустым лагерем — герой один и живёт
   * в Жилье, ровно как было до появления жильцов.
   */
  residents?: {
    id?: string;
    name: string;
    look: string;
    answer: string;
    seed?: number;
    rest?: boolean;
    schedule?: string;
    hunt?: { startedAt: number; endsAt: number; seed: number };
    /**
     * Ремесло нанятого (§6.1.6.3). Необязательное по той же причине, что
     * всё соседнее: сейв, записанный до лесников, обязан открываться —
     * и открывается лагерем, в котором все умеют одно и то же.
     */
    craft?: string;
  }[];
  /** Счёт открытия поручения охоты. Без поля старый лагерь начинает с нуля. */
  foxes?: number;
  tents?: { x: number; z: number }[];
  /** Первая цель хозяйства. Необязательна: старый сейв получит её по условию. */
  farm?: {
    foodAtStart: number;
    gatheredFood: number;
    step: 'intro' | 'goal' | 'reward' | 'done';
    unlocked: boolean;
    /** Необязательно: первый сейв огорода открывал все шесть полос сразу. */
    activePlots?: number;
    /** Необязательно: до карточек единственной культурой был ячмень. */
    selectedCrop?: string;
    /** Необязательно: сейв до появления огорода открывается с пустыми грядками. */
    plots?: ({ plantedAt: number; crop?: string } | null)[];
    /** Сюжет развития огорода. Отсутствие начинает первый из 15 дней. */
    story?: {
      day?: number;
      startedDay?: number;
      plantedPlots?: number;
      harvestedPlots?: number;
      harvestedFood?: number;
      assistedPlots?: number;
      batchUses?: number;
      caretaker?: string | null;
      structures?: Partial<Record<FarmStructureId, boolean>>;
      construction?: { structure?: string; startedAt?: number; endsAt?: number } | null;
    };
  };
  /** Декор моложе версии сохранения: отсутствие означает пустые локации. */
  signposts?: CampState['signposts'];
  /**
   * Свой клан (§30) — имя и час основания. Поле необязательное и по той же
   * причине, что все соседние: сейв, записанный до кланов, обязан
   * открываться, и открывается он лагерем без клана.
   */
  clan?: {
    name: string;
    at: number;
    leader?: boolean;
    location?: {
      seed: number;
      glade: { size: number; cells: string };
      buildings?: { kind: string; x: number; z: number }[];
      resources?: { stone: number; wood: number; iron: number };
      construction?: { kind: string; x: number; z: number; work: number } | null;
      builders?: string[];
      workedAt?: number;
    };
  };
  /**
   * Сундуки-хранилища (`chests.ts`). Необязательное — сейв прежних этапов
   * обязан открываться; но отсутствие поля читается не пустотой, а миграцией:
   * первый сундук достаётся прологом вместе с палаткой, и лагерь, разбитый
   * до этой механики, получает его при чтении — иначе +30 рюкзака достались
   * бы только новым сейвам.
   */
  chests?: { x: number; z: number }[];
  /**
   * Костры гостей и сиды приглашённых (`castleGuest.ts`). Поля необязательные
   * по той же причине, что жильцы и палатки: сейв прежних этапов обязан
   * открываться. Отсутствие читается «гостей не звали».
   */
  fires?: { x: number; z: number }[];
  bushes?: { x: number; z: number; pickedAt?: number }[];
  picks?: Record<string, number>;
  /** §13.5 — выкупленное с прилавка. Самоистекающий список на сутки. */
  bought?: Record<string, number>;
  guests?: number[];
  minotaurVictories?: number[];
  minotaurClaims?: number[];
  minotaurReputation?: number;
  minotaurQuestCycle?: number;
  minotaurRelics?: CampState['minotaurRelics'];
  minotaurQuests?: CampState['minotaurQuests'];
}

export interface LoadResult {
  readonly camp: CampState;
  readonly roster: Roster;
  readonly watermark: number;
  readonly onboarding: OnbStep;
}

function savedCounter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function readFarmStory(
  value: NonNullable<NonNullable<SaveV1['farm']>['story']> | undefined,
): FarmStoryState {
  const story = emptyFarmStory();
  if (value === undefined || value === null || typeof value !== 'object') return story;
  story.day = typeof value.day === 'number' && Number.isFinite(value.day)
    ? Math.max(1, Math.min(FARM_STORY_DAYS, Math.floor(value.day)))
    : 1;
  story.startedDay = typeof value.startedDay === 'number' && Number.isFinite(value.startedDay)
    ? Math.floor(value.startedDay)
    : -1;
  story.plantedPlots = savedCounter(value.plantedPlots);
  story.harvestedPlots = savedCounter(value.harvestedPlots);
  story.harvestedFood = savedCounter(value.harvestedFood);
  story.assistedPlots = savedCounter(value.assistedPlots);
  story.batchUses = savedCounter(value.batchUses);
  story.caretaker = value.caretaker === 'grower' || value.caretaker === 'steward'
    ? value.caretaker as FarmCaretaker
    : null;
  if (value.structures != null && typeof value.structures === 'object') {
    for (const id of FARM_STRUCTURE_IDS) story.structures[id] = value.structures[id] === true;
  }
  const work = value.construction;
  if (
    work != null && typeof work === 'object' &&
    typeof work.structure === 'string' &&
    FARM_STRUCTURE_IDS.includes(work.structure as FarmStructureId) &&
    typeof work.startedAt === 'number' && Number.isFinite(work.startedAt) &&
    typeof work.endsAt === 'number' && Number.isFinite(work.endsAt) &&
    work.endsAt >= work.startedAt
  ) {
    story.construction = {
      structure: work.structure as FarmStructureId,
      startedAt: work.startedAt,
      endsAt: work.endsAt,
    };
  }
  return story;
}

export function save(
  camp: CampState,
  roster: Roster,
  watermark: number,
  onboarding: OnbStep = 'done',
): void {
  const data: SaveV1 = {
    version: VERSION,
    savedAt: Date.now() / 1000,
    watermark,
    levels: camp.levels,
    layout: camp.layout,
    // exactOptionalPropertyTypes: у лагеря без якоря ключа нет вовсе.
    ...(camp.origin !== undefined ? { origin: camp.origin } : {}),
    ...(camp.glade !== undefined ? { glade: camp.glade } : {}),
    ...(camp.trades !== undefined ? { trades: camp.trades } : {}),
    ...(camp.coins !== undefined ? { coins: camp.coins } : {}),
    ...(camp.coinDay !== undefined ? { coinDay: camp.coinDay } : {}),
    ...(camp.wheelDay !== undefined ? { wheelDay: camp.wheelDay } : {}),
    ...(camp.supplyPity !== undefined ? { supplyPity: camp.supplyPity } : {}),
    ...(camp.daily !== undefined ? { daily: { day: camp.daily.day, taken: camp.daily.taken } } : {}),
    ...(camp.guestPromised === true ? { guest: true } : {}),
    resources: camp.resources,
    construction: camp.construction,
    loadout: camp.loadout,
    raids: camp.raids,
    tierRaids: [0, 1, 2, 3].map((t) => camp.tierRaids[t as Tier]),
    gear: camp.gear,
    offhand: camp.offhand,
    arrows: camp.arrows,
    walls: camp.walls,
    sortie: camp.sortie ?? null,
    // Заходы старше окна на богатство уже не влияют — в сохранение они
    // не едут, иначе список растёт без предела.
    visits: liveVisits(camp.visits, watermark).map((v) => ({ n: v.node, s: v.shift })),
    // Пишется остаток, а не список с пометками: разбитый валун — это просто
    // камень, которого больше нет, и хранить о нём запись незачем.
    stones: camp.stones.filter((s) => !s.taken).map((s) => ({ x: s.x, z: s.z })),
    residents: camp.residents.map((r) => ({
      id: residentUuid(r),
      name: r.name,
      look: r.look,
      answer: r.answer,
      seed: r.seed,
      // Пишется только правда «отдыхает»: false — умолчание чтения,
      // и старый сейв без поля читается работающим лагерем, каким и был.
      ...(r.rest ? { rest: true } : {}),
      ...(r.schedule !== undefined ? { schedule: r.schedule } : {}),
      ...(r.hunt !== undefined ? { hunt: r.hunt } : {}),
      // Ремесло пишется только у того, у кого оно есть: пустое поле у всех
      // прочих было бы записью «ремесла нет» там, где его никогда и не было.
      ...(r.craft !== undefined ? { craft: r.craft } : {}),
    })),
    ...(camp.foxesCaught !== undefined ? { foxes: camp.foxesCaught } : {}),
    tents: camp.tents.map((t) => ({ x: t.x, z: t.z })),
    ...(camp.farm !== undefined
      ? {
          farm: {
            foodAtStart: camp.farm.foodAtStart,
            gatheredFood: camp.farm.gatheredFood,
            step: camp.farm.step,
            unlocked: camp.farm.unlocked,
            activePlots: camp.farm.activePlots,
            selectedCrop: camp.farm.selectedCrop,
            plots: camp.farm.plots.map((plot) => plot === null
              ? null
              : { plantedAt: plot.plantedAt, crop: plot.crop }),
            story: {
              ...camp.farm.story,
              structures: { ...camp.farm.story.structures },
              construction: camp.farm.story.construction === null
                ? null
                : { ...camp.farm.story.construction },
            },
          },
        }
      : {}),
    ...(camp.signposts !== undefined
      ? { signposts: { camp: camp.signposts.camp, farm: camp.signposts.farm } }
      : {}),
    chests: camp.chests.map((c) => ({ x: c.x, z: c.z })),
    // exactOptionalPropertyTypes: у лагеря без клана ключа нет вовсе.
    ...(camp.clan != null
      ? {
          clan: {
            name: camp.clan.name,
            at: camp.clan.at,
            ...(camp.clan.leader !== undefined ? { leader: camp.clan.leader } : {}),
            ...(camp.clan.location !== undefined
              ? {
                  location: {
                    seed: camp.clan.location.seed,
                    glade: { ...camp.clan.location.glade },
                    buildings: camp.clan.location.buildings.map((b) => ({ ...b })),
                    resources: { ...camp.clan.location.resources },
                    construction: camp.clan.location.construction === null
                      ? null
                      : { ...camp.clan.location.construction },
                    builders: [...camp.clan.location.builders],
                    workedAt: camp.clan.location.workedAt,
                  },
                }
              : {}),
          },
        }
      : {}),
    // exactOptionalPropertyTypes: у лагеря без гостей этих ключей нет вовсе.
    ...(camp.fires !== undefined ? { fires: camp.fires.map((f) => ({ x: f.x, z: f.z })) } : {}),
    // §13.8 — кусты: клетка и время сбора. Обобранный обязан пережить
    // перезагрузку так же, как разбитый валун, иначе ягоды становятся
    // бесконечными на любой кнопке «обновить».
    ...(camp.picks !== undefined && Object.keys(camp.picks).length > 0
      ? { picks: camp.picks }
      : {}),
    // §13.5 — выкупленное с прилавка. Пишется по той же причине, что кусты:
    // иначе суточный запас лавки обновлялся бы кнопкой «обновить».
    ...(camp.bought !== undefined && Object.keys(camp.bought).length > 0
      ? { bought: camp.bought }
      : {}),
    ...(camp.bushes !== undefined
      ? {
          bushes: camp.bushes.map((b) => ({
            x: b.x,
            z: b.z,
            ...(b.pickedAt !== undefined ? { pickedAt: b.pickedAt } : {}),
          })),
        }
      : {}),
    ...(camp.guests !== undefined ? { guests: [...camp.guests] } : {}),
    ...(camp.minotaurVictories !== undefined ? { minotaurVictories: [...camp.minotaurVictories] } : {}),
    ...(camp.minotaurClaims !== undefined ? { minotaurClaims: [...camp.minotaurClaims] } : {}),
    ...(camp.minotaurReputation !== undefined ? { minotaurReputation: camp.minotaurReputation } : {}),
    ...(camp.minotaurQuestCycle !== undefined ? { minotaurQuestCycle: camp.minotaurQuestCycle } : {}),
    ...(camp.minotaurRelics !== undefined ? { minotaurRelics: { ...camp.minotaurRelics } } : {}),
    ...(camp.minotaurQuests !== undefined ? { minotaurQuests: camp.minotaurQuests } : {}),
    onb: onboarding,
    heroes: {
      active: roster.active,
      list: roster.heroes.map((h) => ({
        cls: h.cls,
        level: h.level,
        xp: h.xp,
        spent: { ...h.spent },
        sp: h.statPoints,
        sl: h.skillLevel,
        skp: h.skillPoints,
        wounds: h.wounds,
        status: h.status,
        busyUntil: h.busyUntil,
      })),
    },
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Приватный режим или переполнение — игра обязана продолжать работать
    // без сохранения, а не падать на записи.
  }
}

/**
 * Сейв как есть — для облачной копии (§6). Облако возит blob, не зная его
 * формы; форма остаётся заботой этого файла.
 */
export function rawSave(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * Приём облачного сейва. Кладётся в хранилище только знакомая версия:
 * blob чужой формы, легший под ключ, при следующем чтении молча стёр бы
 * лагерь — load() читает незнакомую версию как «начать заново».
 */
export function adoptRaw(raw: string): boolean {
  try {
    const data = JSON.parse(raw) as Partial<SaveV1>;
    if (data.version !== VERSION) return false;
    localStorage.setItem(KEY, raw);
    return true;
  } catch {
    return false;
  }
}

/** Сид лица из имени: для жильцов, записанных до того, как лицо появилось. */
export function seedOfName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function load(): LoadResult {
  const camp = createCamp();
  const roster = createRoster();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
  } catch {
    raw = null;
  }
  // Хранилища нет вовсе — это первый запуск: игра начинается с первого кадра.
  if (raw === null) return { camp, roster, watermark: 0, onboarding: 'glade' };

  try {
    const data = JSON.parse(raw) as Partial<SaveV1>;
    // Чужая или будущая версия — начинаем заново, но не роняем игру.
    if (data.version !== VERSION) return { camp, roster, watermark: 0, onboarding: 'glade' };

    for (const id of BUILDING_ORDER) {
      const level = data.levels?.[id];
      // Нижняя граница 0, а не 1: непостроенная Мастерская — законное состояние.
      if (typeof level === 'number' && level >= 0 && level <= 6) camp.levels[id] = level;
      const pos = data.layout?.[id];
      if (pos !== undefined && typeof pos.x === 'number' && typeof pos.z === 'number') {
        camp.layout[id] = { x: pos.x, z: pos.z };
      }
    }

    // Площадь зависит от Жилья, а сейв мог быть записан другой версией правил.
    // Здание, не влезающее в текущую площадь, возвращается на место по умолчанию:
    // молча уехавшая за край постройка выглядит как пропажа.
    const o = data.origin;
    if (o !== undefined && typeof o.x === 'number' && typeof o.z === 'number') {
      camp.origin = { x: o.x, z: o.z };
    }
    const g = data.glade;
    if (g !== undefined && typeof g.size === 'number' && typeof g.cells === 'string') {
      camp.glade = { size: g.size, cells: g.cells };
    }
    if (typeof data.trades === 'number' && data.trades >= 0) camp.trades = Math.floor(data.trades);
    if (typeof data.coins === 'number' && data.coins >= 0) camp.coins = Math.floor(data.coins);
    if (typeof data.coinDay === 'number') camp.coinDay = Math.floor(data.coinDay);
    if (typeof data.wheelDay === 'number') camp.wheelDay = Math.floor(data.wheelDay);
    if (typeof data.supplyPity === 'number' && Number.isFinite(data.supplyPity)) {
      camp.supplyPity = Math.max(0, Math.floor(data.supplyPity));
    }
    // §29 — подарки. Оба числа разбираются по одному и чинятся порознь:
    // сейв с испорченным счётом подарков не должен стоить игроку недели.
    const d = data.daily;
    if (d !== undefined && typeof d.taken === 'number' && d.taken >= 0) {
      camp.daily = {
        day: typeof d.day === 'number' && Number.isFinite(d.day) ? Math.floor(d.day) : -1,
        taken: Math.floor(d.taken),
      };
    }
    if (data.guest === true) camp.guestPromised = true;
    if (typeof data.foxes === 'number' && Number.isFinite(data.foxes) && data.foxes >= 0) {
      camp.foxesCaught = Math.floor(data.foxes);
    }

    const area = campArea(camp.levels.hq);
    const fallback = createCamp().layout;
    for (const id of BUILDING_ORDER) {
      const p = camp.layout[id];
      if (p.x < 0 || p.z < 0 || p.x + 2 > area || p.z + 2 > area) camp.layout[id] = fallback[id];
    }
    const res = emptyResources();
    for (const kind of RESOURCE_KINDS) {
      // Камень раньше звался солью. Версия сейва ради переименования не поднята
      // по той же причине, по какой не поднималась ради отряда: сохранения
      // прежних этапов обязаны открываться, а форма поля не изменилась —
      // изменилось только его имя.
      const value = data.resources?.[kind] ?? (kind === 'stone' ? data.resources?.salt : undefined);
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        res[kind] = Math.floor(value);
      }
    }
    camp.resources = res;
    // До появления счётчика одна снятая шкура была лучшим доступным следом
    // пойманной лисы. Проданные шкуры восстановить нельзя, но оставшиеся
    // обязаны засчитаться, иначе старый лагерь начал бы охоту с нуля.
    if (!(typeof data.foxes === 'number' && Number.isFinite(data.foxes) && data.foxes >= 0)) {
      camp.foxesCaught = res.pelt ?? 0;
    }
    const farm = data.farm;
    if (
      farm !== undefined &&
      typeof farm.foodAtStart === 'number' && Number.isFinite(farm.foodAtStart) && farm.foodAtStart >= 0 &&
      typeof farm.gatheredFood === 'number' && Number.isFinite(farm.gatheredFood) && farm.gatheredFood >= 0 &&
      (farm.step === 'intro' || farm.step === 'goal' || farm.step === 'reward' || farm.step === 'done')
    ) {
      const gatheredFood = Math.min(FARM_FOOD_GOAL, Math.floor(farm.gatheredFood));
      const unlocked = farm.unlocked === true || gatheredFood >= FARM_FOOD_GOAL;
      const activePlots =
        typeof farm.activePlots === 'number' && Number.isFinite(farm.activePlots)
          ? Math.max(0, Math.min(FARM_PLOT_COUNT, Math.floor(farm.activePlots)))
          : FARM_STARTING_PLOT_COUNT;
      const selectedCrop = isFarmCropId(farm.selectedCrop) ? farm.selectedCrop : FARM_DEFAULT_CROP;
      const plots = emptyFarmPlots();
      if (Array.isArray(farm.plots)) {
        for (let i = 0; i < FARM_PLOT_COUNT; i += 1) {
          const plot = farm.plots[i];
          if (
            plot !== null && typeof plot === 'object' &&
            typeof plot.plantedAt === 'number' && Number.isFinite(plot.plantedAt) && plot.plantedAt >= 0
          ) {
            plots[i] = {
              plantedAt: plot.plantedAt,
              crop: isFarmCropId(plot.crop) ? plot.crop : FARM_DEFAULT_CROP,
            };
          }
        }
      }
      camp.farm = {
        foodAtStart: Math.floor(farm.foodAtStart),
        gatheredFood,
        step: unlocked && (farm.step === 'intro' || farm.step === 'goal') ? 'reward' : farm.step,
        unlocked,
        activePlots,
        selectedCrop,
        plots,
        story: readFarmStory(farm.story),
      };
    }
    const signs = data.signposts;
    if (signs != null && typeof signs === 'object') {
      camp.signposts = {
        camp: validSignposts(signs.camp),
        farm: validSignposts(signs.farm),
      };
    }
    if (typeof data.raids === 'number') camp.raids = data.raids;
    // §22.6б — зрелость ярусов. Нет поля — ярусы свежие, вход снова мягкий.
    if (Array.isArray(data.tierRaids)) {
      for (const t of [0, 1, 2, 3] as const) {
        const v = data.tierRaids[t];
        if (typeof v === 'number' && v >= 0) camp.tierRaids[t] = Math.floor(v);
      }
    }
    if (Array.isArray(data.visits)) {
      camp.visits = data.visits
        .filter(
          (v) =>
            v != null &&
            typeof v.n === 'number' &&
            typeof v.s === 'number' &&
            v.n >= 0,
        )
        .map((v) => ({ node: Math.floor(v.n), shift: Math.floor(v.s) }));
    }
    if (Array.isArray(data.loadout)) {
      camp.loadout = data.loadout.filter((id) => id in CONSUMABLES).slice(0, CONSUMABLE_SLOTS);
    }

    const c = data.construction;
    if (c != null && BUILDING_ORDER.includes(c.building) && typeof c.endsAt === 'number') {
      camp.construction = c;
    }

    // Стены. Читается по полям, а не целиком: чужой или испорченный сейв
    // не должен подсовывать симуляции список неизвестной формы.
    const w = data.walls;
    if (w != null) {
      const keys = (list: unknown): string[] =>
        Array.isArray(list) ? list.filter((k) => typeof k === 'string') : [];
      camp.walls = {
        cells: keys(w.cells),
        // Ограда, настил и фонари терялись здесь молча: список полей отстал
        // от состояния стен, и постройка не переживала перезапуск.
        fences: keys(w.fences),
        ...(w.fence === undefined ? {} : { fence: w.fence }),
        roads: keys(w.roads),
        lamps: keys(w.lamps),
        towers: typeof w.towers === 'object' && w.towers !== null ? { ...w.towers } : {},
        gates: keys(w.gates),
        stairs: typeof w.stairs === 'object' && w.stairs !== null ? { ...w.stairs } : {},
        work: w.work ?? null,
      };
    }

    // Отряд в пути. Читается по полям, как стены: чужой сейв не должен
    // подсовывать симуляции билет неизвестной формы, а пропущенное поле
    // входа сделало бы поход невоспроизводимым.
    const so = data.sortie;
    if (
      so != null &&
      typeof so.endsAt === 'number' &&
      typeof so.seed === 'number' &&
      typeof so.hero === 'number' &&
      so.at != null &&
      typeof so.at.kitchen === 'number' &&
      typeof so.at.storage === 'number'
    ) {
      camp.sortie = so;
    }

    // Валуны: список — это то, что ещё лежит. Разбитые в сейв не попадают,
    // поэтому читать их обратно нечего, а нумерация раздаётся заново.
    if (Array.isArray(data.stones)) {
      camp.stones = data.stones
        .filter((s) => s != null && typeof s.x === 'number' && typeof s.z === 'number')
        .map((s, id) => ({ id, x: Math.floor(s.x), z: Math.floor(s.z), taken: false }));
    } else {
      camp.stones = campStones();
    }

    // Жилец без внятной внешности или ответа не восстанавливается вовсе:
    // подставить умолчание значило бы придумать за игрока, кого он позвал.
    if (Array.isArray(data.residents)) {
      camp.residents = data.residents
        // §13.7 — занятий стало три: к двум ответам знакомства добавился
        // приказ «добывать пищу». Проверять по `SELF_ANSWERS` теперь нельзя —
        // сохранение с добытчиком не открылось бы, и жилец пропал бы молча.
        .filter((r): r is {
          name: string;
          id?: string;
          look: DwellerLook;
          answer: ResidentJob;
          seed?: number;
          rest?: boolean;
          schedule?: string;
          hunt?: { startedAt: number; endsAt: number; seed: number };
          craft?: string;
        } =>
          r != null &&
          typeof r.name === 'string' &&
          r.name !== '' &&
          // Внешность меряется всем списком, а не пулом гуляющих
          // (`DWELLER_LOOK_KINDS`): по второму нанятый лесник в сейв
          // записался бы, а обратно не прочитался.
          DWELLER_LOOK_KINDS.includes(r.look as DwellerLook) &&
          RESIDENT_JOBS.includes(r.answer as ResidentJob))
        // Сид лица у старых сохранений отсутствует, и выдумывать его случайно
        // нельзя: жилец менял бы лицо при каждой загрузке. Берётся из имени —
        // оно у жильца не меняется, значит и лицо не изменится.
        .map((r) => ({
          id: residentUuid({
            name: r.name,
            look: r.look,
            seed: typeof r.seed === 'number' ? r.seed : seedOfName(r.name),
            ...(typeof r.id === 'string' ? { id: r.id } : {}),
          }),
          name: r.name,
          look: r.look,
          answer: r.answer,
          seed: typeof r.seed === 'number' ? r.seed : seedOfName(r.name),
          // Отдых — недавнее поле: сейв без него читается работающим лагерем.
          rest: r.rest === true,
          ...(RESIDENT_SCHEDULE_ORDER.includes(r.schedule as ResidentScheduleId)
            ? { schedule: r.schedule as ResidentScheduleId }
            : {}),
          // Незнакомое ремесло читается как «ремесла нет»: человек остаётся
          // в лагере обычными руками. Выбросить его целиком значило бы
          // отнять у игрока купленного жильца из-за одного поля.
          ...(RESIDENT_CRAFTS.includes(r.craft as ResidentCraft)
            ? { craft: r.craft as ResidentCraft }
            : {}),
          ...(r.hunt != null &&
            typeof r.hunt.startedAt === 'number' && Number.isFinite(r.hunt.startedAt) &&
            typeof r.hunt.endsAt === 'number' && Number.isFinite(r.hunt.endsAt) &&
            r.hunt.endsAt >= r.hunt.startedAt &&
            typeof r.hunt.seed === 'number' && Number.isFinite(r.hunt.seed)
              ? {
                  hunt: {
                    startedAt: r.hunt.startedAt,
                    endsAt: r.hunt.endsAt,
                    seed: Math.floor(r.hunt.seed) >>> 0,
                  },
                }
              : {}),
        }));
    }
    if (Array.isArray(data.tents)) {
      camp.tents = data.tents
        .filter((t) => t != null && typeof t.x === 'number' && typeof t.z === 'number')
        .map((t) => ({ x: Math.floor(t.x), z: Math.floor(t.z) }));
    }
    // Клан читается только целым: имя без часа основания и час без имени —
    // это половина записи, а не лагерь со странным кланом.
    if (data.clan != null && typeof data.clan.name === 'string' && data.clan.name.trim() !== '') {
      camp.clan = {
        name: data.clan.name.trim(),
        at: typeof data.clan.at === 'number' ? data.clan.at : 0,
        // Все сохранения до ролей принадлежат основателю и читаются главой.
        leader: data.clan.leader !== false,
        ...(data.clan.location != null &&
          typeof data.clan.location.seed === 'number' &&
          data.clan.location.glade != null &&
          typeof data.clan.location.glade.size === 'number' &&
          Number.isInteger(data.clan.location.glade.size) &&
          data.clan.location.glade.size > 0 &&
          typeof data.clan.location.glade.cells === 'string'
            ? {
                location: {
                  seed: data.clan.location.seed >>> 0,
                  glade: {
                    size: data.clan.location.glade.size,
                    cells: data.clan.location.glade.cells,
                  },
                  buildings: Array.isArray(data.clan.location.buildings)
                    ? data.clan.location.buildings
                        .filter((b): b is { kind: ClanBuildingKind; x: number; z: number } =>
                          b != null &&
                          CLAN_BUILDING_ORDER.includes(b.kind as ClanBuildingKind) &&
                          typeof b.x === 'number' && Number.isFinite(b.x) &&
                          typeof b.z === 'number' && Number.isFinite(b.z))
                        .map((b) => ({ kind: b.kind, x: Math.floor(b.x), z: Math.floor(b.z) }))
                    : [],
                  resources: (() => {
                    const start = startingClanResources();
                    const raw = data.clan!.location!.resources;
                    if (raw == null) return start;
                    for (const kind of ['stone', 'wood', 'iron'] as const) {
                      const amount = raw[kind];
                      if (typeof amount === 'number' && Number.isFinite(amount)) {
                        start[kind] = Math.max(0, Math.floor(amount));
                      }
                    }
                    return start;
                  })(),
                  construction: (() => {
                    const site = data.clan!.location!.construction;
                    if (site == null ||
                        !CLAN_BUILDING_ORDER.includes(site.kind as ClanBuildingKind) ||
                        typeof site.x !== 'number' || !Number.isFinite(site.x) ||
                        typeof site.z !== 'number' || !Number.isFinite(site.z) ||
                        typeof site.work !== 'number' || !Number.isFinite(site.work)) return null;
                    return {
                      kind: site.kind as ClanBuildingKind,
                      x: Math.floor(site.x),
                      z: Math.floor(site.z),
                      work: Math.max(0, site.work),
                    };
                  })(),
                  builders: Array.isArray(data.clan.location.builders)
                    ? data.clan.location.builders
                        .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
                        .map((savedId) => {
                          const resident = camp.residents.find((item) =>
                            residentUuid(item) === savedId || item.name === savedId);
                          return resident === undefined ? null : residentUuid(resident);
                        })
                        .filter((id): id is string => id !== null)
                    : [],
                  workedAt: typeof data.clan.location.workedAt === 'number' &&
                      Number.isFinite(data.clan.location.workedAt)
                    ? data.clan.location.workedAt
                    : (typeof data.clan.at === 'number' ? data.clan.at : 0),
                },
              }
            : {}),
      };
    }
    if (Array.isArray(data.chests)) {
      camp.chests = data.chests
        .filter((c) => c != null && typeof c.x === 'number' && typeof c.z === 'number')
        .map((c) => ({ x: Math.floor(c.x), z: Math.floor(c.z) }));
    } else {
      // Миграция: лагерь, разбитый до сундуков, получает свой первый —
      // тот, что новым игрокам ставит пролог. Ближайшая свободная клетка
      // к Жилью, как у пролога; места нет — сундук подождёт перестановки:
      // прибавка считается от списка, и пустой список честнее фантомного.
      adoptChest(camp, { x: -1, z: -1 });
    }
    // §13.8 — тронутое игроком в местах мира. Чистится здесь же: список
    // самоистекающий, и держать в памяти созревшее незачем.
    if (data.picks != null && typeof data.picks === 'object') {
      const raw = data.picks as Record<string, unknown>;
      const log: PickLog = {};
      for (const [key, at] of Object.entries(raw)) {
        if (typeof at === 'number' && Number.isFinite(at)) log[key] = at;
      }
      // Чистится по отметке сейва: своих часов у загрузки нет, а водяной
      // знак — то самое время, когда игрок последний раз был здесь.
      camp.picks = prunePicks(log, typeof data.watermark === 'number' ? data.watermark : 0);
    }
    // §13.5 — выкупленное у торговца. Чистится тем же водяным знаком:
    // вчерашние покупки прилавка сегодня не держат.
    if (data.bought != null && typeof data.bought === 'object') {
      const raw = data.bought as Record<string, unknown>;
      const log: Record<string, number> = {};
      for (const [key, n] of Object.entries(raw)) {
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) log[key] = n;
      }
      camp.bought = pruneBought(log, typeof data.watermark === 'number' ? data.watermark : 0);
    }
    if (Array.isArray(data.bushes)) {
      camp.bushes = data.bushes
        .filter((b): b is { x: number; z: number; pickedAt?: number } =>
          b != null && typeof b.x === 'number' && typeof b.z === 'number')
        .map((b, id) => ({
          id,
          x: b.x,
          z: b.z,
          ...(typeof b.pickedAt === 'number' ? { pickedAt: b.pickedAt } : {}),
        }));
    }
    if (Array.isArray(data.fires)) {
      camp.fires = data.fires
        .filter((f) => f != null && typeof f.x === 'number' && typeof f.z === 'number')
        .map((f) => ({ x: Math.floor(f.x), z: Math.floor(f.z) }));
    }
    if (Array.isArray(data.guests)) {
      camp.guests = data.guests.filter((g): g is number => typeof g === 'number');
    }
    const seeds = (value: unknown): number[] | undefined => Array.isArray(value)
      ? [...new Set(value.filter((n): n is number =>
          typeof n === 'number' && Number.isInteger(n) && n >= 0).map((n) => n >>> 0))].slice(0, 128)
      : undefined;
    const victories = seeds(data.minotaurVictories);
    const claims = seeds(data.minotaurClaims);
    if (victories !== undefined) camp.minotaurVictories = victories;
    if (claims !== undefined) camp.minotaurClaims = claims;
    if (typeof data.minotaurReputation === 'number' && data.minotaurReputation >= 0) {
      camp.minotaurReputation = Math.floor(data.minotaurReputation);
    }
    if (typeof data.minotaurQuestCycle === 'number' && data.minotaurQuestCycle >= 0) {
      camp.minotaurQuestCycle = Math.floor(data.minotaurQuestCycle);
    }
    if (data.minotaurRelics != null && typeof data.minotaurRelics === 'object') {
      const relics: NonNullable<CampState['minotaurRelics']> = {};
      for (const [key, id] of Object.entries(data.minotaurRelics).slice(0, 128)) {
        if (id === 'golden-horn' || id === 'golem-heart' || id === 'labyrinth-signet') relics[key] = id;
      }
      camp.minotaurRelics = relics;
    }
    if (data.minotaurQuests != null && typeof data.minotaurQuests === 'object') {
      const quests: NonNullable<CampState['minotaurQuests']> = {};
      for (const [key, raw] of Object.entries(data.minotaurQuests).slice(0, 128)) {
        if (raw == null || typeof raw !== 'object') continue;
        const q = raw as Record<string, unknown>;
        if (
          (q.kind !== 'stone' && q.kind !== 'wood' && q.kind !== 'iron') ||
          typeof q.amount !== 'number' || !Number.isFinite(q.amount) || q.amount <= 0 ||
          typeof q.reward !== 'number' || !Number.isFinite(q.reward) || q.reward <= 0
        ) continue;
        quests[key] = {
          ...(typeof q.id === 'string' ? { id: q.id.slice(0, 40) } : {}),
          ...(typeof q.title === 'string' ? { title: q.title.slice(0, 80) } : {}),
          kind: q.kind,
          amount: Math.floor(q.amount),
          reward: Math.floor(q.reward),
          ...(typeof q.reputation === 'number' && q.reputation > 0
            ? { reputation: Math.floor(q.reputation) }
            : {}),
          completed: q.completed === true,
        };
      }
      camp.minotaurQuests = quests;
    }

    for (const slot of GEAR_ORDER) {
      const level = data.gear?.[slot];
      if (typeof level === 'number' && level >= 0 && level <= MAX_ITEM_LEVEL) {
        camp.gear[slot] = Math.floor(level);
      }
    }
    // §14.2 — незнакомое значение и отсутствие поля читаются одинаково:
    // фонарём. Так вёл себя лагерь до появления левой руки, и сейв прежних
    // этапов открывается ровно тем, чем закрывался.
    camp.offhand = data.offhand === 'shield' ? 'shield' : 'torch';
    if (typeof data.arrows === 'number' && data.arrows >= 0) {
      camp.arrows = Math.floor(data.arrows);
    }

    readRoster(roster, data.heroes, camp.sortie ?? null);
    // Состав догоняется до уровня Жилья: сейв мог быть записан правилами,
    // где гейты §11.8 стояли иначе, и отряд не должен от этого рассыпаться.
    while (syncRoster(roster, camp.levels.hq) !== null) { /* добираем по одному */ }

    return {
      camp,
      roster,
      watermark: typeof data.watermark === 'number' ? data.watermark : 0,
      onboarding: readStep(data.onb),
    };
  } catch {
    return { camp, roster, watermark: 0, onboarding: 'glade' };
  }
}

/**
 * Кадр из сейва. Вылазка перезапуск не переживает (см. readRoster), поэтому
 * кадр, идущий в локации, откатывается к началу: доигрывать первую вылазку
 * с середины не на чем.
 */
function readStep(saved: unknown): OnbStep {
  const renamed = typeof saved === 'string' ? RENAMED_STEPS[saved] : undefined;
  const step = renamed ?? ONB_ORDER.find((s) => s === saved);
  if (step === undefined) return 'done';
  return restartStep(step);
}

const STATUSES: readonly HeroState['status'][] = ['ready', 'raid', 'healing', 'training'];

/**
 * Отряд из сейва. Читается по одному полю с проверкой, как и всё остальное:
 * поле, которому нельзя верить на сервере, нельзя записывать и здесь (§6).
 * Герой «в вылазке» на момент записи возвращается готовым — вылазка
 * не переживает перезапуск, и оставлять его занятым навсегда нельзя.
 *
 * **Кроме ушедшего без игрока** (§26). Отправка перезапуск переживает —
 * её билет лежит в том же сейве, — и вернуть её героя готовым значило бы
 * отдать игроку бойца, который сейчас в пути: он ушёл бы во вторую вылазку,
 * а по возвращении первой лагерь выдернул бы его оттуда лечиться.
 * Поэтому занятость снимается всем, кроме того, чей билет открыт.
 */
function readRoster(roster: Roster, saved: SaveV1['heroes'], sortie: CampState['sortie']): void {
  if (saved === undefined || !Array.isArray(saved.list) || saved.list.length === 0) return;
  const heroes: HeroState[] = [];
  saved.list.forEach((h, i) => {
    // Классы переименовывались дважды: Солевар стал Носильщиком, а тройка
    // целиком — Рыцарем, Лучником и Бандитом (§11.7). Оба перехода живут
    // в одной таблице при самих классах, а не здесь: без неё сейв терял
    // героя вместе с опытом — незнакомый класс тут молча пропускается,
    // а syncRoster потом добирал бы новичка первого уровня.
    const saved = LEGACY_CLASS[h.cls] ?? h.cls;
    const cls = CLASS_ORDER.find((c) => c === saved);
    if (cls === undefined) return;
    const level = Math.max(
      1,
      Math.min(MAX_HERO_LEVEL, typeof h.level === 'number' ? Math.floor(h.level) : 1),
    );
    const status = STATUSES.find((s) => s === h.status) ?? 'ready';
    const away = status === 'raid' && sortie != null && sortie.hero === i;
    /**
     * §11.7 — купленные уровни характеристик. Старый сейв их не писал:
     * рост был автоматикой класса, и купленное выводится из неё же —
     * `growth · (уровень − 1)`, то есть герой открывается ровно тем,
     * кем был записан, а не ослабленным до базы.
     */
    const growth = HERO_CLASSES[cls].growth;
    const legacy: Stats = {
      attack: growth.attack * (level - 1),
      defense: growth.defense * (level - 1),
      knowledge: growth.knowledge * (level - 1),
      might: growth.might * (level - 1),
      agility: growth.agility * (level - 1),
    };
    const readSpent = (key: keyof Stats): number => {
      const v = h.spent?.[key];
      return typeof v === 'number' && v >= 0 ? Math.floor(v) : 0;
    };
    const spent: Stats =
      h.spent === undefined
        ? legacy
        : {
            attack: readSpent('attack'),
            defense: readSpent('defense'),
            knowledge: readSpent('knowledge'),
            might: readSpent('might'),
            agility: readSpent('agility'),
          };
    heroes.push({
      id: i,
      cls,
      level,
      xp: typeof h.xp === 'number' && h.xp >= 0 ? Math.floor(h.xp) : 0,
      spent,
      statPoints: typeof h.sp === 'number' && h.sp >= 0 ? Math.floor(h.sp) : 0,
      skillLevel:
        typeof h.sl === 'number'
          ? Math.max(1, Math.min(MAX_SKILL_LEVEL, Math.floor(h.sl)))
          : 1,
      // До появления прокачки умения каждый уже взятый уровень героя
      // ретроактивно даёт очко: старый сейв не теряет заработанный прогресс.
      skillPoints:
        typeof h.skp === 'number' && h.skp >= 0 ? Math.floor(h.skp) : Math.max(0, level - 1),
      wounds: typeof h.wounds === 'number' && h.wounds >= 0 ? Math.floor(h.wounds) : 0,
      status: status === 'raid' && !away ? 'ready' : status,
      busyUntil:
        (status !== 'raid' || away) && typeof h.busyUntil === 'number' ? h.busyUntil : null,
    });
  });
  if (heroes.length === 0) return;
  roster.heroes = heroes;
  roster.active =
    typeof saved.active === 'number' && saved.active >= 0 && saved.active < heroes.length
      ? saved.active
      : 0;
}

export function wipe(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* см. save() */
  }
}
