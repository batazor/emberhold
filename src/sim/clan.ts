/**
 * Свой клан и тот момент, когда мир перестаёт быть пустым (§30).
 *
 * **Соседи появляются со вторым жильцом, и это не таймер.** Пока в лагере
 * один человек, лагерь — это ты сам, и вопроса «а кто ещё есть» у него нет.
 * Второй жилец — первое место в игре, где решение принимается не за себя;
 * ровно там и уместно, что на карте зажигаются чужие лагеря, а таблица
 * впервые показывает, где ты среди них.
 *
 * Порог поэтому считается людьми, а не вылазками и не сутками: вылазки
 * меряют умение, сутки не меряют ничего, а людей игрок приводит сам —
 * знакомством на прогалине (`settler.ts`) и уговором у стен
 * (`castleGuest.ts`).
 *
 * **Клан пока — это имя, а не список членов.** §10.3 держит порог создания
 * альянса в три живых игрока, и порог этот про другое: про пустой список
 * сокомандников, который бьёт по доверию. Списка здесь нет ни одного —
 * есть подпись, под которой лагерь стоит в таблице. Когда у клана появятся
 * члены, подмога и общий совет (§10.4), порог вернётся вместе с ними.
 *
 * **Во фракцию не вступают.** Четыре имени на карте — это мир (§4), а не
 * набор в команду: §10.3 прямо запрещает ботов в списке альянса, и «вступить
 * в Вольную Артель» было бы ровно тем поддельным сокомандником, от которого
 * раздел отказывается. Кнопка вступления поэтому стоит в окне рядом со своей
 * причиной словами (`ui/clanPanel.ts`), а не молчит серой (§16.1).
 */
import type { BuildingId, CampState } from './camp';
import { CLANS } from './world';
import { generateGlade, packGlade, unpackGlade } from './prologue';
import type { GladeSnapshot } from './prologue';
import { idx } from './grid';
import type { Cell } from './types';
import { residentUuid, scheduledWorkSeconds, WORK_CAP, WORK_SECONDS } from './residents';

/**
 * Со скольких жильцов открывается слой соседей. Двое — это первый лагерь,
 * который больше одного человека.
 */
export const CLAN_FROM_RESIDENTS = 2;

/** Свой клан: имя и час основания. Больше у него пока ничего нет. */
export interface OwnClan {
  readonly name: string;
  /** Час основания — секунды мировых часов (§27). */
  readonly at: number;
  /** Основатель — глава. Поле пригодится, когда появится вступление в клан. */
  leader?: boolean;
  /** Отдельная клановая опушка. Необязательна только у старых сохранений. */
  location?: ClanLocation;
}

export interface ClanLocation {
  readonly seed: number;
  /** Тот же снимок лесной поляны, из которого восстанавливается лагерь игрока. */
  readonly glade: GladeSnapshot;
  /** Постройки принадлежат общей поляне, а не личному лагерю главы. */
  buildings: ClanBuilding[];
  /** Общий склад клана. Охотничьи товары к базовому запасу не относятся. */
  resources: ClanResources;
  /** На общей поляне одновременно строят одно здание. */
  construction: ClanConstruction | null;
  /** UUID жителей этого игрока, отправленных на текущую стройку. */
  builders: string[];
  /** Отсюда считается следующая порция работы, в секундах мировых часов. */
  workedAt: number;
}

export type ClanResourceKind = 'stone' | 'wood' | 'iron';
export type ClanResources = Record<ClanResourceKind, number>;

export const CLAN_START_RESOURCES = 15;
export const CLAN_BUILD_SECONDS = WORK_SECONDS * WORK_CAP;

export const startingClanResources = (): ClanResources => ({
  stone: CLAN_START_RESOURCES,
  wood: CLAN_START_RESOURCES,
  iron: CLAN_START_RESOURCES,
});

export type ClanBuildingKind = 'hall' | 'store' | 'workshop';

export interface ClanBuilding {
  readonly kind: ClanBuildingKind;
  readonly x: number;
  readonly z: number;
}

export interface ClanConstruction extends ClanBuilding {
  /** Уже отработанные жителями секунды. */
  work: number;
}

export const CLAN_BUILDING_ORDER: readonly ClanBuildingKind[] = ['hall', 'store', 'workshop'];
export const CLAN_BUILDINGS: Readonly<Record<ClanBuildingKind, {
  readonly name: string;
  readonly model: BuildingId;
}>> = {
  hall: { name: 'Клановый штаб', model: 'hq' },
  store: { name: 'Клановый склад', model: 'storage' },
  workshop: { name: 'Клановая мастерская', model: 'forge' },
};

