/**
 * Набег на лагерь (§6.1.6) — вторая половина стены.
 *
 * **Зачем это вообще.** Стена в лагере строилась, стоила камня и занимала
 * единственный слот стройки, а давала ноль: в лагерь никто не приходил.
 * Кольцо, которое не от кого замыкать, — не механика, а украшение, за которое
 * игрок платит прогрессом. Здесь появляется тот, от кого его замыкают.
 *
 * **Чего набег не отнимает, и это правило, а не настройка.** §10.2 отвергает
 * осады лагеря словами «потеря базы противоречит правилу „провал стоит одной
 * вылазки, а не прогресса“». Поэтому набег трогает **только склад**: ни
 * уровней зданий, ни самих зданий, ни идущей стройки, ни героев, ни стен.
 * Худшее, что он может сделать, — украсть то, что и так уносят из вылазки.
 *
 * **Почему PvE и почему без состояния.** §10.2 отвергает и PvP-осады —
 * армий в игре нет. А считается набег так же, как кланы (§4) и гарнизон
 * замка (§6.1.6.1): **чистой функцией времени**. Ни таймера, который кто-то
 * обязан продвигать, ни события, которое можно пропустить, — вернувшегося
 * встречает то, что случилось, ровно как с достроенным зданием (§20.2).
 */
import { campArea } from './camp';
import type { CampState } from './camp';
import { wallGrid, wallSpotOf } from './campWalls';
import type { CampWalls, WallSite } from './campWalls';
import { keyOf } from './castle';
import type { ResourceKind, Resources } from './resources';

/** Порядок обхода видов. Свой, а не общий: набег списывает со всех куч. */
const KINDS: readonly ResourceKind[] = ['stone', 'wood', 'iron', 'crystal'];

/** Раз в сколько часов приходит набег. */
export const RAID_HOURS = 6;

/**
 * Какую долю склада уводит набег с полностью открытого лагеря.
 *
 * Число первичное и подлежит замеру: оно обязано быть заметным, иначе стену
 * не станут строить, и не разорительным, иначе она станет обязательной,
 * а §20.1 держит слот стройки под выбор, а не под повинность.
 */
export const RAID_SHARE = 0.2;

/**
 * Насколько башня прикрывает то, что осталось открытым.
 *
 * §6.1.6 строил верх стены (`campTop`) прямо «под оборону: на какой клетке
 * стоит стрелок и куда он смотрит». Пока стрелка нет, башня работает числом,
 * и число это тоже первичное.
 */
export const TOWER_COVER = 0.25;

/** Сколько башен ещё считается. Дальше кольцо превращается в бухгалтерию. */
export const TOWER_CAP = 3;

/**
 * Сколько пропущенных набегов сводится за один заход.
 *
 * Без потолка отсутствие складывалось бы без предела: неделя — это двадцать
 * восемь набегов, а двадцать восемь раз по пятой части уносят склад целиком.
 * Ровно то «провал стоит прогресса», которое §10.2 запрещает, — только
 * растянутое во времени и потому незаметное при написании.
 *
 * Двойка, а не единица: вернуться и увидеть, что тебя грабили, пока тебя
 * не было **дважды**, — это напоминание про стену. Увидеть, что грабили
 * двадцать восемь раз, — это наказание за отпуск.
 */
export const RAID_MAX_PENDING = 2;

/** Номер набега: целых `RAID_HOURS` от начала монотонного времени. */
export const raidIndex = (seconds: number): number =>
  Math.floor(seconds / (RAID_HOURS * 3600));

/**
 * Какие здания достаёт набег.
 *
 * Считается тем же, чем считал бы игрок: **доходит ли до здания снаружи.**
 * Волна пускается от края площади по клеткам, где нет стены; здание, до
 * которого она дошла, открыто. Кольцо с дырой не защищает ничего — ровно
 * как везде, где стены работают, и ровно как ждёт игрок, однажды строивший
 * стену в любой другой игре.
 *
 * Ворота считаются стеной: арка — постройка, и закрыть её створки некому
 * только потому, что створок мы не рисуем. Лестница и ограда — нет: первая
 * стоит внутри, вторая (§6.1.7) метровая и городит двор, а не оборону.
 */
