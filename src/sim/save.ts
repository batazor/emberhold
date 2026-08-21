import type { BuildingId, CampState } from './camp';
import { BUILDING_ORDER, campArea, campStones, createCamp } from './camp';
import { DWELLER_LOOKS } from './garrison';
import type { DwellerLook } from './garrison';
import { SELF_ANSWERS } from './settler';
import type { SelfAnswer } from './settler';
import { GEAR_ORDER, MAX_ITEM_LEVEL } from './gear';
import type { GearSlot } from './gear';
import { CLASS_ORDER, LEGACY_CLASS, MAX_HERO_LEVEL, createRoster, syncRoster } from './heroes';
import type { HeroState, Roster } from './heroes';
import { CONSUMABLES, CONSUMABLE_SLOTS } from './consumables';
import { ONB_ORDER, RENAMED_STEPS, restartStep } from './onboarding';
import type { OnbStep } from './onboarding';
import { emptyResources } from './resources';
import { liveVisits } from './world';
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
  resources: Record<ResourceKind, number> & {
    /** Легаси: до переименования камень звался солью. Пишется только чтением. */
    salt?: number;
  };
  construction: CampState['construction'];
  /** Якорь площадки на поляне (§16.1). Необязателен: сейв до якоря
   *  открывается, его лагерь стоит в нулевом. */
  origin?: { x: number; z: number };
  /** Поляна пролога (§16.1). Необязательна: сейв без неё рисует лес-кольцо. */
  glade?: { size: number; cells: string };
  loadout?: CampState['loadout'];
  raids: number;
  /**
   * Стены лагеря (§6.1.6). Поле необязательное, версия сейва ради него
   * не поднята — тем же приёмом, что отряд и снаряжение: сейв, записанный
   * до стройки стен, обязан открываться. Без этого поля всё построенное
   * пропадало при перезагрузке, а стройка стоит камня и времени.
   */
  walls?: CampState['walls'];
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
  residents?: { name: string; look: string; answer: string; seed?: number }[];
  tents?: { x: number; z: number }[];
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
    // exactOptionalPropertyTypes: у лагеря без якоря ключа нет вовсе.
    ...(camp.origin !== undefined ? { origin: camp.origin } : {}),
    ...(camp.glade !== undefined ? { glade: camp.glade } : {}),
    resources: camp.resources,
    construction: camp.construction,
    loadout: camp.loadout,
    raids: camp.raids,
    gear: camp.gear,
    offhand: camp.offhand,
    arrows: camp.arrows,
    walls: camp.walls,
    // Заходы старше окна на богатство уже не влияют — в сохранение они
    // не едут, иначе список растёт без предела.
    visits: liveVisits(camp.visits, watermark).map((v) => ({ n: v.node, s: v.shift })),
    // Пишется остаток, а не список с пометками: разбитый валун — это просто
    // камень, которого больше нет, и хранить о нём запись незачем.
    stones: camp.stones.filter((s) => !s.taken).map((s) => ({ x: s.x, z: s.z })),
    residents: camp.residents.map((r) => ({
      name: r.name,
      look: r.look,
      answer: r.answer,
      seed: r.seed,
    })),
    tents: camp.tents.map((t) => ({ x: t.x, z: t.z })),
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

    const area = campArea(camp.levels.hq);
    const fallback = createCamp().layout;
    for (const id of BUILDING_ORDER) {
      const p = camp.layout[id];
      if (p.x < 0 || p.z < 0 || p.x + 2 > area || p.z + 2 > area) camp.layout[id] = fallback[id];
    }
    const res = emptyResources();
    for (const kind of Object.keys(res) as ResourceKind[]) {
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
    if (typeof data.raids === 'number') camp.raids = data.raids;
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
      camp.walls = {
        cells: Array.isArray(w.cells) ? w.cells.filter((k) => typeof k === 'string') : [],
        towers: typeof w.towers === 'object' && w.towers !== null ? { ...w.towers } : {},
        gates: Array.isArray(w.gates) ? w.gates.filter((k) => typeof k === 'string') : [],
        stairs: typeof w.stairs === 'object' && w.stairs !== null ? { ...w.stairs } : {},
        work: w.work ?? null,
      };
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
        .filter((r): r is { name: string; look: DwellerLook; answer: SelfAnswer; seed?: number } =>
          r != null &&
          typeof r.name === 'string' &&
          r.name !== '' &&
          DWELLER_LOOKS.includes(r.look as DwellerLook) &&
          SELF_ANSWERS.includes(r.answer as SelfAnswer))
        // Сид лица у старых сохранений отсутствует, и выдумывать его случайно
        // нельзя: жилец менял бы лицо при каждой загрузке. Берётся из имени —
        // оно у жильца не меняется, значит и лицо не изменится.
        .map((r) => ({
          name: r.name,
          look: r.look,
          answer: r.answer,
          seed: typeof r.seed === 'number' ? r.seed : seedOfName(r.name),
        }));
    }
    if (Array.isArray(data.tents)) {
      camp.tents = data.tents
        .filter((t) => t != null && typeof t.x === 'number' && typeof t.z === 'number')
        .map((t) => ({ x: Math.floor(t.x), z: Math.floor(t.z) }));
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

    readRoster(roster, data.heroes);
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
 */
function readRoster(roster: Roster, saved: SaveV1['heroes']): void {
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