/** Стабильный сид: одна и та же запись клана всегда даёт ту же опушку. */
function clanLocationSeed(name: string, at: number): number {
  let seed = Math.floor(at) ^ 0x6c616e;
  for (let i = 0; i < name.length; i++) seed = Math.imul(seed ^ name.charCodeAt(i), 16777619);
  return seed >>> 0;
}

export function createClanLocation(name: string, at: number): ClanLocation {
  const seed = clanLocationSeed(name, at);
  return {
    seed,
    glade: packGlade(generateGlade(seed)),
    buildings: [],
    resources: startingClanResources(),
    construction: null,
    builders: [],
    workedAt: at,
  };
}

/** Миграция старого клана: локация появляется при первом обращении. */
export function ensureClanLocation(camp: CampState): ClanLocation | null {
  if (camp.clan == null) return null;
  camp.clan.location ??= createClanLocation(camp.clan.name, camp.clan.at);
  // Снимок, записанный между появлением опушки и появлением стройки.
  camp.clan.location.buildings ??= [];
  camp.clan.location.resources ??= startingClanResources();
  camp.clan.location.construction ??= null;
  camp.clan.location.builders ??= [];
  camp.clan.location.workedAt ??= camp.clan.at;
  return camp.clan.location;
}

export type ClanBuildBlock =
  | 'ok' | 'no-clan' | 'leader' | 'built' | 'construction' | 'tree' | 'busy' | 'hero';

export const CLAN_BUILD_REASON: Record<Exclude<ClanBuildBlock, 'ok'>, string> = {
  'no-clan': 'Сначала нужен клан',
  leader: 'Размещать здания может только глава клана',
  built: 'Это здание уже построено',
  construction: 'У клана уже есть текущая стройка',
  tree: 'Здесь лес или край опушки',
  busy: 'Место занято другим зданием',
  hero: 'На месте стройки стоит герой',
};

/** Проверка следа 2×2 на общей опушке. */
export function clanBuildBlock(
  camp: CampState,
  kind: ClanBuildingKind,
  cell: Cell,
  hero?: Cell,
): ClanBuildBlock {
  const own = camp.clan;
  if (own == null) return 'no-clan';
  if (own.leader !== true) return 'leader';
  const location = ensureClanLocation(camp)!;
  if (location.buildings.some((b) => b.kind === kind) || location.construction?.kind === kind) {
    return 'built';
  }
  if (location.construction !== null) return 'construction';
  const blocked = unpackGlade(location.glade);
  for (let dz = 0; dz < 2; dz++) {
    for (let dx = 0; dx < 2; dx++) {
      const x = cell.x + dx;
      const z = cell.z + dz;
      if (x < 0 || z < 0 || x >= location.glade.size || z >= location.glade.size ||
          blocked[idx(location.glade.size, x, z)]) return 'tree';
    }
  }
  if (location.buildings.some((b) => Math.abs(b.x - cell.x) < 2 && Math.abs(b.z - cell.z) < 2)) {
    return 'busy';
  }
  if (hero !== undefined) {
    const hx = Math.round(hero.x);
    const hz = Math.round(hero.z);
    if (hx >= cell.x && hx < cell.x + 2 && hz >= cell.z && hz < cell.z + 2) return 'hero';
  }
  return 'ok';
}

export function placeClanBuilding(
  camp: CampState,
  kind: ClanBuildingKind,
  cell: Cell,
  hero?: Cell,
  now = 0,
): ClanBuildBlock {
  const block = clanBuildBlock(camp, kind, cell, hero);
  if (block !== 'ok') return block;
  const location = camp.clan!.location!;
  location.construction = { kind, x: cell.x, z: cell.z, work: 0 };
  location.builders = [];
  location.workedAt = now;
  return 'ok';
}

/** Жители, которые не должны в те же часы приносить добычу личному лагерю. */
export function clanBuilderIds(camp: CampState): ReadonlySet<string> {
  const location = camp.clan?.location;
  return new Set(location?.construction === null ? [] : (location?.builders ?? []));
}

/**
 * Отправить своего жителя на общую стройку или вернуть в личный лагерь.
 * Перед сменой состава досчитывается прежняя бригада: иначе новый человек
 * получил бы задним числом часы, когда приказа ещё не было.
 */
