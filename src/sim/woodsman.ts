/**
 * Лесник у замка (§6.1.6.3): человек, которого не находят, а нанимают.
 *
 * **Чем он не гость.** Гость у стен (§6.1.6.2) — находка: он стоит у трети
 * замков, отдаётся один раз и платится ресурсами, которые игрок принёс
 * из вылазки. Лесник — услуга: он стоит **у каждого** замка, нанимается
 * сколько угодно раз и платится монетой (§20.5). Отсюда всё остальное:
 * редкость гостя и есть его цена, а у услуги цена в кошельке, и потому
 * заведён единственный настоящий сток монеты кроме ускорения стройки.
 *
 * **Цена удваивается, и это её главная работа.** Сто монет — десять дней
 * входов; второй лесник стоит двадцати, третий сорока. Плоская цена
 * превращала бы монету в очередь («заходи и покупай людей»), а удвоение
 * останавливает лагерь на том числе лесников, которое он вправду в силах
 * прокормить: пища и крыша с каждым человеком тратятся одинаково (§13.7),
 * а платится за него вдвое больше.
 *
 * **Что он умеет — одно, и оно проверяемое.** На дереве он вдвое быстрее
 * обычных рук и на единицу выше потолком (`WOODSMAN_SWING`, `WOODSMAN_CAP`
 * в `residents.ts` — числа лежат рядом с общим темпом, иначе прибавка
 * и её граница разошлись бы). На камне и на пище он обычный жилец: лес
 * он знает, а породу нет.
 *
 * **Ест и требует крышу как все.** Ремесло не отменяет ни одного правила
 * содержания: он рот (§13.7) и он не работает без палатки (`hasRoof`).
 * Купленный человек, которому не нужны ни еда, ни жильё, был бы прибавкой
 * к складу, а не жильцом, — и первым же отменил бы смысл кухни.
 *
 * **Место у леса, а не у ворот.** Пост стоит в поле, вплотную к кромке
 * леса: лесник живёт лесом, и стоять ему у мощёной дороги незачем. Всё
 * выводится из сида замка, как гость и гарнизон, — тот же замок, тот же
 * пост на том же месте.
 */
import { mulberry32, randInt } from '../core/rng';
import { CASTLE_CELL } from './castle';
import { WOOD, spotAt } from './castleSite';
import type { CastleSite } from './castleSite';
import { castleGuestAt } from './castleGuest';
import { coinsOf, spendCoins } from './camp';
import type { CampState } from './camp';
import { idx } from './grid';
import { admit } from './residents';
import type { Resident } from './residents';
import { NAMES, generateSettler } from './settler';
import type { Settler } from './settler';
import type { Cell } from './types';

/**
 * Цена первого лесника в монетах (§20.5). Число **черновое**, как цена
 * палатки, и держится оно одной связью, которую видно: монета приходит
 * по десять в сутки за вход, значит первый лесник — это десять дней,
 * в которые игрок заходил. Меньше сотни — и человек покупается за неделю
 * невнимания; больше — и первый наём не случается вовсе.
 */
export const WOODSMAN_COIN = 100;

/** Во сколько раз дороже каждый следующий. */
export const WOODSMAN_STEP = 2;

/** Сколько лесников уже нанято. Не хранится: ремесло лежит на жильцах. */
export const woodsmenOf = (camp: CampState): number =>
  camp.residents.filter((r) => r.craft === 'лесник').length;

/** Цена следующего лесника при стольких уже нанятых. */
export const woodsmanPrice = (hired: number): number =>
  WOODSMAN_COIN * WOODSMAN_STEP ** Math.max(0, hired);

/** Цена следующего лесника этому лагерю. */
export const nextWoodsmanPrice = (camp: CampState): number =>
  woodsmanPrice(woodsmenOf(camp));

export type HireBlock = 'ok' | 'coins';

/**
 * Почему лесника сейчас не нанять. Причина, а не булево (§23.3), и причина
 * ровно одна: кошелёк. Крыши в списке нет намеренно — §16.1 держит правило
 * «лагерь тратит собранное, но не запирается за ним», и бездомный лесник
 * это задание построить палатку, а не отказ в найме.
 */
