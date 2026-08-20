import type { BuildingId, CampState } from './camp';
import { BUILDING_ORDER, campArea, createCamp } from './camp';
import { GEAR_ORDER, MAX_ITEM_LEVEL } from './gear';
import type { GearSlot } from './gear';
import { CLASS_ORDER, MAX_HERO_LEVEL, createRoster, syncRoster } from './heroes';
import type { HeroState, Roster } from './heroes';
import { CONSUMABLES, CONSUMABLE_SLOTS } from './consumables';
import { ONB_ORDER, restartStep } from './onboarding';
import type { OnbStep } from './onboarding';
import { emptyResources } from './resources';
import type { ResourceKind } from './resources';

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
  resources: Record<ResourceKind, number>;
  construction: CampState['construction'];
  loadout?: CampState['loadout'];
  raids: number;
  /**
   * Отряд (§11.8). Поле необязательное, и версия сейва ради него не поднята:
   * сохранение этапов 1–4 обязано открываться — иначе на каждом этапе игрок
   * терял бы лагерь, а мы — возможность сравнить замеры до и после.
   */
  heroes?: {
    active: number;
    list: { cls: string; level: number; xp: number; wounds: number; status: string; busyUntil: number | null }[];
  };
  /**
   * Снаряжение (§14). Тоже необязательное поле и по той же причине, что отряд:
   * сейв прежних этапов обязан открываться, иначе игрок теряет лагерь на
   * каждом шаге разработки, а мы — возможность сравнить замеры до и после.
   */
  gear?: Partial<Record<GearSlot, number>>;
  /**
   * Кадр онбординга (`onboarding.html`). Тоже необязательное поле: сейв,
   * записанный до онбординга, принадлежит игроку, который уже играл, —
   * его нельзя возвращать в первые три минуты. Отсутствие поля читается
   * как «пройдено», а не как «начать заново».
   */
  onb?: OnbStep;
}

export interface LoadResult {
  readonly camp: CampState;
  readonly roster: Roster;
  readonly watermark: number;
  readonly onboarding: OnbStep;
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
    resources: camp.resources,
    construction: camp.construction,
    loadout: camp.loadout,
    raids: camp.raids,
    gear: camp.gear,
    onb: onboarding,
    heroes: {
      active: roster.active,
      list: roster.heroes.map((h) => ({
        cls: h.cls,
        level: h.level,
        xp: h.xp,
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
      // Нижняя граница 0, а не 1: непостроенная Кузница — законное состояние.
      if (typeof level === 'number' && level >= 0 && level <= 6) camp.levels[id] = level;
      const pos = data.layout?.[id];
      if (pos !== undefined && typeof pos.x === 'number' && typeof pos.z === 'number') {
        camp.layout[id] = { x: pos.x, z: pos.z };
      }
    }

    // Площадь зависит от Штаба, а сейв мог быть записан другой версией правил.
    // Здание, не влезающее в текущую площадь, возвращается на место по умолчанию:
    // молча уехавшая за край постройка выглядит как пропажа.
    const area = campArea(camp.levels.hq);
    const fallback = createCamp().layout;
    for (const id of BUILDING_ORDER) {
      const p = camp.layout[id];
      if (p.x < 0 || p.z < 0 || p.x + 2 > area || p.z + 2 > area) camp.layout[id] = fallback[id];
    }
    const res = emptyResources();
    for (const kind of Object.keys(res) as ResourceKind[]) {
      const value = data.resources?.[kind];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        res[kind] = Math.floor(value);
      }
    }
    camp.resources = res;
    if (typeof data.raids === 'number') camp.raids = data.raids;
    if (Array.isArray(data.loadout)) {
      camp.loadout = data.loadout.filter((id) => id in CONSUMABLES).slice(0, CONSUMABLE_SLOTS);
    }

    const c = data.construction;
    if (c != null && BUILDING_ORDER.includes(c.building) && typeof c.endsAt === 'number') {
      camp.construction = c;
    }

    for (const slot of GEAR_ORDER) {
      const level = data.gear?.[slot];
      if (typeof level === 'number' && level >= 0 && level <= MAX_ITEM_LEVEL) {
        camp.gear[slot] = Math.floor(level);
      }
    }

    readRoster(roster, data.heroes);
    // Состав догоняется до уровня Штаба: сейв мог быть записан правилами,
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
  const step = ONB_ORDER.find((s) => s === saved);
  if (step === undefined) return 'done';
  return restartStep(step);
}

const STATUSES: readonly HeroState['status'][] = ['ready', 'raid', 'healing', 'training'];

/**
 * Отряд из сейва. Читается по одному полю с проверкой, как и всё остальное:
 * поле, которому нельзя верить на сервере, нельзя записывать и здесь (§6).
 * Герой «в вылазке» на момент записи возвращается готовым — вылазка
 * не переживает перезапуск, и оставлять его занятым навсегда нельзя.
 */
function readRoster(roster: Roster, saved: SaveV1['heroes']): void {
  if (saved === undefined || !Array.isArray(saved.list) || saved.list.length === 0) return;
  const heroes: HeroState[] = [];
  saved.list.forEach((h, i) => {
    const cls = CLASS_ORDER.find((c) => c === h.cls);
    if (cls === undefined) return;
    const level = typeof h.level === 'number' ? Math.floor(h.level) : 1;
    const status = STATUSES.find((s) => s === h.status) ?? 'ready';
    heroes.push({
      id: i,
      cls,
      level: Math.max(1, Math.min(MAX_HERO_LEVEL, level)),
      xp: typeof h.xp === 'number' && h.xp >= 0 ? Math.floor(h.xp) : 0,
      wounds: typeof h.wounds === 'number' && h.wounds >= 0 ? Math.floor(h.wounds) : 0,
      status: status === 'raid' ? 'ready' : status,
      busyUntil:
        status !== 'raid' && typeof h.busyUntil === 'number' ? h.busyUntil : null,
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