export function exposed(walls: CampWalls, site: WallSite): string[] {
  const grid = wallGrid(site.area);
  if (grid <= 0) return Object.keys(site.layout);

  const wall = new Set(walls.cells);
  const seen = new Uint8Array(grid * grid);
  const queue: { x: number; z: number }[] = [];

  const push = (x: number, z: number): void => {
    if (x < 0 || z < 0 || x >= grid || z >= grid) return;
    const at = z * grid + x;
    if (seen[at]) return;
    // Стена волну не пропускает. Здание — пропускает: до него как раз
    // и надо выяснить, добираются ли.
    if (wall.has(keyOf({ x, z }))) return;
    seen[at] = 1;
    queue.push({ x, z });
  };

  // Снаружи — это весь край площади: за ним поля, и никакой стены там нет.
  for (let i = 0; i < grid; i++) {
    push(i, 0);
    push(i, grid - 1);
    push(0, i);
    push(grid - 1, i);
  }
  for (let head = 0; head < queue.length; head++) {
    const { x, z } = queue[head]!;
    push(x + 1, z);
    push(x - 1, z);
    push(x, z + 1);
    push(x, z - 1);
  }

  const open: string[] = [];
  for (const [id, at] of Object.entries(site.layout)) {
    const spot = wallSpotOf(at.x, at.z);
    if (spot.x < 0 || spot.z < 0 || spot.x >= grid || spot.z >= grid) continue;
    if (seen[spot.z * grid + spot.x]) open.push(id);
  }
  return open;
}

/**
 * Доля склада, которую уводит один набег, 0..1.
 *
 * Складывается из двух вещей, и обе видны игроку на площади: сколько зданий
 * стоит открытыми и сколько башен по кольцу. Здания считаются штуками,
 * а не площадью: игрок читает лагерь домами.
 */
export function raidTake(walls: CampWalls, site: WallSite): number {
  const all = Object.keys(site.layout).length;
  if (all === 0) return 0;
  const open = exposed(walls, site).length;
  if (open === 0) return 0;

  const towers = Math.min(TOWER_CAP, Object.keys(walls.towers).length);
  const cover = 1 - TOWER_COVER * towers;
  return RAID_SHARE * (open / all) * Math.max(0, cover);
}

/** Что набег унёс. Пустой список означает, что кольцо выдержало. */
export interface RaidLoss {
  /** Сколько набегов сошлось за один заход: игрока не было сутки — их четыре. */
  readonly raids: number;
  readonly taken: Partial<Resources>;
  readonly total: number;
  /** Здания, до которых дошли. Пустой — кольцо замкнуто. */
  readonly open: readonly string[];
}

/**
 * Свести набеги, случившиеся с прошлого захода, и списать добытое.
 *
 * Возвращает `null`, если сводить нечего. Меняет **только `resources`** —
 * см. заголовок файла: у набега нет права трогать прогресс.
 */
export function resolveRaids(camp: CampState, now: number): RaidLoss | null {
  const index = raidIndex(now);
  const last = camp.raidedAt ?? index;
  camp.raidedAt = index;
  const raids = Math.min(RAID_MAX_PENDING, index - last);
  if (raids <= 0) return null;

  const site: WallSite = { area: campArea(camp.levels.hq), layout: camp.layout, levels: camp.levels };
  const walls = camp.walls;
  const open = walls === null || walls === undefined ? Object.keys(site.layout) : exposed(walls, site);
  const share = walls === null || walls === undefined
    ? RAID_SHARE * (Object.keys(site.layout).length > 0 ? 1 : 0)
    : raidTake(walls, site);
  if (share <= 0) return { raids, taken: {}, total: 0, open };

  // Набеги считаются по одному, а не сложенной долей: два набега по пятой
  // уносят меньше, чем два пятых, и это правильно — второй приходит
  // на опустевший склад.
  const taken: Partial<Resources> = {};
  let total = 0;
  for (const kind of KINDS) {
    let left = camp.resources[kind];
    let lost = 0;
    for (let i = 0; i < raids; i++) {
      const cut = Math.floor(left * share);
      lost += cut;
      left -= cut;
    }
    if (lost <= 0) continue;
    camp.resources[kind] = left;
    taken[kind] = lost;
    total += lost;
  }
  return { raids, taken, total, open };
}

/** Строка для панели стройки: что кольцо даёт прямо сейчас. */
export function wallLine(walls: CampWalls, site: WallSite): string {
  const all = Object.keys(site.layout).length;
  const open = exposed(walls, site);
  if (all === 0) return 'Ставить нечего: в лагере нет зданий';
  if (open.length === 0) return 'Кольцо замкнуто: набег не доходит до построек';
  const share = Math.round(raidTake(walls, site) * 100);
  return `Открыто построек ${open.length} из ${all} · набег уносит ${share}% склада`;
}