export function hireBlock(camp: CampState): HireBlock {
  return coinsOf(camp) < nextWoodsmanPrice(camp) ? 'coins' : 'ok';
}

export const HIRE_REASON: Record<Exclude<HireBlock, 'ok'>, string> = {
  coins: 'Монет на уговор не хватает',
};

/** Пост лесника: его палатка, мишень и клетка, на которой он стоит. */
export interface WoodsmanPost {
  /** Имя и сид лица — тем же генератором, что поселенец пролога. */
  readonly who: Settler;
  /** Палатка набора Kenney Mini Forest (§6.1.18) — след 1×1. */
  readonly tent: Cell;
  /** Мишень того же набора: чем лесник занят, когда не в лесу. */
  readonly target: Cell;
  /** Где он стоит — между палаткой и мишенью. */
  readonly stand: Cell;
}

/**
 * Пост этого замка. Чистая функция площадки: нанятые здесь не хранятся —
 * лесника можно нанять снова, и второй раз он тот же самый человек только
 * лицом, а имя ему выбирает лагерь (`hireWoodsman`).
 *
 * `null` — места под пост не нашлось. Это не редкость, а вырожденный
 * случай: поле кольцом шириной `FIELD` вокруг замка, и три клетки углом
 * в нём есть всегда, кроме площадок, забитых дорогой и валунами целиком.
 */
export function woodsmanPostAt(site: CastleSite): WoodsmanPost | null {
  const size = site.loc.size;
  const keep = {
    x: site.at.x,
    z: site.at.z,
    w: site.castle.width * CASTLE_CELL,
    d: site.castle.depth * CASTLE_CELL,
  };
  // Занятое читается тем же способом, что у гостя: дорога в клетках локации,
  // фонари, валуны. Второй перевод разошёлся бы с первым молча.
  const clear = new Set<string>();
  for (const plan of site.roads) {
    const base = spotAt(site, plan);
    for (let dz = 0; dz < CASTLE_CELL; dz++) {
      for (let dx = 0; dx < CASTLE_CELL; dx++) clear.add(`${base.x + dx}:${base.z + dz}`);
    }
  }
  for (const lamp of site.lamps) clear.add(`${lamp.x}:${lamp.z}`);
  for (const stone of site.loc.stones) clear.add(`${stone.x}:${stone.z}`);
  for (const bush of site.bushes) clear.add(`${bush.x}:${bush.z}`);
  // Стоянка гостя — тоже занятое. Знает о ней этот модуль, а не наоборот:
  // гость встал у стен первым, и двигать его ради поста было бы починкой
  // работающего кадра.
  const guest = castleGuestAt(site);
  if (guest !== null) {
    for (const cell of [guest.tent, guest.fire, guest.sit]) clear.add(`${cell.x}:${cell.z}`);
  }

  const open = (x: number, z: number): boolean =>
    x >= WOOD && z >= WOOD && x < size - WOOD && z < size - WOOD
    && (x < keep.x || z < keep.z || x >= keep.x + keep.w || z >= keep.z + keep.d)
    && site.loc.blocked[idx(size, x, z)] === 0
    && !(x === site.loc.evac.x && z === site.loc.evac.z)
    && !clear.has(`${x}:${z}`);

  /**
   * Ближе к лесу — лучше. Мерка — расстояние до кромки леса, та же, какой
   * поле и очерчено (`WOOD`): пост лесника у самой стены читался бы двором,
   * а не заимкой. Из равно близких выбирает сид замка: «встал сам»
   * обязано переживать перезагрузку.
   */
  const spots: Cell[] = [];
  let best = Infinity;
  for (let z = WOOD; z < size - WOOD; z++) {
    for (let x = WOOD; x < size - WOOD; x++) {
      if (!open(x, z) || !open(x + 1, z) || !open(x + 1, z + 1)) continue;
      const edge = Math.min(x - WOOD, z - WOOD, size - WOOD - 1 - (x + 1), size - WOOD - 1 - (z + 1));
      if (edge > best) continue;
      if (edge < best) {
        best = edge;
        spots.length = 0;
      }
      spots.push({ x, z });
    }
  }
  if (spots.length === 0) return null;

  const rng = mulberry32(site.loc.seed ^ 0x1e5c);
  const tent = spots[randInt(rng, spots.length)]!;
  return {
    who: generateSettler(site.loc.seed ^ 0x1e5f),
    tent,
    stand: { x: tent.x + 1, z: tent.z },
    target: { x: tent.x + 1, z: tent.z + 1 },
  };
}

