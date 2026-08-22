/**
 * Гость у стен замка: палатка, костёр и человек, которого можно позвать.
 *
 * **Зачем он есть.** Знакомство пролога (§16.1) — единственный способ
 * получить жильца, и он одноразовый. Замок — место, куда игрок возвращается
 * (торговец, §13.5), и гость у его стен делает возвращение поводом: иногда
 * в поле между лесом и стеной стоит чужая палатка, у палатки костёр,
 * у костра человек. Разговор — три реплики: кто он, откуда и что ищет.
 * Приглашённый уходит в лагерь **со своим хозяйством**: палатку и костёр
 * он сворачивает, а в лагере ставит заново — на месте, которое выбирает сам.
 *
 * **Гость — не житель замка.** §6.1.6.1 держит правило «торговли и заданий
 * у жильцов двора нет», и гость его не трогает: он стоит снаружи стен,
 * в поле, и к гарнизону с жильцами двора не относится. Замок остаётся
 * постройкой, а не раздатчиком людей — гость есть не у каждого замка
 * (`GUEST_SHARE`), и один и тот же замок отдаёт его один раз.
 *
 * **Всё выводится из сида** — тем же свойством, что гарнизон (§6.1.6.1)
 * и вся генерация локаций (§12): тот же замок — тот же гость на том же
 * месте с той же историей. Состояние одно: «приглашён» — и живёт оно
 * в лагере (`camp.guests`), а не в локации.
 *
 * **Место в лагере выбирает гость, а не игрок.** У палатки за дерево место
 * выбирает игрок (§20.4, `buildTent` с адресом): он платит — он и решает.
 * Гость приносит палатку свою, бесплатную, и правило переворачивается тем
 * же доводом: чьё имущество, того и выбор. Случайность здесь — сид гостя,
 * так что «сам выбрал» переживает перезагрузку.
 */
import { mulberry32, pick, randInt } from '../core/rng';
import { CASTLE_CELL } from './castle';
import { WOOD, spotAt } from './castleSite';
import type { CastleSite } from './castleSite';
import { campArea } from './camp';
import type { CampState } from './camp';
import { idx } from './grid';
import { tentFits } from './residents';
import { generateSettler } from './settler';
import type { SelfAnswer, Settler } from './settler';
import type { Cell } from './types';

/**
 * Доля замков с гостем. Треть — чтобы палатка у стен читалась находкой,
 * а не деталью каждого замка: гость у всех замков разом означал бы, что
 * жильцы раздаются за ходьбу. Доля проверяется замером в правилах
 * (`castleGuest.rules.ts`), а не глазом.
 */
export const GUEST_SHARE = 1 / 3;

/**
 * Откуда гость. Ключи и строки — рабочие подписи (§0.1): за ними нет
 * ни одного решения о мире, лора у них нет, и меняются они строкой.
 * Происхождение ни на что не влияет и влиять не может — это тот самый
 * «выбор происхождения», который отвергнут; здесь оно только реплика.
 */
export type GuestOrigin = 'хутор' | 'застава' | 'обоз' | 'берег';

export const GUEST_ORIGINS: readonly GuestOrigin[] = ['хутор', 'застава', 'обоз', 'берег'];

/** Реплика «откуда» — речь человека, канал диалога (`voice.rules.ts`). */
export const GUEST_FROM_TEXT: Record<GuestOrigin, string> = {
  хутор: '— С хутора за лесом. Хутора больше нет, вот и хожу.',
  застава: '— Со сторожевой заставы. Смена кончилась, а возвращаться некуда.',
  обоз: '— Шёл с обозом. Обоз ушёл, я остался.',
  берег: '— С берега за холмами. Вода поднялась выше дома.',
};

/**
 * Что гость ищет. В отличие от «откуда», ответ обязан что-то менять —
 * то же правило, что у вопроса знакомства (`settler.ts`): всё, что человек
 * сообщает о себе сверх имени, выбирает механику. Здесь оно выбирает,
 * чем он займётся в лагере (`GUEST_WORK`).
 */
export type GuestSeek = 'дело' | 'дорога';

export const GUEST_SEEKS: readonly GuestSeek[] = ['дело', 'дорога'];

/** Реплика «что ищет» — речь человека, канал диалога (`voice.rules.ts`). */
export const GUEST_SEEK_TEXT: Record<GuestSeek, string> = {
  дело: '— Ищу, где строятся. Руки помнят дерево.',
  дорога: '— Ищу спуск под землю. Мне бы к камню поближе.',
};

/**
 * Что искомое значит для лагеря: занятие жильца (`RESIDENT_WORK`).
 * Связка та же, что у ответа знакомства: «где строятся» — дерево,
 * «спуск под землю» — камень (§13.4: камень внизу и есть порода).
 */
export const GUEST_WORK: Record<GuestSeek, SelfAnswer> = {
  дело: 'строим',
  дорога: 'ходим',
};

export interface CastleGuest {
  /** Имя, внешность и сид лица — тем же генератором, что поселенец пролога. */
  readonly who: Settler;
  readonly origin: GuestOrigin;
  readonly seek: GuestSeek;
  /** Клетка палатки — след 1×1, как у палаток лагеря (`TENT_FOOT`). */
  readonly tent: Cell;
  /** Костёр — соседняя клетка. */
  readonly fire: Cell;
  /** Где гость сидит: у костра, наискось от палатки. */
  readonly sit: Cell;
}