export function assignClanBuilder(
  camp: CampState,
  residentId: string,
  assigned: boolean,
  now: number,
): boolean {
  const location = ensureClanLocation(camp);
  if (location?.construction == null) return false;
  if (!camp.residents.some((resident) => residentUuid(resident) === residentId)) return false;
  advanceClanConstruction(camp, now);
  if (location.construction === null) return false;
  const has = location.builders.includes(residentId);
  if (has === assigned) return false;
  location.builders = assigned
    ? [...location.builders, residentId]
    : location.builders.filter((id) => id !== residentId);
  location.workedAt = now;
  return true;
}

export interface ClanConstructionAdvance {
  readonly worked: number;
  readonly completed: ClanBuildingKind | null;
}

/** Досчитать работу назначенных жителей по их обычным рабочим сменам. */
export function advanceClanConstruction(camp: CampState, now: number): ClanConstructionAdvance {
  const location = ensureClanLocation(camp);
  if (location === null || now <= location.workedAt) return { worked: 0, completed: null };
  const construction = location.construction;
  const from = location.workedAt;
  location.workedAt = now;
  if (construction === null || location.builders.length === 0) return { worked: 0, completed: null };

  const assigned = new Set(location.builders);
  let worked = 0;
  for (const resident of camp.residents) {
    if (!assigned.has(residentUuid(resident))) continue;
    worked += Math.min(
      WORK_SECONDS * WORK_CAP,
      scheduledWorkSeconds(resident, from, now),
    );
  }
  if (worked <= 0) return { worked: 0, completed: null };
  construction.work = Math.min(CLAN_BUILD_SECONDS, construction.work + worked);
  if (construction.work < CLAN_BUILD_SECONDS) return { worked, completed: null };

  const finished = construction.kind;
  location.buildings.push({ kind: construction.kind, x: construction.x, z: construction.z });
  location.construction = null;
  location.builders = [];
  return { worked, completed: finished };
}

/** Открыт ли слой соседей: чужие лагеря, таблица, почта и задание про клан. */
export const neighboursOpen = (camp: CampState): boolean =>
  camp.residents.length >= CLAN_FROM_RESIDENTS;

/**
 * Длина имени. Верхняя граница не про вкус: имя стоит в строке таблицы
 * рядом с силой и уровнем, и на телефоне 360 пикселей длинное имя выдавило
 * бы оттуда число, ради которого таблица и заведена.
 */
export const CLAN_NAME_MIN = 2;
export const CLAN_NAME_MAX = 24;

export type NameBlock = 'ok' | 'empty' | 'short' | 'long' | 'world';

/**
 * Почему это имя не годится. Причина, а не булево, — то же правило, что
 * у построек и у мест под палатку: отказ обязан называть, чего не хватает.
 */
export function nameBlock(name: string): NameBlock {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'empty';
  if (trimmed.length < CLAN_NAME_MIN) return 'short';
  if (trimmed.length > CLAN_NAME_MAX) return 'long';
  // Имена фракций заняты миром: свой клан, названный «Вольной Артелью»,
  // сделал бы таблицу нечитаемой — две строки с одним именем.
  if (CLANS.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return 'world';
  return 'ok';
}

export const NAME_REASON: Record<Exclude<NameBlock, 'ok'>, string> = {
  empty: 'Клану нужно имя',
  short: `Коротко: хотя бы ${CLAN_NAME_MIN} буквы`,
  long: `Длинно: не больше ${CLAN_NAME_MAX} знаков`,
  world: 'Так зовут фракцию мира',
};

/** Почему нельзя вступить в чужой клан. Строка одна, потому что причина одна. */
export const JOIN_REASON = 'Не к кому: на карте фракции мира, а они не набирают';

/**
 * Завести клан. Возвращает `false`, если имя не годится: лагерь не обязан
 * доверять тому, кто его зовёт, — та же осторожность, что у стройки.
 */
export function foundClan(camp: CampState, name: string, t: number): boolean {
  if (nameBlock(name) !== 'ok') return false;
  const trimmed = name.trim();
  camp.clan = { name: trimmed, at: t, leader: true, location: createClanLocation(trimmed, t) };
  return true;
}

/**
 * Что сейчас просит задание про клан. `none` — слой ещё не открыт или клан
 * уже есть; `ask` — открыт, а клана нет.
 */
export const clanTaskOpen = (camp: CampState): boolean =>
  neighboursOpen(camp) && (camp.clan ?? null) === null;