/**
 * Шаги разговора. Кадра два: кто он и во сколько встанет. Меньше, чем
 * у гостя (§6.1.6.2), и это не экономия: у гостя спрашивают, откуда он
 * и что ищет, потому что зовут **его**, а лесник нанимается — про него
 * важно ровно одно, что он умеет, и оно же названо ценой.
 */
export type HireStep = 'кто' | 'уговор' | 'кончено';

export const HIRE_ORDER: readonly HireStep[] = ['кто', 'уговор', 'кончено'];

export interface WoodsmanTalk {
  step: HireStep;
  /** Нанят ли он в этот заход: нанятый уходит с игроком и поста не держит. */
  hired: boolean;
}

export const startHireTalk = (): WoodsmanTalk => ({ step: 'кто', hired: false });

/** Шаг вперёд — только вперёд и по одному кадру, как у знакомства. */
export function advanceHire(state: WoodsmanTalk): HireStep {
  const at = HIRE_ORDER.indexOf(state.step);
  state.step = HIRE_ORDER[Math.min(at + 1, HIRE_ORDER.length - 1)]!;
  return state.step;
}

/**
 * Цена строкой. Отдельной строкой, а не внутри реплики, — тем же правилом,
 * каким отдельно стоят дар знакомства и уговор гостя: перечень с числом
 * в кавычках прямой речи читался бы репликой, которую произносят вслух.
 */
export const hireLine = (price: number): string => `Наём: монеты ${price}`;

/**
 * Имя нанятому. Пул общий с знакомством (§0.1), и потому имена кончаются:
 * `admit` отказывает тёзке, а лагерь на шестнадцатом человеке упёрся бы
 * в это молча. Занятое имя обходится сдвигом сида, а когда пул исчерпан —
 * порядковым номером: два Ларта в лагере хуже, чем «Ларт 2».
 */
export function woodsmanName(camp: CampState, seed: number): string {
  const taken = new Set(camp.residents.map((r) => r.name));
  for (let step = 0; step < NAMES.length; step++) {
    const name = generateSettler((seed + step * 0x9e3779b9) >>> 0).name;
    if (!taken.has(name)) return name;
  }
  const base = generateSettler(seed >>> 0).name;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Нанять лесника. Платится монетой, приходит с занятием «носить дерево»:
 * ремесло и занятие обязаны совпасть в первый же день, иначе купленный
 * за сотню человек стоит в лагере обычными руками, пока игрок не заглянет
 * в карточку.
 *
 * Возвращает нанятого или `null`, если не вышло. Монета списывается
 * последней — до неё ничего необратимого не происходит.
 */
export function hireWoodsman(camp: CampState, post: WoodsmanPost): Resident | null {
  if (hireBlock(camp) !== 'ok') return null;
  // Цена считается **до** приёма: нанятый лесник поднимает её вдвое сам
  // (`woodsmenOf`), и посчитанная после она сняла бы с игрока цену
  // следующего человека за этого.
  const price = nextWoodsmanPrice(camp);
  const who: Resident = {
    name: woodsmanName(camp, post.who.seed),
    look: post.who.look,
    seed: post.who.seed,
    answer: 'строим',
    rest: false,
    craft: 'лесник',
  };
  if (!admit(camp, who)) return null;
  spendCoins(camp, price);
  return who;
}
