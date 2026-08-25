import type { CampState } from './camp';
import type { TrailSite } from './trailSite';
import { generateSettler } from './settler';
import type { Settler } from './settler';
import type { Cell } from './types';
import { idx } from './grid';

/**
 * Первая глава после онбординга: не спасение мира, а перебитая поставка
 * железа. Она начинается первой ковкой, ведёт обратно к торговцу, затем к
 * пропавшему обозу на Тропе и заканчивается одним из трёх уже существующих
 * решений у минотавра — работой, обменом или силой.
 *
 * Глава живёт отдельно от `OnbStep`: онбординг сбрасывает незавершённую
 * вылазку при перезапуске, а эта цепочка проходит через несколько мест и
 * сессий. Смешать их значило бы либо сохранять целую прогулку, либо отнимать
 * у игрока найденного человека после перезагрузки.
 */
export type RoadStoryStep =
  | 'return-to-trader'
  | 'find-caravan'
  | 'settle-supply'
  | 'done';

export type SupplyRoute = 'work' | 'trade' | 'force';

export interface RoadStory {
  step: RoadStoryStep;
  /** Как открыли дорогу. Появляется только вместе с `done`. */
  route?: SupplyRoute;
}

export const ROAD_STORY_STEPS: readonly RoadStoryStep[] = [
  'return-to-trader',
  'find-caravan',
  'settle-supply',
  'done',
];

export const SUPPLY_ROUTES: readonly SupplyRoute[] = ['work', 'trade', 'force'];

/** Первая выкованная вещь запускает главу; повторная ковка ничего не меняет. */
export function startRoadStory(camp: CampState): boolean {
  if (camp.roadStory !== undefined) return false;
  camp.roadStory = { step: 'return-to-trader' };
  return true;
}

/** Торговец называет практическую причину цены: обоз не дошёл. */
export function hearAboutCaravan(camp: CampState): boolean {
  if (camp.roadStory?.step !== 'return-to-trader') return false;
  camp.roadStory = { step: 'find-caravan' };
  return true;
}

/** Выживший принят в лагерь — теперь проблема не в поиске, а в дороге. */
export function rescueCaravaner(camp: CampState): boolean {
  if (camp.roadStory?.step !== 'find-caravan') return false;
  camp.roadStory = { step: 'settle-supply' };
  return true;
}

/** Любой из трёх честно сыгранных исходов закрывает первую главу. */
export function settleSupply(camp: CampState, route: SupplyRoute): boolean {
  if (camp.roadStory?.step !== 'settle-supply') return false;
  camp.roadStory = { step: 'done', route };
  return true;
}

export interface CaravanEncounter {
  readonly survivor: Cell;
  readonly wagon: Cell;
  readonly cargo: readonly Cell[];
}

/**
 * Разговор и бой не могут делить один тупик. Лисы остаются на остальных
 * отвилках, а при следующем обычном входе генератор вернёт исходную стаю.
 */
export function clearCaravanApproach(
  site: TrailSite,
  encounter: CaravanEncounter,
  radius = 5,
): number {
  const before = site.loc.enemies.length;
  for (let i = site.loc.enemies.length - 1; i >= 0; i -= 1) {
    const enemy = site.loc.enemies[i]!;
    if (Math.hypot(enemy.x - encounter.survivor.x, enemy.z - encounter.survivor.z) <= radius) {
      site.loc.enemies.splice(i, 1);
    }
  }
  return before - site.loc.enemies.length;
}

/**
 * Обоз стоит в тупике Тропы, а не на главном ходу: если бы ящики лежали на
 * дороге, их находили бы проходом мимо. Выживший ждёт у конца самого длинного
 * отвилка; повозка — на предыдущей, ящики — ещё на двух шагах до неё.
 * У сида без отвилков остаётся
 * безопасный запасной вариант на двух третях главной осевой.
 */
export function caravanEncounter(site: TrailSite): CaravanEncounter {
  // Дальний по дороге важнее длинного сам по себе: длинный отвилок у входа
  // всё равно показывал бы происшествие до того, как игрок начал поиски.
  const depth = (line: readonly Cell[]): number => {
    const cell = line[line.length - 1];
    return cell === undefined ? -1 : site.loc.backSteps[idx(site.loc.size, cell.x, cell.z)] ?? -1;
  };
  const branch = [...site.branches].sort((a, b) => depth(b.line) - depth(a.line))[0];
  const line = branch?.line.length ? branch.line : site.spine;
  const fallback = Math.max(0, Math.floor(line.length * 2 / 3));
  const at = branch?.line.length ? line.length - 1 : fallback;
  const survivor = line[at] ?? site.exit;
  const wagon = line[Math.max(0, at - 1)] ?? survivor;
  const cargo: Cell[] = [];
  for (let i = 2; i <= 3; i += 1) {
    const cell = line[Math.max(0, at - i)];
    if (cell === undefined || (cell.x === survivor.x && cell.z === survivor.z)) continue;
    if (cell.x === wagon.x && cell.z === wagon.z) continue;
    if (!cargo.some((c) => c.x === cell.x && c.z === cell.z)) cargo.push(cell);
  }
  return { survivor: { ...survivor }, wagon: { ...wagon }, cargo: cargo.map((c) => ({ ...c })) };
}

/**
 * Лицо выводится из места происшествия и остаётся тем же при повторном входе.
 * Если имя уже занято в лагере, берётся следующий детерминированный сид:
 * `admit` различает людей именем и иначе отверг бы спасённого как повтор.
 */
export function caravanSurvivor(seed: number, takenNames: ReadonlySet<string>): Settler {
  for (let salt = 0; salt < 64; salt += 1) {
    const who = generateSettler(seed ^ 0x6f626f7a ^ Math.imul(salt + 1, 0x9e3779b9));
    if (!takenNames.has(who.name)) return who;
  }
  return generateSettler(seed ^ 0x6f626f7a);
}