/**
 * Гость этого замка, если он сегодня есть. Чистая функция площадки:
 * состояние «приглашён» здесь не живёт — его проверяет вызывающий
 * по `camp.guests`.
 *
 * Стоянка ищется в поле между лесом и стеной (`FIELD`) — там же, где
 * валуны (§13.5), и по той же причине: двор — витрина постройки, и чужая
 * палатка в нём читалась бы частью замка. Дорога и подход не занимаются:
 * мощение зовёт идти по себе, и палатка на нём отменяла бы приглашение.
 */
export function castleGuestAt(site: CastleSite): CastleGuest | null {
  const rng = mulberry32(site.loc.seed ^ 0x67e57);
  if (rng() >= GUEST_SHARE) return null;

  const size = site.loc.size;
  const keep = {
    x: site.at.x,
    z: site.at.z,
    w: site.castle.width * CASTLE_CELL,
    d: site.castle.depth * CASTLE_CELL,
  };
  // Дорога в клетках локации — тот же перевод, каким её обходят валуны.
  const clear = new Set<string>();
  for (const plan of site.roads) {
    const base = spotAt(site, plan);
    for (let dz = 0; dz < CASTLE_CELL; dz++) {
      for (let dx = 0; dx < CASTLE_CELL; dx++) clear.add(`${base.x + dx}:${base.z + dz}`);
    }
  }
  for (const lamp of site.lamps) clear.add(`${lamp.x}:${lamp.z}`);
  const stones = new Set(site.loc.stones.map((s) => `${s.x}:${s.z}`));

  const open = (x: number, z: number): boolean =>
    x >= WOOD && z >= WOOD && x < size - WOOD && z < size - WOOD
    && (x < keep.x || z < keep.z || x >= keep.x + keep.w || z >= keep.z + keep.d)
    && site.loc.blocked[idx(size, x, z)] === 0
    && !(x === site.loc.evac.x && z === site.loc.evac.z)
    && !clear.has(`${x}:${z}`)
    && !stones.has(`${x}:${z}`);

  // Стоянка — три клетки углом: палатка, справа костёр, под ним сиделец.
  // Раскладка одна и не крутится: поле шириной `FIELD` обходит замок кольцом,
  // и мест под угол 2×2 в нём достаточно (проверяется правилом).
  const spots: Cell[] = [];
  for (let z = WOOD; z < size - WOOD; z++) {
    for (let x = WOOD; x < size - WOOD; x++) {
      if (open(x, z) && open(x + 1, z) && open(x + 1, z + 1)) spots.push({ x, z });
    }
  }
  if (spots.length === 0) return null;

  const tent = spots[randInt(rng, spots.length)]!;
  return {
    who: generateSettler(site.loc.seed ^ 0x9e57),
    origin: pick(rng, GUEST_ORIGINS),
    seek: pick(rng, GUEST_SEEKS),
    tent,
    fire: { x: tent.x + 1, z: tent.z },
    sit: { x: tent.x + 1, z: tent.z + 1 },
  };
}

/** Шаги разговора. Кадра три — кто, откуда, что ищет, — и четвёртого нет. */
export type GuestStep = 'кто' | 'откуда' | 'дело' | 'кончено';

export const GUEST_ORDER: readonly GuestStep[] = ['кто', 'откуда', 'дело', 'кончено'];

export interface GuestMeet {
  step: GuestStep;
  /** Позвал ли игрок его с собой. */
  invited: boolean;
}

export const startGuestMeet = (): GuestMeet => ({ step: 'кто', invited: false });

/** Шаг вперёд — только вперёд и по одному кадру, как у знакомства. */
export function advanceGuest(state: GuestMeet): GuestStep {
  const at = GUEST_ORDER.indexOf(state.step);
  state.step = GUEST_ORDER[Math.min(at + 1, GUEST_ORDER.length - 1)]!;
  return state.step;
}

/**
 * Где гость ставит своё в лагере. Палатка — случайная свободная клетка
 * (`tentFits` — то же правило, каким место проверяется у игрока), костёр —
 * свободный сосед палатки. Случайность — сид гостя: «сам выбрал» обязано
 * переживать перезагрузку, и `Math.random` в симуляции запрещён.
 *
 * `null` у костра — не ошибка: если соседа не нашлось, гость обходится
 * без костра, но не без палатки. `null` целиком — на площадке нет места;
 * гость всё равно входит в лагерь (без крыши — не тупик, `residents.ts`),
 * просто ставить ему нечего некуда.
 */
export function guestPitch(
  camp: CampState,
  seed: number,
): { tent: Cell; fire: Cell | null } | null {
  const rng = mulberry32(seed ^ 0x9f1e);
  const area = campArea(camp.levels.hq);
  const spots: Cell[] = [];
  for (let z = 0; z < area; z++) {
    for (let x = 0; x < area; x++) {
      if (tentFits(camp, x, z)) spots.push({ x, z });
    }
  }
  if (spots.length === 0) return null;
  const tent = spots[randInt(rng, spots.length)]!;

  const sides: readonly Cell[] = [
    { x: tent.x + 1, z: tent.z },
    { x: tent.x - 1, z: tent.z },
    { x: tent.x, z: tent.z + 1 },
    { x: tent.x, z: tent.z - 1 },
  ];
  const first = randInt(rng, sides.length);
  let fire: Cell | null = null;
  for (let i = 0; i < sides.length; i++) {
    const c = sides[(first + i) % sides.length]!;
    // Клетка костра меряется тем же правилом, что палаточная: костёр — не
    // здание, но клетку он занимает, и палатка на костре была бы палаткой
    // в огне.
    if (c.x === tent.x && c.z === tent.z) continue;
    if (tentFits(camp, c.x, c.z)) {
      fire = c;
      break;
    }
  }
  return { tent, fire };
}
